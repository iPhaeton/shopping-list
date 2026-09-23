# Implementation log — step 1: share a list by name, with live autocomplete

**Date:** 2026-09-22. Description: [description-step-1.md](description-step-1.md). Source proposal:
[ai/suggestions/share-by-name.md](../../suggestions/share-by-name.md).

## What changed

**Server** — `supabase/migrations/20260922000000_share_by_name.sql`:
- `pg_trgm` extension + `create index on public.users using gin (lower(name) gin_trgm_ops)` — the
  existing btree unique index on `lower(name)` cannot serve a leading-wildcard `like`.
- New RPC `search_users_by_name(p_query text)` — `security definer`, `authenticated`-only, id+name
  only, `%`/`_`-escaped, capped at 5 rows via `limit 5`. No `session_still_valid()` check: it is a
  read, matching `list_members_of`'s precedent.
- `share_list` dropped (`(uuid, text, list_role)`) and recreated as `(uuid, uuid, list_role)`: the
  email lookup (`select u.id into target from public.users where lower(email) = ...`) is replaced by
  an existence check on the id the client already resolved via a search result, raising `P0002` with
  `'that account no longer exists'` (was `'no account with that email yet'`).

**Client:**
- `src/lib/membersApi.ts` — new `UserSuggestion = { userId, name }` and `searchUsers(query)`
  (mirrors `fetchMembers`'s null-on-error shape, not `resultFor`/`Result` — a search failure resolves
  quietly to no suggestions). `shareList` now sends `p_user_id` instead of `p_email`.
- New `src/components/UserAutocomplete.tsx` — controlled (`value`, `onChangeText`, `onSelect`,
  `selected`, `disabled?`), owns one effect (debounce 300ms + 2-char gate + `cancelled` flag +
  clears suggestions once `selected` is set). Renders inline below the input, not an overlay
  (`SharingScreen` is inside a `ScrollView`). No client-side slice to 5 — the cap is server-side only.
- `src/screens/SharingScreen.tsx` — `email`/`canInvite` replaced by `query`/`selected: UserSuggestion
  | null`; `canInvite = selected !== null && !pending`. The old `TextInput` block (and its now-dead
  `styles.input`) replaced by `<UserAutocomplete>`. Share button guards `if (!selected) return;`
  before calling `shareList(listId, selected.userId, inviteRole)`.
- Stale doc comments updated in `membersApi.ts`, `SharingScreen.tsx`, and `listsApi.ts` (the last one
  quoted the now-nonexistent `'no account with that email yet'` message).
- Tests: new `src/components/UserAutocomplete.test.tsx` (first component tested in isolation rather
  than only through its screen — justified because unlike this codebase's other components it owns
  real logic: a timer, a fetch, response-race handling). Updated `membersApi.test.ts` (new
  `searchUsers` cases; `shareList`'s RPC-argument assertion and the P0002 test reframed around an
  id and the new message) and `SharingScreen.test.tsx` (every invite-flow test now goes through a new
  `pickSuggestion` helper — type, advance `jest.useFakeTimers()` by 300ms, tap the suggestion — since
  typed text alone can no longer reach `canInvite`).

## Decisions worth flagging

- **The proposal's `share_list` SQL was missing `session_still_valid()`.** Its code block was drafted
  from the pre-session-revocation version of `share_list` (`20260907000000_list_sharing.sql`); the
  currently active body (re-created in `20260920000000_session_revocation.sql:271-305`) checks it as
  the first statement, one of ten write RPCs that do
  ([session-still-valid-guards-writes](../../kb/entries/session-still-valid-guards-writes.md)).
  Caught before writing any SQL, by diffing the proposal against the migration history rather than
  trusting the proposal's code block. The recreated function keeps the check — verified directly:
  a `share_list` call under a session id absent from `auth.sessions` raises `'this device has been
  signed out'` before the owner/self/existence checks ever run (see Verification).
- **This bumps `session-still-valid-guards-writes`'s pinned counts from 10→11 occurrences and 2→3
  files.** Confirmed via `npm run kb:audit`: this is the one `FAIL` in an otherwise clean run, exactly
  the expected drift, not a bug. Flagging for `/librarian deposit 18` rather than hand-editing the
  entry.
