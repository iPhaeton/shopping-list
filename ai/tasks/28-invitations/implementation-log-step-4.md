# Step 4 — implementation log (2026-10-09): blocking in the app

Block and its confirm on Notifications, the `Blocked people` header pill, a paged
`BlockedPeopleScreen`, and Account's Blocked people card. Built on step 3 (commit `5ab9b85`). Copy and
a11y labels are step 2's table verbatim. No migration: `block_inviter`, `unblock_user` and
`my_blocked_users` are step 1's. **Not done: the Maestro runs and the phone screenshots.** The
simulator thrashed the Mac again even with Docker capped at 2.5 GB (see Problems hit), and the user
chose to skip them. Uncommitted.

## What changed

**API (`src/lib/notificationsApi.ts`)**
- `BLOCKED_PAGE_SIZE = 100`.
- `BlockedUser = {userId, name, blockedAt}`; `BlockedCursor = {blockedAt, userId}`.
- `fetchBlockedUsers({before?, limit})` → `{blocked, cursor, error, retryable}`:
  - calls `my_blocked_users` with `p_limit`, plus `p_before_at`/`p_before_id` when there is a cursor;
  - throws on `limit > MAX_ROWS`;
  - a null body counts as `[]`;
  - `cursor` is the last row's from a full page, else `null`.
- `blockInviter(invitationId)` → `block_inviter {p_invitation_id}`.
- `unblockUser(userId)` → `unblock_user {p_user_id}`.
- Both writes return `resultFor`.

**`src/components/ScreenHeader.tsx`**
- `right?: ReactNode`, drawn opposite Back.
- The row is always `alignItems: 'center'`, `justifyContent: 'space-between'`. With Back alone, the
  layout is unchanged (a 36 pt child in a 36 pt row), so Account and Blocked people are unaffected.

**`src/screens/NotificationsScreen.tsx`**
- Header: `right={<PillButton label="Blocked people" …navigate('BlockedPeople')/>}`, an `sm` outline
  pill. Being in the header, it shows on every state: loading, error, empty, any page.
- A pending, available card adds `Block ${actorName}` under Decline/Accept: `md`, `tone="danger"`,
  `marginTop` 10, full width. Its label equals its text; `numberOfLines={1}` cuts a long name with
  `…`.
- `confirmingBlockId` (a notification id) swaps the three pills for step 2's confirm:
  - the warning, 15/21 `textSecondary`, `marginTop` 10;
  - a row, gap 11, `marginTop` 10, of `Cancel` (`Cancel blocking ${name}`) and the `danger` pill
    (`Confirm block ${name}`; `Block`, then `Blocking…`).
  - It joins `extraData`.
- `Answer` gains `'block'` → `blockInviter(invitationId)`, through the same `answer()`:
  - `sessionRevoked` → `signOut('revoked')`;
  - `retryable` → `You need a connection to answer an invitation.`, with no reload;
  - a refusal → its message, then reload;
  - success → reload.
  - `confirmingBlockId` clears wherever `inFlight` clears: after the reload lands, or at once when
    offline.
- One effect subscribes `navigation.addListener('blur')` (sets `left`) and `('focus')` (reloads
  only if `left`, then clears it); the cleanup unsubscribes both. The reload is step 3's: one call
  re-reading everything shown, plus one row.
- `busy = inFlight !== null` now disables every action pill on every card, Block and the confirm's
  pills included.

**New `src/screens/BlockedPeopleScreen.tsx`**
- **Frame:** Notifications', with `ScreenHeader title="Blocked people"`; the error banner is pinned
  above the list.
- **Load:** page 1 on mount.
  - Spinner `Loading blocked people`.
  - On failure, `You need a connection to see who you've blocked.` when `retryable`, else the
    message.
- **Paging:** `loadMore` as Notifications', with `paging` and `live` refs.
  - `onEndReached` is set only while a cursor exists and no page loads.
  - A failed page shows nothing.
  - The footer spinner is `Loading more blocked people`.
  - Nothing reloads the list.
- **Card:** `Card` padded 14/13, a row with gap 13 and `alignItems: 'center'`: `Avatar`, the name
  (17 sans, `flex: 1`, wrapping), and an `sm` `PillButton` (`Unblock ${name}`; `Unblock`, then
  `Unblocking…`).
- **Unblock:**
  - `unblocking` is a `ReadonlySet`; each pill is disabled only while its own unblock runs.
  - `sessionRevoked` → `signOut('revoked')`.
  - `retryable` → `You need a connection to unblock someone.`; any other error → its message; the
    row is kept either way.
  - Success → the row is dropped through `rowsRef`, the cursor is untouched, and `refreshUnread()`
    runs. If no rows remain and a cursor exists, `loadMore()`.
