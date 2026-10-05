# Step 2 — `delete_account()`: the database half

The user's requests are quoted verbatim in [description-step-1.md](description-step-1.md), along with
the decisions they settled. Read that first.

**This step does not depend on step 1's mockups.** It changes no app code: nothing calls the function
until step 3.

## The migration

Add one file, `supabase/migrations/<yyyymmdd>000000_delete_account.sql`, dated the day it is
written. It sorts after `20261002000000`.

Apply it with `npx supabase migration up --local`. **Never `db reset`.** A reset wipes every row,
including the 1M load-test users and the screenshot accounts
([supabase-local-stack](../../kb/entries/supabase-local-stack.md)).

`public.delete_account() returns void`, `language plpgsql`, `security definer`,
`set search_path = ''`. Model its shape on `leave_list` in
[20260924000000_leave_list.sql](../../../supabase/migrations/20260924000000_leave_list.sql).

1. **Check the session first.** Call `public.session_still_valid()` and raise `42501` with exactly
   `'this device has been signed out'`. `resultFor` in
   [listsApi.ts](../../../src/lib/listsApi.ts) matches that message (`SESSION_REVOKED_MESSAGE`) to
   set `sessionRevoked`.
2. **Delete every list the caller is the only owner of:**

   ```sql
   delete from public.lists l
    where exists (select 1 from public.list_members m
                   where m.list_id = l.id and m.user_id = (select auth.uid()) and m.role = 'owner')
      and not exists (select 1 from public.list_members m
                       where m.list_id = l.id and m.user_id <> (select auth.uid()) and m.role = 'owner');
   ```

   This covers live and binned lists, shared or not. `deleted_at` is not consulted.
3. **Delete the user:** `delete from auth.users where id = (select auth.uid());`

**The order is load-bearing.** If the user were deleted first, the cascade would remove their
memberships. Statement 2 could then no longer find the lists they solely owned, and those lists would
be left ownerless, which is the outcome this task removes.

**Grants:** `revoke execute on function public.delete_account() from public, anon;` and then
`grant execute … to authenticated;`.

- Revoke `from public, anon`, not `from public` alone
  ([supabase-default-grants-defeat-revokes](../../kb/entries/supabase-default-grants-defeat-revokes.md)).
- Read `pg_proc.proacl` back after applying.

## What the cascades do

**Measured on the local stack on 2026-10-05.** Re-check before relying on it.

- `has_table_privilege('postgres', 'auth.users', 'DELETE')` is `true`. The table's owner is
  `supabase_auth_admin`.
- Every foreign key into `auth.users` is `on delete cascade`, except `public.lists.created_by`, which
  is `set null`. The cascading ones are:
  - `auth.identities`, `auth.sessions` (refresh tokens hang off sessions), `auth.mfa_factors`,
    `auth.one_time_tokens`, `auth.oauth_authorizations`, `auth.oauth_consents`,
    `auth.webauthn_credentials` and `auth.webauthn_challenges`;
  - `public.users` and `public.list_members`.
- `realtime.send` inserts into `realtime.messages`, so the broadcasts can be counted inside the same
  transaction.

What follows from that:

- **Deleting a list (statement 2)** removes its items and its memberships through the cascades.
  - `keep_last_owner` lets the membership deletes through by its "the list is already gone"
    exemption, the same way it does for `purge_deleted`.
  - `notify_list_members` sends `list/changed` to each departing member. The purge's comment in
    [20260910000000_deletion.sql](../../../supabase/migrations/20260910000000_deletion.sql) records
    this as measured.
  - So every other member's app re-fetches and the list disappears. A member who has it open gets
    `ListDetailScreen`'s "List not found".
- **Deleting the user (statement 3)** removes:
  - `public.users`, which frees the name for `set_name`;
  - the user's memberships on the lists that survive, through `keep_last_owner`'s "the user is
    already gone" exemption. Their remaining members are nudged;
  - `created_by` on those lists, which is set to null;
  - every session and identity, so every device's refresh token dies with the account.
- Items carry no user column, and nothing else references the user.

**Nulling `created_by` scans all of `lists`.** The `(owner_id, created_at)` index was dropped in
[20260907000000_list_sharing.sql](../../../supabase/migrations/20260907000000_list_sharing.sql)
because nothing reads lists by creator. Today only `lists_pkey` and the partial `deleted_at` index
remain, and local holds 8,068 lists.

- Measure the call's duration through `/rest/v1` and record it. The `authenticated` role has an 8 s
  `statement_timeout`.
- Add an index on `created_by` only if this measures slow, as with the lists-bin index
  ([keyset-paging-in-the-order-shown](../../kb/entries/keyset-paging-in-the-order-shown.md)).

