# Suggestion — pagination: a first page rides with every fetch, the rest is read on scroll

**Status:** proposal, promoted the same day by `ai/tasks/11-pagination/description-step-1.md` at the
user's request. Backlog item 11 names "lists, items, list members, users"; this document covers
**items**, caps **lists** without paging them, and leaves the other two out (§6).

**Date:** 2026-09-11

**The approach is chosen, not open.** An investigation put three shapes to the user — cap-and-warn
only, split the read into "list rows" and "item pages", or embed a first page and page the rest — and
the user chose the third. Everything below is that shape. What it promises: **for a list that fits in
one page the app behaves exactly as today** — one fetch, offline cache intact, replay intact, the
restore prompt intact. Only a list that outgrows a page pays for any of the new machinery.

## 1. Why now, measured

Nothing pages today and nothing fails loudly when it should. [config.toml](../../supabase/config.toml)
sets `max_rows = 1000` (Supabase's default, so the cloud project has it too), and on PostgREST 14.5 that
is a **silent ceiling on embedded arrays as well as top-level rows**. The 1001st item on a list does not
exist as far as the app is concerned: no error, no header on the embed, nothing in the code that says
the cap exists. The acknowledged-rows cache effect then persists the truncated view, and the next
hydration replaces state with it again. Tombstones count toward the 1000, and the purge holds them 30
days ([deletion-is-a-tombstone](../kb/entries/deletion-is-a-tombstone.md)).

For a household list this is ~4–5× away — tens of lists, a few hundred rows per list including the bin.
That is the priority signal; the shape below is chosen so that the cost of being early is small.

## 2. Measurements

Local stack, PostgREST 14.5, 2026-09-11. A scratch list of 1,500 items (300 live, 100 of them done,
1,200 binned, distinct `created_at` one second apart) was seeded with `psql` as `postgres`, read through
`/rest/v1` with the service-role key, and deleted afterwards — `0` rows left on all three tables. One
account was given a temporary `writer` membership for the plan in row 8; the cascade removed it.

| # | question | measured answer |
|---|---|---|
| 1 | Does `max_rows` cap an **embedded** array? | **Yes, silently.** `lists?select=id,items(id)` on the 1,500-item list returned exactly **1000** items — no error, no `Content-Range`, nothing. The top-level `/items?list_id=eq.…` also returned 1000, at least with `Content-Range: 0-999/*`. |
| 2 | Is it a default or a ceiling? | **A ceiling.** `items.limit=1200` on the embed → 1000. Top-level `limit=1200` → 1000. Every page size in this design is therefore ≤ 1000 by construction, and an explicit limit is what makes the cap *visible* in code. |
| 3 | Does an embed take `offset`/`limit`/`order`/filters? | **Yes.** `items.offset=1000&items.limit=600` → 500. `items.deleted_at=is.null&items.order=created_at.asc,id.asc&items.limit=5` → 5 live rows, ascending by `(created_at, id)`. `items.created_at=gt.<ts>` filters the embed. |
| 4 | Can one request carry **two aliased row embeds** of `items` with different filters? | **Yes — this is the proposed `fetchLists`.** `select=id,name,deleted_at,live:items(…),bin:items(…)` with `live.deleted_at=is.null&live.limit=100` and `bin.deleted_at=not.is.null&bin.limit=100` → 100 live rows and 100 binned rows, each stream correctly filtered and ordered. |
| 5 | Can the same request also carry **counts**? | **No.** `items(count)` works alone (aliased, per-alias filters: `live:items(count)`, `done:items(count)`, `binned:items(count)` → 300 / 100 / 1200 in one request). But **mixing a `count` embed with a row embed of the same table fails** with `42803 column "items_1.created_at" must appear in the GROUP BY clause` — PostgREST groups the whole query. Counts would be a second request. §3.4 says why none is needed. |
| 6 | Does keyset continuation work through PostgREST? | **Yes.** `/items?list_id=eq.…&deleted_at=is.null&or=(created_at.gt.X,and(created_at.eq.X,id.gt.Y))&order=created_at.asc,id.asc&limit=5`, with `(X, Y)` taken from the last row of the embed in row 3, returned the next 5 rows, first strictly after the cursor. |
| 7 | How big can a bin get before the cap bites it? | The 1,200-row bin came back as **1000** through a plain `/items?deleted_at=not.is.null`. The bin is paged too. |
| 8 | What plan does the keyset query get as `authenticated` under RLS? | `Limit → Sort (created_at, id) → Bitmap Heap Scan on items`, `BitmapOr` of **two `Bitmap Index Scan on items_list_id_created_at_idx`**, both with `list_id = ?` as the leading condition; the policy is one `hashed SubPlan` over `Function Scan on my_memberships`. Cost tracks *this list's rows after the cursor*, never the table — the shape [read-rooted-at-list-members](../kb/entries/read-rooted-at-list-members.md) requires. **Measured on 1,500 rows; the 1M run is owed in staging step 1** (§4), and the `Sort` node is the thing to watch there (§7.5). |
| 9 | How many bytes is one item row? | **Computed from PostgREST's output shape, not measured.** `{"id":"<36>","title":"…","done_at":…,"deleted_at":…,"created_at":"<32>"}` plus a separator is **131 B fixed** (uuid 36, timestamp 32 as `2026-09-11T12:27:04.603824+00:00`, both seen in rows 3 and 6), plus the title, plus **4 B per `null` or 34 B per timestamp** for `done_at` and `deleted_at`. Best case 147 B; typical live row (14-char title, done) 183 B; worst realistic (40-char title, both stamped) **239 B**. |

## 3. The design

### 3.1 Two streams per list, a first page of each in the one fetch

`fetchLists` keeps its rooting at `list_members` and its `lists!inner` embed
([read-rooted-at-list-members](../kb/entries/read-rooted-at-list-members.md) is untouched) and replaces
the single `items (…)` embed with two aliased ones (measurement 4):

```ts
// src/lib/listsApi.ts
/**
 * Rows per page, from a budget of 100 kB per request: 100,000 B ÷ 239 B for the worst realistic row
 * (measurement 9) is 418, rounded down. Typical rows are ~183 B, so a full page is ~73 kB. The budget
 * assumes titles of ~40 characters or fewer — the column has no length check, so this is a promise
 * about how the app is used, not a guarantee the schema enforces (§7.8).
 */
export const PAGE_SIZE = 400;
export const MAX_ROWS = 1000;   // supabase/config.toml [api] max_rows, mirrored so the cap is visible here

const ITEM_COLUMNS = 'id, title, done_at, deleted_at, created_at';

supabase
  .from('list_members')
  .select(`role, lists!inner ( id, name, deleted_at, live:items ( ${ITEM_COLUMNS} ), bin:items ( ${ITEM_COLUMNS} ) )`)
  .is('lists.live.deleted_at', null)
  .not('lists.bin.deleted_at', 'is', null)
  .order('created_at', { referencedTable: 'lists.live' }).order('id', { referencedTable: 'lists.live' })
  .order('created_at', { referencedTable: 'lists.bin' }).order('id', { referencedTable: 'lists.bin' })
  .limit(PAGE_SIZE, { referencedTable: 'lists.live' })
  .limit(PAGE_SIZE, { referencedTable: 'lists.bin' })
  .order('created_at')
  .limit(MAX_ROWS);
```

**The supabase-js spelling of nested-alias filters and orders is the one thing here not measured** —
the raw query in measurement 4 is what has to come out the other end (`live.deleted_at=is.null`,
`live.order=created_at.asc,id.asc`, `live.limit=100`, likewise `bin.*`). If postgrest-js will not
address a two-deep alias, `listsApi` builds the query string itself for this one call; the seam rule
([supabase-client-module-boundary](../kb/entries/supabase-client-module-boundary.md)) is that only
`listsApi` knows the shape, not that it must use the builder.

**Why live and binned are separate streams rather than one chronological one.** A single
`created_at`-ordered page of a weekly-cleared list is *all tombstones*: four weeks of cleared items sort
before this week's live ones, so page 1 renders the empty state and the live rows arrive on page 2 or
3 after `onEndReached` fires into nothing. Splitting the streams makes page 1 of `live` exactly what the
screen shows with the checkbox off, and page 1 of `bin` exactly what it adds with the checkbox on.

**Why the bin still rides along.** The deletion entry's escape hatch was "a second query behind the
checkbox"; this design takes half of it. A bin of ≤ `PAGE_SIZE` rows ships as today — instant toggle,
offline restore, `restorePlan` finding the tombstone in state — and the fetch is bounded at
2 × `PAGE_SIZE` rows per list instead of unbounded. Dropping the bin embed and loading it on demand is
the follow-up if fetch size ever matters (§6); nothing below makes it harder.

**Ordering is `(created_at, id)` in both streams, server-side.** The `id` tie-break is what makes the
keyset cursor exact (§3.2). The JS sort in `toList` goes; rows arrive in order.

**Lists are capped, not paged.** `.limit(MAX_ROWS)` on the membership scan, and when the response has
exactly `MAX_ROWS` rows `fetchLists` returns `truncated: true`, which the provider turns into a
`__DEV__` warning and nothing else. Nobody is in 1,000 lists; the `(user_id, created_at)` index is
keyset-ready if that changes ([list_sharing.sql](../../supabase/migrations/20260907000000_list_sharing.sql)
says so beside its definition), and the product question — what a screen with no scroll-to-load
gesture does with page 2 — is not worth answering before the warning fires.

### 3.2 `fetchItems` — the next page of one stream

```ts
export type Cursor = { createdAt: string; id: string };

export async function fetchItems(
  listId: string,
  stream: 'live' | 'bin',
  after: Cursor | null,
  limit = PAGE_SIZE
): Promise<{ items: Item[] | null; next: Cursor | null; error: string | null }>
```

Rooted at `items`, filtered by `list_id`, `deleted_at is null` / `is not null` by stream, ordered
`created_at, id`, and continued with the `or` from measurement 6 when `after` is set. `next` is the
last row's `(created_at, id)` when the page came back **full** (`items.length === limit`) and `null`
otherwise — "a short page is the last page" is the whole termination rule, and it is why a page must
never be silently shortened by the cap: `limit` is asserted `≤ MAX_ROWS`.

**Keyset, not offset, and the tie-break is not optional.** Offset drifts here: the live stream loses
rows when someone else bins one while you scroll, so page 3 skips a row. Keyset on `(created_at, id)`
skips nothing. `created_at > X` alone would give a cleaner plan (one index scan, no sort) at the cost
of dropping a row whose `created_at` equals the cursor's — server-stamped `now()` at microsecond
resolution makes that rare, and *silently rare* is the failure mode this project has paid for before.

**This is a new read rooted somewhere other than `list_members`, and the KB says measure.** Measurement
8 has the plan shape right at 1,500 rows; staging step 1 repeats it at 1M with the seeding procedure
the KB records, as `authenticated` with a JWT claim. The `.eq('list_id', …)` is *not* the client
filtering for authorization — RLS still decides visibility, the filter picks a list — so
[list-data-scoped-by-rls](../kb/entries/list-data-scoped-by-rls.md) holds.

A second export, `fetchItem(itemId)`, reads one row by primary key — `.eq('id', …).maybeSingle()` — for
§3.5. Rows the caller may not see come back `null`, which is the right answer there.

### 3.3 State

```ts
// src/state/types.ts
export type Cursor = { createdAt: string; id: string };

export type Item = {
  id: string; title: string; doneAt: string | null; deletedAt: string | null;
  /** Server-stamped. `null` only for an optimistic row the database has not acknowledged. */
  createdAt: string | null;
};

export type List = {
  id: string; name: string; role: Role; deletedAt: string | null;
  /** Every row loaded so far, both streams, plus optimistic rows — see the ordering rule below. */
  items: Item[];
  /** Where the next page of live rows starts. `null` means every live row is in `items`. */
  nextLive: Cursor | null;
  /** The same for the bin. */
  nextBin: Cursor | null;
};
```

- **`Item.createdAt` is nullable so `item/added` does not change.** The reducer mints nothing
  ([ids-minted-outside-reducer](../kb/entries/ids-minted-outside-reducer.md)); carrying a timestamp on
  the action would change `WriteAction`, and a v1 outbox blob would replay rows with `createdAt:
  undefined`. `null` for the optimistic row, sorted last, is the same place an appended row lands
  today. **`outbox.ts` stays at `VERSION = 1`.**
- **`listCache.ts` goes to `VERSION = 4`, and it is not optional.** A v3 blob rehydrates `nextLive` as
  `undefined`, and `undefined !== null` reads as "there is more", so the first scroll asks
  `fetchItems` for a page after a cursor that does not exist. Same trap as `deletedAt` in step 9,
  same fix ([list-cache-holds-acknowledged-rows](../kb/entries/list-cache-holds-acknowledged-rows.md)).
- **One new reducer action, and `lists/loaded` stays a wholesale replace:**

  ```ts
  | { type: 'items/pageLoaded'; listId: string; items: Item[];
      stream?: { name: 'live' | 'bin'; next: Cursor | null } }
  ```

  Through `updateList`, idempotent by id — a row already present is left alone (its `doneAt` /
  `deletedAt` may have moved since), a new one is appended. `stream` sets the matching cursor;
  omitted, the cursors are untouched (§3.5 uses that). It is *not* a `WriteAction`: nothing is owed
  to the database, so it never enters the outbox and `replay` never sees it — `WriteAction` becomes
  `Exclude<Action, { type: 'lists/loaded' } | { type: 'items/pageLoaded' }>`, and the exhaustive
  switches in `send`, `listIdOf`, `supersedes`, `dropDependents` need no arm.
- **Ordering rule for `items`.** Fetched rows carry `createdAt`; optimistic rows do not. A page is
  inserted **before the first optimistic row**, not appended: a list with page 1 loaded, one item added
  offline, then page 2 loaded must render page 2 before the optimistic item, which is where it will be
  after the next hydration puts it last. The live view is then in order with no sort. The show-deleted
  view merges two streams and sorts by `(createdAt, id)` with nulls last, memoised in the screen.

### 3.4 What the screens read, and why there are no counts

`ListRow`'s "2 of 5 done" is exact only when every live row is loaded. So:

| `nextLive` | `ListRow` summary | `ShowDeletedToggle` label |
|---|---|---|
| `null` | `${countDone(list)} of ${liveItems(list).length} done` — unchanged | `Show ${binned} deleted` — unchanged |
| a cursor | `${liveItems(list).length}+ items` | `Show ${binned}+ deleted` when `nextBin` is set |

Measurement 5 says exact counts cost a second request per hydration, rooted at `list_members` to keep
the read cheap, for a number that is only *displayed*. "400+ items" is true, free, and becomes exact
the moment the user scrolls the list to its end — which is also when `nextLive` becomes `null` and the
row reverts to today's copy. Nothing in the reducer counts anything.

`ShowDeletedToggle` gains a `more: boolean` prop for the `+`. It still renders only when the bin is
non-empty, and `binned > 0` is still answerable from state because page 1 of the bin is embedded.

### 3.5 The blocked write whose target is not loaded

This is the one interaction that fails **silently** under paging, and it is the reason `fetchItem`
exists. The provider's `target_deleted` branch runs `hydrate()` and then `setBlocked`; `restorePlan`
reads the tombstone out of state, and an empty plan means *discard the write*
([writes-can-land-on-a-tombstone](../kb/entries/writes-can-land-on-a-tombstone.md)). With a bin larger
than a page, the item somebody else binned may not be in page 1 of the bin, the plan comes back empty,
and the user's write is dropped with no banner.

The fix stays inside the provider and leaves `write_outcome`, `restorePlan` and `BlockedBanner` as they
are: after `await hydrate()` and before `setBlocked`, if the op names an item (`itemIdOf` is private to
`restorePlan.ts`; export it) and that id is not in the target list's `items`, `await fetchItem(id)` and
dispatch `items/pageLoaded { listId, items: [row] }` with no `stream`. A row the caller cannot see
comes back `null`, and the plan is empty for the same reason it is today — purged, or the account was
removed. The KB entry's ordering rule — the fetch *before* the announcement — now covers two fetches.

The list-level tombstone needs none of this: list rows are never paged.

### 3.6 Hydration re-reads what was loaded

`lists/loaded` replaces state wholesale, on every foreground, every nudge and every rollback
([first-fetch-replaces-list-state](../kb/entries/first-fetch-replaces-list-state.md)). Left alone, a
nudge while the user is three pages into a list would shrink it to page 1 and jump the scroll — and
long lists are precisely where nudges are most frequent.

**The rule: `hydrate` re-reads, per list, as many rows of each stream as were loaded before.** After
`fetchLists` returns, for each fetched list whose previous state held more than `PAGE_SIZE` rows of a
stream, `hydrate` calls `fetchItems(listId, stream, next, PAGE_SIZE)` **one page at a time**, following
each page's cursor, until it holds at least as many rows as before or the stream ends — every request
is one page, so every request stays under the budget — and concatenates, then dispatches one
`lists/loaded` with `replay(expanded, queue)` and caches `expanded`. All of it happens **above the reducer**, beside `replay`, where the KB
already keeps the one merge the app has; the reducer still sees a wholesale replace. The provider reads
"previously loaded" from a `lists` ref mirrored from state, not from a `useCallback` dependency —
`hydrate` is a dependency of `flush`, which is a dependency of everything, and re-creating that chain on
every render is how the effects above it start re-subscribing.

`hydrate` already holds `fetching` for its whole duration, so the extra requests sit inside the same
guard: no flush overlaps them. **If a continuation fails, that list falls back to page 1 for this
hydration** — a snap-back for one list, repaired by the next scroll. Keeping the previous state's rows
beyond page 1 is not an option: it would splice stale rows onto fresh ones, which is the merge the KB
forbids, and the outcome would be a list that is half server truth with nothing to say which half. The realtime payload's `listId` stays **unused** — the rule is "re-read
what is loaded", which needs nothing the nudge carries, and
[realtime-is-a-nudge-to-a-per-user-inbox](../kb/entries/realtime-is-a-nudge-to-a-per-user-inbox.md)
keeps its "do not enrich, do not apply" line intact.

**Snap-back is the acceptable fallback.** If re-expansion proves hairy, staging step 3 may ship with
`hydrate` resetting every list to page 1 and let `onEndReached` reload on scroll — correct, just
jumpy — and step 4 adds the re-read. Do not skip it: a long list is the whole point of the feature.

### 3.7 UI

- **`ListDetailScreen`**: `onEndReached={() => loadMore(listId)}` with `onEndReachedThreshold`
  around `0.5`, a `ListFooterComponent` spinner while a page is in flight, and `loadMore` on the
  context: it fetches the next page of `live`, and of `bin` too when the checkbox is on, dispatches
  `items/pageLoaded`, and is a no-op while a page for that list is already in flight or the cursor is
  `null`. A page is a **read**, so `loadMore` needs none of `refresh`'s guards — but a page that lands
  *during* a `hydrate` would be re-read by the rule in §3.6 anyway, so it is fine to let them overlap.
- **`ListsScreen`**: no scroll-to-load. It reads the summary rule in §3.4 and nothing else changes.
- **`ShowDeletedToggle`**: the `more` prop. Its doc comment ("ticking this is instant: no spinner and
  no round trip") stays true for page 1 and needs a clause for the rest.
- **Copy**: `${n}+ items` and `Show ${n}+ deleted` are asserted verbatim in tests, as every empty-state
  and label string is ([queries-go-through-a11y-labels](../kb/entries/queries-go-through-a11y-labels.md)).

## 4. Staging

1. **Make the cap loud** — `MAX_ROWS`, `.limit(MAX_ROWS)` on the membership scan, `truncated` on
   `fetchLists`'s result, the `__DEV__` warning. Ships alone and is worth having even if nothing else
   lands. In the same step, **measure `fetchItems` at 1M rows** as `authenticated` (§3.2, §7.5) — the
   seed and the pitfalls are in [read-rooted-at-list-members](../kb/entries/read-rooted-at-list-members.md).
2. **API** — the two-stream embed, `fetchItems`, `fetchItem`, `Cursor`, `PAGE_SIZE`; `toList` stops
   sorting and starts reading `next` off a full page. `listsApi.test.ts` asserts the query shapes.
3. **State and provider** — `Item.createdAt`, `List.nextLive`/`nextBin`, cache `VERSION = 4`,
   `items/pageLoaded`, the insert-before-optimistic rule, `loadMore`, the `fetchItem` step in the
   `target_deleted` branch (§3.5). `hydrate` may snap back to page 1 here.
4. **Hydration re-expansion** (§3.6), with a test that a nudge arriving with two pages loaded leaves
   two pages loaded.
5. **UI** — `onEndReached`, the footer spinner, the summary and toggle copy.
6. **Verify in the browser** with a seed like §2's but bigger — 1,000 live rows and 1,200 binned, so
   both streams page — against a real account: scroll the list to its end and watch the summary flip
   from `400+ items` to `N of 1000 done`; tick the checkbox on the bin and scroll it; from a second
   browser, bin an item beyond page 1 of the first while the first has a rename of it queued offline,
   reconnect, and confirm the restore prompt appears rather than the write vanishing. Read the size of
   one page off the network panel while there: it should sit near 73 kB and never cross 100 kB.

## 5. Settled, having been open

1. **Shape B** — first page embedded, rest on scroll — over cap-only and over splitting the read.
   Chosen by the user from the investigation.
2. **Lists are capped, not paged**, with a dev-only warning at the cap. §3.1.
3. **No server counts; `N+` copy instead.** Measurement 5 made counts a second request; the row
   summary is display-only and becomes exact on scroll. §3.4.
4. **The bin's first page still ships with every fetch.** Half of the deletion entry's escape hatch,
   keeping the offline bin and the instant toggle for bins of one page. §3.1.
5. **Keyset with an `id` tie-break, not offset.** §3.2.
6. **`PAGE_SIZE` is derived from a budget of 100 kB per request, with one page per request as the
   unit.** 400 rows, from measurement 9's worst realistic row. The budget is about a *page*; the
   hydration fetch carries one page of each stream for every list and is not itself budgeted — that
   was put to the user and the answer was to size the page, not the fetch. §3.1, §3.6.

## 6. What this does not solve

- **`list_members_of` and `fetchMembers` are unbounded** — the roster RPC. Rosters are the people a
  household shares a list with; the cap is three orders of magnitude away and the RPC is not a
  PostgREST table read, so paging it is a different piece of work. Backlog 11 also says "users"; there
  is no user listing in the app to page.
- **A user in more than 1,000 lists sees 1,000** and a developer sees a warning. §3.1.
- **Exact counts for a long list** are one scroll away rather than in the row. §3.4.
- **Fetch size for large bins** is bounded, not minimised: `PAGE_SIZE` tombstones per list per
  hydration. Dropping the `bin` embed and loading it on the first tick of the checkbox is the follow-up,
  and §3.5 already stops depending on the tombstone being in state.
- **Not measured:** the 1M plan for `fetchItems` (owed, step 1), postgrest-js's spelling of the nested
  alias filters (§3.1), and `fireEvent(…, 'endReached')` reaching a `FlatList` handler under RNTL 14 —
  the event walks up to the nearest element with an `onEndReached` prop, which should be the
  `FlatList`; if it is not, the list gets an `accessibilityLabel` and the test fires on that.

## 7. Issues, ranked

1. **A blocked write is silently discarded when its target is beyond page 1 of the bin** — §3.5. Not a
   regression of anything visible; a *new* silent path that only exists once bins can exceed a page.
   It is why `fetchItem` is in step 3 rather than a later one, and the two-browser check in step 6 is
   there to prove it.
2. **`nextLive: undefined !== null` is `true`.** Cache `VERSION = 4` or the first scroll after the
   upgrade sends a page request with no cursor. Same family as step 9's `deletedAt`.
3. **Hydration re-expansion is the intricate part**, and it interacts with three refs (`fetching`,
   `flushing`, the mirrored `lists`) and one rule the KB guards (`lists/loaded` is a replace). §3.6 keeps
   the merge above the reducer for exactly the reason `replay` lives there. Snap-back first if needed.
4. **The audit will go red on purpose, twice.** [deletion-is-a-tombstone](../kb/entries/deletion-is-a-tombstone.md)'s
   `verify:` asserts `listsApi` sends no `deleted_at` filter — `fetchItems` sends one, and that claim
   becomes false *correctly*. [list-cache-holds-acknowledged-rows](../kb/entries/list-cache-holds-acknowledged-rows.md)
   pins `VERSION = 3`. Neither is a reason to bend the code; both are entries for the librarian (§8).
5. **The keyset plan has a `Sort` node** (measurement 8): a bitmap scan loses index order, so every page
   sorts *every live row after the cursor* before the `Limit`. At 300 rows it is nothing; at a
   10,000-row list it is a 10,000-row sort per page. If the 1M run shows it, the fix is `create index on
   public.items (list_id, created_at, id)` replacing the two-column index so the planner can walk it in
   order — one migration, no query change. Decide from the measurement, not from this paragraph.
6. **Ordering of the show-deleted view depends on `createdAt`, and the two streams load unevenly.**
   Sorting in the screen is the fix; forgetting it interleaves page 2 of `live` after page 1 of `bin`.
   A test with both streams past page 1 catches it.
7. **A page inserted after the optimistic tail** renders page 2 below an item added a minute ago. The
   insert-before-optimistic rule in §3.3; a reducer test with an optimistic row then a page.
8. **The 100 kB page budget rests on titles staying short.** `items.title` is checked only for
   `length(trim(title)) > 0`; one 5,000-character title is a 5 kB row, and twenty of them break the
   budget on their own. Measurement 9 assumes ~40 characters. Making the budget a guarantee rather than
   an expectation is one line — `alter table public.items add constraint items_title_length check
   (length(title) <= 200)` — and one `23514` for the `humanize` map, but it is a schema change with its
   own migration and is **not** in this step unless the user asks. Note the other direction too: at
   400 rows the weekly-cleared list's bin (~200 rows in 30 days) fits in a page, so ordinary lists never
   page at all, and the hydration fetch for a list is bounded at 2 × 400 rows rather than unbounded.
9. **`max_rows` is a Supabase config value, and `config push` sends the whole root**
   ([supabase-config-push-sends-the-whole-root](../kb/entries/supabase-config-push-sends-the-whole-root.md)).
   Nothing here changes it, and `MAX_ROWS` in `listsApi` must be kept equal to it by hand — a comment
   beside each pointing at the other.
10. **`loadMore` and `hydrate` can overlap**, and that is allowed (§3.7): a page that lands during a
    hydration is either included in the re-read or duplicated by id and dropped. What must *not*
    overlap is still flush and fetch, and nothing here touches that guard.

## 8. KB impact — hand these to the librarian, do not edit the entries

| entry | what changes |
|---|---|
| [deletion-is-a-tombstone](../kb/entries/deletion-is-a-tombstone.md) | "the bin ships with every fetch" becomes "the first page of it does"; its `verify:` forbids a `deleted_at` filter in `listsApi` and must be rewritten; its escape hatch is half taken |
| [list-cache-holds-acknowledged-rows](../kb/entries/list-cache-holds-acknowledged-rows.md) | cache `VERSION` 3 → 4 with §7.2 as the reason; outbox stays 1, third worked example |
| [first-fetch-replaces-list-state](../kb/entries/first-fetch-replaces-list-state.md) | `lists/loaded` is still a replace, but `hydrate` now makes more than one request and the merge of re-read pages joins `replay` above the reducer |
| [read-rooted-at-list-members](../kb/entries/read-rooted-at-list-members.md) | a second read of list data, rooted at `items`, with its measured plan; and the fact that `max_rows` silently caps embeds |
| [writes-can-land-on-a-tombstone](../kb/entries/writes-can-land-on-a-tombstone.md) | the "fetch before announce" rule now covers a targeted `fetchItem` as well |
| [realtime-is-a-nudge-to-a-per-user-inbox](../kb/entries/realtime-is-a-nudge-to-a-per-user-inbox.md) | unchanged in rule, worth a line: the payload's `listId` is still unused *even with pages*, because re-reading what is loaded needs nothing from it |
| [scope-boundaries](../kb/entries/scope-boundaries.md) | step 11 row; roster paging and lists paging stay out |

A likely new entry: *`max_rows` is a silent ceiling on embeds* — the measured fact that no error, no
header and no client-side `limit` reveals it, with `MAX_ROWS` as the mirror that keeps it visible.