- **Empty list:** spinner while `rows === null` (nothing after a failed load); `EmptyState` (`You
  haven't blocked anyone` / `People you block from Notifications show up here.`, `ink` `text`)
  only when `cursor === null`; nothing otherwise.

**`src/screens/AccountScreen.tsx`**
- A card between Appearance and the sign-out card: `[styles.card, styles.pillCard]` holding
  `PillButton label="Blocked people" size="lg"` → `navigate('BlockedPeople')`.
- `onDeleteCardLayout` is unchanged: `layout.y` already includes the new card.

**Navigation**
- `types.ts`: `BlockedPeople: undefined`, `BlockedPeopleScreenProps`.
- `RootNavigator.tsx`: `Stack.Screen name="BlockedPeople"` (`title: 'Blocked people'`,
  `headerShown: false`) after Notifications. Eight routes now.

**Tests**

| suite | count | what was added |
|---|---|---|
| `notificationsApi.test.ts` | 16 → 23 | the two writes' names, params and verdicts (`retryable`, `sessionRevoked`); `fetchBlockedUsers`' params with and without a cursor, mapping, cursor (full and short page), null body, `retryable`, `limit 1001` throws |
| `NotificationsScreen.test.tsx` | 32 → 45 | see below |
| new `BlockedPeopleScreen.test.tsx` | 18 | see below |
| `AccountScreen.test.tsx` | 34 → 35 | the stub gains `navigate`; `Blocked people` → `BlockedPeople` |

The `NotificationsScreen.test.tsx` stub gains `addListener`, which records listeners and returns an
unsubscribe, and the suite gains an `emit(event)` helper. New cases:
- Block only on a pending, available invitation;
- the warning verbatim, with the answers gone;
- Cancel;
- confirm → `blockInviter('inv-n1')` and one reload, after which every card from the blocked actor
  is gone and another actor's stays;
- `Blocking…`, with every other pill disabled;
- offline: the sentence, no reload, the confirm closed;
- a refusal: the message, a reload;
- `sessionRevoked`;
- the header pill navigates, and shows on the empty state;
- blur then focus → one reload with `limit: shown + 1`, showing a row that came back;
- a focus without a blur reads nothing;
- unmount unsubscribes.

`BlockedPeopleScreen.test.tsx` mocks `notificationsApi` (`BLOCKED_PAGE_SIZE: 3`), and
`useNotifications` and `useSession` as hooks. Its fake server pages by the cursor's **values**, so a
cursor whose row was unblocked still continues. Cases:
- the cards;
- the first-load spinner;
- the empty state;
- both load failures;
- Back;
- the next page from the cursor, appended;
- the spinner meanwhile;
- nothing read after a short page or a short first page;
- a failed page asked again;
- unblock drops the row and re-reads the count, and the cursor is kept even when its own row was
  the one unblocked;
- `Unblocking…` on that pill only;
- offline unblock keeps the row;
- `sessionRevoked`;
- every loaded row unblocked → the next page is read;
- the last one unblocked → the empty state.

## Decisions beyond the description

1. **`fetchBlockedUsers` returns `retryable`**, as step 3's reads do. The description's signature
   lacks it; the offline load sentence needs it.
2. **Focus reloads only after a blur.** React Navigation emits `focus` when the screen is first
   pushed, while the mount read is still in flight, so every visit would otherwise read twice. The
   mount read stays (the existing suite and any stub without events rely on it).
3. **Unblocks run side by side.** Each pill is pending and disabled only for its own request.
   Unblocks are independent and idempotent, and the screen exists to unblock several people.
   Notifications keeps step 3's one-answer-at-a-time.
4. **Unblocking every loaded row while a cursor exists reads the next page.** The empty state needs
   `cursor === null`, so it never claims nobody is blocked while older blocks remain. Known limit:
   if that read fails, the screen shows only the header and landscape. The `FlatList` may not fire
   `onEndReached` again, since its content did not change, and leaving and reopening the screen
   recovers.
5. **No `refreshUnread` after a block.** `block_inviter`'s decline updates the pressed notification
   row, so `notify_recipient` always nudges the blocker, and `NotificationsContext` re-reads. An
   unblock writes no notification row, so Blocked people calls `refreshUnread()` itself.
6. **The Account card's pill is never disabled.** Leaving Account while a sign-out or delete runs is
   harmless: the stacks swap anyway.
7. **The block confirm is keyed by notification id** and closes only after the reload lands, as
   `inFlight` does, so the old pills never flash back under a finger. Opening a second confirm moves
   it.
8. **The offline sentence for Block is the action one** (`…to answer an invitation.`), as the
   description says. Step 2's table has no block-specific one.

## Verification

