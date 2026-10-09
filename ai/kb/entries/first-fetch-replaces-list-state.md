---
id: first-fetch-replaces-list-state
title: Hydration replaces list state, so nothing may write before status is 'ready' — and it runs more than once now
type: gotcha
status: current
tags: [state, persistence, testing]
sources: [ai/tasks/3/implementation-log-step-1.md, ai/tasks/4-offline-support/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-2.md, ai/tasks/8-realtime/implementation-log-step-1.md, ai/tasks/9-deletion/implementation-log-step-1.md, ai/tasks/11-pagination/implementation-log-step-2.md, ai/tasks/11-pagination/implementation-log-step-3.md, ai/tasks/11-pagination/implementation-log-step-4.md, ai/tasks/16-sync-banner-flicker/implementation-log-step-1.md, ai/tasks/19-remove-oneself/implementation-log-step-2.md, ai/tasks/20-ux/implementation-log-step-3.md, ai/tasks/23-list-limits/implementation-log-step-1.md, ai/tasks/23-list-limits/implementation-log-step-2.md, ai/tasks/24-search-and-sort/implementation-log-step-2.md, src/state/listsReducer.ts, src/screens/ListsScreen.tsx, src/state/replay.ts, src/state/useHydration.ts, src/state/ListsContext.tsx, src/state/reloadPages.ts, src/state/usePaging.ts, ai/tasks/24-search-and-sort/implementation-log-step-3.md, src/state/useCompletion.ts, ai/tasks/28-invitations/implementation-log-step-3.md, 5ab9b85]
last_verified: 2026-10-09
verify: grep -q 'lists: action.lists, listCursors: action.cursors' src/state/listsReducer.ts && grep -q 'reloadListPages(listsRef.current, fetchLists)' src/state/useHydration.ts && grep -q 'pages.lists === null) return { error: pages.error, lists: null };' src/state/useHydration.ts && grep -q "status === 'loading'" src/screens/ListsScreen.tsx && grep -q 'replay(' src/state/useHydration.ts && ! grep -q 'replay' src/state/listsReducer.ts && grep -q 'const hydrateLists = useCallback' src/state/useHydration.ts && grep -q "dirty = useRef<Set<string> | 'all'>" src/state/useHydration.ts && grep -A3 'const refresh = useCallback' src/state/useHydration.ts | grep -q 'if (flushing.current || retry.current) return;' && grep -A3 'const refresh = useCallback' src/state/useHydration.ts | grep -q 'dirty.current = new Set();' && grep -A3 'const drainDirty = useCallback' src/state/useHydration.ts | grep -q 'if (flushing.current || retry.current || fetching.current) return;' && grep -A15 'const refreshSoon = useCallback' src/state/useHydration.ts | grep -q '(listId?: string)' && grep -A15 'const refreshSoon = useCallback' src/state/useHydration.ts | grep -q 'drainDirty();' && ! grep -A15 'const refreshSoon = useCallback' src/state/useHydration.ts | grep -q 'void refresh()' && grep -q 'await hydrate();' src/state/ListsContext.tsx && grep -q "addEventListener('visibilitychange'" src/state/ListsContext.tsx && test "$(grep -c 'listsRef.current = loaded;' src/state/useHydration.ts)" = 2 && test "$(grep -c 'listCursorsRef.current = ' src/state/useHydration.ts)" = 2 && grep -q 'listCursorsRef.current = cached.cursors;' src/state/ListsContext.tsx && grep -q 'listsRef.current = lists;' src/state/ListsContext.tsx && grep -q 'listsRef.current = replay(' src/state/usePaging.ts && test "$(grep -c 'if (!retry.current) void flushRef.current?.();' src/state/useHydration.ts)" = 2 && grep -q 'flushRef.current = flush;' src/state/ListsContext.tsx && grep -q 'const listCounts = action.counts ?? state.listCounts;' src/state/listsReducer.ts && grep -q 'if (read.counts === null) return { error: read.error, lists: null };' src/state/useHydration.ts && grep -q "dispatch({ type: 'lists/loaded', lists: loaded, cursors });" src/state/useHydration.ts && grep -q 'asks one page further once the database has it, which keeps every row shown before' src/state/reloadPages.test.ts && grep -q 'asks one bin page further for a list binned on this device and not yet sent' src/state/reloadPages.test.ts && test "$(grep -c 'foldPage(' src/state/usePaging.ts)" = 1 && grep -q 'listCursorsRef.current = next.listCursors;' src/state/usePaging.ts && test "$(grep -c 'after: page.after' src/state/usePaging.ts)" = 2 && grep -qF 'if (!continues(action, action.stream && state.listCursors[action.stream.name])) return state;' src/state/listsReducer.ts && grep -qF 'if (!continues(action, at)) return list;' src/state/listsReducer.ts && grep -qF 'return sameCursor(at, action.after);' src/state/listsReducer.ts && test "$(grep -c 'setReadEpoch((epoch) => epoch + 1)' src/state/useHydration.ts)" = 2 && grep -qF "if (status === 'failed') retry();" src/state/useCompletion.ts
related: [writes-retry-from-an-outbox, list-cache-holds-acknowledged-rows, queries-go-through-a11y-labels, realtime-is-a-nudge-to-a-per-user-inbox, writes-can-land-on-a-tombstone, postgrest-reads-retry-on-network-errors]
---