- **The proposal also mis-stated `RolePicker`'s prop shape** as `{ value, onChangeText, onSelect,
  disabled }`; the real shape is `{ value, labelFor, disabled?, onChange }`
  (`src/components/RolePicker.tsx:11-20`). `UserAutocomplete` was designed with its own props rather
  than copying either shape, since a free-text-plus-suggestions control isn't a fixed radio set.
- **`UserAutocomplete` takes a `selected` prop** beyond what the proposal specified, so it can clear
  its own suggestion list once the parent has one selected, without duplicating `SharingScreen`'s
  state internally.
- **No client-side `.slice(0, 5)`** in `UserAutocomplete` — the cap is enforced once, server-side
  (`limit 5`); a redundant client cap would mask a server misconfiguration rather than surface it.
- **The "stale doc comments updated" claim above was initially incomplete.** `/librarian deposit 18`
  caught one this log had missed: `SharingScreen.tsx`'s inline comment inside `run()` (above the
  `verdict === 'retryable'` branch) still quoted `'no account with that email yet'` — a third mention
  of the old message, distinct from the two (`membersApi.ts`'s doc comment, `listsApi.ts`'s
  `writeResult` comment) that were caught before the log was first written. Fixed after the deposit
  pass reported it; `grep -rn "no account with that email yet" src/` is clean as of this log's final
  version, and the fix is included in the diff this log describes.
- **`P0002`'s meaning shifted** from "typo in an email field" to "the target account vanished between
  a search suggestion and the tap on Share" — a real but much rarer race, since the UI can no longer
  construct an unresolved-target request the way free-typed email once allowed.
  `scope-boundaries.md`'s "share_list raises P0002 for an address with no account" line and
  `queries-go-through-a11y-labels.md`'s "invite input `Email address`" row are both stale now too —
  flagging both for the deposit pass.

## Verification

- `npm run typecheck` — clean.
- `npm test` — 392/392 passing (22 suites), including the new `UserAutocomplete.test.tsx` and the two
  updated suites.
- `npm run kb:audit` — 38/41 entries mechanically pass; the one `FAIL`
  (`session-still-valid-guards-writes`) is the expected, described drift above, for the librarian to
  reconcile.
- Local Supabase stack (`npx supabase stop && npx supabase start && npx supabase db reset`, Docker) —
  migration applied cleanly (`20260922000000_share_by_name.sql` in the apply log, no errors).
  Confirmed directly via `psql`, in transactions rolled back afterward, impersonating real accounts
  via `set local role authenticated` + `request.jwt.claims` (a real `auth.sessions` row inserted first
  where `session_still_valid()` needed to pass):
  - `search_users_by_name('bo')` on seeded names `Bob Smith`/`Carol Jones`/`Dave_Underscore` /
    `DaveXUnderscore` matched only `Bob Smith`; a caller never sees their own row even when their own
    name matches the query (self-exclusion, tested by giving the caller a matching name).
  - `search_users_by_name('Dave_Und')` matched only `Dave_Underscore`, not `DaveXUnderscore` —
    confirms the `%`/`_` escape chain works, not just parses.
  - `share_list` happy path: owner shares with another account, row lands with the right role — a
    first read of `list_members` immediately after, still impersonating the sharer, showed only the
    sharer's own row and looked like a failed insert; re-read as `postgres` showed both rows. This is
    the documented `list_members` select-policy behavior (each caller sees only their own row), not a
    bug — worth recording here since it cost real debugging time before being recognized as expected.
  - `share_list` refusals, each confirmed to raise the right code/message: a non-owner sharer (42501),
    an id with no matching `public.users` row (P0002, `'that account no longer exists'`), self-share
    (22023), and no matching `auth.sessions` row for the claimed `session_id` (42501, `'this device
    has been signed out'` — the guard this log's first decision above is about).
  - Grants confirmed via `information_schema.routine_privileges`: `authenticated`/`postgres`/
    `service_role` only, on both `search_users_by_name` and `share_list` — no `anon`, no `public`.
  - All throwaway accounts and their `auth.sessions`/`public.lists` rows were created inside
    transactions rolled back at the end of each check, or deleted via the admin API afterward — none
    left behind in the local stack.
- `npm run web`, driven end to end with Playwright, reading the OTP code from local Mailpit: signed up
  a fresh account through the real gate (OTP → `SetNameScreen` → name), created a list, opened
  Sharing. Typed a single character — no suggestion appeared, even after waiting past the debounce.
  Typed a second account's name prefix (2 chars) — the suggestion appeared after the debounce, sourced
  from the live `search_users_by_name` RPC. Selecting it filled the field with the full name, closed
  the suggestion list, and enabled "Share" (disabled before any selection, confirming `canInvite`).
  Shared as writer: the roster re-read and showed the new member with working role/remove controls,
  and the invite field cleared. No console errors attributable to this change (the browser's console
  showed only pre-existing, unrelated noise: the web stub warning for native Google Sign-In, one stale
  refresh-token 400 from a session predating the `db reset`, and a generic RN Web `pointerEvents`
  deprecation warning).

## Scale verification (1,000,000 users)

**Date:** 2026-09-23. Prior verification above only exercised a handful of seeded names — nothing
confirmed the new trigram GIN index actually gets used, or stays fast, at realistic scale, the way
tasks 7 and 11 verified 1M-row scale for lists/items before calling those steps done.
`ai/tasks/18-share-by-name/seed-1m-users.sql` (raw output:
`ai/tasks/18-share-by-name/seed-1m-users-output.txt`) seeds 1,000,000 synthetic accounts and reruns
the search.

