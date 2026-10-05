# Step 3 — implementation log: delete account in the app

2026-10-05. Scope: `description-step-3.md`, with step 1's log winning where they differ (copy, a11y labels, the
reveal rule, mutual exclusion, the in-card banner). The user approved the plan before work began. Not committed.

## What changed

| file | change |
|---|---|
| `src/lib/profileApi.ts` | `deleteAccount(): Promise<Result>`: `supabase.rpc('delete_account')` with no args, returning `resultFor(error, status)`. It is the shape `setName` has |
| `src/lib/outbox.ts` | `clearOutbox(userId)`: one `inOrder` job that removes `outbox:<id>` and then `outbox:<id>:broken` |
| `src/state/SessionContext.tsx` | the `SignOutReason = 'revoked' \| 'deleted'` type (exported); `AuthState.signedOut.reason?: SignOutReason`; a widened `signOutReason` ref; the module helper `forgetAccount(id)` (lists, name and outbox in parallel, all `inOrder`); a `deletedUserId` ref; `deleteAccount()`; a sticky `enterSignedOut`; the second-clear effect. `signOut(reason?: 'revoked')` and `performSignOut` are unchanged, and signing out still keeps the outbox |
| `src/components/useScrollReveal.ts` | new. It returns `{ ref, onLayout, onScroll, reveal(bottom) }`. `overflow = bottom − (offset + frame − insets.bottom)`, and it scrolls by that much, animated, only when it is above 0 |
| `src/screens/AccountScreen.tsx` | the 4th card; `confirmingDelete`, `pendingDelete` and `deleteError`; the refs `cardsTop` and `revealDelete`; `openConfirmEverywhere`, `openConfirmDelete`, `onDeleteCardLayout` and `pressConfirmDelete`. The style `signOutCard` is renamed `pillCard` (both cards use it), and `cardError` is new (`marginHorizontal: 0, marginTop: 0`) |
| `src/screens/SignInScreen.tsx` | `NOTICES: Record<SignOutReason, string>` replaces the `revoked` boolean. One notice line at most |
| tests | `profileApi` +4, `outbox` +2, `SessionContext` +5, `AccountScreen` +9, `SignInScreen` +1 plus 2 assertions. 786 → 807 |
| `ai/tasks/25-account-deletion/screenshots/step-3/` | 6 shots plus 2 reveal frames (below) |

Copy and labels are step 1's table verbatim:
- `Delete account` / `Delete account`;
- the warning;
- `Cancel deleting account` / `Cancel`;
- `Confirm delete account` / `Yes, delete my account` → `Deleting…`;
- `You need a connection to delete your account.`;
- `Your account was deleted.`.

The warning is JSX text over three source lines. JSX collapses the line breaks into single spaces, and the RNTL test
asserts the whole sentence.

## Decisions

1. **`deleteAccount`'s order.**
   1. Guard on `signedIn`/`nameRequired`. Otherwise return `{ error: 'Not signed in.', verdict: 'permanent' }`, as
      `setName` does.
   2. Call the RPC. On error, return the result untouched; nothing on the device changes.
   3. Set `deletedUserId.current = id`, then `await forgetAccount(id)`.
   4. Set `signOutReason.current = 'deleted'`, then `await supabase.auth.signOut({ scope: 'local' })`. Its result is
      ignored.
   5. Call `enterSignedOut('deleted')`.
2. **The deleted state is forced (step 4 above), because the description's auth-js claim is not quite true.**
   - In `GoTrueClient.js` (2.112.4, `_signOut`, about line 3412), the first branch is
     `if (sessionError && !isAuthSessionMissingError(sessionError)) return this._returnResult({ error: sessionError })`.
     It returns *before* `removeCurrentSession()` and without notifying.
   - `_useSession` → `__loadSession` refreshes an expired access token. A *retryable* (network) refresh failure
     comes back as that `sessionError`.
   - `_callRefreshToken` (catch, about line 4274) removes the session only for a non-retryable error, and only once
     the access token has really expired. A proactive refresh with a still-valid token preserves the session. A
     retryable error never removes it.
   - The `/logout` branches do behave as the description says. A 401/403/404 is ignored. Any other error removes the
     session for `scope: 'local'` before returning the error.
   - So, in that one case, the listener never hears `SIGNED_OUT` and the stored session survives. Forcing the state
     covers it. The leftover stored session self-heals: the next refresh gets 400 `refresh_token_not_found`, and
     auth-js removes the session and emits `SIGNED_OUT`.