**Repo checks**
- `npx jest`: **996/996, 37 suites**.
- `npm run typecheck`: clean.
- `npm run kb:audit`: 73 entries, 66 checked, **4 errors, 26 warnings**.
  - The errors are step 3's four, unchanged: `session-still-valid-guards-writes`,
    `queries-go-through-a11y-labels`, `realtime-channel-shared-per-topic` and
    `realtime-is-a-nudge-to-a-per-user-inbox`.
  - Each `verify:` clause was run on its own. Only step 3's recorded clauses fail: the awk, the three
    `UserAutocomplete` `Share` greps, and `onNudge, onNudge`. The every-`Pressable` loop passes.
  - Warnings are "ground moved", now also on this step's uncommitted files
    (`screens-take-navigation-props`, `theme-provider-suites-fake-the-clock`,
    `queries-go-through-a11y-labels`).

**Browser (Playwright, web on 8081, `.env` target `local`)**

Setup: throwaway O (`T28b-own`) and I (`T28b-inv`), each in its own context, and X (`T28b-x`),
API-only. O invited I to L1 and L2, and X invited I to LX. Every change reached the other account
with no reload:
- **The pills.** All three pending cards show `Block <name>`. The confirm draws as
  `notifications-screen-block-confirm` does: the warning on three lines at 390, then Cancel and Block
  half each.
- **Block on L1.**
  - Both of O's cards left I's screen in 0.22 s; X's stayed.
  - O's Notifications showed `T28b-inv declined your invitation to T28b L1` in 0.51 s.
  - In the DB: L1 `declined`; L2 `pending`, `suppressed`, with its notification deleted.
  - O's Sharing for L2 still lists I under Invited.
- **O invites I to L3** through Sharing.
  - O sees I under Invited.
  - I got no card within 2.5 s, and `unread_notification_count` stayed 0.
  - In the DB: L3 `pending`, `suppressed`, no notification.
