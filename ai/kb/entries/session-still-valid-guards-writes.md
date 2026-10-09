---
id: session-still-valid-guards-writes
title: Signing out globally does not revoke an already-issued access token — writes now check auth.sessions fresh on every call
type: decision
status: current
tags: [supabase, postgres, auth, security, rls]
sources: [ai/tasks/15-session-revocation/implementation-log-step-1.md, ai/tasks/15-session-revocation/implementation-log-step-2.md, ai/tasks/17-user-names/implementation-log-step-1.md, ai/tasks/18-share-by-name/implementation-log-step-1.md, ai/tasks/18-share-by-name/implementation-log-step-2.md, ai/tasks/19-remove-oneself/implementation-log-step-1.md, supabase/migrations/20260920000000_session_revocation.sql, supabase/migrations/20260921000000_user_names.sql, supabase/migrations/20260922000000_share_by_name.sql, supabase/migrations/20260923000000_set_name_min_length.sql, supabase/migrations/20260924000000_leave_list.sql, ai/tasks/23-list-limits/implementation-log-step-2.md, supabase/migrations/20261001000000_list_limits.sql, ai/tasks/25-account-deletion/implementation-log-step-2.md, supabase/migrations/20261005000000_delete_account.sql, ai/tasks/25-account-deletion/implementation-log-step-3.md, src/lib/listsApi.ts, ai/tasks/26-apple-sign-in/implementation-log-step-4.md, 78f86a4, ai/tasks/28-invitations/implementation-log-step-1.md, ai/tasks/28-invitations/implementation-log-step-3.md, ai/tasks/28-invitations/implementation-log-step-4-unblock.md, supabase/migrations/20261008000000_invitations.sql, supabase/migrations/20261009000000_drop_share_list.sql, supabase/migrations/20261009100000_unblock_restores_invitations.sql, 47965d5, 5ab9b85, 2916e6e]
last_verified: 2026-10-09
verify: grep -q "^create function public.session_still_valid" supabase/migrations/20260920000000_session_revocation.sql && grep -A6 "^create function public.session_still_valid" supabase/migrations/20260920000000_session_revocation.sql | grep -q "security definer" && grep -q "auth.jwt() ->> 'session_id'" supabase/migrations/20260920000000_session_revocation.sql && grep -q '^revoke execute on function public.session_still_valid() from public, anon;' supabase/migrations/20260920000000_session_revocation.sql && grep -q '^grant execute on function public.session_still_valid() to authenticated;' supabase/migrations/20260920000000_session_revocation.sql && test "$(awk '/^create (or replace )?function public\./{match($0,/public\.[a-z_]+/); f=substr($0,RSTART,RLENGTH); g[f]=0} /^drop function (if exists )?public\./{match($0,/public\.[a-z_]+/); delete g[substr($0,RSTART,RLENGTH)]; f=""} /if not public\.session_still_valid\(\) then/{if (f != "") g[f]=1} END{for (k in g) if (g[k]) print k}' supabase/migrations/*.sql | sort | tr '\n' ' ')" = "public.accept_invitation public.add_item public.block_inviter public.decline_invitation public.delete_account public.invite_to_list public.leave_list public.mark_notifications_read public.remove_member public.rename_item public.rename_list public.set_item_deleted public.set_item_done public.set_list_deleted public.set_member_role public.set_name public.unblock_user public.withdraw_invitation " && test "$(grep -rh 'session_still_valid' supabase/migrations | grep -v '^ *--' | grep -vc 'if not public.session_still_valid() then')" = 3 && grep -A2 "case '42501':" src/lib/listsApi.ts | grep -q 'You no longer have permission' && grep -q "supabase.from('lists').insert({ id, name })" src/lib/listsApi.ts && grep -q "sessionRevoked: error.code === '42501' && error.message === SESSION_REVOKED_MESSAGE" src/lib/listsApi.ts
related: [server-stamps-done-at, list-data-scoped-by-rls, read-rooted-at-list-members, realtime-is-a-nudge-to-a-per-user-inbox, supabase-default-grants-defeat-revokes, writes-retry-from-an-outbox, insert-returning-races-membership-trigger, session-revoked-write-redirects, delete-account-locks-then-removes-sole-owned-lists]
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
inside `begin` in all eighteen write RPCs: `set_item_done`, `add_item`, `rename_item`, `rename_list`,
`set_list_deleted`, `set_item_deleted`, `set_member_role`, `remove_member`, `set_name`
([user_names.sql](../../../supabase/migrations/20260921000000_user_names.sql)), `leave_list`
([leave_list.sql](../../../supabase/migrations/20260924000000_leave_list.sql)), `delete_account`
([delete-account-locks-then-removes-sole-owned-lists](delete-account-locks-then-removes-sole-owned-lists.md)),
and task 28's seven: `invite_to_list`, `withdraw_invitation`, `accept_invitation`,
`decline_invitation`, `block_inviter`, `unblock_user`, `mark_notifications_read`
([invitations.sql](../../../supabase/migrations/20261008000000_invitations.sql)). `share_list` was
one until task 28 step 3 dropped it. `block_inviter` runs the guard twice — its own, then
`decline_invitation`'s, which it calls. Each raises `42501` with `'this device has been signed out'` on failure — the same SQLSTATE every other refusal
in this schema already raises, so `verdictFor` in [listsApi.ts](../../../src/lib/listsApi.ts) already
classifies it `permanent` with no client change needed
([server-stamps-done-at](server-stamps-done-at.md)).

