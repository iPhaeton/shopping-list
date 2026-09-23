# Implementation log — step 2: raise the name-search floor to 3 characters, DB-enforced

**Date:** 2026-09-23. Follows directly from step 1's scale-verification finding
(`implementation-log-step-1.md`'s "Scale verification" section) and the resulting KB entry
`ai/kb/entries/trigram-index-needs-three-characters.md`: `search_users_by_name`'s trigram GIN index
only accelerates 3+ character queries, but `UserAutocomplete`'s `MIN_QUERY_LENGTH` was 2, forcing a
full sequential scan on every user's second keystroke — measured at ~270ms at 1M rows and growing
with the table.

## What changed

**Server** — `supabase/migrations/20260923000000_set_name_min_length.sql`: `create or replace
function public.set_name` adds one new check, `if char_length(trimmed) < 3 then raise ... 'please
enter at least 3 characters'`, kept as a separate `if` from the existing empty-name check so the two
messages stay distinct. Signature unchanged (`text → void`), so this follows the
`create or replace` precedent from `20260920000000_session_revocation.sql` — no re-grant, no
`notify pgrst, 'reload schema'` needed (confirmed absent from every prior signature-unchanged
migration in this repo).

**Client:**
- `src/components/UserAutocomplete.tsx:7` — `MIN_QUERY_LENGTH` 2 → 3. Only use of the constant.
- `src/screens/SetNameScreen.tsx:35` — `canSubmit` extended from `length > 0` to `length >= 3`.
- `src/screens/AccountScreen.tsx` — the equivalent gate was inlined three times rather than
  extracted like `SetNameScreen`; introduced one `canSaveName = nameDraft.trim().length >= 3 &&
  !namePending` and replaced all three inline checks (`accessibilityState`, `disabled`, the
  `saveButtonDisabled` style condition) with it. `saveName()` itself still has no internal guard —
  this screen's `TextInput` has no `onSubmitEditing`, so the Pressable's `disabled` prop is the only
  path to it, same as before.
- Tests: `UserAutocomplete.test.tsx` (renamed/adjusted the two boundary tests, and fixed one
  suggestion-rendering test that would otherwise hang — it typed a 2-char string purely as setup to
  trigger a search, which silently stopped firing under the new floor); `SetNameScreen.test.tsx` and
  `AccountScreen.test.tsx` (one new disabled-state test each; `AccountScreen.test.tsx` had *no*
  disabled-state coverage at all before this, not even for the pre-existing empty-name case, closed
  incidentally here); `profileApi.test.ts` (one new test mirroring the existing `'that name is
  taken'` RPC-rejection pattern for the new length-rejection message).

## Decisions worth flagging

- **The two failure messages were kept distinct on purpose.** `char_length(trimmed) < 3` alone would
  have covered the empty case too (length 0 < 3), collapsing "please enter a name" into "please
  enter at least 3 characters." Keeping the existing empty check first preserves its message
  unchanged for that specific case.
- **No backfill migration.** Per the user, no existing row is shorter than 3 characters, confirmed
  true at the time of writing (the local stack had just been seeded with 1,000,000 names all of the
  form `"Firstname Lastname <n>"` — never shorter than 3 — from step 1's load test, which this step's
  `db reset` then wiped along with everything else).
- **Client-side gating was a deliberate extension of an existing pattern, not a new one.** Both
  `SetNameScreen` and `AccountScreen` already blocked an empty name client-side before ever calling
  the server; extending the same gate to `>= 3` avoids an unnecessary round trip for the common case
  without adding a new validation concept to either screen.

## Verification

- `npm run typecheck` — clean.
- `npm test` — 396/396 passing (22 suites), including all newly added/adjusted cases.
- Local Supabase stack (`npx supabase db reset`, applying the new migration cleanly) — confirmed
  directly via `psql`, inside a transaction rolled back afterward, impersonating a real account
  (`set local role authenticated` + `request.jwt.claims`, with matching `auth.users`/`auth.sessions`
  rows so `session_still_valid()` passes): `set_name('')` → `'please enter a name'`; `set_name('A')`
  and `set_name('Al')` → `'please enter at least 3 characters'`; `set_name('Ali')` → succeeds, row
  updated to `'Ali'`. No rows left behind.
- `npm run web`, driven end to end with Playwright, OTP read from local Mailpit: signed up a fresh
  account, typed `'Al'` on the name gate — Continue stayed disabled; typed `'Ali'` — Continue
  enabled, submission succeeded (`set_name` accepted it), landed on My Lists. Created a list, opened
  Sharing: typed `'Al'` in the invite field, waited past the debounce, confirmed via
  `browser_network_requests` that no `search_users_by_name` request was made; typed `'Ali'` — the RPC
  fired (`POST .../rpc/search_users_by_name` → 200). Confirms the debounce gate and the server call
  are wired together correctly at the real 3-character boundary, not just in the mocked unit tests.