- **Seeding deliberately bypasses the documented admin-API convention**
  ([supabase-local-stack](../../kb/entries/supabase-local-stack.md) says to mint local test accounts
  via `/auth/v1/admin/users`) in favor of direct SQL against `auth.users` — 1M HTTP round-trips isn't
  practical for a one-off load test. `set local session_replication_role = replica` skips
  `handle_new_user()` firing 1M times and every FK-enforcing trigger between `auth.users` and
  `public.users`; `alter table auth.users disable trigger` was tried first and fails outright
  (`must be owner of table users` — `auth.users` is owned by `supabase_auth_admin`, `postgres` is
  neither its owner nor a superuser on this stack). Both tables derive `id`/`email` independently
  from the same deterministic formula keyed on row number, so nothing can let the two disagree with
  triggers off. Rows are isolated behind an `@loadtest.invalid` marker (RFC 2606, never resolves) —
  reversible with one `delete from auth.users where email like '%@loadtest.invalid'` (cascades).
  These accounts can never sign in for real (dummy password hash, no `auth.identities` row); fine
  since the goal is database query performance, not exercising auth flows.
- Row counts matched exactly both times this was run (1,000,000 in `auth.users`, 1,000,000 in
  `public.users`). Insert timing ~22–26s + ~7–9s for the two tables; the unique btree + GIN trigram
  index on `lower(name)` were dropped before the insert and rebuilt after (bulk build vs. incremental
  maintenance across 1M rows) — GIN rebuild ~5s at `maintenance_work_mem = '512MB'` (this stack
  defaults to 64MB).
- **`search_users_by_name()` itself can't be `EXPLAIN`ed usefully.** It's `language sql security
  definer set search_path = ''` — `security definer` and a `set` clause each independently disqualify
  a SQL-language function from being inlined, so `explain analyze select * from
  search_users_by_name(...)` just shows an opaque `Function Scan`, never the plan inside. Ran the
  function's own inline query directly instead — since the function runs as its owner (also
  `security definer`, RLS-bypassing), the direct query run as `postgres` reproduces exactly what
  happens inside it; no `set local role authenticated` / JWT simulation needed for this specific
  check (that technique from `supabase-local-stack.md` is still how anyone needs to test the RLS a
  caller actually sees, just not what was needed here).
- **3+ character queries are index-backed and fast.** `'ann'` and `'Olivia Smith'` both plan as
  `Bitmap Index Scan` on the trigram GIN index → `Bitmap Heap Scan` → top-N sort → `Limit 5`. Full
  name (`'Olivia Smith'`, ~44 matches by construction): ~2ms. `'ann'` (~20,001 matching rows before
  the `limit 5`): ~230ms cold (cache-miss heavy — thousands of heap blocks read for the first time),
  ~42ms on a warm rerun. Isolating the index's actual effect from cache state: rerunning the same
  warm-cache `'ann'` query with `enable_bitmapscan`/`enable_indexscan` forced off falls back to a
  `Parallel Seq Scan` over the full table at ~190ms — roughly **4.5x slower** than the ~42ms indexed
  warm-cache run, same data, same cache state, only the index availability differs.
- **2-character queries do not use the index at all — and 2 is the UI's real minimum, not a
  hypothetical.** `UserAutocomplete`'s `MIN_QUERY_LENGTH` is 2; `pg_trgm` has no usable trigram this
  short for a leading-wildcard `like '%an%'`. The planner falls back to a `Parallel Seq Scan` over
  all 1,000,000 rows — ~270ms, reproduced twice. This is the exact query shape a real user's second
  keystroke sends today. **Not a bug in this step's code — `search_users_by_name`'s own escaping and
  cap work as designed — but a real scaling gap between what the index can accelerate (3+ chars) and
  what the client gate allows (2 chars).** At 1M rows every 2-character search costs a full-table
  scan server-side (~270ms here; grows with table size, unlike the indexed 3+ char case). Flagging
  for `/librarian deposit 18` and as an open decision for a future step — raise
  `MIN_QUERY_LENGTH` to 3, or accept an unindexed scan on the shortest allowed query — not resolved
  in this log.
- **Verdict: Pass for the index's own behavior** (used when the query is long enough, real measured
  speedup over a forced scan, not a script artifact) — see the open 2-character gap above as the one
  actionable follow-up.
- Cleanup: the 1,000,000 rows and the two name indexes (recreated as `users_name_lower_unique` /
  `users_name_trgm_gin` — functionally identical to the migration's own unnamed indexes, just
  explicitly named since the drop step looks them up by definition rather than a guessed default
  name) were left in place after this check, not deleted — the commented block at the bottom of
  `seed-1m-users.sql` removes them on request; `npx supabase db reset` also clears everything
  (restores the migration's original unnamed index names too, since it reapplies migrations from
  scratch) but wipes all other local dev data along with it.
