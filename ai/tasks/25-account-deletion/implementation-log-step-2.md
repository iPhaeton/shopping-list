# Step 2 — implementation log: `delete_account()`, the database half

2026-10-05. Scope: `description-step-2.md`. The user approved the plan before work began. **No app code changed.**
The migration was applied to the local stack only (`npx supabase migration up --local`); it was not pushed to cloud
and not committed.

## What changed

`supabase/migrations/20261005000000_delete_account.sql`, the only new file besides this log.

- **`public.delete_account() returns void`**: `plpgsql`, `security definer`, `set search_path = ''`. The body is the
  description's three statements, verbatim, in order:
  1. the `session_still_valid()` guard, which raises `42501` `'this device has been signed out'`;
  2. the sole-owner list delete;
  3. `delete from auth.users where id = (select auth.uid())`.
- **Grants:** revoked `from public, anon`, then granted to `authenticated`.
  - `pg_proc` read back after applying: `proowner` `postgres`, `prosecdef` true, `proconfig {search_path=""}`, result
    `void`.
  - `proacl {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`, with no PUBLIC (grantee 0)
    entry.
  - `has_function_privilege`: `anon` f, `authenticated` t.
- **Header comment:** why an RPC and not an Edge Function, why the order of the two deletes is load-bearing, the
  cascades and both `keep_last_owner` exemptions, the nudges, and the `created_by` set-null scan. Also: second
  permanent delete and why not a tombstone, the accepted co-owner race with "do not add locks without asking", no
  heir and no return value, and the cloud privilege check before a push. It cites this log for the measurements.

## Decisions

1. **No `notify pgrst, 'reload schema'`.**
   - `leave_list`, the description's model, has none.
   - The local stack has the `pgrst_ddl_watch` and `pgrst_drop_watch` event triggers.
   - The first REST call after applying found the function: it answered 401 to `anon`, not "Could not find the
     function in the schema cache".
2. **Measured numbers live in this log, not in the migration.** The comment says "measured cheap (same log)", as the
   list-limits migration cites its log, so the file never needs editing after it is applied.
3. **The comment avoids five phrases that unrelated `kb:audit` checks grep across `supabase/migrations`:**
   - `revoke execute` without `from public, anon` on the same line (supabase-default-grants-defeat-revokes);
   - `session_still_valid` on any non-comment line except the guard. Its line count must stay 3
     (session-still-valid-guards-writes);
   - `before insert … on public.lists` (limit-checks-pass-an-applied-resend);
   - `function public.my_memberships` (deletion-is-a-tombstone);
   - `function public.set_item_done`. server-stamps-done-at takes the *last* file that mentions it as the latest
     definition.
4. **No index on `lists.created_by`.** The set-null costs 13 ms (below).
5. **The fixture lists were seeded as `postgres` in psql**, not built through REST.
   - Only the accounts and sessions need to be real.
   - Seeding through `lists` inserts still runs the real `on_list_created` and `limit_list_memberships` triggers.
6. **Cleanup was done by `delete_account` itself:** B, then C, through REST. That doubles as a check:
   - L4 was co-owned until A left. B now owns it alone, so it went with B.
   - L6, binned, went with C.

## Re-measured before relying on it (local, 2026-10-05)

All of these hold as the description states:

- `has_table_privilege('postgres', 'auth.users', 'DELETE')` is t. The table's owner is `supabase_auth_admin`.
  - **Cloud, too.** The user ran `select has_table_privilege('postgres', 'auth.users', 'DELETE');` on the cloud
    project on 2026-10-05, and it returned `true`. The bare expression, without `select`, fails with `42601`.
  - The migration is still not pushed; cloud is behind for other reasons too.
