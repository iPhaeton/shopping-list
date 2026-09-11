# Implementation log — step 1: pagination

**Date:** 2026-09-11. Description: [description-step-1.md](description-step-1.md). Proposal:
[ai/suggestions/pagination.md](../../suggestions/pagination.md) (shape B, chosen by the user).
Plan: the approved plan-mode file (not checked in).

A list's items now arrive as **two streams with a first page of each** — `live` and `bin`, 400
rows apiece, ordered `(created_at, id)` on the server — and the rest of either stream is read on
scroll with a keyset cursor. Lists are capped at `MAX_ROWS` and not paged. Hydration re-reads as
many pages as were loaded before, one page per request, so a nudge does not shrink a scrolled list.
A blocked write whose tombstone is beyond the loaded bin gets one targeted read before the prompt.
For a list that fits in a page nothing observable changed.

## What was built

| File | |
|---|---|
| `src/lib/listsApi.ts` | `MAX_ROWS = 1000`, `PAGE_SIZE = 400`; `fetchLists` embeds `live:items(…)` and `bin:items(…)` filtered/ordered/limited two embeds deep, `.limit(MAX_ROWS)`, returns `truncated`; `toList` keeps server order (no JS sort) and leaves a cursor on a full page; `fetchItems(listId, stream, after, limit)` — keyset `or` **plus a redundant `gte`** (see decisions); `fetchItem(id)` by primary key |
| `src/state/types.ts` | `Item.createdAt: string \| null` (required); `Cursor`, `Stream`; `List.nextLive` / `nextBin` (required); `items/pageLoaded` action; `WriteAction` excludes it |
| `src/state/listsReducer.ts` | `items/pageLoaded` arm — idempotent by id, inserts before the first optimistic row, moves the named cursor, identity-preserving no-op; `inCreationOrder` |
| `src/state/reloadPages.ts` | new — the re-expansion loop, pure over a `fetchPage` callback, folding pages through the reducer; snap-back on a failed page |
| `src/state/ListsContext.tsx` | `hydrate` returns `{ error, lists }` and re-expands via `reloadPages`; `foldPage` (a page, then the outbox re-dispatched over it); `fetchMissingTarget` in the `target_deleted` branch; `loadMore(listId, includeBin)` on the context; `listsRef` / `paging` refs; `__DEV__` warning on `truncated` |
| `src/lib/listCache.ts` | `VERSION = 4` |
| `src/state/restorePlan.ts` | `itemIdOf` exported |
| `src/components/ShowDeletedToggle.tsx` | `more` prop → `Show ${n}+ deleted` |
| `src/components/ListRow.tsx` | `${n}+ items` while `nextLive` is set |
| `src/screens/ListDetailScreen.tsx` | both views through `inCreationOrder`; `onEndReached` only while there is a cursor; footer `ActivityIndicator` "Loading more items"; toggle `more` |
| `supabase/config.toml` | comment beside `max_rows` pointing at `MAX_ROWS` (value unchanged) |
| 15 suites | 46 new tests (252 → 298); new `listCache.test.ts`, `reloadPages.test.ts`; `listsApi.test.ts` stub replaced by a recording chainable builder |

Untouched on purpose: **every policy and every migration** (no index change — measured, below),
`outbox.ts` (`VERSION` stays 1; `item/added` still carries no timestamp), `replay.ts`, `send()`,
`supersedes`, `dropDependents`, `BlockedBanner`, `write_outcome`, `restorePlan`'s logic.

## Decisions

**The keyset query carries a redundant `created_at >= cursor` beside the `or`, and that — not an
index — is what the 1M-row measurement decided.** Seeded 1,009,904 items over 10,002 lists (one of
10,000 rows, half binned; memberships over 5,000 accounts, `n_distinct ≈ −0.5`), `explain
(analyze, buffers)` as `authenticated` with a JWT claim, cursor in the middle of each stream,
page of 400:

| shape | index | index cond | rows removed | buffers | time |
|---|---|---|---|---|---|
| `or` only | `(list_id, created_at)` | `list_id` | 5,401 | 121 | 3.2 ms |
| `or` + `>=` | `(list_id, created_at)` | `list_id, created_at >=` | 402 | 23 | 0.40 ms |
| `or` + `>=` | `(list_id, created_at, id)` | same | 401 | 22 | 0.48 ms |
| `or` + `>=` | partial per stream | same | 1 | 19 | 0.51 ms |

The bare `or` form walks the list from its first row and filters — cost tracks the cursor's
*position*, so a full scroll is quadratic in list length. The `gte` turns the index condition into
a range starting at the cursor, and cost tracks the page. The planner already walks the two-column
index in order; the `Sort` the proposal feared (§7.5) is an **Incremental Sort** over
equal-`created_at` groups, 27 kB, and the three-column index removes the node without moving a
buffer. Partial per-stream indexes touch 19 buffers instead of 22. Neither is worth a migration
today; the signal for the partials is a list whose bin dwarfs its live rows *and* is paged often.
`fetchItem` by primary key: 7 buffers, 0.26 ms.