3. **`enterSignedOut` keeps `signedOut`/`deleted` against any later sign-out event.** Only a sign-in leaves it. Two
   races needed this:
   - A flush step whose write comes back 403 `sessionRevoked` calls `signOut('revoked')`. Its
     `signOutReason = 'revoked'` can overwrite `'deleted'` before the listener reads it.
   - A failed auto-refresh later emits `SIGNED_OUT` with no reason.

   In both, the forced call in decision 1 lands last, or the guard drops the late event.
4. **The second clear.** It is an effect on `state`. When the state is `signedOut`/`deleted` and `deletedUserId.current`
   is set, it takes the id, nulls the ref and runs `void forgetAccount(id)`.
   - It works because React runs every passive unmount cleanup before any new passive effect in a commit.
     `ListsProvider`'s `live.current = false` (`ListsContext.tsx`, the cleanup at about line 200) therefore lands
     first.
   - Every later write is either already ahead of this clear in `inOrder`'s chain, or stopped by `live`. Checked:
     - `useOutbox.persist` runs after `if (!live.current) return`, synchronously;
     - `useHydration.hydrate`'s `writeCachedLists` runs after the `live` check at line 124, synchronously;
     - the cache effect in `ListsContext` runs only while mounted.
   - The first clear (before the sign-out) is kept as well, so a kill in between leaves nothing. A test pins it.
   - **Residual, not handled:** `SessionContext`'s own `writeCachedName`. A background `resolveName` or a `setName`
     whose response arrives after the second clear would re-create `name:<id>`. The response would have to arrive
     after the RPC, the clear, `/logout`'s round trip and the unmount, so this is judged negligible.
5. **The account-ending actions lock each other out while one runs.** This was not in step 1; the agent added it.
   - `Delete account` is disabled while `pending || pendingEverywhere`.
   - `Sign out` and `Sign out of all devices` are disabled while `pendingDelete`.
   - Why: "one closes the other" would otherwise close a confirm under its own request. A plain `Sign out` racing a
     successful delete would also reach `signedOut` with no reason, and the second clear would be skipped.
   - The name editor stays independent, as step 1 left it.
6. **Mutual exclusion** (step 1, answer 3): `openConfirmDelete` sets `confirming` to false, and
   `openConfirmEverywhere` sets `confirmingDelete` to false.
7. **The reveal runs once per open.**
   - `openConfirmDelete` sets `revealDelete.current = true`.
   - The delete card's next `onLayout` clears the flag and calls `reveal(cardsTop + layout.y + layout.height)`.
     `cardsTop` is the `cards` View's `onLayout` y.
   - The ScrollView gets `scrollEventThrottle={16}`, as `AuthFrame` has.
   - `Backdrop` does not pad the bottom, so the frame is the whole screen and `insets.bottom` is subtracted.
8. **The in-card `deleteError`** (step 1, 4/4a) is cleared when the confirm is pressed, not when it is opened, so it
   stays visible above the reopened confirm. On any failure the screen re-enables and closes the confirm, as
   `pressConfirmEverywhere` does. On `sessionRevoked` it calls `void signOut('revoked')` and returns without
   re-enabling, as `saveName` does.
9. **`NOTICES` is a map keyed by `SignOutReason`.** The type makes a third reason a compile error until it has copy.
   This removed the literal `state.reason === 'revoked'` from `SignInScreen.tsx`, which one KB `verify:` greps (see
   Verification).

## Verification

### Commands

