# Step 4 — Blocking in the app: Block, Blocked people, and the Account card

The user's requests and the settled decisions D1–D8 are in
[description-step-1.md](description-step-1.md). Read that first.

**Step 3 must land first.**

- Build to step 2's mockups.
- Take every visible string and a11y label from step 2's log. Where the log differs from this
  description, the log wins.

What blocking is (D2, D5):

- It governs invitations only. It removes nobody from a shared list and hides nobody from name
  search.
- While it stands, every notification from that person is hidden.
- The blocked person learns nothing beyond the ordinary decline of the invitation Block was pressed
  on. Their later invitations stay *Invited* on their side until they expire.
- Unblocking brings back their hidden notifications, but not the invitations suppressed meanwhile.

## API

In [notificationsApi.ts](../../../src/lib/notificationsApi.ts), beside step 3's functions:

- `blockInviter(invitationId): Promise<Result>`, which calls `block_inviter`. It takes the invitation,
  never a user id.
- `unblockUser(userId): Promise<Result>`.
- `fetchBlockedUsers({ before?, limit })` → `{ blocked: BlockedUser[] | null; cursor: BlockedCursor | null; error: string | null }`,
  where `BlockedUser = { userId; name; blockedAt }`.
  - It reads `my_blocked_users`, paged as `fetchNotifications` is (D8, step 1's request 10).
  - `before` and `cursor` are `{ blockedAt, userId }`, the last row's. `cursor` is `null` on a short
    page, and a null body counts as an empty page.
  - Export `BLOCKED_PAGE_SIZE = 100`, and assert `limit <= MAX_ROWS`.

## `NotificationsScreen`

- **The `Block <name>` pill** (`tone="danger"`) goes under Decline and Accept, on a pending,
  available invitation only, per step 2.
- **Block is two-step**, like every destructive row: a `confirmingBlockId` state swaps the card's
  actions for step 2's warning, `Cancel` and the danger confirm.
  - Confirm calls `blockInviter`, with the outcomes accept and decline already handle:
    - `sessionRevoked` → `signOut('revoked')`;
    - `retryable` → the offline action sentence;
    - any other failure → its message;
    - success → reload. The server now filters out every card from that person (D5).
  - Close the confirm on any outcome.
- **The `Blocked people` entry**, where step 2 placed it (recommended: in the header, since the list
  is paged and its end is out of reach until every page has loaded), navigates to `BlockedPeople`. It
  shows on the empty state too.
- **A block or a focus reloads as step 3 defines a reload**: one call re-reading as many rows as are
  shown, so the person's cards leave every loaded page.
- **Reload on focus**, through `navigation.addListener('focus', …)` on the navigation prop. Returning
  from Blocked people after an unblock must show that person's cards again, and an unblock sends no
  realtime nudge (it changes no `notifications` row).
  - This is the first focus listener in `src/screens`. The test stubs need an `addListener` that
    returns an unsubscribe
    ([screens-take-navigation-props](../../kb/entries/screens-take-navigation-props.md)).

## `BlockedPeopleScreen` (new)

`src/screens/BlockedPeopleScreen.tsx`, built to step 2's mockups. It takes navigation props and draws
its own header and Back.

- **Load.** Page 1 on mount.
  - While loading: an `ActivityIndicator` labelled `Loading blocked people`.
  - On failure: `ErrorBanner`; a `retryable` failure shows the offline load sentence.
- **A `FlatList`, paged (D8)**, as Notifications is:
  - `onEndReached` reads the next page with the cursor, and appends it, only while the cursor is
    not `null` and no page is in flight.
  - Its spinner, labelled `Loading more blocked people`, sits in `ListFooterComponent`.
  - A failed page shows nothing, and the next scroll to the end asks again.
  - No reload: nothing else changes this list while the screen is open.
- **One card per person:** `Avatar`, name, and an `Unblock` pill. One tap, no confirm: nothing is
  lost by unblocking.
  - While it runs, that pill shows its pending text and is disabled.
  - On success, drop the row and call `refreshUnread()` from `useNotifications()`. The person's
    unread notifications count again, and no nudge says so.
  - Keep the cursor as it is. The keyset continues from the last row's values, not its presence,
    so a dropped row never makes the next page skip one.
  - Failures are handled as on Notifications.
- **Empty state:** step 2's title and hint, verbatim.

**Navigation:** add `BlockedPeople: undefined` to `RootStackParamList` in
[types.ts](../../../src/navigation/types.ts), plus `BlockedPeopleScreenProps`. Add a `Stack.Screen` in
`RootNavigator`'s signed-in branch with `headerShown: false`.

## `AccountScreen`

[AccountScreen.tsx](../../../src/screens/AccountScreen.tsx) gains step 2's card, in the position it
settled. Its pill navigates to `BlockedPeople`.

- Check the delete confirm's scroll-into-view (`onDeleteCardLayout`) still lands with the extra card,
  at 390×844 and on the iPhone 18 Pro.

## Tests (jest)

Await `render` and `fireEvent` (RNTL 14). Assert copy verbatim from step 2's log.

- **`notificationsApi.test.ts`:**
  - the three new calls' names and params, `fetchBlockedUsers`' with and without a cursor;
  - its mapping, with a null body read as an empty page;
  - the cursor is the last row's, and is `null` on a short page.
- **`NotificationsScreen.test.tsx`:**
  - `Block` shows on a pending, available invitation only;
  - the warning, verbatim;
  - cancel;
  - confirm calls `blockInviter` with the invitation id, reloads, and that person's cards are gone;
  - the pending text;
  - the offline sentence;
  - `sessionRevoked`;
  - the Blocked people entry navigates;
  - a focus event reloads.
- **`BlockedPeopleScreen.test.tsx` (new):**
  - the list;
  - scrolling to the end reads the next page with the cursor and appends it, with the spinner
    showing meanwhile; nothing is read once the cursor is `null`;
  - an unblock drops the row, calls `refreshUnread`, and leaves the cursor unchanged;
  - the pending text;
  - both offline sentences;
  - `sessionRevoked`;
  - the empty state.
- **`AccountScreen.test.tsx`:** the card navigates to `BlockedPeople`; everything else is unchanged.

## Verification

1. **Local stack only**, as in step 3: read `.env`'s target first, and use throwaway accounts O and I
   in two browser contexts.
2. **Browser (Playwright).**
   - O invites I to L1 and L2. I presses Block on L1's card and confirms.
     - Every card from O leaves I's Notifications.
     - O gets `… declined your invitation to L1`.
     - L2 stays under Invited on O's Sharing, and never reaches I.
   - O invites I to L3. O sees *Invited*; I gets no dot and no card.
   - I opens Blocked people from Notifications and from Account: O is listed.
   - I unblocks.
     - O leaves the list.
     - Back on Notifications, O's earlier cards are back.
     - L2 and L3 are still not shown to I, and still *Invited* for O. Record that O must withdraw
       them to invite I to those lists again.
   - O invites I to L4: I gets it as normal.
   - Block `/rest/v1/rpc/block_inviter`: the offline sentence, and nothing changes.
   - **Paging.** Give I 250 blocks in SQL (load-test accounts as the blocked).
     - Scrolling loads all 250, newest first, in three pages, with no repeat.
     - Unblocking two people on page 1, then scrolling on, still loads every other row.
     - Delete the blocks afterwards.
3. **Maestro, iOS simulator.** Re-run `sign-out`, `set-theme` and `tour-signed-in`: Account's layout
   moved.
4. **Phone.** iOS simulator (iPhone 18 Pro) screenshots of the changed screens only, in day and night:
   - Notifications with `Block`, and with its confirm open;
   - Blocked people, with the next page's spinner, and empty;
   - Account with the new card.

   Compare by measure against step 2's mockups. Use `maya3@example.com`, and unblock everything
   afterwards. **iPhone only:** never the Android emulator.
5. **Commands:** `npm test`, `npm run typecheck`, `npm run kb:audit`. Only the failures step 3
   recorded are expected.

## After this step

- **Do not run `/librarian deposit`**, whatever CLAUDE.md's working rules say (step 1's request 9).
  Step 5 deposits the whole task once.
- Write `implementation-log-step-4.md` as usual. End it with a **KB candidates** section: the table
  below, corrected to what was actually built, plus anything the step taught that the table misses.
  That section is how this step reaches step 5.
- Never edit `ai/kb/`. If `npm run kb:audit` fails on an entry this step made stale, that is
  expected until step 5: name it in the log. Never change code to make a check pass.

## KB impact (for step 5's deposit)

| entry | change |
|---|---|
| scope-boundaries | blocking is in, for invitations only (D5). It hides that person's invitations and notifications while it stands, and stays invisible to them except as the pressed invitation's decline. It removes nobody from lists and hides nobody from search. Unblocking does not revive the invitations suppressed meanwhile. A wider block is out |
| screens-take-navigation-props | `NotificationsScreen` listens for `focus` on its navigation prop, so test stubs supply `addListener` |
| keyset-paging-in-the-order-shown | Blocked people pages on scroll. An unblock drops its row locally and keeps the cursor, which a keyset allows and an offset would not |
| phone-is-the-product | the Account, Notifications and Blocked people screenshots match step 2's mockups |