**This is a second permanent delete.** [deletion-is-a-tombstone](../../kb/entries/deletion-is-a-tombstone.md)
says the nightly purge is the only one, and this function becomes the second by request 2. Do not
tombstone these lists instead. Only an owner can restore a list, so a binned one here could never come
back, and it would hold the departed user's data for 30 more days.

## What the function does not do

- **No heir promotion.** It was considered and replaced by request 2. The list-limit trigger
  `limit_list_memberships` therefore never fires here.
- **No return value.** The warning is general (request 3).
- **No locks.** One co-owner leaving at the same instant the other deletes their account can strand
  a list ownerless under READ COMMITTED, because each transaction sees the other owner as the one who
  remains. This is accepted. Do not add `for update` or advisory locks without asking the user.
- **No change** to `keep_last_owner`, any policy, any table grant, or the realtime trigger.
- **No cloud push.** Cloud is ten migration files behind local
  ([scope-boundaries](../../kb/entries/scope-boundaries.md)). Whoever next pushes must first check
  `has_table_privilege('postgres', 'auth.users', 'DELETE')` on cloud. It is measured locally only.

## Tests

Run these in SQL by hand on the local stack and record them in the log.

**Run as `authenticated` with a real `session_id` in `request.jwt.claims`.** With only `sub`, the
guard raises ([session-still-valid-guards-writes](../../kb/entries/session-still-valid-guards-writes.md)).

- Sign each test account in through OTP (Mailpit and `/auth/v1/verify`), and take the id from
  `auth.sessions`.
- Wrap each case in a transaction and roll it back where possible, so one set of accounts serves
  every case.
- **Never use `maya@example.com` or `maya3@example.com`.** They are the screenshot accounts.

**Fixture:** throwaway accounts A (the one deleted), B and C.

| list | members | after A deletes |
|---|---|---|
| L1 | A owner, with items | gone, items too |
| L2 | A owner, B writer | gone, B's membership too |
| L3 | A owner, C reader, binned | gone |
| L4 | A owner, B owner | stays. A's membership is gone, B is still owner, `created_by` is null |
| L5 | B owner, A writer | stays, without A |
| L6 | C owner, A reader, binned | stays in C's bin, without A |

**Assert:**

- Every row of the table, **by row count**, not by the absence of an error. RLS refuses with zero rows
  ([refused-writes-return-zero-rows](../../kb/entries/refused-writes-return-zero-rows.md)), so count
  as `postgres`.
- `auth.users`, `public.users`, `auth.sessions` and `auth.identities` hold nothing for A.
- **Broadcasts.** Count the `realtime.messages` rows per topic in the same transaction. Expect
  `list/changed` to `user:<B>` for L2, L4 and L5, and to `user:<C>` for L3 and L6. Record the actual
  set, and A's own topic too.
- **A revoked session.** With a `session_id` absent from `auth.sessions`, the call raises `42501`
  `this device has been signed out` and deletes nothing.
- **`anon` cannot execute it.**
- **An account with no lists** deletes cleanly.
- **Through `/rest/v1/rpc/delete_account`** with A's access token, record:
  - the HTTP status of a success;
  - the HTTP status of the revoked refusal;
  - the duration.
- **A's still-unexpired access token after the deletion**, which step 3's other-device behaviour
  rests on. Record that:
  - a read of `/rest/v1/list_members` returns zero rows;
  - a guarded RPC raises `42501`;
  - a `lists` insert fails, and how.
- **Signing up again** with A's email creates a new `auth.users` id whose `public.users.name` is null.

## Verification

- `npm run kb:audit` is **expected to fail on `session-still-valid-guards-writes`**.
  - Its `verify:` asserts that the guarded write RPCs are exactly eleven, and this makes twelve.
  - The fact changed; the check is not broken. Leave it for the librarian at deposit, and never edit
    the code or the check to make it pass.
  - Any other failure is real.
- `npm test` and `npm run typecheck` must still pass, unchanged.

## KB impact (for the librarian)

| entry | change |
|---|---|
| session-still-valid-guards-writes | `delete_account` is the twelfth guarded write RPC. Update the list and the `verify:` |
| deletion-is-a-tombstone | a second permanent delete: `delete_account` deletes every list the caller solely owns, binned or not |
| list-data-scoped-by-rls | deleting an account no longer leaves ownerless lists. Both `keep_last_owner` exemptions still carry these deletes. Record the accepted co-owner race |
| supabase-local-stack, or a new entry | `postgres` holds DELETE on `auth.users` locally, and every FK into it cascades except `lists.created_by`. Cloud is unverified. Nulling `created_by` scans `lists`; record the measured cost |
