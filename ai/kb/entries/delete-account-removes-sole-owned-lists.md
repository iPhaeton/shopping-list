---
id: delete-account-removes-sole-owned-lists
title: Deleting an account is one guarded definer RPC that hard-deletes every list the caller solely owns, then the `auth.users` row — in that order, never tombstoned, never locked
type: decision
status: current
tags: [supabase, postgres, auth, deletion, account]
sources: [ai/tasks/25-account-deletion/description-step-2.md, ai/tasks/25-account-deletion/implementation-log-step-2.md, supabase/migrations/20261005000000_delete_account.sql]
last_verified: 2026-10-05
verify: f=$(grep -lE '^create (or replace )?function public\.delete_account\(' supabase/migrations/*.sql | tail -1) && test -n "$f" && grep -A4 -E '^create (or replace )?function public\.delete_account\(\)' "$f" | grep -q 'security definer' && test "$(grep -E '^ *delete from (public\.lists|auth\.users)' "$f" | sed -E 's/^ *delete from ([a-z_.]+).*/\1/' | tr '\n' ' ')" = "public.lists auth.users " && grep -q "m.user_id <> (select auth.uid()) and m.role = 'owner'" "$f" && ! grep -v '^ *--' "$f" | grep -qiE 'advisory|for update|deleted_at' && grep -rq '^revoke execute on function public.delete_account() from public, anon;' supabase/migrations && grep -rq '^grant execute on function public.delete_account() to authenticated;' supabase/migrations && ! grep -rqiE '^create index.*\(created_by' supabase/migrations && grep -A1 'add constraint lists_created_by_fkey' supabase/migrations/20260907000000_list_sharing.sql | grep -q 'on delete set null'
indexed: false
related: [session-still-valid-guards-writes, deletion-is-a-tombstone, list-data-scoped-by-rls, session-revoked-write-redirects, supabase-default-grants-defeat-revokes, supabase-local-stack]
---

**`public.delete_account()`** ([the migration](../../../supabase/migrations/20261005000000_delete_account.sql))
is `security definer`, guarded by `session_still_valid()`
([session-still-valid-guards-writes](session-still-valid-guards-writes.md)), granted to
`authenticated` only. It runs two deletes in one transaction:

1. every list the caller owns **and no one else owns** — live or binned, shared or not — taking its
   items and every member's row with it by cascade;
2. the caller's `auth.users` row, which cascades `public.users` (freeing the name), every session,
   identity and refresh token, and their memberships of the lists that survive.
   `lists.created_by` is the one FK into `auth.users` that is `set null` rather than cascade.

The app calls it while the user watches and never queues it in the outbox. Through REST: 204 with no
body on success, 403 `42501` for a revoked session (`resultFor` maps it to `sessionRevoked`), 401 for
`anon`. It returns nothing and promotes no heir. Signing up again with the same email is a new user id,
nameless, in no list.

**The order of the deletes is load-bearing.** The user first would cascade their memberships away; the
list delete would then find nothing they own, and every solely-owned list would be left ownerless —
the outcome this function exists to remove.

**An RPC, not an Edge Function calling `auth.admin.deleteUser`**: every write here is already a
guarded RPC, there is no functions infrastructure, and only a database function deletes the lists and
the account atomically. It works because `postgres`, the function's owner, holds DELETE on
`auth.users` (owned by `supabase_auth_admin`) and has `rolbypassrls` (`rolsuper` is false). As
owner, `postgres` skips RLS on `lists` and `list_members` anyway, but not on `auth.users`, where RLS
is on. **Without `rolbypassrls` the final delete would match zero rows with no error**: the lists
gone, the account kept, a silent half-delete. **Both preconditions are checked true on the local
stack and on cloud** (2026-10-05). The migration itself is **not yet pushed to cloud**. Any new
environment must re-check both before it gets this migration:
`select has_table_privilege('postgres', 'auth.users', 'DELETE');` and
`select rolbypassrls from pg_roles where rolname = 'postgres';` — a bare expression without
`select` fails with `42601` at position 1.

**Not a tombstone — the second hard delete beside the nightly purge**
([deletion-is-a-tombstone](deletion-is-a-tombstone.md)). Only an owner can restore a list, so a
binned one here could never come back, and it would hold the departed user's data 30 more days.

**`keep_last_owner` lets both cascades through** by its two exemptions: "the list is already gone"
for step 1, "the user is already gone" for step 2
([list-data-scoped-by-rls](list-data-scoped-by-rls.md)).

**No locks, and one race is accepted.** A co-owner leaving at the instant the other deletes their
account can strand a list ownerless under READ COMMITTED — each transaction sees the other as the
owner who remains. **Do not add `for update` or advisory locks without asking the user.**

**No index on `lists.created_by`, on purpose.** The set-null is a sequential scan of `lists`:
13 ms locally over a 2,146-page heap (task 23's 200,000 deleted lists were never vacuumed out), an
estimated ~65 ms at a million lists, and the whole REST call took 32 ms — far under `authenticated`'s
8 s `statement_timeout`. Add the index only if a measurement says otherwise.

**The set-null is an `UPDATE` on `lists`, so it fires `notify_on_list_rename`**: a co-owner who stays
gets two nudges for that list (the membership `DELETE` and the rename), which the client's debounce
collapses. RI triggers fire in name order, so the departing user's memberships are gone first and
they get no rename nudge.

**Another device still signed in to the deleted account** keeps a valid access token until it
expires; what each request gets back — including a queued list create failing with 409 `23503`, not
a redirect — is in [session-still-valid-guards-writes](session-still-valid-guards-writes.md).

The `verify:` asserts, on the latest definition: definer, the list delete before the user delete,
the sole-owner predicate, no lock and no `deleted_at` stamp, the revoke and grant, no `created_by`
index, and the FK still `set null`.
