# Step 2 — "Show deleted" becomes a separate bin view, newest deletion first

The user's requests are quoted in [description-step-1.md](description-step-1.md). Rationale:
[ai/suggestions/search-and-sort.md](../../suggestions/search-and-sort.md) §3 and §4. Where the two
differ, this description wins.

**Step 1's mockups must be signed off first.** This step builds `lists-screen-bin` and
`list-detail-screen-bin` to them, and takes the bin copy from step 1's log.

**Scope change:** today "Show deleted" mixes binned rows into the live ones, ordered by
`created_at` / `joinedAt`. After this step, the toggle switches the whole screen:

| | Show deleted **off** | Show deleted **on** |
|---|---|---|
| rows | live only, as today | bin only, **`deleted_at` descending**, next page on scroll |
| Create / Add bar | shown | hidden. The slot holds what step 1 settled |
| empty | `No lists yet` / `Nothing on this list`, as today | `The bin is empty` |
| toggle | rendered while the bin has rows | rendered while the bin has rows **or** while it is checked |

Step 3 adds search and sort to the "off" column only. **The bin is never searched, sorted another
way, or loaded in full.**

## Why the read itself changes order

If the bin kept paging by `created_at` and the screen sorted by `deleted_at`, page 2 could hold
yesterday's deletion and push it above rows already on screen. Paging by `(deleted_at, id)`
descending means each page continues where the last one ended.

- **New deletions land on page 1**, which every `hydrate` already re-reads, and which opening a list
  already loads.
- **A changing key does not break the keyset.** `deleted_at` only jumps to `now()` (deleted again) or
  becomes `null` (restored, and gone from the bin). A row can move to page 1, never behind the
  cursor, so paging skips nothing.
- **Accepted, cosmetic, self-healing:** a re-deleted row already in state keeps its old `deletedAt`
  until the next re-read, because `items/pageLoaded` leaves rows it already holds alone. A deletion
  made on this device carries the tap's device time ([useListWrites.ts](../../../src/state/useListWrites.ts),
  `list/setDeleted` and `item/setDeleted`) until a re-read replaces it with the server's stamp, so
  clock skew can misplace it until then.

## Do this first: the lists bin query

`deleted_at` lives on `lists`, but the read stays rooted at `list_members`
([read-rooted-at-list-members](../../kb/entries/read-rooted-at-list-members.md), rules 1–3). So the
order and the keyset both go through the `!inner` embed.

**Client half, already checked** (postgrest-js 2.112.4, `dist/index.cjs`):

- `.order('lists(deleted_at)', { ascending: false })` emits `order=lists(deleted_at).desc`, which
  orders the **parent** rows by a to-one embedded column.
- `.order('deleted_at', { referencedTable: 'lists' })` emits `lists.order=…`, which orders the embed's
  **own** rows. That does nothing useful for a to-one embed. **Do not use `referencedTable` for the
  order.**
- `.or(filters, { referencedTable: 'lists' })` emits `lists.or=(…)`, and with `!inner` an embed
  filter drops the parent row. That spelling is the right one for the keyset.

**Server half, unverified:** whether PostgREST v14.5 accepts `order=lists(deleted_at).desc` on this
embed and returns parent rows in that order. Check it against the local stack with `curl` before
anything else in this step, and record the URL and result in the log. **Fallback:** a
`security invoker` SQL function rooted at `list_members`, the way `my_list_counts()` is, returning the
same columns.

```ts
// fetchLists, bin branch only. The live branch is unchanged.
let query = supabase
  .from('list_members')
  .select(MEMBERSHIP_COLUMNS)
  .not('lists.deleted_at', 'is', null);
if (after) {
  query = query
    .lte('lists.deleted_at', after.deletedAt)
    .or(
      `deleted_at.lt."${after.deletedAt}",and(deleted_at.eq."${after.deletedAt}",id.lt."${after.id}")`,
      { referencedTable: 'lists' }
    );
}
query.order('lists(deleted_at)', { ascending: false }).order('list_id', { ascending: false }).limit(limit);
```

**Cost, accepted, to be measured:** no index can serve an order whose key is across the join. Every
bin page walks all of the account's memberships, joins `lists_pkey`, sorts, and takes 100. Today's
page 1 already costs that (1,649 buffers / ~2 ms at 402 memberships, 8,097 / ~7 ms at 2,000).
**Escalate only if measured slow** for an account with tens of thousands of binned memberships. The
escalation is denormalising the stamp onto `list_members`, maintained by `set_list_deleted`, with a
partial index on `(user_id, …)`. Do not build it now.

