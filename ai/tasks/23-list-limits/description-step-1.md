# Step 1 — Page the lists the way items are paged

User requests (2026-09-30), verbatim, in order. This whole task comes from them:

1. "I want to limit the number of lists for a user to 100 and the number of items in a list to 1000. Suggest a way to do that."
2. "I want to limit the number of the lists created by a user to 100 and lists that user is assigned to in total to 1000, not including the delted items."
3. "I don't like the locks overshooting a limit by a little is ok"
4. "Pagination for the lists should be the same as for the items, but with 100 lists per page."

This step implements request 4. Step 2 implements the limits. Paging comes first for two reasons:

- Step 2 accepts overshoot, so a user can hold more than `MAX_ROWS` (1000) memberships. Today's
  single read (`fetchLists`, [src/lib/listsApi.ts](../../../src/lib/listsApi.ts)) would then drop
  the newest ones silently. Its only signal is a `__DEV__` warning in `useHydration.hydrate`.
- Step 2's in-app warnings need counts from the server. Once lists are paged, the client no longer
  holds every list.

**Scope change:** [scope-boundaries](../../kb/entries/scope-boundaries.md) has "paged lists out";
this step puts them in. The sharing roster stays unpaged.

## "The same as items", mapped

Items today (task 11) work like this:

- There are two streams, live and bin, each keyset-paged on `(created_at, id)`.
- Page 1 of both streams is fetched together.
- The rest loads on scroll through `onEndReached`, and the bin only while "Show deleted" is on.
- `hydrate` re-reads as many rows per stream as were loaded before (`reloadPages`), one page per request.
- The cache holds every loaded page and the cursors.
- `ShowDeletedToggle` shows `N+` while the bin has more.

Lists copy all of it, mapped as follows:

| | items (today) | lists (this step) |
|---|---|---|
| read | `fetchItems(listId, stream, after, PAGE_SIZE)` | `fetchLists(stream, after, LIST_PAGE_SIZE)`, **still rooted at `list_members`** |
| page size | `PAGE_SIZE = 400` | `LIST_PAGE_SIZE = 100` (user's number), asserted `<= MAX_ROWS` like `fetchItems` |
| keyset | `(items.created_at, id)` | `(list_members.created_at, list_id)`. Join time is today's list order (`.order('created_at')` on `list_members`), so the visible order does not change |
| stream filter | `items.deleted_at` | `lists.deleted_at` through the `lists!inner` embed |
| optimistic marker | `Item.createdAt: null` | new required `List.joinedAt: string \| null`, `null` for an optimistic `list/created` |
| cursors | `List.nextLive` / `List.nextBin` | two list cursors on `State`, e.g. `State.listCursors: { live: Cursor \| null; bin: Cursor \| null }`. Reuse `Cursor`, with `createdAt` = membership `created_at` and `id` = list id |
| page 1 of both streams | on entering a list (`loadListItems`) | on every `hydrate`, since the Lists screen is the root and there is no "enter" moment |
| more on scroll | `usePaging.loadMore(listId, includeBin)` | a list-level twin, e.g. `loadMoreLists(includeBin)`, with its own in-flight guard |
| page action | `items/pageLoaded` (read, idempotent by id, inserted before the first optimistic row, `stream` optional) | `lists/pageLoaded`, same rules. `stream` omitted means cursors unchanged, used by the single-list reads below |
| screen order | `inCreationOrder` in `ListDetailScreen`, both views | a twin sorted by `(joinedAt, id)`, nulls last, applied to both views in `ListsScreen`. A list that moves between streams keeps its array position, and "Show deleted" interleaves two streams |
| footer | spinner `accessibilityLabel="Loading more items"` | `"Loading more lists"`. It must coexist with `ListsScreen`'s ground-coloured `minHeight` footer, which stays |
| toggle | `ShowDeletedToggle more={nextBin !== null}` | same prop on the Lists screen. `count` stays the loaded binned count |

## The parts that do not map one to one

- **`lists/loaded` must carry the list cursors.** It replaces state wholesale. `replay` and
  `reloadPages` both build `{ lists }` states and need the new fields too, or keep the cursors out
  of `State`. Pick one and say which in the log.
- **`hydrate` re-reads list pages, then item pages.** Extend `reloadPages` (or add a sibling in
  front of it) so that it:
  - re-reads each list stream one page per request from page 1, until it holds at least as many
    **stamped** lists (`joinedAt !== null`) as before or the stream ends;
  - then runs today's per-list item re-expansion over the result.
- **A failed list-page continuation fails the whole `hydrate`: no dispatch, state untouched.** This
  deliberately differs from items' per-list snap-back. Snapping back the list pages would drop lists
  from state: one open in `ListDetailScreen`, or one with queued writes. It is the same outcome as a
  failed `fetchLists` today.
- **`hydrateLists` (a nudge naming lists) appends a list it has never seen only if it falls inside
  the loaded range of its stream.** That means the stream's cursor is `null`, or `(joinedAt, id)`
  is at or before the cursor. Otherwise it is dropped and arrives with its page. `fetchList` must
  also select `list_members.created_at` for `joinedAt`. Lists already in state are replaced in place,
  as now.
- **The blocked-write path must fetch a missing list.**
  - Problem: `useOutbox.fetchMissingTarget` returns early when the op's list is not in `loaded`.
    With paging, a list somebody else binned can sort past the loaded bin pages. `restorePlan` then
    finds no list, the plan is empty, and **the write is discarded silently**. That is task 11
    §3.5's failure, one level up.
  - Fix: when the list is missing, fetch it with `fetchList(listIdOf(op))` and fold it in with
    `lists/pageLoaded` (no `stream`) before the item lookup.
- **`ListDetailScreen` fetches its list once before showing "List not found".**
  - Problem: a full hydrate can drop the open list for the same reason: binned by someone else, and
    now past the loaded bin pages.
  - Fix: fetch it with `fetchList` and fold it in with no `stream`.
  - Accepted: a later full hydrate may drop it again, and it is re-fetched the same way. This is
    reachable only with more than 100 binned lists.
- **Accepted by parity with items.** Items already have "an item added past a loaded page surfaces
  one scroll away":
  - A list created on this device shows at the bottom of what is loaded. Once acknowledged, a full
    hydrate re-reads only the loaded range, so the list leaves the screen until the user scrolls to
    the end.
  - This happens only with more than 100 live lists.
- **`fetchLists` loses `truncated`**, and `hydrate` loses the `__DEV__` warning
  ([useHydration.ts:103-108](../../../src/state/useHydration.ts#L103-L108)). `MAX_ROWS` stays.

## Query

```ts
let query = supabase
  .from('list_members')
  .select('role, created_at, lists!inner ( id, name, deleted_at )');
query = stream === 'live'
  ? query.is('lists.deleted_at', null)
  : query.not('lists.deleted_at', 'is', null);
if (after) {
  query = query
    .gte('created_at', after.createdAt)
    .or(`created_at.gt."${after.createdAt}",and(created_at.eq."${after.createdAt}",list_id.gt."${after.id}")`);
}
query.order('created_at').order('list_id').limit(limit);
```

Two things here are not yet verified:

- **The filter spelling.** Filtering the parent through an `!inner` embed's column is standard
  PostgREST, but check the emitted URL in `listsApi.test.ts` and against the local stack.
- **The plan.** [read-rooted-at-list-members](../../kb/entries/read-rooted-at-list-members.md) says
  to measure: `explain (analyze, buffers)` as `authenticated` with a JWT claim, for both streams and
  with a mid-stream cursor. The redundant `gte` is what made the items keyset cheap, so keep it.
  The bin stream cannot use the index for its filter: it walks memberships in `(user_id, created_at)`
  order and discards live ones. Cost should track memberships after the cursor. Record the numbers
  in the log.

## State, cache, outbox

- `List.joinedAt` is required, not optional: `undefined !== null`.
- `listCache` `VERSION` 5 → 6. The blob gains the list cursors, and `readCachedLists` returns them so
  a cold start seeds state with them.
- `outbox.ts` stays at `VERSION = 1`. `list/created` is unchanged, and the reducer sets `joinedAt: null`.
- `WriteAction` excludes four reads now. The exhaustive switches need no arm for a read.

## Tests (jest)

- `listsApi`: both streams' query shapes, the keyset, and the page-size assertion.
- Reducer:
  - `lists/pageLoaded` is idempotent by id.
  - A page is inserted before an optimistic list.
  - `lists/loaded` sets the cursors.
- `reloadPages` (lists):
  - Two pages loaded plus a nudge leaves two pages loaded.
  - A failed continuation leaves state untouched.
- `hydrateLists`: an unseen list inside the loaded range is appended; one beyond it is not.
- `fetchMissingTarget`: a missing list is fetched, and the restore prompt appears instead of the
  write vanishing.
- `ListsScreen`:
  - `onEndReached` loads the next page.
  - The spinner label is "Loading more lists".
  - "Show 100+ deleted" is asserted verbatim
    ([queries-go-through-a11y-labels](../../kb/entries/queries-go-through-a11y-labels.md)).
- `ListDetailScreen`: a missing list is fetched before "List not found".

## Verification

1. **Local stack only.** Check `.env`'s `EXPO_PUBLIC_SUPABASE_TARGET` and any Metro already on 8081
   first.
2. **Seed.** Give one account about 250 live and 150 binned lists with
   [supabase/scripts/seed-lists-for-user.sql](../../../supabase/scripts/seed-lists-for-user.sql)
   (small item counts), then bin 150 by SQL.
3. **Browser checks:**
   - Lists arrive 100 at a time.
   - Scrolling to the end reaches every list.
   - "Show 100+ deleted" appears, and the bin pages as you scroll it.
   - Backgrounding and foregrounding keeps every loaded page, with no snap back to 100.
   - Share a list from a second account: it appears only when it falls in the loaded range.
   - From a second account, bin a list the first has a rename queued for offline, positioned past
     page 1 of the first's bin. Reconnect: the restore prompt appears, not a vanished write.
4. **Phone.** iOS simulator screenshots of the Lists screen only, since it is the one visibly
   changed screen: the footer spinner and the `+` toggle.
5. **Commands.** `npm test`, `npm run typecheck`, `npm run kb:audit`. The audit is expected to go red
   on the entries below, and those are left for the librarian.

## KB impact (for the librarian, not edited here)

| entry | change |
|---|---|
| scope-boundaries | paged lists are in |
| max-rows-is-a-silent-ceiling | `fetchLists` is no longer capped and has no `truncated` |
| read-rooted-at-list-members | the list read is keyset-paged, with the measured plan |
| first-fetch-replaces-list-state | `hydrate` re-reads list pages, and a failed continuation fails the hydrate |
| list-cache-holds-acknowledged-rows | cache `VERSION` 6 |
| writes-retry-from-an-outbox | 11 `Action` members, and `WriteAction` excludes four reads. Its `verify:` goes red on purpose |
| writes-can-land-on-a-tombstone | `fetchMissingTarget` fetches the list too |
| realtime-is-a-nudge-to-a-per-user-inbox | `hydrateLists` appends only within the loaded range |
| deletion-is-a-tombstone | the list bin is paged |