- `postgres` has `rolbypassrls` t and `rolsuper` f. RLS is enabled on `auth.users`, `auth.sessions` and
  `auth.identities`, but the definer bypasses it.
  - **Cloud, too.** On 2026-10-05 the user ran `select rolname, rolbypassrls, rolsuper from pg_roles where
    rolname = 'postgres';` and the `pg_class` owner/`relrowsecurity`/`relforcerowsecurity` query for
    `public.lists`, `public.list_members` and `auth.users` on cloud. Results matched local: `rolbypassrls` t,
    `rolsuper` f; `auth.users` owned by `supabase_auth_admin`, `lists` and `list_members` by `postgres`; RLS on
    for all three, forced on none.
  - Why it matters: `postgres` skips RLS on `lists`/`list_members` as their owner anyway, but not on
    `auth.users`. Without `rolbypassrls` the final `delete from auth.users` would match zero rows with no error:
    the lists gone, the account kept.
- Every FK into `auth.users` is `c`, except `public.lists` (`lists_created_by_fkey`), which is `n`.
  - The `c` ones are identities, sessions, mfa_factors, one_time_tokens, oauth_authorizations, oauth_consents,
    webauthn_credentials, webauthn_challenges, `public.users` and `list_members`.
  - `refresh_tokens` and `mfa_amr_claims` hang off `sessions`.
- `lists` indexes: `lists_pkey` and `lists_deleted_at_idx` only.
- `authenticated` `statement_timeout` is 8 s, and `anon`'s is 3 s.
- Data: 8,068 lists, 1,000,036 `auth.users` (1,000,000 `@loadtest.invalid`), 5,844,548 items, 8,088 memberships.
- The only trigger on `auth.users` is `on_auth_user_created` (insert, or update of email). A delete fires nothing of
  ours.
- `realtime.messages` had today's partition (`messages_2026_10_05`).

## Fixture

The accounts were signed in by OTP: `POST /auth/v1/otp` with `create_user: true`, the code read from the Mailpit
API, then `POST /auth/v1/verify`. Throwaway accounts only; neither `maya@` nor `maya3@` was touched.

| account | id | sessions used |
|---|---|---|
| A `t25a@example.com` | `917bb74a-9309-471e-aa5a-e2d13b576069` | A1 `c322ec9b…` (deletes), A2 `c538281a…` (revoked) |
| B `t25b@example.com` | `3c4870ed-3290-46f9-ac72-7fb13ea1a972` | one |
| C `t25c@example.com` | `79001b9d-0053-42bd-b1e8-218ee41bf40b` | one |

Lists `t25s2-L1…L6`, ids `25250000-0000-4000-8000-00000000000N`:

| list | created by | members | binned | items |
|---|---|---|---|---|
| L1 | A | A owner | no | 2 |
| L2 | A | A owner, B writer | no | 1 |
| L3 | A | A owner, C reader | yes | 0 |
| L4 | A | A owner, B owner | no | 1 |
| L5 | B | B owner, A writer | no | 0 |
| L6 | C | C owner, A reader | yes | 0 |

## SQL cases

Each case ran in `begin … rollback`, as `set local role authenticated`, with `request.jwt.claims` set through
`set_config(…, true)` to `{sub, role, session_id}`. Counts were taken after `reset role`, as `postgres`, **by row
count**.

### 1. A deletes (A1's real `session_id`)

The call took 63 ms in psql (`\timing`, cold). After it, in the same transaction:

| list | rows | items | members | `created_by` | as expected |
|---|---|---|---|---|---|
| L1 | 0 | 0 | — | — | gone, items too ✓ |
| L2 | 0 | 0 | — | — | gone, B's membership too ✓ |
| L3 | 0 | 0 | — | — | gone ✓ |
| L4 | 1 | 1 | B owner | **null** | stays, without A ✓ |
| L5 | 1 | 0 | B owner | B | stays, without A ✓ |
| L6 | 1 (binned) | 0 | C owner | C | stays in C's bin, without A ✓ |

- **A's rows:** `auth.users` 0, `public.users` 0, `auth.sessions` 0 (from 3), `auth.identities` 0,
  `auth.refresh_tokens` 0 (from 3), `list_members` 0 (from 6).
