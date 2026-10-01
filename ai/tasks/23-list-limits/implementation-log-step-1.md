# Implementation log — task 23, step 1: page the lists the way items are paged

**Date:** 2026-10-01 (work began 2026-09-30). Description: [description-step-1.md](description-step-1.md).
The user approved the plan before work began, and it was implemented as planned. There were two
additions, both found by tests or checks: the synchronous `listsRef` assignment in `loadList`
(Problems 1), and keeping `ListsScreen`'s footer line shape for a KB `verify:` (Problems 2).

## Decisions

1. **The list cursors live in `State`, and `lists/loaded` carries them.**
   - `State = { lists, listCursors: ListCursors }`, where
     `ListCursors = { live: Cursor | null; bin: Cursor | null }`.
   - `lists/loaded` gained a required `cursors`.
   - `replay(lists, ops)` keeps its `List[]` signature. It folds over `{ ...initialState, lists }`,
     because no write action reads or moves the cursors. `reloadPages`' item loop does the same.
   - The cursors could not live in a ref alone: `ListsScreen` renders from them (`+`, `onEndReached`).
2. **`listCursorsRef` mirrors `state.listCursors` the way `listsRef` mirrors `state.lists`.** It is
   updated by an effect in `ListsContext`, and also assigned synchronously after every `lists/loaded`:
   - in `hydrate`;
   - in `hydrateLists`;
   - **and newly, in the cold-start cache dispatch in `ListsContext`.** `hydrate` reads `listsRef`
     before its first await, when the mirroring effects have not run yet. Without the assignment, a
     cold start counted 0 previous lists and re-read only page 1. The test "re-reads as many pages
     of lists as the cache held on a cold start" fails without it (mutation-checked).
3. **`reloadListPages(previous, fetchListPage)`** in `src/state/reloadPages.ts` runs ahead of
   `reloadPages`.
   - Each stream is re-read from page 1, one page per request, until it holds at least as many
     stamped lists of that stream as `previous` did (`joinedAt !== null`, split live/bin by
     `deletedAt`), or the stream ends. At least page 1 is always read.
   - The two streams run concurrently (`Promise.all`). Pages are folded with `lists/pageLoaded`,
     live first, so a list present in both streams is kept once.
   - Any failed page returns `{ lists: null, cursors: null, error }`. `hydrate` then returns
     `{ error, lists: null }` with no dispatch.
4. **`hydrateLists` captures `previous` and `cursors` at the same moment**, after the `fetchList`
   awaits, and dispatches exactly those cursors.
   - An unseen list is appended only if `withinLoadedRange(list, cursors)` holds: the stream's
     cursor is `null`, or `(joinedAt, id) <= cursor`.
   - Timestamps are compared as strings, like `inCreationOrder`. Postgres trims trailing zeros in
     fractional seconds, and `+` (0x2B) sorts before any digit, so `.0754+00:00 < .075405+00:00`
     holds.
5. **`usePaging` gained two functions:**
   - `loadMoreLists(includeBin)` has a one-boolean in-flight guard, reads `listCursorsRef`, fetches
     live and then bin, folds through `foldPage`, and fails silently.
   - `loadList(listId): Promise<List | null>` calls `fetchList`, then `lists/pageLoaded` with no
     `stream`. It returns the list so that `useOutbox.fetchMissingTarget` can go on to the item.
     `loadList` is threaded into `useOutbox` and exposed on the context, along with `listCursors`
     and `loadMoreLists`.
6. **`fetchMissingTarget`** first resolves the list (`loaded.find(...) ?? await loadList(listId)`),
   then the item. List-level ops (`list/renamed`, `list/setDeleted`) now fetch their list; before,
   the function returned at `!itemId`. The test "fetches the list a blocked write landed on when
   the bin pages do not reach it" fails without the change (mutation-checked).
7. **`ListDetailScreen` has a lookup state: `idle → pending → done`.**
   - Once `status === 'ready'`, a missing list is read once with `loadList`.
   - While the read is pending, the screen shows `ActivityIndicator accessibilityLabel="Loading list"`.
   - After it, the screen shows "List not found".
   - The state resets to `idle` whenever the list is present, so a list dropped by a later hydrate is
     looked up again.
   - `SharingScreen` is unchanged. It is reached only from List detail, where the list is already in
     state.
8. **`ListsScreen`:**
   - `inJoinOrder` (a twin of `inCreationOrder` sharing the comparator `byStamp`) sorts both views,
     memoised.
   - `loadingMore` is screen-local state.
   - `onEndReached` exists only while there is a cursor to follow (`live`, or `bin` while the bin is
     shown).
   - The spinner (`accessibilityLabel="Loading more lists"`, colour `ground.ink`) sits at the top of
     the existing ground-coloured `minHeight` footer, which stays.
   - `ShowDeletedToggle` gets `more={listCursors.bin !== null}`.
