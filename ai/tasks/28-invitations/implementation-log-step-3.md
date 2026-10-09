# Step 3 — implementation log (2026-10-09): invitations in the app

The round Lists header with the bell, `NotificationsContext`, a paged `NotificationsScreen` without
Block, Sharing's Invite and Invited section with withdraw, `UserAutocomplete`'s invite and `listId`
filter, and the migration dropping `share_list`. Copy and a11y labels are step 2's table verbatim
(its own "Changes from the description's starting table" included). **Not done: the Maestro runs
and the phone screenshots** — the 8 GB Mac could not hold the simulator beside Docker (see Problems
hit); the user chose to skip them. Uncommitted.

## What changed

**Database**
- `supabase/migrations/20261009000000_drop_share_list.sql`: `drop function public.share_list(uuid,
  uuid, public.list_role); notify pgrst, 'reload schema';`, with D1 in the header comment. Applied
  with `migration up --local`; `pg_proc` has no `share_list`; `schema_migrations` max is
  `20261009000000`.

**API**
- `membersApi.ts`: `shareList` → `inviteToList(listId, userId, role)` (`invite_to_list`);
  `fetchInvitations(listId)` (`pending_invitations_of` → `PendingInvitation {invitationId, userId,
  name, role, createdAt}`, a null body read as `[]`); `withdrawInvitation(id)` (`{p_invitation_id}`);
  `searchUsers(query, listId?)` sends `p_list_id` only when given. Doc comments rewritten.
- New `notificationsApi.ts`: `NOTIFICATION_PAGE_SIZE = 100`, `NOTIFICATION_RELOAD_MAX = MAX_ROWS`;
  `Notification` a union by `kind` (`list_invitation` adds `invitationId/role/status/available`);
  `fetchNotifications({before?, limit})` (`my_notifications`; throws on `limit > MAX_ROWS`; drops an
  unknown kind; cursor from the last **raw** row of a full page, else `null`); `fetchUnreadCount()`
  (`unread_notification_count`); `markNotificationsRead(ids)`; `acceptInvitation(id)` →
  `Result & {listId?}` with `LM001`/`LM002` rewritten to `OWNED_LISTS_FULL`/`LISTS_FULL` (verdict stays
  `permanent`); `declineInvitation(id)`.
- New `ago.ts`: `ago(iso, now)` → `just now` (also future or NaN) / `N min ago` / `N h ago` /
  `N d ago`, each floored.

**Realtime and the count**
- `listsChannel.ts`: a 4th parameter `onNotifications`, bound to `broadcast` `notifications/changed`
  on the same `user:<uid>` channel.
- `ListsContext.tsx`: publishes `lastNotificationsNudge: object | null` (a fresh `{}` per nudge);
  `onResubscribe` bumps both nudges:
  `return subscribeToChanges(userId, onNudge, onResubscribe, onNotifications);`.
- New `NotificationsContext.tsx`: `NotificationsProvider` / `useNotifications()` →
  `{unread: number | null, refreshUnread}`. Reads on mount, on `AppState 'active'` (native), on
  `online`/`visibilitychange` (web), and once per burst of `lastNotificationsNudge` (300 ms trailing,
  effect-cleanup timer). A sequence ref lands only the latest-started read; a failed read keeps the
  count. `App.tsx`: `ListsForSignedInUser` wraps its children in it, inside `ListsProvider`.