- **Global deltas:** lists −3 (8,074 → 8,071), items −3, memberships −8 (8,099 → 8,091), `auth.users` −1. Nothing
  outside the fixture moved.
- **After the rollback**, every number was back to its value before the case.

**Broadcasts** are `realtime.messages` rows with `inserted_at >= now()::timestamp`. Every one is event
`list/changed`:

| topic | list | `source` / `op` |
|---|---|---|
| `user:A` | L1, L2, L3, L4, L5, L6 | `list_members` / `DELETE`, one each |
| `user:B` | L2, L4, L5 | `list_members` / `DELETE`, one each |
| `user:B` | **L4** | **`lists` / `UPDATE`**, one |
| `user:C` | L3, L6 | `list_members` / `DELETE`, one each |

- That is 12 rows. The expected set is present: `user:B` for L2, L4 and L5, and `user:C` for L3 and L6.
- **The extra row is the `created_by` set-null.** It is an `UPDATE` on `lists`, so it fires `notify_on_list_rename`.
  B gets two nudges for L4, which the client's 300 ms debounce collapses.
- **A gets no rename nudge for L4.** The RI triggers fire in this order: `list_members_user_id_fkey`, then
  `lists_created_by_fkey` (see the plan below). So A's L4 membership is already gone when the rename fan-out reads
  the members.
- A's own topic gets one departure nudge per list, sent to a user who no longer exists.

### 2. Cost

`explain (analyze, buffers)` as `postgres`, A's id literal, rolled back:

| statement | plan | time |
|---|---|---|
| list delete | index scan `list_members (user_id, created_at)` (4 owner rows) → nested loop `lists_pkey` → anti-join on `list_members_pkey`; 47 buffers | **5.7 ms**. Triggers: `items_list_id_fkey` 0.7, `list_members_list_id_fkey` 1.9, `notify_on_membership_change` ×5 2.5 |
| user delete | `users_pkey`; 28 buffers | **18.6 ms**. **`lists_created_by_fkey` 13.0 ms**; each auth cascade 0.2–0.9; `refresh_tokens_session_id_fkey` ×3 0.9; `notify_on_membership_change` ×3 0.8; `notify_on_list_rename` ×1 0.5 |

- The set-null is a sequential scan of the `lists` heap. That heap is **2,146 pages (17 MB) for 8,068 rows**,
  because task 23 step 2's 200,000 deleted lists were never vacuumed out of the file. So 13 ms is the cost of the
  bloated heap, all cached, not of 8,068 rows.
- Task 23 step 2 estimated about 11,000 pages at 1,000,000 lists, roughly 65 ms at this rate when cached. Both are
  far below the 8 s `statement_timeout`.

### 3. A revoked session

- With `session_id` set to a random uuid: `ERROR 42501: this device has been signed out`, raised at line 4 of the
  function, before any delete.
- With `sub` alone and no `session_id`: the same error.
- Every count was unchanged afterwards.

### 4. `anon`

- `set local role anon`, then the call: `ERROR 42501: permission denied for function delete_account`.

## Through `/rest/v1`

These calls commit. They used the local anon key from `.env.example` and each account's real access token.

| call | status | body / note | time |
|---|---|---|---|
| `rpc/delete_account`, apikey only (`anon`) | **401** | `42501` "permission denied for function delete_account" | 117 ms |
| A2 `POST /auth/v1/logout?scope=local` | 204 | A2's `auth.sessions` row gone (A: 3 → 2 sessions) | — |
| `rpc/delete_account` with A2's revoked token | **403** | `42501` "this device has been signed out"; every count unchanged | 71 ms |
| `rpc/my_list_counts` with A1's token (baseline) | 200 | cold, then warm | 45, 18, 7 ms |
| **`rpc/delete_account` with A1's token** | **204** | empty body | **32 ms** |
| `rpc/delete_account` as A′ (no lists) | 204 | every row of A′ gone; lists unchanged | 35 ms |
| B's `rpc/delete_account` | 204 | L4 (B was by then its sole owner) and L5 gone; L6 untouched | 48 ms |
| C's `rpc/delete_account` | 204 | L6 (binned) gone | 20 ms |

