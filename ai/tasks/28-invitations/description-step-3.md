# Step 3 — Invitations in the app: the round header, Notifications, and Sharing's Invite

The user's requests and the settled decisions D1–D8 are in
[description-step-1.md](description-step-1.md). Read that first.

**Steps 1 and 2 must land first.**

- Build to step 2's mockups.
- Take every visible string and a11y label from step 2's log. Where the log differs from this
  description, the log wins.
- Step 1's log has the measured HTTP status of each refusal code.

**Not in this step:** Block, the `Blocked people` entry on Notifications, `BlockedPeopleScreen`, and
the Account card (step 4). Build Notifications' pending card without the `Block` pill, and its header
without the entry, so step 4 adds only those.

## Database: drop `share_list`

Add one file, `supabase/migrations/<yyyymmdd>000000_drop_share_list.sql`, dated the day it is written:

```sql
drop function public.share_list(uuid, uuid, public.list_role);
notify pgrst, 'reload schema';
```

- Comment the file with D1: nobody becomes a member without accepting, and keeping `share_list`
  would let an owner skip that consent.
- Apply it with `npx supabase migration up --local` only after nothing in `src/` calls `share_list`.
  Never `db reset`. Local only.

## API

Both modules import the client from `./supabase` only
([supabase-client-module-boundary](../../kb/entries/supabase-client-module-boundary.md)). Writes return
`resultFor(error, status)`. Nothing goes through the outbox, and nothing is cached: these screens are
online-only, like Sharing
([writes-retry-from-an-outbox](../../kb/entries/writes-retry-from-an-outbox.md)).

**[membersApi.ts](../../../src/lib/membersApi.ts)**

- Replace `shareList` with `inviteToList(listId, userId, role): Promise<Result>`, which calls
  `invite_to_list`.
- `fetchInvitations(listId)` → `{ invitations: PendingInvitation[] | null; error: string | null }`.
  It reads `pending_invitations_of`, and a null body counts as an empty list, as `fetchMembers` does.
  `PendingInvitation = { invitationId; userId; name; role; createdAt }`.
- `withdrawInvitation(invitationId): Promise<Result>`.
- `searchUsers(query, listId?)` passes `p_list_id` when `listId` is given.
- Update the module's doc comment, which describes the roster as changed by sharing.

**`src/lib/notificationsApi.ts` (new)**

- `fetchNotifications({ before?, limit })` → `{ notifications: Notification[] | null; cursor: NotificationCursor | null; error: string | null }`.
  - `before` and the returned `cursor` are `{ createdAt, id }`, the last row's.
  - `cursor` is `null` when the answer is shorter than `limit`: nothing further to read.
  - Export `NOTIFICATION_PAGE_SIZE = 100`, the user's number (request 7), as `LIST_PAGE_SIZE` is.
    Assert `limit <= MAX_ROWS`, as the other paged reads do.
  - `Notification` is a union keyed by `kind`:
  - `list_invitation` carries `invitationId`, `role`, `status`, `available`;
  - `invitation_accepted` and `invitation_declined` carry none of them;
  - every kind carries `id`, `createdAt`, `readAt`, `actorId`, `actorName`, `listId`, `listName`.
  - **Drop a row of an unknown kind** rather than crash. A newer database may send a kind this app
    predates.
- `fetchUnreadCount()` → `{ count: number | null; error: string | null }`.
- `markNotificationsRead(ids: string[]): Promise<Result>`.
- `acceptInvitation(invitationId): Promise<Result & { listId?: string }>`.
- `declineInvitation(invitationId): Promise<Result>`.
- **Limit refusals are rephrased here.** `resultFor` keeps only the database's message, which is
  about somebody else ("they are already on 1,000 lists"). So `acceptInvitation` maps
  `error.code` `LIMIT_CODES.ownedLists`/`LIMIT_CODES.lists` to `OWNED_LISTS_FULL`/`LISTS_FULL` from
  [limits.ts](../../../src/lib/limits.ts) before returning. The verdict stays `permanent`.