## Items bin query and its index

```ts
// fetchItems, bin branch only. The live branch is unchanged.
let query = supabase.from('items').select(ITEM_COLUMNS).eq('list_id', listId).not('deleted_at', 'is', null);
if (after) {
  query = query
    .lte('deleted_at', after.deletedAt)
    .or(`deleted_at.lt."${after.deletedAt}",and(deleted_at.eq."${after.deletedAt}",id.lt."${after.id}")`);
}
query.order('deleted_at', { ascending: false }).order('id', { ascending: false }).limit(limit);
```

- The `lte` is the descending twin of the redundant `gte` both reads keep today for the plan. Keep it.
- **One new migration**, dated after `20261001000000_list_limits.sql`:
  `create index items_bin_order_idx on public.items (list_id, deleted_at, id) where deleted_at is not null;`
  - With it, a bin page is a backward ordered index walk that costs one page, however large the bin.
  - Without it, every page sorts the list's whole bin. The bin is unbounded: only the 30-day purge
    trims it, and that has never run on cloud
    ([deletion-is-a-tombstone](../../kb/entries/deletion-is-a-tombstone.md)).
  - Being partial, it is never touched by adding or ticking live items. The live stream keeps
    `(list_id, created_at)`.
- **Do not push the migration to cloud.** Cloud is already behind local
  ([scope-boundaries](../../kb/entries/scope-boundaries.md)).

## Client

- **`BinCursor = { deletedAt: string; id: string }`** in [types.ts](../../../src/state/types.ts), used
  by `List.nextBin` and `ListCursors.bin`. `Cursor` stays the live type. Let the compiler list every
  site that has to change: the `fetchItems`/`fetchLists` signatures, `cursorAfter`, `FetchPage` and
  `FetchListPage` in `reloadPages.ts`, the reducer's `stream` payloads and `sameCursor`.
- **`listCache` `VERSION` 7 → 8.** A cached bin cursor is a `created_at` position and would page the
  new order wrong. **`outbox` stays at 1:** no queued action changes shape.
- **[reloadPages.ts](../../../src/state/reloadPages.ts):** `reloadListPages` and `reloadPages` page
  the bin with `BinCursor`. `stampedLists`/`loadedRows` count a row this device deleted, but the
  server has not acknowledged, as a loaded bin row: it carries `joinedAt`/`createdAt` and a
  device-minted `deletedAt`. **Check** whether that can make the re-read ask for a page it doesn't
  need, rather than assuming it can't, and record the answer in the log.
- **`withinLoadedRange`** in [useHydration.ts](../../../src/state/useHydration.ts) keeps a nudged list
  only if it sorts inside the loaded pages. Today it compares `(joinedAt, id)` ascending for both
  streams. For the bin it must compare `(deletedAt, id)` **descending**: a binned list is in range
  when the bin cursor is `null`, or `deletedAt > cursor.deletedAt`, or the two are equal and
  `id >= cursor.id`. A wrong comparison only hides a newly binned list until a scroll brings it, so
  nothing else would catch it. **It needs its own test.**
- **`inDeletionOrder(items)` and an equivalent for lists**, next to `inCreationOrder`/`inJoinOrder` in
  [listsReducer.ts](../../../src/state/listsReducer.ts): `deletedAt` descending, then `id` descending.
  Add `binItems`/`binLists` beside `liveItems`/`liveLists`, so the tombstone filter stays in one
  place.
- **Paging takes a stream:** `loadMore(listId, stream)` and `loadMoreLists(stream)`, replacing
  `includeBin`, in [usePaging.ts](../../../src/state/usePaging.ts). Live mode never fetches bin pages,
  and bin mode never fetches live ones.
- **Unchanged:** page 1 of the item bin still loads when a list is opened (`loadListItems`), and
  page 1 of the lists bin on every `hydrate`. The toggle needs it to know whether to render, and it
  keeps the bin readable offline. `fetchList`/`fetchItem` (single reads) are untouched.

## Screens

Both [ListsScreen](../../../src/screens/ListsScreen.tsx) and
[ListDetailScreen](../../../src/screens/ListDetailScreen.tsx):

- `visible` is `inJoinOrder(live)` / `inCreationOrder(live)` with the toggle off, and the deletion
  order over the bin rows with it on. Rewrite the comments that explain the interleaving: there is
  none any more.