`lists/loaded` **replaces** the whole array, and the list cursors with it — it does not merge.
Anything the reducer holds that a fetch does not include is silently discarded; no error, no warning.
The one exception is deliberate: its `counts` (`listCounts`, what the list limits warn from) is
optional, and when omitted the reducer keeps the counts state already holds.

**The merge lives one level up, in the provider.** It dispatches `replay(fetched, outbox)` —
[src/state/replay.ts](../../../src/state/replay.ts) folds pending writes back over fetched rows with
the reducer itself — so a queued write survives a hydration. **Do not turn hydration into a merge.**
The race left: the hydration effect assigns `queue.current = ops` wholesale when `loadOutbox`
resolves, so a write dispatched before that is dropped from queue and state alike.

`useLists()` exposes `status: 'loading' | 'ready'`, and consumers must wait for `'ready'` before
writing. [ListsScreen](../../../src/screens/ListsScreen.tsx) renders a spinner instead of `AddBar`
until then — the race once bit a **test** whose harness created a list before the provider's effect
ran — and "No lists yet" never flashes before the first answer. **A cache hit reaches `'ready'`
without the network**, and a fetch failing afterwards is swallowed rather than banner-ed
([list-cache-holds-acknowledged-rows](list-cache-holds-acknowledged-rows.md)): `status` means
"there is something to show", not "the database has been heard from".

**The replace happens repeatedly** — whenever the app comes to the front (`AppState` going `active`,
and on web `visibilitychange` beside `online`), after every membership change on `SharingScreen`,
and on realtime nudges. Everything above applies to every re-read.

**So a replace must re-read as deep as the screen had scrolled, or it snaps back to page 1.**
`hydrate` re-reads the pages of lists first (`reloadListPages`: each stream from page 1, one page per
request, until it holds as many database-stamped lists as before), then each open list's item pages
(`reloadPages`). **A failed list page fails the whole `hydrate` — nothing dispatched, state
untouched** — unlike the item re-read, which snaps just that list back: snapping list pages back
would drop the list open on List detail, or one with writes queued. `fetchListCounts()` runs beside
the pages and **fails `hydrate` the same way**: `replayState` counts pending creates and bins on top
of the server's numbers, so falling back to state's counts would count them twice.

**A row binned on this device counts toward the bin's depth, so a bin re-read can ask one page more
than was loaded — on purpose.** Only its `deletedAt` is the device's, so `stampedLists`/`loadedRows`
count it. If the deletion has landed, the row heads the newest-first bin and pushed the last row
shown onto the next page, which the extra page keeps on screen; if still queued, the extra page is
rows never shown — one page per stream per re-read, accepted. Do not drop pending deletions from the
count: that "fix" loses the last row in the first case.

**A scroll page may land after a replace, and then it must be thrown away, not folded.** A page
action carries `after`, the cursor it was read from; the reducer (`continues()` → `sameCursor`)
ignores the page whole unless state's cursor for that stream still equals it. Otherwise a `hydrate`
that replaced state while the page was in the air, dropping the page before it, would leave a gap
with a cursor past it. `loadMore`/`loadMoreLists` pass `after`; `reloadPages`/`reloadListPages`
omit it, since a re-read built from nothing continues itself. **Cursors move only through `hydrate`,
`hydrateLists`, the cold-start cache load, and page folds** — never through a write action.