**The guard is copied forward with every redefinition, so count RPCs, not grep lines.** Migrations
are append-only, and a `create or replace` (or a drop-and-recreate with a new signature) carries the
whole body, guard included, into a new file (`unblock_user`'s latest `create` is
`20261009100000_unblock_restores_invitations.sql`), and a dropped function's guards stay in the old
files: as of task 28 there are 30 guard lines across 10 files for eighteen live RPCs, `share_list`'s
among them. A moving line count is not evidence of a new call site, and the `verify:` does not count
lines: it takes each function's **latest** definition across the migrations, forgets one a later
`drop function` removed, and asserts the set of guarded ones is exactly these eighteen — so a new
guarded RPC, a drop, and a redefinition that loses the guard all fail it.

**Testing a write RPC from `psql` needs a real `session_id` in `request.jwt.claims`.** With only
`sub`, as [supabase-local-stack](supabase-local-stack.md)'s role-switching recipe sets, every one of
the eighteen raises `'this device has been signed out'` — the guard looks the id up in
`auth.sessions`. Sign the account in through OTP (Mailpit and `/auth/v1/verify`) and take the id
from its row there; task 23 step 2's SQL cases ran that way. **Wrap the `set_config(…, true)` and the
call in `begin … commit`**: outside a transaction block the setting dies with its own implicit
transaction, and the call that follows raises the same `'this device has been signed out'` (task 28
step 1's first `delete_account` case). **A new account's first OTP verify leaves
two `auth.sessions` rows**, about 80 ms apart, and the returned token names the second — a test that
counts a user's sessions must expect the extra one.

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
one of the eighteen RPCs** — `insertList` sends a plain `.insert()` into `lists`, unchanged by this
migration, and the `lists` INSERT policy checks only `created_by = (select auth.uid())`. **A revoked
device can still create new lists until its access token naturally expires.** Closing that gap, and
folding the check into the read side, were both scoped out as separate work, not oversights.

**After `delete_account`, a stale access token on another device gets two different refusals.**
Reads answer 200 `[]`, and a guarded RPC answers 403 `42501` `'this device has been signed out'`,
which redirects. But the unguarded `lists` insert gets **409 `23503`** — the INSERT policy passes and
`lists_created_by_fkey` refuses, since the `sub` no longer exists in `auth.users`. That is not
`sessionRevoked`: `verdictFor` makes it `permanent`, `humanize` has no `23503` case so the banner shows
the raw FK sentence, and `dropDependents` drops the items queued into that list. Observed in the
browser in task 25 step 3 — the op dropped, the device still signed in — and **deliberately left
unhandled**: the device stays signed in until a guarded write redirects it (`set_name` did, in 214 ms)
or its access token expires. **A device that reopens after a deletion elsewhere lands on Choose your
name first**: its access token is still valid, the unguarded profile read finds no `public.users`
row, so the name gate shows, and only `set_name` then refuses and sends it to Sign in (seen in task
26 step 4 after a web deletion). Expected under this decision, not a regression to fix.

**The distinct message never reaches the user as text — step 2 reads it before `humanize` can erase
it.** `writeResult` still maps every `42501` to the same generic sentence, `'You no longer have
permission to make that change.'`, and the twelve non-outbox RPCs (membership, invitation, block,
notification, `set_name`, `delete_account`) skip `humanize` and keep the database's own words. But
`resultFor` — the function both paths call — matches the exact string
`'this device has been signed out'` into `Result.sessionRevoked` *before* either of those renderings
happens, and the outbox (`useOutbox.flush`) and every synchronous call site check that flag first
and redirect to sign-in instead of showing anything
([session-revoked-write-redirects](session-revoked-write-redirects.md) has the client-side mechanism:
the write is not dropped, and the reason reaches `SignInScreen`). Do not assume a plain `42501` refusal
is the only shape a caller has to handle — check `sessionRevoked` on the `Result` first.

**What to do:** a new write RPC that should not survive a global sign-out adds `if not
public.session_still_valid() then raise exception using errcode = '42501', message = '...'; end if;`
as its first statement, matching this shape exactly, and a redefinition of a guarded one keeps it. A
new *read* RPC (`my_list_counts()` is one), or a change to `list_members_of` or the SELECT policies,
does not get this check — that closure is unmade work, not an oversight to "complete" casually. The
`verify:` command asserts the function's shape and grants, that the latest live definitions guard
exactly these eighteen RPCs, that nothing outside its own definition and those guards mentions it (no policy
or read has adopted it), that `humanize` still collapses `42501` to one sentence, and that
`insertList` is still a bare `.insert()`.