9. **`listCache` is at `VERSION` 6.**
   - The blob is `{ v, lists, cursors, fetchedAt }`.
   - `readCachedLists` returns `{ lists, cursors } | null`, and returns `null` when either cursor key
     is missing or not `null`/an object.
   - `outbox.ts` stays at 1.
10. **`fetchLists(stream, after, limit = LIST_PAGE_SIZE)`:**
    - `LIST_PAGE_SIZE = 100`, and a limit above `MAX_ROWS` throws.
    - Both list reads select `MEMBERSHIP_COLUMNS = 'role, created_at, lists!inner ( id, name, deleted_at )'`.
    - `toList` sets `joinedAt: row.created_at ?? null`.
    - `next` is `{ createdAt: membership created_at, id: list id }`, set only when the page is full.
    - `truncated` and the `__DEV__` warning are gone. `MAX_ROWS` stays.

## What changed

- `src/state/types.ts`: `List.joinedAt`, `ListCursors`, `State.listCursors`, `lists/loaded.cursors`,
  `lists/pageLoaded`. `WriteAction` now excludes 4 reads, and `Action` has 11 members.
- `src/lib/listsApi.ts`: `LIST_PAGE_SIZE`, `MEMBERSHIP_COLUMNS`, the paged `fetchLists`,
  `created_at` in `fetchList`, and `joinedAt` in `toList`.
- `src/state/listsReducer.ts`: `NO_LIST_CURSORS`, `initialState.listCursors`, the
  `lists/pageLoaded` arm, `list/created` with `joinedAt: null`, `inJoinOrder`, and the generic
  `insertFetched` (which replaced `insertFetchedItems`).
- `src/state/reloadPages.ts`: `reloadListPages`, `FetchListPage`, `ListPages`, `stampedLists`.
- `src/state/useHydration.ts`, `usePaging.ts`, `useOutbox.ts`, `foldPage.ts`, `replay.ts`,
  `ListsContext.tsx`, `src/lib/listCache.ts`, `src/screens/ListsScreen.tsx`, `ListDetailScreen.tsx`,
  as described above.
- Tests: 586 → 620.
  - New: `listsApi` (fetchLists `describe`), `listsReducer` (`lists/pageLoaded`, `inJoinOrder`, the
    cursors on `lists/loaded`, `joinedAt: null`), `reloadPages` (`reloadListPages` ×6),
    `ListsContext` (`lists, paged` ×7), `ListsScreen` (`more lists than a page` ×6),
    `ListDetailScreen` (missing list read before "List not found"), `listCache` (v5 dropped,
    missing cursors dropped).
  - `ListsContext.test` mocks by stream through the `serveLists`/`serveListsOnce`/`failLists`
    helpers. `hydrations()` counts `('live', null)` calls in place of
    `fetchLists.toHaveBeenCalledTimes(n)`. The `MAX_ROWS` warning test was removed.
  - `ListsScreen`, `ListDetailScreen` and `SharingScreen` tests each have a local `serveLists`.
  - Every `List` literal gained `joinedAt`.

## Problems hit

1. **`loadList` hit the one-commit-behind ref trap.**
   - List detail's mount effect calls `loadListItems` in the same commit in which the folded list
     first appears. `loadListItems` looks the list up in `listsRef.current`, which the parent's
     mirroring effect updates only after the child's effect has run. So it found nothing and never
     asked again: the binned list's notice never rendered.
   - The fix: after `foldPage`, `loadList` sets
     `listsRef.current = replay(listsReducer({ ...initialState, lists: listsRef.current }, action).lists, queue.current)`.
     That is exactly what the dispatch sequence produces.
   - This is the same trap as `first-fetch-replaces-list-state` step 11-2, now for a single-list fold.
2. **A KB `verify:` failed on formatting only.** `flatlist-footer-absent-when-list-is-empty` greps
   `ListFooterComponent={loading || visible.length === 0 ? null` as one line. Wrapping the footer JSX
   broke it while the fact still held, so the line's start was restored.
3. **An intermittent `act(...)` warning from `VirtualizedList`** appears in full parallel jest runs.
   - With these changes: 2 of 3 runs. At HEAD, in a separate worktree: 1 of 3, in
     `ListDetailScreen.test`.
   - It never appears when a suite runs alone. So it predates this step and depends on load: a
     batched cell update lands after the test.
