# Implementation log — step 2: items fetched only on entering a list

**Date:** 2026-09-12. Description: [description-step-2.md](description-step-2.md). Plan: the
approved plan-mode file (not checked in).

Step 1 embedded a first page of a list's `live` and `bin` items in `fetchLists`, so the Lists
screen fetched item rows for **every** list on every load — laggy, and the thing this step
reverses. `fetchLists` is now list metadata only (`id, name, deleted_at`); a list's items — both
streams, first page of each — are read by `ListDetailScreen` the moment it opens that list, via
the same `fetchItems` keyset read step 1 already built for scrolling. Everything downstream of
"items are known" is unchanged: `onEndReached` paging, the bin toggle, the blocked-write restore
prompt, the offline outbox.

## What was built

| File | |
|---|---|
| `src/state/types.ts` | `List.itemsLoaded: boolean` — `false` until a list's first page has arrived, `true` immediately for a locally-created list (nothing on the server to fetch); new read action `items/firstPageLoaded { listId, live: {items, next}, bin: {items, next} }`, excluded from `WriteAction` like the other two reads |
| `src/state/listsReducer.ts` | `list/created` sets `itemsLoaded: true`; `items/firstPageLoaded` arm — idempotent on `itemsLoaded`, dedupes both streams against what's already there, inserts before the first optimistic row, flips the flag; the insert-before-optimistic logic factored out of `items/pageLoaded` into `insertFetchedItems`, shared by both arms |
| `src/lib/listsApi.ts` | `fetchLists` drops both item embeds and everything that only existed for them — six `.is`/`.not`/referenced-table `.order`/`.limit` calls gone, down to `role, lists!inner(id, name, deleted_at)`; `toList` returns `itemsLoaded: false, items: [], nextLive: null, nextBin: null` for every row; `fetchItems`/`fetchItem`/`PAGE_SIZE`/`MAX_ROWS` untouched |
| `src/state/reloadPages.ts` | `FetchPage`'s `after` widens to `Cursor \| null`; skips a list outright when it wasn't `itemsLoaded` before; the re-expansion loop's stopping condition changes from "cursor is null" to an explicit `exhausted` flag, since `null` now means "haven't asked yet" on the first iteration rather than "stream ended"; flips `itemsLoaded` true once both streams are caught up, even when neither needed a fetch |
| `src/state/ListsContext.tsx` | new `loadListItems(listId)` — fetches both streams from `null` via `Promise.all`, dispatches `items/firstPageLoaded` through `foldPage` only if **both** succeed; `hydrate` now also writes `listsRef.current` synchronously at dispatch time (see Problems hit #1); `foldPage`'s parameter type widens to the two read-action types |
| `src/components/ListRow.tsx` | drops `countDone`/`liveItems`/the summary line entirely — a row shows only its name (and "Shared with you"); label is `list.name` or `\`${list.name}, shared with you\`` |
| `src/screens/ListDetailScreen.tsx` | new mount `useEffect` calling `loadListItems` while `!list.itemsLoaded`; a full-screen loading spinner (`"Loading list items"`, mirroring `ListsScreen`'s `status === 'loading'` pattern) gates everything below the header until it resolves |
| `src/lib/listCache.ts` | `VERSION = 5` |
| 9 suites | fixture and assertion updates for the new field/action across `listsReducer`, `reloadPages` (substantially rewritten — its fixtures assumed page 1 arrived free), `listsApi`, `listCache`, `replay`, `restorePlan`, `ListsContext`, `ListsScreen`, `ListDetailScreen`, `SharingScreen`; net test count 309 (was 298) |

Untouched: every migration and policy (this is a client-side `select` trim, nothing else), the
keyset shape and the redundant `gte` in `fetchItems`, `outbox.ts` (`VERSION` stays 1), `replay.ts`,
the blocked-write flow's ordering rules.

## Decisions

**One `itemsLoaded` flag on `List`, covering both streams, not two.** Every consumer only ever
asks "has this list's data arrived" — the fetch is always both streams together, which is also
what preserves the offline-restore/instant-toggle guarantee step 1 built for the bin, just moved
from "every list fetch" to "list-entry fetch." A tri-state cursor (`Cursor | null | undefined`)
was the alternative; rejected because it would have made `nextLive`/`nextBin` mean three things
depending on context, whereas a dedicated boolean is one fact answered once.

**One combined `items/firstPageLoaded` action, not two `items/pageLoaded` dispatches plus a flag
flip.** The failure mode to avoid is a half-loaded list — live succeeded, bin failed — reading as
loaded. `loadListItems` only ever constructs the action after confirming both `fetchItems` calls
returned non-null, so the reducer never has to reason about partial state, and there is no
observable moment where live rows are in state but `itemsLoaded` is still false.

**`list/created` sets `itemsLoaded: true` immediately.** A list that does not exist on the server
yet has nothing to fetch; waiting would show a spinner for a list the user just named. This also
kept `ListDetailScreen.test.tsx`'s primary harness (which creates its fixture list through the
real `createList` flow) working with no changes — confirmed rather than assumed, since the plan
flagged it as worth checking.

**`ListRow` shows only the name — no count, no `N of M done`, no `N+ items`.** Put to the user
during planning rather than decided unilaterally: the alternative (a count-only embed added back
to `fetchLists`, using the `items(count)` shape step 1's proposal measured as viable) would have
kept exact counts at the cost of a second query shape on the one path this step exists to make
lean. The user chose to drop counts.

**A visited list stays "warm" for the rest of the session — `itemsLoaded` is never reset on
unmount.** Also put to the user explicitly, because it has a real cost: a realtime nudge's
`hydrate → reloadPages` now re-expands every list opened this session, not only the one on screen,
since nothing tracks "currently visible" versus "visited earlier." Confirmed as the better
trade-off than forgetting on navigate-away (which would make every return visit pay a fresh fetch)
given it is still far cheaper than today's baseline, where every nudge re-embeds items for every
list the account is a member of regardless of whether it was ever opened.

## Problems hit

### 1. `loadListItems`, called from a mount effect, raced the ref that mirrors state

`loadListItems` (like `loadMore` before it) reads `listsRef.current` — a ref kept in sync by
`useEffect(() => { listsRef.current = state.lists }, [state.lists])` — to check whether the list
exists and is already loaded, without needing `state.lists` in its own dependency array. That
pattern is safe for `loadMore`, which only ever fires from a user's scroll, long after the ref has
settled. It is not safe for a screen's own **mount** effect: `ListDetailScreen`'s new effect
(calling `loadListItems`) and the provider's ref-mirroring effect can both be scheduled by the
*same* commit (the one where `hydrate`'s `dispatch({ type: 'lists/loaded', ... })` first makes the
list appear), and React fires a child's effects before its parent's. So `ListDetailScreen`'s
effect could run while `listsRef.current` still held the *previous* commit's (empty) array —
`loadListItems` would find no list, return, and silently never fetch anything.

Caught by a test that checked `fetchItems` was called with `('l1', 'live', null)` and found zero
calls despite the loading spinner correctly rendering (the spinner reads `list.itemsLoaded`
straight from context, not from the ref, so it was never wrong — only the fetch triggered from
inside the ref-dependent guard was). The unconsumed `mockImplementationOnce` pair from that failed
test then leaked into three unrelated tests further down the file (`describe('a list longer than a
page', ...)`), which is why the failure showed up as missing "Eggs" rows in tests that never
touched the entry-loading code at all — a reminder that a queued-once mock left unconsumed by a
failing test is a liability for whatever runs next in the same file.

This is the exact trap `hydrate` already has a documented workaround for on its *return value*
("`hydrate` returns what it dispatched... reading a ref mirrored by an effect would be one commit
behind" — see [first-fetch-replaces-list-state](../../kb/entries/first-fetch-replaces-list-state.md)),
just not previously on the ref itself. Fixed the same way: `hydrate` now also assigns
`listsRef.current = loaded` synchronously, immediately after dispatching, so the ref is correct
before React even begins the commit/effect cycle — independent of effect ordering entirely. The
generic mirroring `useEffect` stays (other dispatch sites still rely on it, and none of them race a
same-commit child mount effect the way this one did).

### 2. `reloadPages`' loop needed a real logic change, not just a type change

The old loop's sole stopping condition was `next !== null`, which worked because a fresh fetch
always carried page 1 for free — `next` only became `null` by *exhausting* a stream. Once
`fetchLists` carries nothing, `next` legitimately starts `null` meaning "haven't asked yet," so the
same condition would skip every re-expansion on the very first iteration. Replaced with an
explicit `exhausted` boolean, set only when a page comes back short — the first iteration always
runs (fetching page 1), and only a later short page stops the loop. Covered by two new
`reloadPages.test.ts` cases: re-expansion starting from page 1, and a previously-loaded-but-empty
list correctly ending up `itemsLoaded: true` with zero fetch calls.

## How it was verified

**Automated:** 309 tests across 15 suites (298 → 309, all net-new in `listsReducer.test.ts`'s
`items/firstPageLoaded` block, `reloadPages.test.ts`'s rewritten fixtures, and two new
`ListsContext.test.tsx`/`ListDetailScreen.test.tsx` describe blocks for the entry-loading
mechanism), `tsc --noEmit` clean, `npm run kb:audit` at **3 errors** — exactly the three predicted
before writing any code: `deletion-is-a-tombstone` (its `verify:` greps for `bin:items` in
`listsApi.ts`, which is gone on purpose), `list-cache-holds-acknowledged-rows` (pins `VERSION = 4`;
it is 5), and `writes-retry-from-an-outbox` (pins the `Action` member count at 9 and the exact
`WriteAction` exclude expression; both moved with the new `items/firstPageLoaded` member). No
unexpected entry went red.

**End to end in the browser** against the local stack (`npm run web`), signed in as an existing
session (bob, with leftover seed data from prior steps — a list named "bob list" among ~85+ others,
one of which triggered the pre-existing `truncated` dev warning, unrelated to this change):

| | |
|---|---|
| Lists screen load | network panel: `list_members?select=role,lists!inner(id,name,deleted_at)&order=created_at.asc&limit=1000` — no `items` in the select string at all |
| row label | `"bob list, shared with you"` — name only, no count, matching the chosen design |
| open "bob list" | items rendered (`Item 1`, `Item 2`, `Item 3_1`, …); network panel shows exactly two new requests: `items?...&list_id=eq.<id>&deleted_at=is.null&...&limit=400` and the same with `deleted_at=not.is.null` — the first-page-of-both-streams fetch, fired only for this list |
| scroll to the end | no further request — this list's current row count fits in one page (the large seed from step 1's verification was cleaned up at the end of that session) |
| add "Verify step 2 works", then delete it | both round-tripped normally; cleaned up before finishing |
| back to Lists screen | instant, no new `items` request |

Console: 0 errors; the pre-existing `pointerEvents` deprecation and the `truncated`-at-`MAX_ROWS`
warning (real leftover list count in the local DB, not caused by this change), nothing else.

**Not re-verified this session:** true multi-page scrolling against a large seeded list (step 1's
seed was already cleaned up) and the realtime re-expansion path (`reloadPages` re-fetching a
visited list's pages after a nudge) against a real two-browser session — both are covered by the
automated suite (`reloadPages.test.ts`, `ListsContext.test.tsx`'s `describe('a re-fetch with pages
loaded', ...)`) but not exercised against Postgres this time, since `fetchItems`'s query shape and
measured plan are unchanged from step 1 and nothing here touches them.

## KB impact — handed to the librarian, not edited here

Three `verify:` commands fail, all for facts that moved correctly, as predicted:
[deletion-is-a-tombstone](../../kb/entries/deletion-is-a-tombstone.md)'s "the bin arrives in the
same fetch as everything else" is now false — the bin arrives in the same fetch as the *live*
stream, but that fetch is triggered by opening the list, not by `fetchLists`.
[list-cache-holds-acknowledged-rows](../../kb/entries/list-cache-holds-acknowledged-rows.md) pins
`VERSION = 4`; it is 5, for `itemsLoaded`, and the reasoning for *why* this bump is safer than the
previous two (a missing boolean fails closed to "not loaded," rather than actively lying) is worth
carrying over.  [writes-retry-from-an-outbox](../../kb/entries/writes-retry-from-an-outbox.md) pins
the `Action` member count at 9 and quotes `WriteAction`'s exact exclude expression; both moved for
`items/firstPageLoaded`.

Prose that moved without tripping a check:

- [read-rooted-at-list-members](../../kb/entries/read-rooted-at-list-members.md) — `fetchLists`'s
  select no longer carries `live:items`/`bin:items`; rules 1–3 (rooting, uncorrelated predicate,
  membership-sized scan) are otherwise untouched, since this is a narrower select, not a different
  root.
- [first-fetch-replaces-list-state](../../kb/entries/first-fetch-replaces-list-state.md) —
  `hydrate` now writes `listsRef.current` synchronously at dispatch time as well as via the
  mirroring effect, for the reason in Problems hit #1; worth a line since it is the same class of
  trap the entry already documents for `hydrate`'s return value.
- [max-rows-is-a-silent-ceiling](../../kb/entries/max-rows-is-a-silent-ceiling.md) — unaffected in
  substance (`fetchItems`/`PAGE_SIZE`/`MAX_ROWS` untouched); its `verify:` still passes, but the
  entry's framing of "the bin's first page is the fetch-size term to watch" now applies per list
  visited rather than per list fetched.
- [queries-go-through-a11y-labels](../../kb/entries/queries-go-through-a11y-labels.md) — new label
  `"Loading list items"` (distinct from the existing footer spinner's `"Loading more items"`);
  `ListRow`'s composed label loses its summary half entirely (`"Groceries"` /
  `"Groceries, shared with you"`, not `"Groceries, 1 of 3 done"`).
- [scope-boundaries](../../kb/entries/scope-boundaries.md) — step 11 now has a second row; the
  "bin's first page ships with every fetch" line moves to "ships with the fetch that opens the
  list."

A likely new entry, or an addition to
[first-fetch-replaces-list-state](../../kb/entries/first-fetch-replaces-list-state.md): *a screen's
own mount effect can race a provider's ref-mirroring effect, because children's effects fire before
their parent's* — general enough to bite the next per-list or per-screen lazy-load feature, not
specific to this one.

## What this does not solve

- **`ListRow` shows no item count at all now**, not even an approximate one — a deliberate product
  trade-off (see Decisions), not a gap to fill later without asking again.
- **A realtime nudge re-expands every list visited this session, not only the one on screen** —
  also deliberate (see Decisions), and would need a "currently visible" concept to narrow further.
- **No retry affordance if a list's very first load fails.** `loadMore`'s failures are implicitly
  retried by the next scroll; a one-shot mount effect has no equivalent, and `reloadPages` only
  re-expands lists that were *already* `itemsLoaded`, so a list that never finished loading once
  stays stuck on the spinner until something else (a remount) re-triggers the effect. Not fixed
  here — flagged during planning, not in this step's scope.
- **Nothing to push to cloud** — no migration this step; this is a client-side `select` trim.
