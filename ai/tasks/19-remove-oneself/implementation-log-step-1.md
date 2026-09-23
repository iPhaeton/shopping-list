# Implementation log — step 1: remove oneself from a list ("Leave list")

**Date:** 2026-09-23. Description: [description-step-1.md](description-step-1.md).

## What changed

**Server** — new migration `supabase/migrations/20260924000000_leave_list.sql`:
- Fourth membership RPC, `leave_list(p_list_id uuid) returns void`, `security definer`,
  `set search_path = ''`. Same shape as `remove_member`
  (`supabase/migrations/20260907000000_list_sharing.sql:370-390` originally, last redefined with the
  session guard in `20260920000000_session_revocation.sql:334-358`): `session_still_valid()` first, then a
  `delete`, `if not found then raise 'P0002'`. Unlike `remove_member` it takes no `p_user_id` and no
  owner check — it deletes exactly `(p_list_id, (select auth.uid()))`, i.e. it can only ever act on
  the caller's own row. `keep_last_owner` (unchanged, `20260907000000_list_sharing.sql:120-165`)
  still fires on this `delete` and blocks a sole owner exactly as it does on `remove_member`'s —
  verified below, not just assumed from the trigger firing on any `delete on list_members`.
- Grants: `revoke ... from public, anon; grant execute ... to authenticated;`, matching every other
  RPC in the sharing migration.

**Client:**
- `src/lib/membersApi.ts` — new `leaveList(listId: string): Promise<Result>`, one-line
  `supabase.rpc('leave_list', { p_list_id: listId })` → `resultFor`, beside `shareList`/
  `setMemberRole`/`removeMember`. Doc comment above the four writes updated (three→four, four→five
  RPCs) and extended with why `leaveList` is still an RPC despite touching only a row the caller can
  already see under the select policy — the session guard and raise-on-refusal, not visibility.
- `src/screens/SharingScreen.tsx` — the per-row branch was purely screen-level before this
  (`manageable ? <owner controls> : <Text>{member.role}</Text>`, so a non-owner saw plain text on
  every row, including their own). Added a third branch: `!manageable && you` renders a "Leave list"
  control instead of plain text; `!manageable && !you` is unchanged. Confirmation is an inline
  Cancel/confirm row copied from `AccountScreen`'s "Sign out of all devices" pattern
  (`src/screens/AccountScreen.tsx:174-212`) rather than `Alert.alert` (a no-op under
  react-native-web) — local `confirmingLeave` boolean, fixed `accessibilityLabel="Confirm leave
  list"` while the visible text toggles `"Leave list"`/`"Leaving…"`. Confirmed action goes through
  the screen's existing `run()` helper (`run(() => leaveList(listId))`), which already: disables
  controls, redirects to sign-in on `sessionRevoked`, renders a refusal, and — since it already
  checks `!rows.some((m) => m.userId === userId)` — calls `navigation.popToTop()` on success with no
  changes needed there.
- `run()`'s return type changed `Promise<void>` → `Promise<boolean>` (true iff it reached the
  post-write branch) so the new confirm row can collapse back to the plain button on a refusal,
  mirroring `AccountScreen.pressConfirmEverywhere`'s `setConfirming(false)` on failure. The three
  existing callers (`RolePicker.onChange`, "Remove", "Share") all still call it as `void run(...)`
  and are unaffected.
- Tests: `src/lib/membersApi.test.ts` — `leaveList` added to the RPC-argument-name assertion (now
  six, was five); no separate classification tests, matching the existing convention of only
  `shareList` carrying the P0002/500/sessionRevoked cases since `resultFor` is shared logic, not
  per-function. `src/screens/SharingScreen.test.tsx` — new cases under "somebody who is not an
  owner": the control appears only on the viewer's own row; confirm-then-cancel does not call
  `leaveList`; confirm-then-confirm does, with the right `listId`; success triggers `popToTop()`
  (same shape as the existing owner self-removal case, reached via this new path); a refusal
  collapses the confirm row back to the plain button and renders the message; `sessionRevoked` →
  `signOut('revoked')`. One regression case under "an owner": their own row still shows "Remove", not
  "Leave list".

## Decisions worth flagging

- **A fourth RPC, not a widened DELETE policy**, even though the self-only SELECT policy on
  `list_members` means a policy `for delete using (user_id = (select auth.uid()))` would in fact be
  reachable (unlike the owner-acting-on-someone-else case
  [select-policy-gates-update-and-delete](../../kb/entries/select-policy-gates-update-and-delete.md)
  describes) — `keep_last_owner` fires on any `delete` regardless of path, so it isn't the deciding
  factor. Chose the RPC anyway to stay consistent with the established rule that every write in this
  schema is an RPC that raises rather than a table write that can silently no-op
  ([refused-writes-return-zero-rows](../../kb/entries/refused-writes-return-zero-rows.md)), and so
  `leave_list` gets the `session_still_valid()` guard other membership writes get — a raw policy path
  would need that check re-implemented as a trigger to match.
