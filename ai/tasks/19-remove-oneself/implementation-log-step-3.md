# Implementation log — step 3: confirm before an owner removes someone (including themselves)

**Date:** 2026-09-23. Description: [description-step-3.md](description-step-3.md).

## What changed

No database or `membersApi.ts` change — this is purely `SharingScreen.tsx`'s owner-only "Remove"
control gaining the same two-step Cancel/confirm pattern step 1 already built for the reader/writer
"Leave list" control in the same file, applied uniformly to every row `manageable` renders, including
the owner's own.

**`src/screens/SharingScreen.tsx`**:
- New `const [confirmingRemoveUserId, setConfirmingRemoveUserId] = useState<string | null>(null);` —
  a single id rather than a set, since `locked = pending || (you && soleOwner)` already disables
  every other row's Remove/RolePicker for the duration of any one row's write, so more than one row
  can never legitimately be mid-confirm at once; starting a confirm on a different row simply
  replaces the previous (unconfirmed) one.
- The `manageable` branch now checks `confirmingRemoveUserId === member.userId` first: pressing
  "Remove" no longer calls `removeMember` directly — it only sets `confirmingRemoveUserId`, swapping
  that row's `RolePicker` + Remove button for a confirm row (reusing the existing
  `styles.confirm`/`confirmText`/`confirmActions`/`cancelButton`/`dangerButton`, no new styles).
  Confirming calls `run(() => removeMember(listId, member.userId))` and, on a refusal, uses `run`'s
  existing boolean return (added in step 1) to collapse back to the plain button — the identical
  mechanism `confirmingLeave` already uses.
- Confirm copy is voiced differently for self vs. someone else: `you ? "You'll lose access to this
  list until someone shares it with you again." : "${name} will lose access to this list until
  someone shares it with them again."` — the self line is copied verbatim from the existing
  Leave-list confirm text, since the real-world consequence (an owner removing themselves) is the
  same fact stated from the same voice.
- `RolePicker`'s role-change action was deliberately left untouched — a single tap, no confirmation —
  since only removal was in scope and a role change is reversible with another tap.

**`src/screens/SharingScreen.test.tsx`**: four existing tests pressed `Remove …` expecting an
immediate call and needed a second press on the new `` `Confirm remove …` `` label added
(`'removes somebody'`, the revoked-session test, `'leaves the screen when your own membership is
gone'`, `'stays put when somebody else is removed'`). `'disables the controls while a request is in
flight'` was restructured to check the confirm row's own Cancel/Confirm buttons rather than a
RolePicker that no longer renders once that row is mid-confirm. Three new cases mirror the
Leave-list suite's own depth: pressing Remove alone doesn't call `removeMember` yet; Cancel returns
to the plain button without calling it; a refusal collapses the confirm row back to the plain
button. A stale comment on the "still uses Remove on their own row" test (which said Remove had no
confirm step) was corrected.

## Decisions worth flagging

- **One shared confirm id across every row, not per-row state or a set** — justified above by
  `locked`'s existing screen-wide `pending` gate already ruling out two simultaneous confirms; adding
  a `Set<string>` would have been unreachable complexity.
- **The disables-while-pending test lost its "another row is also disabled" assertion.** The
  original pre-step-3 version checked Bob's *own* Remove button and RolePicker together, both part of
  one un-swapped view — it never actually checked a genuinely different row. Once Remove-then-confirm
  replaces that row's whole controls block, the direct analogue is the confirm row's own two buttons;
  reaching for a truly different row (e.g. the sole-owner row, already disabled for an unrelated
  reason) would have been a confound, not stronger coverage, so it was dropped rather than replaced
  with something misleading.

## Bug found in review: stale `confirmingRemoveUserId` on a re-invited account

**Reported scenario:** share a list with a user, remove them, add the same user back — their new row
opened straight into the confirm view, with no press on "Remove" at all.

**Cause:** the confirm button's `onPress` only cleared `confirmingRemoveUserId` on a *refusal*
(`if (!ok) setConfirmingRemoveUserId(null)`), copied directly from `confirmingLeave`'s equivalent
handler without noticing the two aren't symmetric on success. Leaving always navigates away on
success (`popToTop()`), so `confirmingLeave` staying `true` in an unmounted screen is inert. Removing
someone *else* doesn't navigate anywhere — the screen stays mounted, that row simply disappears from
the next roster, and the id sat in state invisibly. If the same account was re-invited later and
landed back on the same `userId` (the common case — it's the same row in `list_members`, not a new
one), the new row's `confirmingRemoveUserId === member.userId` check matched the leftover id and
rendered the confirm view unprompted.

**Fix:** clear `confirmingRemoveUserId` unconditionally once the request settles, not only on
`!ok` — `run(...).then(() => setConfirmingRemoveUserId(null))`. On success this is a no-op for
render (the row is already gone), on failure it's the same behavior as before.

**Regression test**, `src/screens/SharingScreen.test.tsx`: `'does not reopen the confirm view for an
account re-invited after being removed'` — remove-then-confirm, re-invite the same `userId` via the
share flow, assert the new row shows the plain "Remove" button rather than the confirm view. Checked
against the bug directly: reverting only the `.then(() => ...)` line back to `.then((ok) => { if
(!ok) ... })` (keeping the rest of step 3 intact) reproduces the exact failure — `findByLabelText('Remove
bob@example.com')` never resolves because that row is stuck on the confirm view.

## Verification

- `npm run typecheck` — clean.
- `npm test` — 412/412 passing (22 suites): the three new cases and four adjusted ones from the
  confirm-step work itself, plus the one regression test for the stale-id bug.
- `npm run web`, driven end to end with Playwright, reading OTP codes from local Mailpit's HTTP API:
  two accounts signed up and made co-owners of one list (owner role both ways, so self-removal isn't
  blocked by `keep_last_owner`). As the primary owner:
  - pressed Remove on the co-owner's row — confirm row appeared with the "someone else" wording, no
    call yet; Cancel reverted cleanly to the plain Remove button, roster unchanged.
  - pressed Remove on **their own** row — confirm row appeared with the "you" wording; confirming
    navigated back to `My Lists` (`popToTop()`, the same as any other "your own membership is gone"
    path).
  - `psql` confirmed only the co-owner's `list_members` row remained afterward.
  - Browser console: 0 errors (same two pre-existing, unrelated warnings seen in every prior run).
  - Cleanup: both test accounts and the test list deleted directly via `psql` afterward.
- A second `npm run web` pass, after the bug fix, reproduced the reported scenario exactly: a third
  account shared a list with a fourth as reader, removed them (Remove → Confirm), then re-invited the
  same account by the same name search. The re-added row rendered the plain `RolePicker` + "Remove"
  button, not the confirm view. 0 console errors; both accounts and the list deleted via `psql`
  afterward.