**Lists header (D7)**
- `icons.tsx`: `BellIcon`, `PersonIcon` (step 2's paths, 24 viewBox, stroke 2, size 18 default).
- `IconButton.tsx`: `dot?: boolean` draws the dot (12 pt `primary`, 2 pt `skyTop` ring, top/right −2);
  `ModeButton` passes `dot` through and lost its own dot style.
- `ListsScreen.tsx` `titleActions`: `modeButton`, the bell (`IconButton` `outline`, label
  `Notifications`, `value` `${unread} unread` and `dot` only while `unread > 0`, navigates to
  `Notifications`), the person (label `Account`). `PillButton` import gone.

**Notifications** — new `NotificationsScreen.tsx` (467 lines); `types.ts` `Notifications: undefined`
+ `NotificationsScreenProps`; `RootNavigator` screen with `headerShown: false`.
- Frame as Account's: `Backdrop`/`ScreenSky`, a `FlatList` (`contentContainerStyle {flexGrow: 1}`,
  `ScreenHeader` as header, separator 10, items padded 20, the first `marginTop` 12); the footer is the
  `Loading more notifications` spinner while a page loads, a spacer (`flex 1`, `minHeight 64`),
  `HorizonFooter`; `ListEmptyComponent` is the `Loading notifications` spinner, then `EmptyState`
  (`No notifications yet` / `Invitations to shared lists show up here.`, `ink` `text`), or nothing
  after a failed first load.
- `reload()`: `limit = min(max(shown + 1, NOTIFICATION_PAGE_SIZE), NOTIFICATION_RELOAD_MAX)`, one call,
  lands only if still the latest started (`reloadSeq`). Runs on mount, on a nudge (300 ms trailing;
  the nudge present at mount is ignored), after every answer. `loadMore()` asks `before: asked` and
  lands only if `cursorRef.current === asked`.
- Marking: each landing marks exactly its rows with `readAt === null` not yet in the visit's `seen`
  set, then `refreshUnread()` (`sessionRevoked` → `signOut('revoked')`). Dots and the all-600 sentence
  come from `seen` only.
- The card lives in the screen file (see Decisions 9). Answers: `setActionError(null)`, `inFlight`;
  `sessionRevoked` signs out; `retryable` → `You need a connection to answer an invitation.`, no
  reload; otherwise the refusal text (or, on an accepted answer, `refresh()` of ListsContext), then
  `await reload()`.

**Sharing and `UserAutocomplete`**
- `UserAutocomplete`: `canShare`/`onShare` → `canInvite`/`onInvite`; `buttonLabel="Invite"`; rows
  `Invite ${name}`; new `listId` prop passed to `searchUsers` (deps `[value, selected, listId]`).
- `SharingScreen`: `load()` = `Promise.all([fetchMembers, fetchInvitations])`, still returning the
  members (`run` checks your own membership with them); `invite()` via `inviteToList`; role picker
  `Invite as ${role}`; the new remove/leave warnings; the Invited section (owners only, non-empty):
  `Invited` header (serif 24/32, `marginTop` 24), cards with `Avatar`, name (17, one line) over
  `Invited ${ago}` (14/19 `textSecondary`), the role badge, and an `IconButton` (`CloseIcon` 16 on
  `controlFill`, `Withdraw ${name}'s invitation`); withdraw reuses `confirm(...)` with
  `${name}'s invitation will be withdrawn.`, `Confirm withdraw ${name}'s invitation`,
  `Withdraw`/`Withdrawing…`.