- `npm test`: 31 suites, **807 of 807** passed.
  - In 2 of 4 full runs, an `act(...)` warning for `VirtualizedList` printed from `src/screens/ListsScreen.test.tsx`.
  - It **predates this step**. The pre-change tree (stashed) printed it in 2 of 4 runs too (5, 0, 1 occurrences). The
    suite alone prints 0, so it depends on load. Not touched.
- `npm run typecheck`: clean.
- `npm run kb:audit`: **"67 entries, 61 mechanically checked, 1 error(s), 7 warning(s)".**
  - The error: `session-revoked-write-redirects`' `verify:` includes
    `grep -q "state.reason === 'revoked'" src/screens/SignInScreen.tsx`, which decision 9 removed. The behaviour it
    stands for still holds; the revoked-notice tests pass.
  - The seven warnings are "ground moved" for uncommitted files.
  - Step 2's expected error, `session-still-valid-guards-writes`, no longer fires: its deposit has already run.

### Mutation checks

Each new mechanism was removed once to confirm a test catches it:

| removed | failing test |
|---|---|
| `inOrder` in `clearOutbox` | `clears after a save that is still pending` (`setItem` is delayed 20 ms once) |
| the second-clear effect | `leaves nothing even when a flush in flight saves after the first clear` |
| the first clear | `signs this device out with reason deleted…` (it records the keys at the moment `signOut` is called) |
| the forced `enterSignedOut('deleted')` | `still ends signed out when the local sign-out returns an error` |
| the sticky guard | `keeps reason deleted through a later sign-out event` |

### Browser (Playwright MCP, local stack)

**Setup.**
- `.env`'s `EXPO_PUBLIC_SUPABASE_TARGET` line was commented out, and nothing was on 8081.
- Metro ran under `EXPO_PUBLIC_SUPABASE_TARGET=local npx expo start --dev-client --clear`. The bundle's target was
  read back as `local`.
- Accounts: A `t25s3a@` (`0a0d0c07-0525-4a93-9715-2558d1b51432`), B `t25s3b@` (`6de9420e…`) and C `t25s3c@`
  (`042a4d36…`). Throwaways only.
- **One Playwright context per user**, plus A2 (a second session of A) and B2 (a second session of B), all made with
  `browser.newContext()`. See "Problems" for how state was kept across calls.

**Fixture: step 2's L1–L6, built through the UI.**
- Lists were created on Lists. Sharing used the name field and the `Share with <name>` suggestion. Roles were set with
  the `Set <name> to <role>` radios. L3 (by A) and L6 (by C) were binned with `Delete <list>`.
- `psql` read it back exactly as step 2's table.

**Offline.** `A.route('**/rest/v1/rpc/delete_account', r => r.abort('failed'))`, then open and confirm:
- `You need a connection to delete your account.` showed as an `alert` inside the delete card, above `Delete account`;
- the confirm closed;
- A stayed signed in;
- the keys were unchanged: `lists:<A>`, `name:<A>`, `outbox:<A>`.

**A deletes.** Timed from the confirm tap:

| check | result |
|---|---|
| A on Sign in, showing `Your account was deleted.` and no revoked line | **284 ms**. A's `localStorage` was **empty**: no `lists:`/`name:`/`outbox:` key, and the auth token was gone too |
| B's Lists loses L2, with no reload | **792 ms**. L4 and L5 remain |
| B2, which had L2 open | `List not found` at **792 ms** |
| the L4 and L5 rosters, read in B's Sharing | B (you) only. A is absent from both |
| C's bin (`Show deleted`) | L6 is there, with `Restore t25s3-L6` |
| `psql` | L1–L3 gone. L4: B owner, `created_by` null. L5: B owner. L6: binned, C owner. A's `auth.users` rows: 0 |

**A2, a second session of A that never signed out.** These are the other-device observations.
- **Reads.** Its Lists was already empty before any action. A's own `user:<A>` topic got the departure nudges, the
  device re-read, and every read now returns `[]`.