- **After A1's call, the committed state was identical to SQL case 1**: every list row, A's rows, the global deltas,
  and the same 12 broadcasts.

**A1's access token, still unexpired, after the deletion.** Step 3's "other devices" rests on this.

| request | status | body |
|---|---|---|
| `GET /rest/v1/list_members?select=list_id,role` | 200 | `[]` |
| `GET /rest/v1/lists?select=id,name` | 200 | `[]` |
| `rpc/my_list_counts` (a read) | 200 | `[{"owned":0,"total":0}]` |
| `rpc/set_name` (guarded) | **403** | `42501` "this device has been signed out" |
| `rpc/add_item` into L5 (guarded) | **403** | `42501` "this device has been signed out" |
| `POST /rest/v1/lists` | **409** | **`23503`** `insert or update on table "lists" violates foreign key constraint "lists_created_by_fkey"`, details `Key is not present in table "users".` The `create your own lists` policy passes (`created_by` defaults to the `sub`), and the FK refuses |
| `GET /auth/v1/user` | 403 | `user_not_found`, "User from sub claim in JWT does not exist" |
| `POST /auth/v1/token?grant_type=refresh_token` (A1's refresh token) | 400 | `refresh_token_not_found` |

**Signing up again** with `t25a@example.com` created `auth.users` id `f47b3102-05f2-4e6f-a9d6-89b0bcc24849`, which is
not `917bb74a…`. Its `public.users.name` is null, and it has 0 memberships.

**Left on the local stack:** nothing. After B and C:

- no `t25s2-%` list, and no row with a `25250000-…` list id in `items` or `list_members`;
- no `t25%@example.com` row in `auth.users` or `public.users`;
- the global counts were back to the starting baseline: 8,068 lists, 5,844,548 items, 8,088 memberships,
  1,000,036 users.

Mailpit still holds the `t25` sign-in mails.

## Problems hit

1. **OTP is throttled at 1 s per address** (`[auth.email] max_frequency = "1s"`). A's second `POST /auth/v1/otp`,
   sent at once after the first sign-in, got `429 over_email_send_rate_limit`.
   - Signing in B and C first, then retrying A, cleared it.
   - `[auth.rate_limit] email_sent = 2` did not bite. Its own comment says it needs `auth.email.smtp`, and local
     mail goes to Mailpit.
2. **A new account's first OTP verify leaves two `auth.sessions` rows, about 80 ms apart.** The returned token names
   the second.
   - A, B and C each had one extra session. The auth log shows exactly one `/verify` per sign-in.
   - Harmless here, since the cascade removes both. A test that counts a user's sessions must expect it.
3. **A `jest` flake on a cold first run.** The first `npm test`, run while the audit ran, failed 2 tests in 2 suites
   (17 s). Only the output's tail was kept, and its one trace points at the first test of `SignInScreen.test.tsx`
   (line 107). The other failure is unidentified.
   - Every later run passed, 786 of 786 in about 5 s, and the suite alone passed twice.
   - No app file was touched, so this is a cold-cache timeout, not this step.

## Verification

- `npm run typecheck`: clean.
- `npm test`: 31 suites, 786 tests, all passing (unchanged; see problem 3).
- `npm run kb:audit`: **1 error, the expected one**, `session-still-valid-guards-writes`.
  - Its awk now finds twelve guarded RPCs: the eleven plus `public.delete_account`.
  - Its non-guard mention count is still 3.
  - Baseline before the migration: 0 errors. Nothing else fails.
- `git status`: only the migration and this log are new.
- No cloud push. Cloud was ten migration files behind local by the description's count; this makes eleven (not
  re-measured with `migration list --linked`).