4. **PostgREST's real SQL could not be captured.**
   - The `postgres` role cannot `alter system set log_statement`.
   - `supabase_admin` (through `docker exec … psql -U supabase_admin`) can, but
     `docker logs supabase_db_shopping-list` ends at 2026-09-27, so nothing new shows up there.
   - `PGRST_DB_PLAN_ENABLED` is not set on the rest container.
   - So the plan was measured on hand-written SQL in PostgREST 14's shape: an `INNER JOIN LATERAL`
     embed carrying the `deleted_at` filter, the keyset in `WHERE`, and `ORDER BY created_at,
     list_id LIMIT 100`. It ran as `authenticated` with `request.jwt.claims`.
5. **The web app reads the lists twice on every mount.** HEAD does too: two `limit=1000` reads,
   checked by stashing and reloading. It is not the realtime resubscribe (`listsChannel` fires that
   only on a second `SUBSCRIBED`), and there is no StrictMode. The cause was not identified; it is
   not in this step's scope.
6. **Maestro's iOS driver timed out once on the first run** (load average 20–46 after the simulator
   booted). The second run passed, as `maestro-drives-the-native-ui` predicts.

## Plan measurement (local stack, 2026-10-01)

Setup:
- 200,000 background lists, each with 1 owner membership, spread over 10,000 load-test accounts
  (20 each, modulo assignment). A third of them binned. Removed afterwards.
- The measured accounts: `t23lists` (402 memberships: 250 live + 2 shared, 150 binned) and a
  load-test account given 2,000 lists, a third binned (also removed).
- `analyze` after seeding. Each query was run once warm, then measured.

| account | read | rows | buffers | time |
|---|---|---|---|---|
| 402 | live, page 1 | 100 | 1,649 | 2.2 ms |
| 402 | bin, page 1 | 100 | 1,649 | 1.9 ms |
| 402 | live, cursor at row 100 | 100 | 849 | 2.7 ms |
| 402 | bin, cursor at row 100 | 50 | 845 | 1.3 ms |
| 2,000 | live, page 1 | 100 | 8,097 | 7.4 ms |
| 2,000 | bin, page 1 | 100 | 8,097 | 6.4 ms |
| 2,000 | live, cursor at row 1,000 | 100 | 2,074 | 3.1 ms |
| 2,000 | bin, cursor at row 500 | 100 | 2,070 | 2.9 ms |
| 402 | HEAD's single read (`limit 1000`) | 402 | 1,646 | 5.7 ms |
| 2,000 | HEAD's single read | 1,000 (capped) | 8,094 | 16.1 ms |

The plan shape is the same in every row:
- a Bitmap Index Scan on `list_members_user_id_created_at_idx`, with index cond
  `user_id = (InitPlan)` and, with a cursor, `AND created_at >= cursor`;
- then a Bitmap Heap Scan, a nested loop into `lists_pkey` (the RLS `hashed SubPlan` over
  `my_memberships()` in its filter), and a top-N sort.

What that means:
- **It is not an ordered index walk that stops at 100.** The planner cannot see which user
  `auth.uid()` is (it is an InitPlan), so it assumes the average of about 20 memberships per account.
- **So cost tracks the memberships after the cursor, for both streams.** Page 1 therefore costs
  what the whole account costs.
- **The redundant `gte` is what bounds a continuation** (it is in the index cond): 849 against
  1,649 buffers at 402 memberships.
- **Against HEAD:** each page-1 stream costs about what HEAD's whole read did, and a hydrate runs
  two streams. It returns 200 rows instead of up to 1,000 and is never capped.
- No index change was made. The signal for one would be accounts with thousands of memberships.

## Verification

- `npm test`: 28 suites, 620 tests, all passing.
- `npm run typecheck`: clean.
- `npm run kb:audit`: 3 errors, all expected and all in the description's KB-impact table:
  `list-cache-holds-acknowledged-rows` (VERSION 5, and `writeCachedLists(userId, lists)`),
  `max-rows-is-a-silent-ceiling` (`truncated`), and `writes-retry-from-an-outbox` (10 `type:` lines,
  and the three-read `WriteAction`).
- **Local stack only.** Metro was started with `EXPO_PUBLIC_SUPABASE_TARGET=local npx expo start --web`,
  because `.env` has `cloud`. The web and iOS bundles both read `"local"`, checked with curl.
- **Seed:** a new account `t23lists@example.com` (name "Tessa Pages"), given 400 lists by
  `seed-lists-for-user.sql` (1–3 items each). Then every second list among the oldest 300 was binned
  by SQL under `session_replication_role = replica`: 250 live and 150 binned, streams interleaved.
- **Emitted URL** (Playwright network log):
  - `list_members?select=role,created_at,lists!inner(id,name,deleted_at)&lists.deleted_at=is.null&order=created_at.asc,list_id.asc&limit=100`,
    and `lists.deleted_at=not.is.null` for the bin.
  - Continuations add `created_at=gte.<ts>&or=(created_at.gt."<ts>",and(created_at.eq."<ts>",list_id.gt."<id>"))`.
    All returned 200.
