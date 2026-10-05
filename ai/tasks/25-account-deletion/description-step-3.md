# Step 3 — Delete account in the app

The user's requests are quoted verbatim in [description-step-1.md](description-step-1.md), along with
the decisions they settled.

**Steps 1 and 2 must land first.**

- Build to step 1's mockups.
- Take every visible string and a11y label from step 1's log. Where the log differs from this
  description, the log wins.
- Step 2's log has the measured HTTP statuses and the behaviour of a stale token after deletion.

## API

- **[profileApi.ts](../../../src/lib/profileApi.ts):** add `deleteAccount(): Promise<Result>`. It
  calls `supabase.rpc('delete_account')` and returns `resultFor(error, status)`, the same shape as
  `setName`.
  - It is answered synchronously and never queued, so it is not one of the outbox's seven write
    actions ([writes-retry-from-an-outbox](../../kb/entries/writes-retry-from-an-outbox.md)).
  - Tests mock `supabase`
    ([supabase-client-module-boundary](../../kb/entries/supabase-client-module-boundary.md)).
- **[outbox.ts](../../../src/lib/outbox.ts):** add `clearOutbox(userId)`.
  - It removes `outbox:<userId>` and `outbox:<userId>:broken`, through `inOrder`.
  - `:broken` holds unsent writes kept for recovery by hand. A deleted account has nowhere to recover
    them into.

## SessionContext

[SessionContext.tsx](../../../src/state/SessionContext.tsx):

- **`SignedOut.reason`** becomes `'revoked' | 'deleted'`. Widen the `signOutReason` ref to match.
- **`deleteAccount(): Promise<Result>`**, beside `signOutEverywhere`:
  1. Call the RPC. On failure, return the result untouched. Nothing on the device changes.
  2. On success:
     - clear the account's list cache (`clearCachedLists`), name cache (`clearCachedName`) and
       outbox (`clearOutbox`);
     - set `signOutReason.current = 'deleted'`;
     - call `supabase.auth.signOut({ scope: 'local' })`.
- **Local sign-out always completes.** The server session is already gone with the account.
  - auth-js 2.112.4's `_signOut` (`node_modules/@supabase/auth-js/dist/module/GoTrueClient.js`)
    ignores a 401, 403 or 404 from `/logout`.
  - For `scope: 'local'`, it removes the stored session in every branch.
  - So treat any error it returns after a successful delete as success. The account no longer
    exists, so staying signed in is never right.
- **The outbox and the caches can be written back after they are cleared.**
  - `useOutbox`'s `persist` saves `queue.current` after each flush step. It stops only once
    `live.current` is false, which happens when `ListsProvider` unmounts: the render after
    `onAuthStateChange` delivers the sign-out.
  - So a flush in flight when the RPC returns can save the queue again after `clearOutbox`.
  - Check `writeCachedLists` for the same window.
  - **Required:** once the `deleted` state is reached, none of `lists:<id>`, `name:<id>`,
    `outbox:<id>` or `outbox:<id>:broken` exists.
  - **Recommended:** clear again once the signed-in tree has unmounted. One way is an effect on
    `state.status === 'signedOut' && state.reason === 'deleted'`, with the deleted user's id held in
    a ref. It works because passive unmount cleanups run before new passive effects.
  - Today's sign-out has the same window for the list cache and accepts it. Deletion must not.
- **Deleting discards the outbox. Signing out still keeps it.** The queued writes are owed to an
  account that no longer exists. `performSignOut` does not change.
- **Untouched:**
  - the sort and theme preferences, which are per device and never per account
    ([scope-boundaries](../../kb/entries/scope-boundaries.md));
  - the native Google sign-in state. Sign-out does not touch it either.

## AccountScreen

[AccountScreen.tsx](../../../src/screens/AccountScreen.tsx), built to step 1's mockups:

- **The control and its confirm have their own state** (`confirmingDelete`, `pendingDelete`).
  They are independent of "Sign out of all devices" unless step 1 settled otherwise. Build the fold
  behaviour step 1 chose.
- **Confirm calls `deleteAccount()`.** The outcomes:
  - **Success:** do nothing. `RootNavigator` swaps stacks and the screen unmounts, as it does on
    sign-out.
  - **`sessionRevoked`:** call `signOut('revoked')` and return, as `saveName` does
    ([session-revoked-write-redirects](../../kb/entries/session-revoked-write-redirects.md)).
  - **`verdict === 'retryable'`:** show step 1's offline sentence in the `ErrorBanner`.
  - **Any other failure:** show the database's own words in the `ErrorBanner`. `resultFor` keeps them
    for synchronous callers.
  - **On any failure:** re-enable the buttons and close the confirm, as `pressConfirmEverywhere`
    does.