- `more` reads only the shown stream's cursor, and `loadNextPage` passes that stream.
- **The toggle renders while `binned > 0 || showDeleted`** (`inBin` on List detail). In bin mode,
  restoring the last row would otherwise remove the only way back, and this is the only route to
  `The bin is empty`. Its label at zero comes from step 1. Update `ShowDeletedToggle`'s doc comment,
  which says it renders only when there is something in it.
- The Create / Add bar is not rendered in bin mode, and the slot holds what step 1 settled. List
  detail's read-only notice and binned-list notice (with `Restore`) are not write controls and stay.
- `showDeleted` stays screen-local and resets on arrival, as today.
- The binned-list notice ("those are one tick of Show deleted away") stays accurate. Leave it.
- Empty-state copy from step 1's log, asserted verbatim.

## Tests (jest)

- `listsApi`, supabase mocked ([supabase-client-module-boundary](../../kb/entries/supabase-client-module-boundary.md)):
  - both bin reads' emitted parameters, with and without a cursor;
  - the live reads unchanged.
- Reducer: `inDeletionOrder` for items and lists, and `pageLoaded` carrying a `BinCursor`.
- `withinLoadedRange` for the bin: in range, past the cursor, an equal stamp on either side of the
  id, and a `null` cursor.
- `reloadPages`/`reloadListPages` with a bin cursor: two bin pages loaded plus a nudge leaves two
  loaded.
- `listCache`: a version-7 blob reads as a miss.
- Screens, through a11y labels ([queries-go-through-a11y-labels](../../kb/entries/queries-go-through-a11y-labels.md)):
  - The toggle switches modes. On: only binned rows, in deletion order, no Create / Add bar.
  - The toggle survives restoring the last binned row, and `The bin is empty` shows.
  - `onEndReached` asks only for the shown stream: `loadMoreLists('bin')` in bin mode,
    `loadMoreLists('live')` otherwise; the same for `loadMore`.

## Measurement

Use read-rooted-at-list-members' method and its seeding traps: `explain (analyze, buffers)` as
`authenticated` with a JWT claim. Record every number in the log.

- The item bin read at ~1M items, a list with a large bin, cursor deep in it: before and after the
  index.
- The lists bin read at ~400 and ~2,000 memberships, page 1 and a mid-stream cursor.

## Verification

1. **Local stack only.** Read `.env`'s `EXPO_PUBLIC_SUPABASE_TARGET`, and check for any Metro already
   on 8081, first ([supabase-target-picked-at-runtime](../../kb/entries/supabase-target-picked-at-runtime.md)).
2. **Seed** one account with ~250 lists, then bin ~150 of them by SQL at spread-out `deleted_at`
   values ([supabase/scripts/seed-lists-for-user.sql](../../../supabase/scripts/seed-lists-for-user.sql)).
   Give one list ~500 binned items the same way.
3. **Browser:**
   - The lists bin pages in deletion order, newest first. Scrolling adds older ones below, never
     above.
   - Binning a list from a second account puts it at the top of the first account's bin after the
     nudge.
   - Restoring the last binned item leaves `The bin is empty` with the toggle still on. Turning the
     toggle off returns the live view.
   - No Create / Add bar in bin mode, on either screen.
   - Live mode still pages by scroll, and never requests a bin page. Check the network tab.
4. **Phone:** iPhone 18 Pro simulator, both themes, the two changed screens in bin mode only, compared
   by measure against step 1's `*-bin` mockups. Screenshots in `screenshots/step-2/`.
5. **Commands:** `npm test`, `npm run typecheck`, `npm run kb:audit`. The audit is expected to go red
   on `list-cache-holds-acknowledged-rows` (its `verify:` pins `VERSION = 7`). Leave that for the
   librarian.

## KB impact (for the librarian)

| entry | change |
|---|---|
| scope-boundaries | "Show deleted" is a separate bin view, deletion order, not searchable or sortable |
| deletion-is-a-tombstone | the bin is its own view, newest deletion first; its `verify:` may still pass, so the prose goes stale silently |
| read-rooted-at-list-members | both bin reads are keyset on `(deleted_at, id)` descending; the partial index; the lists-bin cost and the PostgREST embed-order finding, measured |
| list-cache-holds-acknowledged-rows | cache `VERSION` 8. Its `verify:` goes red on purpose |
| realtime-is-a-nudge-to-a-per-user-inbox | `withinLoadedRange` compares the bin by `(deletedAt, id)` descending |
| first-fetch-replaces-list-state | the re-reads page the bin with `BinCursor`, and the answer to the `loadedRows` question |