**Stale words fixed:** `limits.ts` (the note above `OWNED_LISTS_FULL`), `listsApi.ts` (`resultFor`
doc, `writeResult` doc, `humanize`'s limit comment, `verdictFor`'s `P0002` comment),
`useHydration.ts` (line 175), `ListsScreen.tsx` (another member's share).

**Maestro tooling** (both broken by this step; neither run on a device — see Not done)
- `.maestro/seed.mjs`: `share_list` is gone, so a `share(from, to, listId, role)` helper invites
  (`invite_to_list`), reads the invitee's `my_notifications` (`p_limit: 100`), and accepts the pending
  `list_invitation` for that list; `call` now returns the parsed body. Run once against local with
  `t28s-own@`/`t28s-mem@` (1.2 s): every membership the tour expects came out, all via accept.
- `.maestro/flows/tour-signed-in.yaml`: the suggestion row's label is `Invite <name>`, so
  `"Share with .*"` → `"Invite .*"` (both the wait and the tap). Before a pick only the rows match: the
  bar button is `Invite` alone, and `Invite as …` exists only after a pick.

## Decisions beyond the description

1. **The promote path still shows the database's "they …" limit words.** The description says they
   reach nobody verbatim now. Wrong: `set_member_role` promoting to owner raises `LM001`, and its
   update branch (`check_list_limits(…, true)`) can raise `LM002`, both on Sharing. `limits.ts`'s note
   says so; `SharingScreen.test`'s `LM002` case was re-aimed from share at promotion.
2. **Read results carry `retryable: boolean`** (`fetchNotifications`, `fetchUnreadCount`), classified by
   `resultFor(error, status).verdict`, so the screen can tell an offline load
   (`You need a connection to see your notifications.`) from any other failure.
3. **The error banner is pinned above the list**, as on Lists and Sharing; no mockup draws an error
   state. `loadError` clears when a load lands; `actionError` clears when the next answer starts —
   otherwise the reload after a refusal would wipe it.
4. **Nudge reloads are debounced 300 ms** (screen and count): one mark of n rows sends n nudges. A reload
   after an answer runs at once.
5. **The reload asks for shown + 1 rows** (at least a page, at most 1,000). Found in the browser: asking
   for exactly what was shown returned a full page, so the cursor came back at the end and every scroll
   read an empty page. Test "knows the end is still the end after a re-read" (mutation-checked).
6. **`NOTIFICATION_RELOAD_MAX`** re-exports `MAX_ROWS` from `notificationsApi`: a screen may not import
   values from `listsApi` (`supabase-client-module-boundary`'s check), only types.
7. **The cursor is the last raw row's**, taken before an unknown-kind row is dropped, so a dropped row
   can never stall or repeat paging.
8. **While an Accept or Decline runs, every card's actions are disabled** (as Sharing's `run`); the
   pending text shows only on the pressed card.
9. **The card stays inside `NotificationsScreen.tsx`**: components may not import from `../lib/` (same
   boundary check), and the card needs `Notification` and `ago`.
10. **The answer card's chevron shows only while `lists.some(l => l.id === listId)`**, as specified.
    Known limit: `lists` holds only loaded pages, so an account on more than 100 lists may see no
    chevron on a list it does hold.
11. **The Invited section keeps `pending_invitations_of`'s order, oldest first.** The step 2 scene's
    fixture shows newest first; nothing in the copy or the description fixes an order.

## Verification

**Repo checks (after the restart)**
- `npx jest`: **957/957, 36 suites**, on two reruns. The first run after the reboot failed 7 tests in 6
  suites while the machine was still swapping at load ≈ 130; their names were not captured. The
  touched suites: `notificationsApi` 16, `membersApi` 13, `ago` 11, `listsChannel` 12,
  `NotificationsContext` 6, `UserAutocomplete` 8, `NotificationsScreen` 32, `ListsContext` 100,
  `SharingScreen` 51, `ListsScreen` 57.
- `npm run typecheck`: clean.
- `npm run kb:audit`: 73 entries, 66 checked, **4 errors, 25 warnings**. Every error is an entry this
  task made stale, expected until step 5; no code changed for them:
  - `session-still-valid-guards-writes` — from step 1. Its awk keeps each function's latest `create`
    and does not see `drop function`, so it still expects `share_list`. Without it the guarded set
    is 18: `accept_invitation add_item block_inviter decline_invitation delete_account
    invite_to_list leave_list mark_notifications_read remove_member rename_item rename_list
    set_item_deleted set_item_done set_list_deleted set_member_role set_name unblock_user
    withdraw_invitation`.
  - `queries-go-through-a11y-labels` — exactly three greps: `buttonLabel="Share"`,
    `canSubmit={canShare}`, ``accessibilityLabel={`Share with ${user.name}`}`` in `UserAutocomplete`.
    The every-`Pressable`-has-role-and-label loop passes with the new cards.
  - `realtime-channel-shared-per-topic` and `realtime-is-a-nudge-to-a-per-user-inbox` — both grep
    `return subscribeToChanges(userId, onNudge, onNudge);`, now
    `return subscribeToChanges(userId, onNudge, onResubscribe, onNotifications);`.
  - Warnings: "ground moved" on uncommitted files, plus `phone-is-the-product` (`ai/ux/source/README.md`
    committed 2026-10-08).

**Browser (Playwright, local stack, throwaway owner O and invitee I, each in its own context; codes
from Mailpit).** Every change reached the other account with no reload:
- invite → I's bell dot in ≈ 0.43 s; O's search for I no longer suggests them (`p_list_id`);
- I opens Notifications: the dots show for the visit, gone on the next visit;
- decline, re-invite and accept (`You joined`, O's answer card opens the list), and withdraw each
  reached the other side in 0.2–0.9 s;
- accept with `accept_invitation` aborted by `page.route`: nothing changed on either account;
- I on 1,000 lists (SQL) accepting: `LISTS_FULL`'s words;
- paging over 253 notifications, 150 of them unread across all three pages: pages of 100/100/53 in the
  SQL's order; marks of 59/60/31 ids, one per page; the bell still dotted after page 1;
- a page-3 invitation (backdated in SQL) withdrawn by O: its card went (reload limit 254 → 252 rows).
- Accounts, lists and notifications deleted afterwards.

**Not done — the user chose to skip the simulator part** after the Mac ran out of memory (Problems
hit). Open for whoever picks this up:
- Maestro `ensure-signed-in`, `set-theme`, `sign-out`, `tour-signed-in` against the glyph `Account`.
  Static evidence only: `Account` is an `IconButton` with `accessibilityLabel="Account"`, the same
  component and form as `ScreenHeader`'s `Back`, which the flows already `tapOn: Back` by label. The
  tour's `"Invite .*"` fix is unrun.
- iPhone 18 Pro shots, day and night: Lists with and without the dot; Notifications mixed, with the
  spinner, empty; Sharing with Invited; the comparison by measure against step 2's scenes. The seed
  built for them (`maya3@example.com` invited by five throwaway actors, named and timed as in the
  mockups) has been deleted; it was SQL inserts of `notifications`/`list_invitations` rows keyed by
  `set_config('t28.<k>', …)` list ids.

## Problems hit

- **Memory, 8 GB Mac.** Docker Desktop reserves 4.1 GB (Supabase's containers use ≈ 1.1 GB of it).
  With Metro, VS Code and Chrome, booting the iOS 27 simulator drove load to 90–200 and swap to
  3.5/4 GB: `diskimagesiod` at up to 394% CPU re-reading the runtime image as the simulator's daemons
  lost their pages. Before the restart: the XCUITest driver timed out (`MAESTRO_DRIVER_STARTUP_TIMEOUT
  =180000` did not help), the Docker VM crashed once (host ports dead; `npx supabase stop && npx
  supabase start` brought it back with the data), and stopping analytics, vector, studio, pg_meta
  and edge_runtime did not free enough. After a full reboot: load 8 before the boot, 119–191 within
  minutes of it; a `simctl terminate` plus two `simctl spawn … defaults read` took over 2 min.
- **The reboot wiped `/private/tmp`**, scratchpad included; helpers were rebuilt.
- **`auth.users where email = …` scans 1M load-test rows**: look up by `public.users`'
  `lower(email)` (`users_lower_idx`).
- **Cleanup:** `keep_last_owner` refuses deleting an owner's membership; delete the lists (cascade),
  then `auth.users` (cascade to `public.users`, invitations, notifications).
- **Playwright MCP:** `globalThis` does not survive between `browser_run_code_unsafe` calls (reach the
  second context through `page.context().browser().contexts()`); its `filename` parameter loads code,
  it does not save output.
- **Web back stack:** a list opened from Notifications leaves Notifications under List detail, so Back
  returns there; the harness pressed Back until `My Lists` showed.
- **Tests:** RNTL 14's `Pressable` normalises `accessibilityValue` to an object of `undefined`s, so
  "no value" is asserted as `not.toHaveAccessibilityValue({text: expect.anything()})`;
  `jest.spyOn(Date, 'now')` fights fake timers — use `jest.useFakeTimers({ now })`.

## State left

- Local DB: migration `20261009000000` applied. No `t28s-*` accounts or their lists; maya3 holds only
  its own seven lists (none from today) and no notifications; Priya is back to her two lists.
- Supabase: analytics, vector, studio, pg_meta and edge_runtime still stopped (the reboot restarted
  only the rest). `npx supabase stop && npx supabase start` brings them back; `edge_runtime` is needed
  for `delete-account`.
- Simulator shut down; Metro stopped. Nothing committed.

## KB candidates

| entry | change |
|---|---|
| scope-boundaries | invitations between existing accounts are in: Sharing invites, nobody joins without accepting, the inviter hears accept and decline, an owner may withdraw. Notifications are in-app only, no push or badge (D6). The stranger invite (`list_invites`) is still out; "`share_list` takes only a resolved user id" is now `invite_to_list` |
| session-still-valid-guards-writes | `share_list` dropped: 18 guarded RPCs (listed under Verification). The `verify:`'s awk keeps the latest `create` and does not see drops |
| realtime-is-a-nudge-to-a-per-user-inbox, realtime-channel-shared-per-topic | the app side: `onNotifications`, a 4th `subscribeToChanges` argument on the same channel; `lastNotificationsNudge`; a resubscribe bumps both nudges; screen and count debounce bursts 300 ms. Both `verify:`s grep the old `onNudge, onNudge` call |
| queries-go-through-a11y-labels | its `verify:` greps `Share` labels in `UserAutocomplete`: now `buttonLabel="Invite"`, `canSubmit={canInvite}`, `` `Invite ${user.name}` `` |
| writes-retry-from-an-outbox | invitation and notification writes stay out of the outbox, like membership writes |
| keyset-paging-in-the-order-shown, or first-fetch-replaces-list-state | Notifications pages on scroll, outside `ListsContext`. A reload re-reads everything shown in one call **and asks for one row more** — asking for exactly the rows shown brings a cursor back at the end. Only the latest-started reload lands; a scroll page lands only if it continues the screen's cursor; the cursor is the last raw row's. Read marking is per page, so the bell can stay marked past page 1 |
| max-rows-is-a-silent-ceiling, supabase-client-module-boundary | `fetchNotifications` throws past `MAX_ROWS`; screens reach it as `NOTIFICATION_RELOAD_MAX` from `notificationsApi`, since a screen may import only types from `listsApi`; the notification card stays in the screen file, since components may not import `lib/` |
| the list limits (wherever the KB keeps them) | met by the invitee at accept, in the second person (`OWNED_LISTS_FULL`/`LISTS_FULL`); the owner no longer meets them at invite — **but promotion still raises `LM001`/`LM002` on Sharing in the "they …" words** |
| phone-is-the-product | the Lists header and new screens are **not yet** signed off on the phone (shots skipped) |
| maestro-drives-the-native-ui | nothing learned on a device. `seed.mjs` now invites and accepts (via `my_notifications`); the tour's suggestion rows are `"Invite .*"`. **The tour hardcodes `Sam` and display names are unique (`users_name_lower_unique`), so it runs only as the seed's own owner** — on this stack that is `maya@`, which is off limits; a throwaway run needs the member's name as a flow parameter. The glyph `Account` should resolve as `Back` does — unverified |
| native-build-toolchain (environment) | on the 8 GB Mac, the simulator beside Docker's 4.1 GB reservation thrashes (`diskimagesiod`, load 100+, swap full) even right after a reboot; a simulator run needs Docker's memory lowered or other apps closed |
| supabase-local-stack | with 1M load-test users, look accounts up by `public.users`' `lower(email)`, never `auth.users.email` (seq scan) |