**Three fetch functions, and which one a caller reaches for is the part to get wrong.** `hydrate`
(every loaded page) and `hydrateLists` (named lists — see
[realtime-is-a-nudge-to-a-per-user-inbox](realtime-is-a-nudge-to-a-per-user-inbox.md)), with
`refresh`, `refreshSoon` and `drainDirty`, live in [useHydration.ts](../../../src/state/useHydration.ts).
`hydrate` and `hydrateLists` are **private and unguarded**. `refresh` is the only one the context
exposes, wraps `hydrate` alone, and **skips while `flushing` or `retry` is set** — a read issued while
a write is in the air can come back without that write just as the loop dequeues it.

**A realtime nudge does not go through `refresh`.** `refreshSoon(listId?)` records what was named in
`dirty` (`Set<string>`, or `'all'` once anything arrives with no id — a malformed payload or a
resubscribe) and, after its debounce, calls `drainDirty`, which re-implements `refresh`'s guard
(`flushing`, `retry`, and also `fetching`, since nothing else stops two fetches racing) and hands off
to `runDirty`: a loop draining `dirty` — `hydrate` for `'all'`, `hydrateLists` for a set — so a nudge
arriving mid-fetch is not lost. `dirty` is written before the guard is checked. `hydrateLists`
dispatches **no counts**, so a removal by somebody else, or an invitation accepted on another
device, moves the limit counts only at the next full `hydrate` — approximate by design.

**Self-draining deliberately does not live inside `hydrate`'s or `hydrateLists`'s own `finally`.**
That would make a `useCallback` cycle (`drainDirty` → `runDirty` → `hydrateLists` → `drainDirty`), and
race `discardBlocked`/`restoreBlocked`'s `hydrate().then(() => flush())`: a drain inside `finally`
sets `fetching.current` back to `true` before that `.then` resumes, and `flush` silently skips.
**Those `finally` blocks call `flush` instead** — `if (!retry.current) void flushRef.current?.();` —
or a write enqueued during a nudge's fetch found `fetching` set and waited for an unrelated trigger.
`flushRef` (since `useHydration` runs before `useOutbox` builds `flush`) is neither closure nor cycle;
guarded on `retry` alone, like `enqueueOp`, so a fetch ending mid-backoff fires no early retry.

**The flush loop is the third door onto `hydrate`, and it is unguarded**: it runs *with*
`flushing.current` set, and never calls `hydrateLists`. **There the *timing* is load-bearing.** On
`target_deleted` it awaits `hydrate()` before announcing anything; announcing first reads the
pre-delete view and silently discards the write
([writes-can-land-on-a-tombstone](writes-can-land-on-a-tombstone.md)). `stuck` stops the loop while
a blocked write sits at its head. `refresh` deliberately does not check `fetching`: a user's refresh
would otherwise do nothing while a nudge-driven fetch was in flight.

**`readEpoch` is how a screen learns the network is back** — there is no connectivity library. It
bumps after `hydrate`'s dispatch, and after `hydrateLists`' when at least one `fetchList` succeeded;
an outbox retry is not a read. `useCompletion` restarts only a `'failed'` completion run on a move.

**The same trap lives on the refs, and it has bitten four times.** `listsRef` and `listCursorsRef`
mirror state through `useEffect`s — safe for a scroll callback, not for anything running in the
commit of the dispatch, since React fires a child's effects before its parent's. So every dispatch
read back at once assigns the refs itself: `hydrate` and `hydrateLists` right after dispatching; the
cold-start cache dispatch in `ListsContext` (else a cold start re-read one page of lists, not the
cached depth); and **every page fold in `usePaging`**, through `fold()` — the same reducer over the
refs, then `replay` — `items/firstPageLoaded` and `loadList` included. List detail's completion
effect runs in the commit where `itemsLoaded` flips; a stale ref there read `nextLive: null` and
would have returned `'complete'` at once.

**What to do:** wait for `status === 'ready'` before creating a list or item — in a test, await
something the loaded screen renders. A new dispatch a same-commit effect or a not-yet-awaited read
depends on assigns the refs synchronously. A new page read passes `after`. A caller that knows which
list changed reaches for `refreshSoon(listId)`, not `refresh`.

The `verify:` pins each of these. It counts the literal `listsRef.current = loaded;`, so renaming
that variable fails it with the fact intact — why `hydrate` calls the replayed state `replayed`.
