---
id: session-still-valid-guards-writes
title: Signing out globally does not revoke an already-issued access token — writes now check auth.sessions fresh on every call
type: decision
status: current
tags: [supabase, postgres, auth, security, rls]
sources: [ai/tasks/15-session-revocation/implementation-log-step-1.md, supabase/migrations/20260920000000_session_revocation.sql, src/lib/listsApi.ts]
last_verified: 2026-09-20
verify: grep -q "^create function public.session_still_valid" supabase/migrations/20260920000000_session_revocation.sql && grep -A6 "^create function public.session_still_valid" supabase/migrations/20260920000000_session_revocation.sql | grep -q "security definer" && grep -q "auth.jwt() ->> 'session_id'" supabase/migrations/20260920000000_session_revocation.sql && grep -q '^revoke execute on function public.session_still_valid() from public, anon;' supabase/migrations/20260920000000_session_revocation.sql && grep -q '^grant execute on function public.session_still_valid() to authenticated;' supabase/migrations/20260920000000_session_revocation.sql && test "$(grep -c 'if not public.session_still_valid() then' supabase/migrations/20260920000000_session_revocation.sql)" = 9 && test "$(grep -rl 'session_still_valid' supabase/migrations | wc -l | tr -d ' ')" = 1 && grep -A2 "case '42501':" src/lib/listsApi.ts | grep -q 'You no longer have permission' && grep -q "supabase.from('lists').insert({ id, name })" src/lib/listsApi.ts
related: [server-stamps-done-at, list-data-scoped-by-rls, read-rooted-at-list-members, realtime-is-a-nudge-to-a-per-user-inbox, supabase-default-grants-defeat-revokes, writes-retry-from-an-outbox, insert-returning-races-membership-trigger]
---

`auth.signOut({ scope: 'global' })` deletes the caller's row from `auth.sessions` and revokes its
refresh token — but the **access token** already handed to that device is a self-contained JWT,
checked by signature and expiry only. Measured directly against the local stack: the same access
token that unlocked `GET /rest/v1/lists` (`200`) kept unlocking it after
`POST /auth/v1/logout?scope=global` (`204`), for up to `jwt_expiry` (1h, `supabase/config.toml`), on
any device, online or not. This is the bug "sign out of all devices" was reported not to fix: a
second, already-signed-in device kept writing for up to an hour after the button was pressed
elsewhere.

**The fix is a fresh, per-request check, not a notification.**
[`public.session_still_valid()`](../../../supabase/migrations/20260920000000_session_revocation.sql)
is `select exists (select 1 from auth.sessions where id = (auth.jwt() ->> 'session_id')::uuid)` —
`security definer`, because `authenticated` holds no grant at all on `auth.sessions` (only `postgres`
does; an `invoker` version would fail outright, valid session or not). It is the first statement
inside `begin` in all nine write RPCs: `set_item_done`, `add_item`, `rename_item`, `rename_list`,
`set_list_deleted`, `set_item_deleted`, `share_list`, `set_member_role`, `remove_member`. Each raises
`42501` with `'this device has been signed out'` on failure — the same SQLSTATE every other refusal
in this schema already raises, so `verdictFor` in [listsApi.ts](../../../src/lib/listsApi.ts) already
classifies it `permanent` with no client change needed
([server-stamps-done-at](server-stamps-done-at.md)).

**A realtime "kick" was considered and rejected.** Delivery on the per-user nudge channel is
at-most-once ([realtime-is-a-nudge-to-a-per-user-inbox](realtime-is-a-nudge-to-a-per-user-inbox.md)):
a device offline at the moment of sign-out never receives it, and reconnecting afterward does not
force a token refresh — it resumes on the same stale-but-valid token. A check that runs fresh on
every request, independent of whether anything was ever delivered, is the only shape that closes the
offline case.

**Cost, measured rather than assumed.** `explain (analyze, buffers)` against a live `auth.sessions`
table: 0.25ms, 1 buffer. The function takes no arguments and mentions nothing about the row it sits
beside, so Postgres evaluates it once per statement — the same InitPlan treatment `(select
auth.uid())` and `my_memberships()` already get
([read-rooted-at-list-members](read-rooted-at-list-members.md)), not the per-row shape that entry
rejected on cost grounds. `auth.sessions` is sized by live sessions across the whole install, not by
list/item row counts.

**Scope is writes only, deliberately, and narrower than "every write" reads.** `list_members_of` and
the SELECT-side RLS policies (`my_memberships()`, the read policies) are untouched: a revoked device
may still *read* briefly-stale data until its token naturally expires. And **creating a list is not
one of the nine RPCs** — `insertList` sends a plain `.insert()` into `lists`, unchanged by this
migration, and the `lists` INSERT policy checks only `created_by = (select auth.uid())`. **A revoked
device can still create new lists until its access token naturally expires.** Closing that gap, and
folding the check into the read side, were both scoped out as separate work, not oversights.

**The distinct message rarely reaches the user.** Six of the nine guarded RPCs are outbox writes;
their `42501` goes through `writeResult` → `humanize()`, which maps *every* `42501` — a role refusal
and a revoked session alike — to the same generic sentence, `'You no longer have permission to make
that change.'` Only the three membership RPCs (`share_list`, `set_member_role`, `remove_member`),
which skip `humanize`, would show `'this device has been signed out'` verbatim. Do not assume the
banner tells revocation apart from an ordinary role refusal without checking `humanize` first.

**What to do:** a new write RPC that should not survive a global sign-out adds `if not
public.session_still_valid() then raise exception using errcode = '42501', message = '...'; end if;`
as its first statement, matching this shape exactly. A new *read* RPC, or a change to
`list_members_of` or the SELECT policies, does not get this check — that closure is unmade work, not
an oversight to "complete" casually. The `verify:` command asserts the function's shape and grants,
that exactly nine call sites guard themselves, that no other migration has adopted the function (the
read side stays untouched), that `humanize` still collapses `42501` to one sentence, and that
`insertList` is still a bare `.insert()`.