- **Blocked people**, opened from Notifications' header and from Account's card, lists O both times.
- **Unblock** (from Notifications' Blocked people).
  - The empty state shows; the requests were `unblock_user`, then `unread_notification_count`.
  - Back made one `my_notifications` read (the focus reload), and O's L1 card came back
    (`Declined · 2 min ago`).
  - L2 and L3 stay hidden from I, and O's Sharing still shows L3 Invited.
  - **O cannot invite I to L2 or L3 again until O withdraws them:**
    `search_users_by_name(p_list_id = L3)` leaves I out, and a direct `invite_to_list` is refused
    `22023 they have already been invited`.
- **L4:** O's invite reached I's open Notifications in 0.83 s, as normal.
- **Offline:** with `/rest/v1/rpc/block_inviter` aborted by `page.route`, the sentence shows, the
  confirm closes, the Block pill is back, and no `user_blocks` row was written. The console's one
  error is that aborted request.
- **Paging, 250 blocks.** I blocked `loadtest1`–`250` in SQL; the 12 at positions 95–106 share one
  `created_at`, so page 1 ends inside the tie.
  - Pages came back 100/100/50: 250 distinct rows, in exactly the SQL's
    `order by created_at desc, blocked_id desc`.
  - Page 1's cursor was `loadtest101`, inside the tie; page 2 continued 100…95, then 107.
  - Unblocking `Liam Smith 2` and `Emma Smith 3` on page 1, then scrolling: page 2 was asked from the
    same cursor (`…0065`). The screen ended with 248 rows, equal to the SQL's order without those
    two, and cursor `null`.
- **Account at 390×844.** The new card sits between Appearance and the sign-out card. `Delete
  account` rests at y 695–747. Opening its confirm scrolls the card to the viewport's bottom: the
  pills end at 823 of 844, and the card ends at 843.
- **Cleanup:** the three accounts, their lists, and I's blocks were deleted.

**Not done (the user chose to skip the simulator part).** Open for whoever picks this up:
- Maestro `ensure-signed-in`, `set-theme` and `sign-out` as they are, plus a scratch flow of the
  tour's Account steps. The user chose that over the full `tour-signed-in`, and the tour file is
  untouched. The scratch flow also opens Delete account to check the 18 Pro reveal.
  - Static evidence: `Sign out` and `Sign out of all devices` stay on screen at rest. On web at 390
    the delete pill rests at y 695; step 2 measured the delete card's end at 815 on 390 and 840
    (revealed) on the 18 Pro.
- iPhone 18 Pro shots, day and night: Notifications with Block and with its confirm; Blocked people
  with the next page's spinner, and empty; Account with the card. Then the comparison by measure
  against step 2's scenes at `W=402 H=874 INSET=62`.
  - The data built for them has been deleted. It was maya3's cards in the mockup's mix and ages,
    through the real RPCs. The actors were throwaway `Mira`/`Sal`/`Alex`/`Jordyn`/`Petra`, since
    Maya, Sam, Jordan and Priya are taken names. Birthday party was binned for `No longer
    available`, and an `ages.sql` backdated the rows and re-set two unread.
  - Blocked people: 105 blocks, with ten named accounts (`Riley`…`Robin`, the 42-character name
    eighth) at positions 91–100.
- The long-name `Block Maximilian Alexander Fitzger…` cut is unverified on iOS. Web was not checked
  for it.

## Problems hit

- **The simulator thrashed the Mac again, with Docker capped at 2.5 GB.**
  - A headless boot (no Simulator.app) took load from 3 to 140–220, and it stayed there for over 5
    min.
  - `diskimagesiod` ran at ~200% CPU, beside the simulator's first-boot `mediaanalysisd` and widget
    extensions (`NewsToday2`, `CalendarWidgetExtension`, `PhotosReliveWidget`).
  - Swap held at 3.9–4.2 of 5 GB and did not fill, so the choke this time is I/O on the runtime's disk
    image more than memory.
  - 30 s sleeps took 50 s, and `simctl shutdown` took about 10 min.
- **zsh does not word-split** a command held in a variable (`A="node api.mjs"; $A …` →
  `command not found`): scratch scripts went to bash with a function wrapper. Nothing had run, so
  nothing was half-seeded.
- **`sql.sh -f file` reads inside the container:** pipe it as `-f - < file`.
- **`FlatList` on web virtualizes:** DOM counts undercount long lists. Rows were read from the
  screen's state through the React fiber, and pages from the responses. A response listener misses a
  page that lands after the `browser_run_code_unsafe` function returns, which first looked like a
  missing page 3.
- **Playwright MCP screenshots** may only be written under the repo, in git-ignored
  `.playwright-mcp/`; the scratchpad is refused.

## State left

- Local DB: no schema change. No `t28b-*` or `t28m-*` accounts, lists or blocks. maya3 holds its
  own seven lists, with no notifications, invitations or blocks. One extra `auth.sessions` row for
  maya3, from the scratch API sign-in.
- Supabase: analytics, vector, studio, pg_meta and edge_runtime are still stopped, as since step 3.
- Simulator shut down; Metro stopped. Nothing committed.

## KB candidates

The description's table, corrected to what was built, then what it misses.

| entry | change |
|---|---|
| scope-boundaries | Blocking is in, for invitations only (D5). Block sits on a pending, available invitation's card behind a confirm, and takes the invitation, never a user id. It declines that invitation (the inviter hears an ordinary decline), suppresses the inviter's other pending invitations and deletes their notifications, and hides every notification from them while it stands. Their later invitations stay Invited on their side, suppressed, with no notification. It removes nobody from lists and hides nobody from search. Unblock (Blocked people, one tap) brings back the hidden notifications, never the suppressed invitations: those stay pending and *Invited* until withdrawn or expired, and the inviter cannot invite again until they withdraw (the search's `p_list_id` filter hides the person; `invite_to_list` says `they have already been invited`). A wider block is out |
| screens-take-navigation-props | `NotificationsScreen` subscribes to `blur` and `focus` with `navigation.addListener` and reloads on a focus that follows a blur. The suite's stub supplies an `addListener` that records listeners and returns an unsubscribe, plus `emit`. `ScreenHeader` takes `right` (the `Blocked people` pill). The entry's "all six routes" is stale: there are eight (`Notifications` in step 3, `BlockedPeople` here), each `headerShown: false`, so the `verify:` count still holds |
| keyset-paging-in-the-order-shown | Blocked people pages on scroll, 100 at a time, from `my_blocked_users`, keyed `(created_at, blocked_id)` descending, with no reload. An unblock drops its row and keeps the cursor, which a keyset allows and an offset would not; this was checked across a tie at the page boundary. Unblocking every loaded row with a cursor reads the next page |
| phone-is-the-product | **Not signed off on the phone.** Account's card, Notifications' Block and confirm, and Blocked people (spinner, empty) were checked on web only. Step 3's screens are also still unshot |
| realtime-is-a-nudge-to-a-per-user-inbox | A block nudges the blocker, through its decline's notification update. An unblock nudges nobody: the device that unblocks re-reads the count (`refreshUnread`), and Notifications re-reads when it is returned to |
| max-rows-is-a-silent-ceiling, supabase-client-module-boundary | `fetchBlockedUsers` throws past `MAX_ROWS`; `BlockedPeopleScreen` takes `BLOCKED_PAGE_SIZE` from `notificationsApi`, and its card stays in the screen file |
| native-build-toolchain (environment) | On the 8 GB Mac, the iOS 27 simulator thrashes even with Docker at 2.5 GB and booted headless: `diskimagesiod` I/O plus first-boot daemons, load 140–220 for 5+ min, and `simctl shutdown` ~10 min. Lowering Docker alone is not enough |
| maestro-drives-the-native-ui | Nothing learned on a device (not run). Step 3's candidate stands: the tour hardcodes `Sam`, so a throwaway run needs a name parameter |
