# Suggestion — search and sort the live rows; "Show deleted" becomes a separate bin view

**Status:** proposal, promoted the same day by `ai/tasks/24-search-and-sort/description-step-1.md`
to `-step-3.md` at the user's request, where §7's decisions are answered. Decision 3 went against
the recommendation: one item sort **per list**, stored only when it is not the default.
[scope-boundaries](../kb/entries/scope-boundaries.md) is updated by the librarian as each step lands.

**Date:** 2026-10-01

**Sourced from `backlog/backlog.txt`** items 17 ("Search lists / items") and 19 ("Sorting"), shaped in
conversation with the user the same day. Covers both screens, `Lists` and `ListDetail`. Searching for
an item across every list is a separate question (§7, decision 1).

## Current state

- **Lists.** [ListsScreen](../../src/screens/ListsScreen.tsx#L73) shows `inJoinOrder(live)`, or
  `inJoinOrder(lists)` with "Show deleted" on, so binned lists are mixed in by join date. `fetchLists`
  pages 100 at a time, keyset on the membership's `(created_at, list_id)`. `hydrate` reads page 1 of
  both streams every time.
- **Items.** [ListDetailScreen](../../src/screens/ListDetailScreen.tsx#L101) shows
  `inCreationOrder(...)` the same way, so binned items are mixed in by `created_at`. `fetchItems` pages
  400 at a time, keyset `(created_at, id)`. Page 1 of both streams loads when the list is opened
  (`loadListItems`).
- **Bounds.** Since task 23 step 2 the database caps an account at 1,000 lists and a list at 1,000
  live items. The bin counts toward neither, and overshoot is accepted. The bin is bounded only by the
  30-day purge, which has never run on cloud ([deletion-is-a-tombstone](../kb/entries/deletion-is-a-tombstone.md)).
  **Treat the bin as unbounded.**
- No search exists apart from `search_users_by_name` on the Sharing screen.

## Decisions taken with the user, 2026-10-01

1. **"Show deleted" switches the whole screen.** Off: live rows only, with search and sort. On: bin
   rows only, with no search and no sort, always ordered **`deleted_at` descending**.
2. **Search and sort run on the device, over every live row.** The bin is never loaded in full.
   Claude proposed this and the user built on it without objecting.

Everything below follows from those two. The open decisions are in §7.

## 1. Why the device, not the database

- **The live streams are small enough.** 1,000 lists is 10 pages of 100, and 1,000 items is 3 pages of
  400. Most accounts already hold everything in page 1, so completing a stream usually costs no request
  at all.
- **Sorting on the server breaks paging.** Every sort order would need its own keyset cursor, its own
  index, a cache shape change, and a rewrite of `reloadPages`/`reloadListPages`, which re-read pages
  in cursor order.
- **On-device gets these for free:** offline search over the cache, optimistic rows in results at
  once, realtime nudges, the outbox replay, and `liveItems`/`liveLists` staying the single filter for
  tombstones.

## 2. Live view: complete the stream, then arrange

**Search and sort are correct only over a complete stream.** A filter over loaded pages says "No
matches" when the match is on page 3. A non-default sort reshuffles the rows already on screen when
the next page arrives. **But results never wait for the network:** offline, or on a weak signal, the
stream may never complete. So the screen arranges what it holds at once, completes the stream behind
it, and says how complete the results are.

- **When to complete.** When the query is non-empty or the sort is not the default, *and* the live
  cursor is non-null (`listCursors.live`, `list.nextLive`), load the rest of the live stream in the
  background. Add `loadAllLists()` and `loadAllItems(listId)` to
  [usePaging.ts](../../src/state/usePaging.ts), looping the page fetch until the cursor is `null`.
  Use the normal page size: 10 or 3 requests at the limit, and only for heavy accounts.
- **The loop stops at the first failed page.** Today `loadMore`/`loadMoreLists` swallow a failed
  page and leave the cursor where it was ("a page that fails is silent"). A loop that waits for the
  cursor to become `null` would then re-ask at once, and offline every attempt fails almost
  instantly: an endless request loop. The page functions must report the outcome, and
  `loadAll*` returns `'complete' | 'failed' | 'capped'`.
- **Results show at once,** arranged over what state holds. Offline, that is what the cache
  restored. A line under the search field reports coverage, from the outcome and the count of live
  rows held:

  | completion | line |
  |---|---|
  | running | `Searching 400 loaded items · loading the rest…` |
  | failed | `Searched the 400 loaded items. The rest need a connection.` and a `Try again` button |
  | capped | `Searched the first 2,000 items.` |
  | complete | none |

  For lists the line can name the total (`300 of 1,000 lists`) from `listCounts.total`, which the
  app already reads for the limits. Items have no total.
- **No "No matches" over partial data.** While the stream is incomplete, an empty result reads `No
  matches in the 400 loaded items`, with the line under it.
- **A non-default sort over partial data is accepted.** Offline nothing arrives, so the order holds
  still. When the rest arrives, rows slot into place, and the line has already said the results were
  partial.
- **No spinner gates the results,** and that matters beyond offline: no request timeout is set in
  [supabase.ts](../../src/lib/supabase.ts), so one stuck request on a weak signal would hold a
  results spinner for as long as the platform keeps the request open.
- **Retry on the signals the app already has.** There is no connectivity library (step 4,
  [scope-boundaries](../kb/entries/scope-boundaries.md)), so the app learns it is back online only
  from a read that succeeds:
  - `hydrate` on foreground (`AppState` `active`; `visibilitychange` and `online` on web);
  - `hydrate` on a realtime resubscribe, which nudges `'all'`;
  - `hydrateLists` on any later nudge, including the echo of the user's own queued write once the
    outbox delivers it (echo suppression was declined in step 8).

  A successful outbox retry is **not** a signal on its own: `flush` re-reads only after a `permanent`
  refusal or a `target_deleted` ([useOutbox.ts](../../src/state/useOutbox.ts)). Expose a counter from
  the provider that a successful `hydrate` or `hydrateLists` bumps. The screen restarts a `'failed'`
  completion when the counter moves, and on `Try again`.
- **A hard stop at 2,000 rows** (20 pages of lists, 5 of items). Overshoot is accepted, and accounts
  that were already past a limit keep everything, so "bounded by the limits" is not a guarantee. The
  stop shows as the `capped` line above.
- **Default sort with an empty query keeps today's paging on scroll.** Nothing is completed, and no
  line shows.

**Offline search is usually complete anyway:**

- **Most accounts hold everything in page 1** (under 100 lists, under 400 items in a list).
- **The cache keeps every page loaded,** so a stream completed online stays complete offline across
  restarts, until sign-out clears the cache
  ([list-cache-holds-acknowledged-rows](../kb/entries/list-cache-holds-acknowledged-rows.md)).
  Exception: the acknowledged-rows effect writes the cache only while nothing is queued
  (`status === 'ready' && pending === 0`, [ListsContext.tsx:298](../../src/state/ListsContext.tsx#L298)),
  and `hydrate` writes it otherwise. Pages completed while writes were queued, with the app killed
  before the queue drained or the next `hydrate`, come back partial at the next offline start. The
  coverage line reports that honestly. No fix proposed.
- **A list never opened has no items offline.** This is today's behaviour: ListDetail shows `Loading
  list items`. The search control renders only once `list.itemsLoaded` is true, the same gate the Add
  bar already has.
- **Consequence to accept:** `hydrate` re-reads as deep as state holds
  ([first-fetch-replaces-list-state](../kb/entries/first-fetch-replaces-list-state.md)), so after one
  search an account near 1,000 lists makes up to 10 sequential list requests on every foreground. If
  that ever matters, `reloadListPages` can re-read with `limit = MAX_ROWS`, one request. Do not build
  that speculatively.

**A new pure module, `src/state/arrange.ts`:**

- `arrangeLists(lists, { sort, query })` and `arrangeItems(items, { sort, query })`. Each takes the
  output of `liveLists`/`liveItems` and returns a new array, so screens memoise it in place of the
  current `inJoinOrder`/`inCreationOrder` call.
- **Matching:** substring, case- and accent-insensitive (`creme` finds `Crème fraîche`), on `name` /
  `title`. Fold with `normalize('NFD')`, strip combining marks, then lowercase. **Confirm that Hermes
  implements `String.prototype.normalize` on both platforms**. If it doesn't, the fallback is a small
  fold table.
- **Sorts:**

  | screen | options, default first |
  |---|---|
  | Lists | Oldest first (`joinedAt`, today's order) · Newest first · A–Z |
  | ListDetail | Added (`createdAt`, today's order) · A–Z · To do first |

  "To do first" puts undone items first, then done ones, each group in added order. A–Z uses
  `Intl.Collator(undefined, { sensitivity: 'base', numeric: true })`, so "Item 2" sorts before "Item
  10". **Confirm Hermes ships `Intl.Collator` with those options on both platforms.**
- **Ties and optimistic rows:** every comparator falls back to the existing `byStamp` order in
  [listsReducer.ts](../../src/state/listsReducer.ts#L327), so rows the database has not stamped stay
  last within their group.
- **No debounce.** Filtering 2,000 strings is not worth one.

**State:**

- **The query is screen-local `useState`.** It is never stored, cleared on leaving the screen, and
  kept across a trip into the bin and back, like `showDeleted` today
  ([ListsScreen.tsx:59](../../src/screens/ListsScreen.tsx#L59)).
- **The sort is stored per device.** Add a new `src/lib/sortPreference.ts` modelled on
  [themePreference.ts](../../src/lib/themePreference.ts): one versioned key holding `{ lists, items }`,
  a read that never rejects, writes through `inOrder`. One item sort covers every list.

## 3. Bin view: paged by `deleted_at` descending, never completed

**The bin read itself has to change order.** If the bin kept paging by `created_at` and the screen
sorted by `deleted_at`, page 2 could hold yesterday's deletion and push it above rows already on
screen. Paging by `(deleted_at, id)` descending makes each page continue where the last one ended.
Two properties make this safe:

- **New deletions land on page 1,** which every `hydrate` already re-reads. A deletion on another
  device appears at the top on the next nudge.
- **A changing key does not break the keyset.** `deleted_at` only jumps to `now()` (deleted again) or
  becomes `null` (restored and gone from the bin). A row can move to page 1 but never behind the
  cursor, so paging skips nothing. A re-deleted row already in state keeps its old `deletedAt`
  until the next re-read, because `items/pageLoaded` leaves rows it already holds alone. That is
  cosmetic and heals itself.

**Items** ([listsApi.ts](../../src/lib/listsApi.ts), `fetchItems`, bin branch only):

- `order('deleted_at', { ascending: false }).order('id', { ascending: false })`.
- Keyset: `deleted_at.lt."c",and(deleted_at.eq."c",id.lt."x")`, plus a redundant `.lte('deleted_at',
  c)` beside it. That is the descending twin of the `gte` both reads keep today for the plan
  ([read-rooted-at-list-members](../kb/entries/read-rooted-at-list-members.md)).
- **New migration:** `create index on public.items (list_id, deleted_at, id) where deleted_at is not
  null;`. With it, a bin page is an ordered index walk that costs one page however large the bin is.
  Without it, every page sorts the list's whole bin, which is the unbounded case. Being partial, the
  index is never touched by adding or ticking live items. The live stream keeps `(list_id,
  created_at)`.

**Lists** (`fetchLists`, bin branch only):

- `deleted_at` lives on `lists`, but the read must stay rooted at `list_members` (rules 1–3 of
  read-rooted-at-list-members). Order through the embed: `order=lists(deleted_at).desc,list_id.desc`.
  Keyset through embed filters: `lists.deleted_at=lte.c` and
  `lists.or=(deleted_at.lt."c",and(deleted_at.eq."c",id.lt.x))`, relying on `!inner` to make an
  embed filter drop the parent row.
- **Unverified.** Whether PostgREST v14.5 orders top-level rows by a to-one embedded column this way,
  and whether supabase-js's `.order(...)`/`.or(..., { referencedTable })` emit those parameters,
  was not checked against the local stack. A test was attempted on 2026-10-01 and not run. **Check it
  before anything else in the step.** Fallback: a `security invoker` function rooted at
  `list_members`, the way `my_list_counts()` is.
- **Cost:** no index can serve an order whose key is on the far side of the join. Every bin page
  walks all of the account's memberships, joins `lists_pkey`, sorts, and takes 100. That is what page
  1 costs today (1,649 buffers / ~2 ms at 402 memberships, 8,097 / ~7 ms at 2,000). Accept it and
  measure. The escalation, only if an account with tens of thousands of binned memberships is
  measured slow, is denormalising the stamp onto `list_members`, maintained by `set_list_deleted`,
  with a partial index on `(user_id, …)`.

**Client:**

- **A separate cursor type,** `BinCursor = { deletedAt: string; id: string }` in
  [types.ts](../../src/state/types.ts), for `List.nextBin` and `ListCursors.bin`. Keep `Cursor` for
  live. The compiler then lists every site that has to change.
- **`listCache` `VERSION` 7 → 8:** a cached bin cursor is a `created_at` position and would page the
  new order wrong. **`outbox` stays 1:** no queued action changes shape
  ([list-cache-holds-acknowledged-rows](../kb/entries/list-cache-holds-acknowledged-rows.md)).
- **[reloadPages.ts](../../src/state/reloadPages.ts):** both re-reads page the bin with the new
  cursor. `stampedLists`/`loadedRows` count a row this device deleted but the server has not
  acknowledged as a loaded bin row, because it carries `joinedAt`/`createdAt` and a device-minted
  `deletedAt`. Check whether that can make the re-read ask for a page it doesn't need, rather than
  assuming it can't.
- **`withinLoadedRange`** ([useHydration.ts:320](../../src/state/useHydration.ts#L320)), which
  `hydrateLists` uses to keep a nudged list only if it sorts inside the loaded pages, compares
  `(joinedAt, id)` ascending. For the bin it must compare `(deletedAt, id)` **descending**. A wrong
  comparison only hides a newly binned list until a scroll brings it, so it **needs its own test**.
- **Paging takes a stream:** `loadMore(listId, stream)` and `loadMoreLists(stream)` in place of
  `includeBin`. Live mode never fetches bin pages, and bin mode never fetches live ones.
- **`inDeletionOrder(items|lists)`** goes next to `inCreationOrder`: `deletedAt` descending, `id`
  descending. A deletion made on this device carries the tap's time
  ([useListWrites.ts:155](../../src/state/useListWrites.ts#L155), `:179`), so it lands on top before
  the server answers.
- **Unchanged:** page 1 of the bin still loads when a list is opened (items) and on every `hydrate`
  (lists). The toggle needs it to know whether to render, and it keeps the bin readable offline.

## 4. Screens

| | Show deleted **off** | Show deleted **on** |
|---|---|---|
| rows | live only; whole stream once a search or sort needs it (§2) | bin only, `deleted_at` descending, next page on scroll |
| search and sort | shown | hidden |
| Create / Add bar | shown | hidden (decision 4) |
| empty | `No lists yet` / `Nothing on this list` as today; `No matches for "<query>"` with a query over a complete stream, `No matches in the <n> loaded items` over a partial one (§2) | `The bin is empty` |

- **The toggle stays while it is on.** Today it renders only while `binned > 0` / `inBin > 0`
  ([ListsScreen.tsx:148](../../src/screens/ListsScreen.tsx#L148),
  [ListDetailScreen.tsx:294](../../src/screens/ListDetailScreen.tsx#L294)). In bin mode, restoring the
  last row would remove the only way back. Render it while the bin has rows **or** while it is
  checked. That is the only route to `The bin is empty`.
- **`showDeleted` stays screen-local and resets on arrival,** as today.
- **Control placement needs mockups in `ai/ux/primary/` before code**
  ([phone-is-the-product](../kb/entries/phone-is-the-product.md)). Proposed:
  - A round magnifier `IconButton`, labelled `Search and sort`, next to `Account` on Lists and between
    `Back` and `Rename` on ListDetail.
  - Tapping it swaps the Create / Add bar for a panel of the same height: a search field with
    `Cancel`, and a `SegmentedPicker` for the sort below it.
  - This is the same in-place swap the rename bar (replacing the title) and the limit sentence
    (replacing the Create bar) already make, so the sticky header keeps its shape.
  - The sort stays applied after the panel closes. `Cancel` clears the query only.
- The binned-list notice on ListDetail ("those are one tick of Show deleted away") stays accurate.

## 5. Knowledgebase this changes

The librarian updates these at the step's deposit. Hand them over, don't edit them:

- **[list-cache-holds-acknowledged-rows](../kb/entries/list-cache-holds-acknowledged-rows.md):** its
  `verify:` asserts `const VERSION = 7;` and **will fail** on the bump.
- **[read-rooted-at-list-members](../kb/entries/read-rooted-at-list-members.md):** the bin keyset, the
  new partial index, and the lists-bin cost. Its `verify:` may still pass, so its prose goes stale
  silently.
- **[deletion-is-a-tombstone](../kb/entries/deletion-is-a-tombstone.md):** "Show deleted" is now a
  separate view in deletion order, no longer mixed in. Same risk: stale prose with a passing
  `verify:`.

## 6. Testing and measurement

- **Unit tests:**
  - `arrange.ts`: matching with accents and case, each sort, ties, unstamped rows last.
  - `inDeletionOrder`.
  - `withinLoadedRange` for the bin.
  - `reloadPages`/`reloadListPages` with a bin cursor.
  - `listsApi` bin query shapes, with supabase mocked
    ([supabase-client-module-boundary](../kb/entries/supabase-client-module-boundary.md)).
  - `sortPreference` read fallbacks.
- **Screen tests, through a11y labels** ([queries-go-through-a11y-labels](../kb/entries/queries-go-through-a11y-labels.md)):
  - The toggle switches modes and hides search, sort and the Add bar.
  - The toggle survives restoring the last binned row.
  - Empty-state copy is asserted verbatim, in both its complete and partial forms.
  - Results show at once over a partial stream, with the `running` line.
  - With the page fetch mocked to fail, completion stops after **one** request, not a loop, and
    shows the `failed` line and `Try again`.
  - A successful `hydrate` after a failure restarts completion, and so does `Try again`.
  - The `capped` line appears at the 2,000-row stop.
  - The search control is absent until `itemsLoaded`.
- **Measurement,** following read-rooted-at-list-members' method and its seeding traps:
  - The item bin read at ~1M items with a deep cursor, before and after the index.
  - The lists bin read at ~400 and ~2,000 memberships.
- **Phone:** a Maestro flow on the iPhone 18 Pro simulator, with screenshots of the two changed
  screens only.

## 7. Open decisions

1. **Cross-list item search** ("which list has the batteries?"). Recommended **out of this step**. It
   cannot run on the device: items load only when a list is opened, and an account can reach 1,000 ×
   1,000 items. If wanted, it would be:
   - an RPC rooted at `list_members` (`security invoker`, `in (select … from my_memberships())`);
   - `create index … on public.items using gin (lower(title) gin_trgm_ops)`;
   - a 3-character floor, client and server
     ([trigram-index-needs-three-characters](../kb/entries/trigram-index-needs-three-characters.md));
   - results opening `ListDetail`. Offline it is unavailable.
2. **Sort remembered per device** (recommended) or reset on every visit.
3. **One item sort for every list** (recommended) or one per list.
4. **The Create / Add bar is hidden in bin mode** (recommended): an item added while viewing the bin
   would vanish from view at once.
5. **Control placement** (§4), settled by the mockups.

## Deliberately out

- **Searching or sorting the bin.** Searching it would mean a server-side filtered keyset read.
  Results could not be folded into shared state, because re-reads size themselves by row count and
  would drop deep matches mid-search. A Restore would have to fold the one row in by id, as
  `fetchItem` does for a blocked write's target. That is a lot of machinery when re-adding an item is
  usually quicker.
- **Sorting the live rows on the server** (§1).
- **A "recently changed" list sort.** Lists carry no change timestamp the client reads. Adding one
  means a column bumped by a trigger on every item write, which is a migration that also touches the
  realtime fan-out.