**`src/lib/ago.ts` (new):** `ago(iso, now)`, pure, giving the step-2 age strings. No `Intl`, for the
reason `grouped` in limits.ts gives.

## Realtime and the unread count

- **[listsChannel.ts](../../../src/lib/listsChannel.ts):** `subscribeToChanges` gains an
  `onNotifications()` handler for the `notifications/changed` broadcast, on the **same channel**.
  One channel per topic, still owned by `ListsContext`. It decodes nothing from the payload
  ([realtime-is-a-nudge-to-a-per-user-inbox](../../kb/entries/realtime-is-a-nudge-to-a-per-user-inbox.md)).
- **[ListsContext.tsx](../../../src/state/ListsContext.tsx):**
  - Publish `lastNotificationsNudge: object | null`, a fresh object per nudge, as `lastNudge` is.
  - A resubscribe bumps both, since it may have missed either kind. Today `onNudge` is passed as
    `onResubscribe`; split it.
- **`src/state/NotificationsContext.tsx` (new):**
  - `NotificationsProvider` and `useNotifications()` → `{ unread: number | null; refreshUnread(): Promise<void> }`.
  - Mount it inside `ListsProvider` in `ListsForSignedInUser` in [App.tsx](../../../App.tsx). It
    lives and dies with the signed-in account.
  - It reads `unread_notification_count()`:
    - on mount;
    - on foreground: `AppState` `'active'` on native, `visibilitychange` on web, mirroring
      `ListsContext`'s resume effect;
    - on `lastNotificationsNudge`, with a 300 ms trailing debounce. One mark of n rows sends n
      nudges (step 1's log has the count).
  - A failed read keeps the last count. `null` until the first answer, so a cold start offline
    shows no dot.

## Lists header (D7)

In [ListsScreen.tsx](../../../src/screens/ListsScreen.tsx)'s `titleActions`, left to right, each a
round 36 pt outlined `IconButton`:

1. `ModeButton`, unchanged.
2. **Notifications:** `BellIcon`, label `Notifications`, the step-2 `value` while `unread > 0`, and
   navigating to `Notifications`.
   - The dot is the one `ModeButton` draws: 12 pt `primary` with a `skyTop` ring.
   - Recommended: move that dot into `IconButton` as a `dot` prop, which is how the harness draws
     it, and have `ModeButton` use it.
3. **Account:** an `IconButton` with `PersonIcon`, replacing the `PillButton`. **The label stays
   `Account`.**

Add `BellIcon` and `PersonIcon` to [icons.tsx](../../../src/components/icons.tsx), with the path data
step 2 drew in `mock.js`.

## `NotificationsScreen` (new)

`src/screens/NotificationsScreen.tsx`, built to step 2's mockups. It takes navigation props and draws
its own header and Back
([screens-take-navigation-props](../../kb/entries/screens-take-navigation-props.md)).

- **Data.** It holds `useState` for the rows, the cursor, an error, the invitation in flight, and
  the set of ids that were unread when this visit first loaded them (see read marking).
- **A `FlatList`, paged (D8)**, as [ListsScreen.tsx](../../../src/screens/ListsScreen.tsx) pages
  its lists:
  - `onEndReached` reads the next page with the cursor, and appends it, only while the cursor is not
    `null` and no page is in flight.
  - Its spinner, labelled `Loading more notifications`, sits in `ListFooterComponent`.
  - A failed page shows nothing, and the next scroll to the end asks again, as on Lists.
- **First load.** Page 1 on mount.
  - While it loads: an `ActivityIndicator` labelled `Loading notifications`.
  - On failure: the error in `ErrorBanner`; a `retryable` failure shows step 2's offline load
    sentence.
- **Reload.** On each `lastNotificationsNudge` while mounted, and after every write.
  - Re-read from the top, in **one** call, as many rows as are shown, and at least a page. That call
    returns the rows and the cursor, and replaces both.
  - So a withdrawn invitation disappears and an answered one changes state on every loaded page,
    not only on page 1.
  - **A response lands only if it is still current.**
    - A scroll page lands only if the cursor it was asked with is still the screen's cursor.
    - Of two reloads, only the later-started one lands.
    - This is the rule [first-fetch-replaces-list-state](../../kb/entries/first-fetch-replaces-list-state.md)
      records for the lists.
- **Read marking (D4, per page).**
  - After each page or reload lands, add its rows whose `readAt` is null to the visit's unread set.
    If any were new, call `markNotificationsRead` with **exactly those ids**, then `refreshUnread()`.
  - Unread rows on pages not yet scrolled to stay unread, and the bell stays marked until they are
    reached (D8).
  - **Draw the dots from the visit's set, never from the reloaded `readAt`.** The mark's own nudge
    reloads the screen, and the dots must stay for the visit.
  - A notification arriving mid-visit gets a dot and is marked.
  - A reload that finds nothing new unread sends no mark, so the nudge loop ends.
  - Re-read the count rather than setting it to 0 (the suggestion said `setUnread(0)`). The server's
    answer already includes anything that arrived meanwhile.
- **Accept and Decline.**
  - While one runs, disable that card's buttons and show the pending text.
  - Outcomes, as Sharing's `run` handles them:
    - `sessionRevoked` → `signOut('revoked')` and return
      ([session-revoked-write-redirects](../../kb/entries/session-revoked-write-redirects.md));
    - `retryable` → step 2's offline action sentence;
    - any other failure → its message (limits already rephrased by the API), then reload.
  - On success, reload. Accept also calls `refresh()` on `ListsContext`.
- **Cards** are per step 2's states:
  - **`You joined`**: its chevron navigates to `ListDetail` with the list id.
  - **The accepted answer**: its chevron shows only while that list is in `ListsContext`'s `lists`.
    The inviter may have left it since.
  - **Pending but `available === false`**: reads `No longer available`, with no actions.
- **Empty state:** step 2's title and hint, verbatim.

**Navigation:** add `Notifications: undefined` to `RootStackParamList` in
[types.ts](../../../src/navigation/types.ts), plus `NotificationsScreenProps`. Add a `Stack.Screen` in
`RootNavigator`'s signed-in branch with `headerShown: false`.

## `SharingScreen` and `UserAutocomplete`

[SharingScreen.tsx](../../../src/screens/SharingScreen.tsx):

- **Invite.** `share()` becomes `invite()` and calls `inviteToList`. The role picker's `labelFor`
  gives `Invite as <role>`.
- **One load.** `load()` fetches the roster and the invitations together. Non-owners get an empty
  list from the RPC. The existing `lastNudge` effect then refreshes both: an accept moves the person
  from Invited to the roster, and a decline or withdraw drops them.
- **The Invited section.** Owners only, and only when non-empty, under the roster.
  - Per step 2: `Avatar`, name, role badge, the sub-line with `ago()`, and a withdraw `IconButton`.
  - The withdraw button opens the existing `confirm(…)` row, with its own
    `confirmingWithdrawId` state. Confirm runs `run(() => withdrawInvitation(id))`.
- **Remove the comment** saying the bar "doubles as a promote" (D1). A refusal such as
  `they already have this list` shows verbatim, through `run`.
- **The remove and leave warnings** take step 2's new words.

[UserAutocomplete.tsx](../../../src/components/UserAutocomplete.tsx):

- `buttonLabel` becomes `Invite`, and the suggestion rows take step 2's a11y label.
- `canShare`/`onShare` become `canInvite`/`onInvite`.
- A new `listId` prop is passed to `searchUsers`, so members and pending invitees are no longer
  suggested (backlog #23).

## Stale words to fix

Grep `src/` for `share_list`, `shareList` and `Share`. Fix every comment that says a share adds a
member, or that the limit words reach the Sharing screen:

- [limits.ts](../../../src/lib/limits.ts)'s note above `OWNED_LISTS_FULL`;
- `humanize` and `verdictFor`'s `P0002` comment in [listsApi.ts](../../../src/lib/listsApi.ts).

The database's "they …" limit words now reach nobody verbatim.

## Tests (jest)

Await `render` and `fireEvent` (RNTL 14). Assert copy verbatim from step 2's log.

- **`membersApi.test.ts`:**
  - `inviteToList`'s params, and a `22023` comes back `permanent`, never `applied`;
  - `fetchInvitations`' mapping, with a null body read as `[]`;
  - `withdrawInvitation`;
  - `searchUsers` with and without `listId`.
- **`notificationsApi.test.ts` (new):**
  - each RPC's name and params, `fetchNotifications`' with and without a cursor;
  - the cursor is the last row's, and is `null` on a short page;
  - all three kinds decode, and an unknown kind is dropped;
  - accept returns the list id;
  - `LM001`/`LM002` read as `OWNED_LISTS_FULL`/`LISTS_FULL` and stay `permanent`.
- **`ago.test.ts` (new):** every boundary.
- **`listsChannel.test.ts`:** `notifications/changed` reaches `onNotifications` and not `onChange`,
  and the reverse.
- **`ListsContext.test.tsx`:** `lastNotificationsNudge` moves on the event and on a resubscribe.
- **`NotificationsContext.test.tsx` (new):**
  - it reads on mount, on foreground, and once per burst of nudges;
  - a failed read keeps the count;
  - the count is `null` before the first answer.
- **`ListsScreen.test.tsx`:**
  - the bell's label;
  - its value at 2, and no value at 0 or `null`;
  - it navigates to `Notifications`;
  - `Account` is still found by label and navigates.
- **`NotificationsScreen.test.tsx` (new):**
  - every card state, verbatim;
  - accept calls `refresh` and shows `You joined`;
  - `LM002` shows `LISTS_FULL`;
  - decline shows `Declined`;
  - the offline sentences;
  - `sessionRevoked` leads to `signOut('revoked')`;
  - scrolling to the end reads the next page with the cursor and appends it, with the spinner
    showing meanwhile; nothing is read once the cursor is `null`;
  - a page that lands after a reload replaced the cursor is dropped;
  - a reload re-reads as many rows as are shown, in one call;
  - each page marks exactly its own ids that loaded unread;
  - the dots survive a reload in the same visit;
  - a later arrival gets a dot and is marked;
  - the answer's chevron shows only while the list is held;
  - the empty state.
- **`SharingScreen.test.tsx`:**
  - Invite, and a refusal shown verbatim;
  - the Invited section is for owners only;
  - withdraw's confirm and cancel;
  - a nudge reloads both lists;
  - the new remove and leave words.
- **`UserAutocomplete.test.tsx`:** the button label, and `listId` passed through.

## Verification

1. **Local stack only.** Read `.env`'s `EXPO_PUBLIC_SUPABASE_TARGET`, and check for a Metro already
   on 8081 ([supabase-target-picked-at-runtime](../../kb/entries/supabase-target-picked-at-runtime.md)).
   Use throwaway accounts O (owner) and I (invitee), each in its own browser context, with codes from
   Mailpit.
2. **Browser (Playwright).** Each change on the other account must appear within about a second,
   with no reload.
   - O invites I. O's Sharing shows I under Invited, and O's search no longer suggests I. I's bell
     gets its dot.
   - I opens Notifications: one dotted card. Back on Lists, the bell has no dot. Reopened, the card
     has no dot.
   - I declines. The card reads `Declined`, and I leaves O's Invited. O's bell gets a dot, and O's
     Notifications reads `… declined your invitation to …`.
   - O invites again, and I accepts. The list appears in I's Lists. `You joined` opens it. O's
     roster shows I, Invited is empty, and O's answer card opens the list.
   - O invites, then withdraws. I's card and dot are gone.
   - Block `/rest/v1/rpc/accept_invitation`: the offline sentence, and nothing changes.
   - Put I on 1,000 lists in SQL, and I accepts: `LISTS_FULL`.
   - **Paging.** Give I 250 notifications in SQL, 150 of them unread (answers from O need no
     invitation row).
     - Scrolling loads all 250, newest first, in three pages, with no repeat.
     - The bell stays marked until the last unread row has been scrolled to.
     - With three pages loaded, O withdraws an invitation whose card is on page 3, and it
       disappears.
3. **Maestro, iOS simulator.** `sign-out`, `set-theme`, `tour-signed-in` and `ensure-signed-in` tap
   or wait for `Account` by text.
   - Run them. If they no longer resolve against the glyph button's label, record what does, and fix
     the flows, not the label.
   - The dev client's floating button covers the top-right buttons until turned off
     ([maestro-drives-the-native-ui](../../kb/entries/maestro-drives-the-native-ui.md)).
4. **Phone.** iOS simulator (iPhone 18 Pro) screenshots of the changed screens only, in day and
   night:
   - Lists at rest, with and without the dot;
   - Notifications with mixed cards, with the next page's spinner, and empty;
   - Sharing with the Invited section.

   Compare by measure against step 2's mockups
   ([phone-is-the-product](../../kb/entries/phone-is-the-product.md)). The pending card lacks `Block`
   until step 4.
   - Use `maya3@example.com` for the shots, invited from a throwaway owner. Afterwards, remove maya3
     from any list it joined for them.
   - **iPhone only:** never build for, boot or test on the Android emulator.
5. **Commands:** `npm test`, `npm run typecheck`, `npm run kb:audit`.
   - The audit still fails on `session-still-valid-guards-writes` until step 5.
   - Its `verify:` takes each function's **latest `create`**, and has no notion of `drop function`,
     so it will still list `share_list` after this migration. Report it; don't fix it.

## After this step

- **Do not run `/librarian deposit`**, whatever CLAUDE.md's working rules say (step 1's request 9).
  Step 5 deposits the whole task once.
- Write `implementation-log-step-3.md` as usual. End it with a **KB candidates** section: the table
  below, corrected to what was actually built, plus anything the step taught that the table misses.
  That section is how this step reaches step 5.
- Never edit `ai/kb/`. If `npm run kb:audit` fails on an entry this step made stale, that is
  expected until step 5: name it in the log. Never change code to make a check pass.

## KB impact (for step 5's deposit)

| entry | change |
|---|---|
| scope-boundaries | invitations between existing accounts are in. Sharing invites, nobody joins without accepting, the inviter hears accept and decline, and an owner may withdraw. Notifications are in-app only, with no push or badge (D6). The stranger invite (`list_invites`) is still out, and that entry's "`share_list` takes only a resolved user id" is now `invite_to_list` |
| session-still-valid-guards-writes | `share_list` is dropped, so eighteen guarded RPCs. The `verify:`'s awk does not see drops |
| realtime-is-a-nudge-to-a-per-user-inbox | the app side: `onNotifications` on the same channel, `lastNotificationsNudge`, and `NotificationsContext`'s debounced count |
| writes-retry-from-an-outbox | invitation and notification writes stay out of the outbox, like membership writes |
| keyset-paging-in-the-order-shown, or first-fetch-replaces-list-state | Notifications pages on scroll, outside `ListsContext`. A reload re-reads everything shown in one call. A scroll page lands only if it continues the screen's cursor. Read marking is per page, so the bell can stay marked past the first page |
| phone-is-the-product | the Lists header and the new screens match step 2's mockups |
| maestro-drives-the-native-ui | whatever was learned about finding a glyph-only button by its label |
| the list limits (wherever the KB keeps them) | met by the invitee at accept, in the second person. The owner no longer meets them at invite |