**`hydrate` returns what it dispatched.** The blocked-write branch needs "is the tombstone in
state now" and must not wait for React to commit; reading a ref mirrored by an effect would be one
commit behind. So `hydrate` returns `{ error, lists }`, and the branch checks `loaded` directly.

**A page gets the outbox re-dispatched over it (`foldPage`).** Found in the browser test's unit
twin: the tombstone fetched for a blocked write arrived without the queued tick on it, because
`hydrate` replays the outbox and a bare `items/pageLoaded` does not. What the screen shows is
server truth with the outbox on top, for a page as for a fetch. Done by re-dispatching every
queued op after the page rather than by `replay(...)` + `lists/loaded`, because a page lands on
whatever state holds *now* and a wholesale replace from a possibly stale base would drop a page
that landed a moment earlier. Every write action is idempotent by id, which is what makes
re-applying them safe.

**Both views are sorted in the screen, not only the show-deleted one.** `items` is two streams end
to end plus optimistic rows, and a row restored from the bin keeps its array position — between
page 1 and page 2 of the live rows. One memoised `inCreationOrder` covers both. The
insert-before-optimistic rule in the reducer stays, so array order is sane for anything not
sorting.

**`reloadPages` is a pure function over a `fetchPage` callback**, in `src/state/` beside `replay`,
folding each page through `listsReducer` with `items/pageLoaded`. Only database-stamped rows
(`createdAt !== null`) count as "loaded before", so an optimistic row never triggers a page that
was never read. A failed continuation snaps that list back to the fetched page 1 and leaves the
others.

**A failed page is silent.** Cursor untouched, spinner stops, the next `onEndReached` retries.
`error` in the context means a refused write.

**Two streams, and the bin's first page still ships.** As proposed: a one-stream chronological
page of a weekly-cleared list would be all tombstones. A 2-page fetch measured 134.6 kB for a
2,203-row list (~67 kB per page with short titles) — under the 100 kB-per-page budget.

## Problems hit

### 1. A KB `verify:` counts `dispatch(op);` against `void enqueueOp(op);`

`writes-retry-from-an-outbox` asserts every dispatched write is enqueued by counting the two
literals. `foldPage`'s loop was `for (const op of queue.current) dispatch(op);` — one extra
match for ops that are *already* queued — and the audit went red on a true invariant. Renamed the
loop variable to `queued`, which also says what it is. The same entry counts `Action` members with
`grep -c '^  | { type:'` and read **8**; the true count is now **9** — `items/pageLoaded` is
written across lines and does not match. Handed to the librarian rather than reformatted to trip
it.

### 2. A programmatic scroll jump leaves the web `FlatList` blank

`el.scrollTop = el.scrollHeight` in Playwright scrolls the container to the end, but
`VirtualizedList` renders towards the new position in batches of ten per scroll event; one jump
left the render window at rows 1–10 with 80,000 px of blank space below and `onEndReached` never
fired. `page.mouse.wheel` in 1,500 px steps with 300 ms waits behaves like a person and paged the
bin three times. Not an app bug — nothing a hand can do jumps like that — but the next browser
probe of a long list should scroll, not teleport. Also: `page.goBack()` leaves the app (React
Navigation keeps one URL), and `locator.fill()` on the row's rename field detached its Save button
mid-way (the editor closed); clicking the field and `keyboard.type` + Enter worked.

### 3. A bin of exactly three full pages costs a fourth request

1,200 tombstones is 3 × 400, so the third page came back full and left a cursor; the fourth request
returned one row (the tombstone alise had just made) and cleared it. That is "a short page is the
last page" working as specified, noted so nobody debugs it: the client cannot know a full page is
the last one.

## How it was verified

**Automated:** 298 tests across 15 suites, `tsc --noEmit` clean, `npm run kb:audit` at **2
errors** — exactly the two the proposal predicted (below). `fireEvent(row, 'endReached')` reaches
the `FlatList` handler under RNTL 14 from a row inside it; no `accessibilityLabel` on the list was
needed.

**Measured before writing the API** (the two things the proposal left open): PostgREST 14.5
accepts a two-deep alias path from the `list_members` root
(`lists.live.deleted_at=is.null&lists.live.order=…&lists.live.limit=…`), and postgrest-js spells it
through the builder since `referencedTable` is concatenated verbatim; the keyset `or` needs its
timestamp and id **double-quoted**. The scale seed above was deleted by marker afterwards
(`name like 'seed-%'`, cascade), the index recreated under its original name, the 10,020
`realtime.messages` the cascade fanned out to fake accounts removed; counts back to 2 / 4 / 3 / 2.

**End to end in the browser** against the local stack, driven with Playwright, signed in as
**bob, a writer**, on a list seeded with 1,000 live (334 done) + 1,200 binned rows:

| | |
|---|---|
| lists screen | `bob list, 400+ items, shared with you`; the fetch is the designed URL, 134.6 kB for 400 + 400 rows |
| open the list | 400 rows, `Show 400+ deleted` |
| scroll to the end | two keyset requests with `gte` + quoted `or`; the last three rows are the pre-existing items; no spinner left |
| reload the tab | the cache held three pages, so mount re-read pages 2 and 3, and the row reads **`334 of 1003 done`** — psql agrees |
| tick the bin, scroll | `Show 400+` → `800+` → `1200+` → **`Show 1200 deleted`** |
| abort `**/127.0.0.1:54321/**`, rename "Item 1" | *1 change will sync when you're back online*; bob's `outbox:` holds one `item/renamed` |
| as alise, `set_item_deleted` on that item via psql with her JWT claim | it is tombstone **#1201** in the bin — beyond every page bob holds |
| lift the route, fire `online` | `rename_item` → `target_deleted` → `list_members` fetch → four re-reads → **`items?id=eq.d3a68238…`** → *"That item is in the bin. Restore it and keep your change?"*; outbox still holds the write |
| "Restore and keep my change" | prompt gone, outbox empty, no error; psql: title renamed, `deleted_at` null |

Console: only react-native-web's pre-existing `pointerEvents` deprecation and the five aborted
retries while offline; no `MAX_ROWS` warning (one list). Cleanup: title restored, the 2,200 seed
rows deleted, the tab reloaded to `0 of 3 done`. Screenshots and bodies in `.playwright-mcp/`
(gitignored).

## KB impact — handed to the librarian, not edited here

Two `verify:` commands fail, both for facts that moved correctly:
[deletion-is-a-tombstone](../../kb/entries/deletion-is-a-tombstone.md) forbids a `deleted_at`
filter in `listsApi` — `fetchItems` and the two embeds send one, and "the bin ships with every
fetch" is now "the first page of it does"; its escape hatch is half taken.
[list-cache-holds-acknowledged-rows](../../kb/entries/list-cache-holds-acknowledged-rows.md) pins
`VERSION = 3`; it is 4, for `nextLive`/`nextBin` (`undefined !== null` reads as "there is more"),
and the outbox stayed at 1 a third time.

Prose that moved without tripping a check:

- [read-rooted-at-list-members](../../kb/entries/read-rooted-at-list-members.md) — a second read
  of list data rooted at `items`, with the plan table above; `max_rows` silently caps embeds; the
  redundant `gte` is what makes keyset cheap, not the index.
- [first-fetch-replaces-list-state](../../kb/entries/first-fetch-replaces-list-state.md) —
  `lists/loaded` is still a replace, but `hydrate` makes up to *k* requests per list, returns
  `{ error, lists }`, and `foldPage` puts the outbox over a page by re-dispatch.
- [writes-can-land-on-a-tombstone](../../kb/entries/writes-can-land-on-a-tombstone.md) — "fetch
  before announce" is two fetches now (`fetchMissingTarget`).
- [writes-retry-from-an-outbox](../../kb/entries/writes-retry-from-an-outbox.md) — `Action` has
  nine members, `WriteAction` still seven; the `dispatch(op)`-count check and problem 1.
- [realtime-is-a-nudge-to-a-per-user-inbox](../../kb/entries/realtime-is-a-nudge-to-a-per-user-inbox.md)
  — the payload's `listId` is still unused even with pages.
- [queries-go-through-a11y-labels](../../kb/entries/queries-go-through-a11y-labels.md) — new
  labels: `Loading more items`, `Show N+ deleted`, `N+ items`; `fireEvent(row, 'endReached')`.
- [supabase-local-stack](../../kb/entries/supabase-local-stack.md) — the seeding pattern
  (`session_replication_role = replica` skips the notify triggers and FK checks; delete by marker,
  not `db reset`) and problem 2's Playwright traps.
- [scope-boundaries](../../kb/entries/scope-boundaries.md) — step 11 row; roster and lists paging
  stay out.

A likely new entry: *`max_rows` is a silent ceiling on embeds* — measured, no error and no header,
`MAX_ROWS` as the mirror that keeps it visible, and the `gte` beside a keyset `or` as the query
shape that makes paging cost a page.

## What this does not solve

- **An item added to a list longer than a page lands beyond the loaded pages after the next
  hydration** — server order is `created_at asc`, so it is one scroll away and the row reads
  `N+ items`. Inherent in the chosen ordering (§3.1, §5.5 of the proposal).
- **A nudge on a list with *k* pages loaded costs *k* sequential requests** inside one `hydrate`.
- **Fetch size for large bins is bounded, not minimised**: 400 tombstones per list per fetch.
  Dropping the `bin` embed and reading it on the first tick of the checkbox is the follow-up.
- **`items.title` has no length check**; the page budget assumes ~40-character titles. A migration
  only if asked.
- **Roster (`list_members_of`) and lists themselves are not paged.**
- **Nothing to push to cloud** — no migration this step; the `config.toml` change is a comment.