- **Scope kept to reader/writer only, deliberately not touching owner self-removal.** An owner could
  already remove themselves (while another owner remains) via the existing "Remove" button on their
  own row + `remove_member`, whose owner-check does not special-case the target being the caller.
  That path is untouched — no reason to migrate it onto `leave_list`, and the regression test above
  asserts it still isn't. The RPC itself has no owner/role restriction, so nothing stops a future
  screen from using it for an owner too, but this step's UI only surfaces it for `!manageable`.
- **`leave_list` needs no sole-owner special case in its own body** — `keep_last_owner` already
  covers it, and that case is unreachable from the UI this step ships (only reader/writer get the
  control) but was verified anyway (see Verification) since the RPC would be reachable by any role.
- **Confirmation step chosen over the zero-friction "Remove" pattern**, per explicit product decision
  during planning: leaving is self-initiated and not something the leaver can undo themselves (they'd
  need to be re-invited), unlike an owner-initiated "Remove" of someone else.

## Verification

- `npm run typecheck` — clean.
- `npm test` — 403/403 passing (22 suites), including the new `membersApi.test.ts` and
  `SharingScreen.test.tsx` cases.
- `npm run kb:audit` — 40/41 mechanically-checked entries pass; the one `FAIL`
  (`session-still-valid-guards-writes`, pinned-count drift 12→13 occurrences / 4→5 files from the new
  migration) is the expected shape of this exact change, matching the precedent in
  `ai/tasks/18-share-by-name/implementation-log-step-1.md`. Flagging for `/librarian deposit 19`
  rather than hand-editing the entry. `scope-boundaries.md`, `refused-writes-return-zero-rows.md`,
  and `writes-retry-from-an-outbox.md` all describe this exact gap as still-open and need the
  librarian's update too (audit doesn't flag them because their `verify:` commands don't assert
  RPC/function counts the way the session one does).
- Local Supabase stack (`npx supabase migration up`, not a full `db reset` — preserves existing local
  dev data): applied cleanly, one migration. `\df public.leave_list` confirms the signature;
  `information_schema.routine_privileges` confirms grants to `authenticated`/`postgres`/
  `service_role` only, no `anon`/`public`.
- Three scenarios proven directly via `psql`, impersonating real accounts (`set local role
  authenticated` + `request.jwt.claims`, a real `auth.sessions` row inserted first), each inside a
  transaction rolled back afterward so nothing was left behind:
  - **Sole owner calling `leave_list` on their own list**: raises `23514 'a list must keep at least
    one owner'` from inside `keep_last_owner` — the same trigger, same message `remove_member`'s
    self-removal path already relies on, proven rather than assumed from "the trigger fires on any
    `delete`".
  - **Reader calling `leave_list` on a list they don't own**: succeeds, their `list_members` row is
    gone afterward, the owner's row is untouched.
  - **Same reader, but their `auth.sessions` row deleted first** (simulating a global sign-out
    elsewhere): raises `42501 'this device has been signed out'` — confirms the guard runs, and
    runs first, before the `delete` statement.
- `npm run web`, driven end to end with Playwright, reading OTP codes from local Mailpit's HTTP API
  (`GET /api/v1/messages`) rather than clicking through its UI each time:
  - Two fresh accounts signed up through the real OTP + name gate (`owner-task19@example.com` /
    `member-task19@example.com`), a list created and shared to the second account as **reader** by
    name search.
  - As the reader: Sharing screen showed the owner's row as plain `owner` text and the reader's own
    row as a "Leave list" button — nobody else's row had any control, matching
    `!manageable && !you` staying plain text. Pressing it revealed the Cancel/confirm row with the
    exact copy written above; confirming navigated back to `My Lists`, and the list no longer
    appeared there (`popToTop()` plus the next list fetch both confirmed by the resulting screen).
  - `psql`: `list_members` for that list held only the owner's row afterward — the reader's row was
    actually deleted, not just hidden client-side.
  - Signed back in as the owner: the Sharing screen's roster showed only themselves — confirms the
    departure is visible to the remaining member on a fresh fetch, with no code change needed for
    that (the existing `departed` arm of the realtime un-share trigger,
    [realtime-is-a-nudge-to-a-per-user-inbox](../../kb/entries/realtime-is-a-nudge-to-a-per-user-inbox.md),
    already covers this — not separately exercised over a live socket here, only confirmed via a
    plain re-fetch).
  - No console errors attributable to this change.
  - Cleanup: both test accounts (`auth.users`, cascades) and the test list were deleted directly via
    `psql` afterward — nothing left in the local stack.
- Not pushed to the cloud project — consistent with every migration since step 9 staying local-only
  until a separate, explicit push.