- **An unguarded write.** `New list` → `t25s3-A2-new` → `Create` got `POST lists → 409`:
  - body `{"code":"23503","details":"Key is not present in table \"users\".", "message":"insert or update on table \"lists\" violates foreign key constraint \"lists_created_by_fkey\""}`;
  - **the red banner shows that raw sentence**;
  - the op was dropped (`outbox:<A>` = `{"v":1,"ops":[]}`), and **the device stayed signed in**.

  This is step 2's prediction, now observed. No code, as the description says.
- **A guarded write.** Account → `Edit name` → `Save name` (`set_name`, 403 `42501`) redirected to Sign in with
  `You were signed out on another device.` in **214 ms**.
- **Leftovers on disk** after that revoked sign-out: `outbox:<old A id>` = `{"v":1,"ops":[]}`. The list and name
  caches were cleared, as any sign-out clears them. This is accepted and never replays.

**Signing up again** with `t25s3a@` showed the name gate, then an empty Lists, under a new id `e218f80d…` (not
`0a0d0c07…`).

**The reveal on web at 375×667** (insets are 0 on web):
- At rest, the pill's bottom is at 645.
- On open, the card's bottom would be at 775. After the reveal it is at **667.0**, exactly the bottom edge.
- With the page scrolled to its end first, opening the confirm moved nothing: 422.5 before and after.

**Cleanup:** A (new id), B and C each deleted their account through the app. All three reached the deleted notice
with an empty `localStorage`. `psql` then showed 0 `t25s3%` rows in `auth.users`, `public.users` and `lists`.

### Phone (iPhone 18 Pro simulator, iOS 27, iPhone only)

**Setup.**
- No native build: the installed dev client loaded JS from Metro. The floating action button was still off
  (`EXDevMenuShowFloatingActionButton` = 0). `status_bar override --time 9:41` was set.
- **Before:** the simulator was shut down. On opening, it was signed in as `maya3@example.com` with Appearance
  **Day**.
- The flow (`scratchpad/maestro/delete-run.yaml`, not committed):
  1. signs out with `.maestro/flows/sign-out.yaml`, then signs in a throwaway with `sign-in.yaml`;
  2. sets the name, then Account → THEME;
  3. `assertVisible: ${EMAIL}` before any confirm.
- Runs: `t25s3i1@` with Day plus the reveal frames, and `t25s3i2@` with Night.
- **After:** `ensure-signed-in` + `set-theme` signed `maya3@` back in on Day, and its Lists matched the "before" shot.
  Then the status bar was cleared, the simulator shut down and Metro stopped. `psql` showed 0 `t25s3%` rows.

**Compared by measure against step 1's 18 Pro column.** Edges were scanned down the x = 200 pt column of each @3x PNG,
in pt. Day and night are identical.

| | step 1 (18 Pro) | measured |
|---|---|---|
| delete card at rest | 636–728, pill 655–707 | 636–728, pill 655–707 |
| delete card open | 636–837: warning 655–760 (5 lines), pills 770–816 | 636–837: pills 770–816. Warning glyph bands start at 660, 681, 702, 723 and 744 (5 lines at a 21 pt pitch, so the boxes are 655–760) |
| Sign in card | 387–787, notice 412–452.5 | 387–787, notice 412–452.7 |

**The native reveal.** `reveal-before-day.png` has the name editor open, which pushes the delete card down.
`reveal-after-day.png` is the confirm opened from there: the page scrolled so the card's bottom sits on the safe area,
with the pills above the home indicator. On the 18 Pro the confirm opened from rest fits, as step 1 measured
(837 vs 840), so no scroll happens there.

Files in `screenshots/step-3/`:
- `account-delete-{day,night}.png`;
- `account-delete-confirm-{day,night}.png`;
- `sign-in-deleted-{day,night}.png`;
- `reveal-{before,after}-day.png`.

## Problems hit

1. **Playwright MCP `browser_run_code_unsafe` does not keep `globalThis` between calls.** The second call found the
   helpers undefined. The `page.context().browser()` object does persist, so the helpers and the per-user pages were
   attached to it (`browser.t25`).