- **Browser (Playwright, 390×844):**
  - Page 1 showed odd-numbered lists from 1, and the toggle read "Show 100+ deleted".
  - Scrolling to the end read live pages of 100, 100 and 50; the short page ended the stream. The
    last row was "Seed list 400".
  - With the bin shown, scrolling read bin page 2 (50), and the toggle became "Show 150 deleted".
  - `visibilitychange` re-read 3 live pages and 2 bin pages. The toggle stayed "Show 150 deleted" and
    the last row "Seed list 400": no snap back to 100.
  - A cold reload re-read to the cached depth, the same 3 + 2.
- **Sharing (the second account `t23friend@example.com` acted through the API):** its token came
  from OTP via Mailpit, and it called REST `lists` insert and `rpc/share_list`, the app's own paths.
  - With the live cursor mid-stream, "Friend's picnic" was read by id (`list_id=eq`) on the nudge
    and not shown. After scrolling, it arrived with the last page.
  - With the live stream fully loaded (cursor `null`), "Friend's barbecue" appeared on the nudge with
    no page read.
- **Blocked write:**
  - The friend was made co-owner of "Seed list 351" (SQL insert into `list_members`).
  - The test account opened it, went offline (`context.setOffline`) and renamed it to "Renamed
    offline"; the sync banner said 1 change.
  - The friend binned it through `rpc/set_list_deleted`. It became #151 of the account's bin, past
    the one bin page loaded.
  - After reconnecting, List detail showed the binned list with the pending rename and "That list is
    in the bin. Restore it and keep your change?"
  - "Restore and keep my change" left the database row at name "Renamed offline", `deleted_at null`.
- **Phone (iPhone 18 Pro simulator, iOS 27, the existing Debug dev client, since no native code
  changed; Night theme; status bar 9:41):**
  - [lists-more-deleted-night-ios.png](screenshots/step-1/lists-more-deleted-night-ios.png) shows
    "Show 100+ deleted".
  - [lists-loading-more-night-ios.png](screenshots/step-1/lists-loading-more-night-ios.png) shows
    the footer spinner under "Seed list 199" on the band-coloured footer. The spinner was held there
    by `docker pause supabase_rest_shopping-list` during the scroll, then `docker unpause`.
  - Web shots: [lists-web.png](screenshots/step-1/lists-web.png) and
    [list-detail-blocked-restore-web.png](screenshots/step-1/list-detail-blocked-restore-web.png).

Left on the local stack on purpose:
- `t23lists@example.com`: 400 owned seed lists, 150 of them binned, plus 2 shared from the friend,
  and "Seed list 351" renamed and co-owned. Step 2 can use it as an account already over 100 owned
  lists.
- `t23friend@example.com`: no name set; owns 2 lists.
- The 200,000 measurement lists and the 2,000-list account's lists were deleted.

## For the librarian

The description's KB-impact table stands. New candidate facts from this step:

- **The paged list read's plan (read-rooted-at-list-members):**
  - It is a bitmap scan plus top-N sort, never an early-stopping index walk, because `auth.uid()` is
    an InitPlan and the planner assumes about 20 memberships per account.
  - Cost tracks the memberships after the cursor, for both streams, so page 1 costs the whole
    account.
  - The `gte` is in the index cond for continuations.
  - The numbers are in the table above.
- **The ref trap generalises to single-list folds (first-fetch-replaces-list-state).** `loadList`
  sets `listsRef.current` synchronously because List detail's mount effect reads it in the same
  commit.
- **Cold-start seeding (list-cache-holds-acknowledged-rows, first-fetch-replaces-list-state):** the
  cache dispatch in `ListsContext` sets `listsRef` and `listCursorsRef` synchronously, or `hydrate`
  counts from an empty ref.
- **The mechanics of capturing PostgREST's SQL on this stack (supabase-local-stack):**
  `docker logs supabase_db_shopping-list` stopped at 2026-09-27, `postgres` cannot set
  `log_statement`, and `PGRST_DB_PLAN_ENABLED` is unset. Measure hand-written SQL in PostgREST's
  shape instead.
- **Under replica mode, foreign-key cascades do not fire (read-rooted-at-list-members' seeding
  traps).** When deleting a seed under `session_replication_role = replica`, delete `items` and
  `list_members` explicitly before `lists`.
- **Holding a loading state for a native screenshot (maestro-drives-the-native-ui):**
  `docker pause supabase_rest_shopping-list` during the gesture, then `docker unpause`.
- **The web app reads the lists twice on mount, at HEAD too, cause unknown.** Worth an entry only if
  someone investigates it.
- **The intermittent `VirtualizedList` act warning in full jest runs** predates this step (seen at
  HEAD).