- **While the request runs**, the confirm shows its pending text and `Cancel` is disabled.
- Queries go through a11y labels
  ([queries-go-through-a11y-labels](../../kb/entries/queries-go-through-a11y-labels.md)).

## SignInScreen

- When `reason === 'deleted'`, show step 1's notice in the existing `notice` style. Show it instead
  of the revoked notice, never alongside it.

## Other devices

No code. Observe and describe in the log:

- **Writes.** Their sessions went with the account, so the next guarded write is refused with
  `42501` and redirects to Sign in with the revoked notice, through the existing path.
- **Reads** return nothing until the access token expires (1 h at most). Then the refresh fails and
  the device signs out.
- **Leftovers on disk.** Their queued writes and cached lists stay under the old id, and they never
  replay, because signing up again with the same email gets a new id. This is accepted. Do not build
  cleanup across devices.

## Tests (jest)

Await `render` and `fireEvent` (RNTL 14).

- **`deleteAccount`** calls `rpc('delete_account')` with no arguments and maps the result through
  `resultFor`.
- **`clearOutbox`** removes both keys, ordered after a pending `saveOutbox`.
- **SessionContext:**
  - A success ends in `signedOut` with `reason: 'deleted'`, leaving no list, name or outbox key.
  - That holds even with a flush in flight that saves after the RPC resolves.
  - A failed RPC leaves the session signed in and every key intact.
  - A `signOut` that returns an error after a successful delete still ends signed out.
- **AccountScreen:**
  - open, cancel and confirm;
  - the warning, verbatim;
  - the pending text;
  - the offline sentence;
  - `sessionRevoked` leads to `signOut('revoked')`;
  - any other error is shown verbatim.
- **SignInScreen:** `deleted` shows its notice verbatim and not the revoked one. `revoked` is
  unchanged.

## Verification

1. **Local stack only.**
   - Read `.env`'s `EXPO_PUBLIC_SUPABASE_TARGET` first, and check for any Metro already on 8081
     ([supabase-target-picked-at-runtime](../../kb/entries/supabase-target-picked-at-runtime.md)).
   - **Never delete `maya@example.com` or `maya3@example.com`.** Use throwaway accounts.
2. **Browser (Playwright + Mailpit).** Rebuild step 2's fixture through the UI, with B signed in in a
   second browser context. Then:
   - **A deletes the account.**
     - L1, L2 and L3 are gone.
     - B's Lists loses L2 within about a second, with no reload. If B has L2 open, B sees "List not
       found".
     - The rosters of L4 and L5 no longer list A.
     - L6 is still in C's bin.
   - **A lands on Sign in** with the deleted notice. `localStorage` holds no `lists:`, `name:` or
     `outbox:` key for A's id.
   - **Offline.** Block `/rest/v1/rpc/delete_account`. Expect the offline sentence, A still signed
     in, and nothing cleared.
   - **Signing in again with the same email** shows the name gate, then an empty Lists.
   - **A second session of A** in another context: its next write redirects to Sign in with the
     revoked notice.
3. **Phone.** Take iOS simulator screenshots of the changed screens only, in day and night:
   - Account at rest;
   - Account with the confirm open;
   - Sign in with the deleted notice.

   Compare by measure against step 1's mockups
   ([phone-is-the-product](../../kb/entries/phone-is-the-product.md)).

   **iPhone only.** Do not build for, boot or test on the Android emulator (request 5).
4. **Commands:** `npm test`, `npm run typecheck`, `npm run kb:audit`. The audit still fails on
   `session-still-valid-guards-writes` until step 2's deposit has run, which is expected.

## KB impact (for the librarian)

| entry | change |
|---|---|
| scope-boundaries | account deletion is in. Every solely owned list goes permanently, live or binned, shared or not, and every other list stays. The warning is general with no per-list preview (the user's call). No Edge Function, no Apple token revocation, no cloud push. Remove the "ownerless list" sentence |
| writes-retry-from-an-outbox | deleting the account is the one path that discards the outbox, `:broken` blob included. Signing out still keeps it |
| session-revoked-write-redirects | `AccountScreen`'s delete confirm checks `sessionRevoked` inline, beside the three callers the entry lists |
| phone-is-the-product | the Account screenshots match step 1's mockups. Device checks run on the iPhone only, by the user's instruction (request 5); the entry still names the `Pixel_10` emulator as the second sign-off |