2. **The first Maestro run failed to start the iOS driver.** This is the known iOS 27 flake, and the retry passed.
3. **The load spike after booting the simulator.** The simulator runtime's `BackgroundShortcutRunner` ran at about
   225 % CPU, and the load average reached 37.
   - The KB says `inputText` drops characters under heavy load, so the flow waited.
   - It took about 7 minutes to fall under 8. Both passes then typed cleanly.
4. **Different Lists layouts in different contexts.** A2's Lists showed the `New list` button with the search bar
   (the browser profile's sort state, presumably) rather than the `New list name` field. The first create silently did
   nothing until the button was tapped first.
5. **`kb:audit`'s stale grep** (Verification, above).

## KB candidates (for the librarian)

| entry | change |
|---|---|
| scope-boundaries | Account deletion is in. Every solely owned list goes permanently, live or binned, shared or not, and every other list stays. The warning is general, with no per-list preview (the user's call). No Edge Function, no Apple token revocation, no cloud push. Remove the "ownerless list" sentence |
| writes-retry-from-an-outbox | Deleting the account is the one path that discards the outbox, `:broken` blob included (`clearOutbox`, through `inOrder`). Signing out still keeps it |
| session-revoked-write-redirects | (a) `AccountScreen` now has two inline `sessionRevoked` checks: `saveName` and `pressConfirmDelete`. (b) The reason ref is `SignOutReason = 'revoked' \| 'deleted'`. `deleteAccount` sets `'deleted'`, `signOut` still takes only `'revoked'`, and a `deleted` state is sticky in `enterSignedOut`. (c) **Fix the `verify:`**: replace `grep -q "state.reason === 'revoked'" src/screens/SignInScreen.tsx` with a check of `NOTICES` (for example `grep -q "revoked: 'You were signed out on another device.'" src/screens/SignInScreen.tsx`). The audit's one error comes from this |
| phone-is-the-product | The Account and Sign in shots match step 1's mockups by measure (table above). Device checks ran on the iPhone only, by the user's instruction (request 5). The entry still names the `Pixel_10` emulator as the second sign-off |
| new, or with deletion | **The device-side deletion rules.** (1) The order: RPC, clear, `signOut({scope:'local'})`, then force `signedOut`/`deleted`. (2) auth-js `_signOut` returns early, without removing the session or notifying, when `_useSession` returns a non-"missing" error (a retryable refresh failure). That is why the state is forced. (3) The second clear runs on the deleted state once `ListsProvider` has unmounted, relying on passive unmount cleanups running before new passive effects. (4) The `writeCachedName` residual (decision 4) |
| new, or AccountScreen's | **Account's confirm rules, built now as step 1 asked.** Opening either confirm closes the other. The three account-ending actions are disabled while another one runs. The delete failure banner is the card's own `deleteError`, cleared on confirm. The reveal (`useScrollReveal`) runs once per open, scrolling the card's bottom to `frame − insets.bottom` with no gap. The SE (375×667) needs it; the 18 Pro does not |
| session-still-valid-guards-writes, or deletion | Observed (it was step 2's prediction): after a deletion, another device's unguarded list create gets 409 `23503`. The raw FK sentence shows in the red banner (`humanize` has no `23503` case), the op is dropped, and the device stays signed in until a guarded write or the token expires. A guarded write redirects with the revoked notice in about 200 ms. Reads return `[]` at once, because the departure nudges on `user:<deleted id>` reach that device's own channel |
| maestro-drives-the-native-ui | After a cold boot of the iOS 27 simulator, `BackgroundShortcutRunner` held about 225 % CPU and load reached 37 for about 7 min. Wait for the load to fall before `inputText` |
| supabase-local-stack (testing recipe) | Playwright MCP: `browser_run_code_unsafe` loses `globalThis` between calls, but `page.context().browser()` persists. Hang helpers on it, and give each user a `browser.newContext()` so their `localStorage` is separate |
