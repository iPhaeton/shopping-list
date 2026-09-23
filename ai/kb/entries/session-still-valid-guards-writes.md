---
id: session-still-valid-guards-writes
title: Signing out globally does not revoke an already-issued access token — writes now check auth.sessions fresh on every call
type: decision
status: current
tags: [supabase, postgres, auth, security, rls]
sources: [ai/tasks/15-session-revocation/implementation-log-step-1.md, ai/tasks/15-session-revocation/implementation-log-step-2.md, ai/tasks/17-user-names/implementation-log-step-1.md, ai/tasks/18-share-by-name/implementation-log-step-1.md, supabase/migrations/20260920000000_session_revocation.sql, supabase/migrations/20260921000000_user_names.sql, supabase/migrations/20260922000000_share_by_name.sql, src/lib/listsApi.ts]
last_verified: 2026-09-22
verify: grep -q "^create function public.session_still_valid" supabase/migrations/20260920000000_session_revocation.sql && grep -A6 "^create function public.session_still_valid" supabase/migrations/20260920000000_session_revocation.sql | grep -q "security definer" && grep -q "auth.jwt() ->> 'session_id'" supabase/migrations/20260920000000_session_revocation.sql && grep -q '^revoke execute on function public.session_still_valid() from public, anon;' supabase/migrations/20260920000000_session_revocation.sql && grep -q '^grant execute on function public.session_still_valid() to authenticated;' supabase/migrations/20260920000000_session_revocation.sql && test "$(grep -rh 'if not public.session_still_valid() then' supabase/migrations | wc -l | tr -d ' ')" = 11 && test "$(grep -rl 'session_still_valid' supabase/migrations | wc -l | tr -d ' ')" = 3 && grep -q 'if not public.session_still_valid() then' supabase/migrations/20260921000000_user_names.sql && grep -q 'if not public.session_still_valid() then' supabase/migrations/20260922000000_share_by_name.sql && grep -A2 "case '42501':" src/lib/listsApi.ts | grep -q 'You no longer have permission' && grep -q "supabase.from('lists').insert({ id, name })" src/lib/listsApi.ts && grep -q "sessionRevoked: error.code === '42501' && error.message === SESSION_REVOKED_MESSAGE" src/lib/listsApi.ts
related: [server-stamps-done-at, list-data-scoped-by-rls, read-rooted-at-list-members, realtime-is-a-nudge-to-a-per-user-inbox, supabase-default-grants-defeat-revokes, writes-retry-from-an-outbox, insert-returning-races-membership-trigger, session-revoked-write-redirects]
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
inside `begin` in all ten write RPCs: `set_item_done`, `add_item`, `rename_item`, `rename_list`,
`set_list_deleted`, `set_item_deleted`, `share_list`, `set_member_role`, `remove_member`, and — since
step 17 — `set_name` ([user_names.sql](../../../supabase/migrations/20260921000000_user_names.sql)).
Each raises `42501` with `'this device has been signed out'` on failure — the same SQLSTATE every other refusal
in this schema already raises, so `verdictFor` in [listsApi.ts](../../../src/lib/listsApi.ts) already
classifies it `permanent` with no client change needed
([server-stamps-done-at](server-stamps-done-at.md)).

**The `verify:` grep counts 11 occurrences across 3 files, not 10 across 2 — and that is migration
history accumulating, not an eleventh RPC.** Step 18 dropped and recreated `share_list` with a new
signature (`uuid, uuid, list_role`, id instead of email) to take an id a name search already
resolved; the guard was carried over into the new function body verbatim. Migrations are
append-only, so `20260920000000_session_revocation.sql` still holds the original `share_list`
definition's copy of the check, and `20260922000000_share_by_name.sql` now holds a second one for the
same RPC under its new signature. The set of **currently active** write RPCs is still exactly ten;
count files, not just occurrences, before assuming a grep count change means a new call site.

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
one of the ten RPCs** — `insertList` sends a plain `.insert()` into `lists`, unchanged by this
migration, and the `lists` INSERT policy checks only `created_by = (select auth.uid())`. **A revoked
device can still create new lists until its access token naturally expires.** Closing that gap, and
folding the check into the read side, were both scoped out as separate work, not oversights.

**The distinct message never reaches the user as text — step 2 reads it before `humanize` can erase
it.** `writeResult` still maps every `42501` to the same generic sentence, `'You no longer have
permission to make that change.'`, and the four non-outbox RPCs (the three membership calls plus
`set_name`) still skip `humanize` and keep the database's own words. But `resultFor` — the function
both paths call — now matches the exact string
`'this device has been signed out'` into `Result.sessionRevoked` *before* either of those renderings
happens, and both the outbox (`useOutbox.flush`) and `SharingScreen`'s `run()` check that flag first
and redirect to sign-in instead of showing anything
([session-revoked-write-redirects](session-revoked-write-redirects.md) has the client-side mechanism:
the write is not dropped, and the reason reaches `SignInScreen`). Do not assume a plain `42501` refusal
is the only shape a caller has to handle — check `sessionRevoked` on the `Result` first.

**What to do:** a new write RPC that should not survive a global sign-out adds `if not
public.session_still_valid() then raise exception using errcode = '42501', message = '...'; end if;`
as its first statement, matching this shape exactly. A new *read* RPC, or a change to
`list_members_of` or the SELECT policies, does not get this check — that closure is unmade work, not
an oversight to "complete" casually. The `verify:` command asserts the function's shape and grants,
that exactly ten call sites guard themselves across the migrations that add them, that no third
migration has adopted the function (the read side stays untouched), that `humanize` still collapses
`42501` to one sentence, and that `insertList` is still a bare `.insert()`.