## Notes for step 3

- **Statuses:** a success is **204** with no body, the revoked refusal is **403** `42501` with
  `SESSION_REVOKED_MESSAGE`, and `anon` gets 401. `resultFor` maps the 403 to `sessionRevoked: true`.
- **Other devices after the deletion.** Reads return empty (200 `[]`) until the access token expires. Then the
  refresh fails with 400 `refresh_token_not_found`, and `/auth/v1/user` answers 403 `user_not_found`. A guarded
  write gets 403 `42501` "this device has been signed out", which redirects through the existing path.
- **But a queued `list/created` is not guarded.** It gets **409 `23503`**:
  - `verdictFor` makes that `permanent` (`status >= 400`), and `sessionRevoked` is false;
  - `humanize` has no `23503` case, so its `default` would show the database's raw FK sentence in the red banner;
  - `dropDependents` would drop the items queued into that list;
  - the device redirects to Sign in only when a guarded write follows, or when the token expires.

  The description says "observe, no code". Whether this banner is acceptable is step 3's call, and it should be
  observed in the browser there.
- **Nudges:** B gets two for a co-owned list (a membership `DELETE` and the `created_by` `UPDATE`). Every departure
  also nudges `user:<deleted id>`, where nobody listens once the device has signed out.

## KB candidates (for the librarian)

The description's table stands. Facts to add or fold in:

- **session-still-valid-guards-writes:**
  - `delete_account` (`20261005000000_delete_account.sql`) is the **twelfth** guarded write RPC. Add it to the list
    and to the `verify:` set.
  - The non-guard mention count stays 3.
  - It is answered synchronously and never queued.
  - A stale token after the deletion gets 403 from guarded RPCs and 409 `23503` from the unguarded `lists` insert.
- **deletion-is-a-tombstone:** a **second permanent delete**.
  - `delete_account` deletes every list the caller solely owns, live or binned, shared or not, with its items and
    memberships, by cascade.
  - It does not tombstone them: only an owner can restore, and it would keep the user's data for 30 more days.
  - The nightly purge is no longer the only hard delete.
- **list-data-scoped-by-rls:**
  - Deleting an account no longer leaves ownerless lists.
  - Both `keep_last_owner` exemptions carry these deletes: "the list is already gone" for the list cascade, and "the
    user is already gone" for the memberships on surviving lists.
  - The accepted co-owner race (READ COMMITTED, no locks, don't add any without asking).
- **supabase-local-stack, or a new entry:**
  - Locally, `postgres` holds DELETE on `auth.users` and has `rolbypassrls`. Cloud is unverified: check
    `has_table_privilege('postgres','auth.users','DELETE')` before pushing.
  - Every FK into `auth.users` cascades, except `lists.created_by` (set null).
  - The set-null seq-scans `lists`: 13 ms over a 2,146-page heap bloated by task 23's deleted 200,000 lists. The
    whole call through REST takes 32 ms. No `created_by` index.
- **realtime-is-a-nudge-to-a-per-user-inbox:**
  - Deleting an account nudges every member of every affected list, and the departed user's own topic once per list.
  - The `created_by` set-null is an `UPDATE` on `lists`, so `notify_on_list_rename` sends co-owners a second nudge.
  - RI triggers fire in name order, so the user's memberships cascade before the set-null, and the departed user
    gets no rename nudge.
- **Testing recipe (supabase-local-stack or session-still-valid-guards-writes):**
  - OTP is throttled at 1 s per address (429).
  - A new account's first verify leaves two `auth.sessions` rows.
  - `realtime.messages.inserted_at` is a `timestamp` defaulting to `now()`, so `inserted_at >= now()::timestamp`
    isolates one transaction's broadcasts.
- **scope-boundaries:** nothing yet. Step 3 brings account deletion into scope in the app.
