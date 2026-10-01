---
id: first-fetch-replaces-list-state
title: Hydration replaces list state, so nothing may write before status is 'ready' — and it runs more than once now
type: gotcha
status: current
tags: [state, persistence, testing]
sources: [ai/tasks/3/implementation-log-step-1.md, ai/tasks/4-offline-support/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-2.md, ai/tasks/8-realtime/implementation-log-step-1.md, ai/tasks/9-deletion/implementation-log-step-1.md, ai/tasks/11-pagination/implementation-log-step-2.md, ai/tasks/11-pagination/implementation-log-step-3.md, ai/tasks/11-pagination/implementation-log-step-4.md, ai/tasks/16-sync-banner-flicker/implementation-log-step-1.md, ai/tasks/19-remove-oneself/implementation-log-step-2.md, ai/tasks/20-ux/implementation-log-step-3.md, ai/tasks/23-list-limits/implementation-log-step-1.md, ai/tasks/23-list-limits/implementation-log-step-2.md, src/state/listsReducer.ts, src/screens/ListsScreen.tsx, src/state/replay.ts, src/state/useHydration.ts, src/state/ListsContext.tsx, src/state/reloadPages.ts, src/state/usePaging.ts]
last_verified: 2026-10-01
verify: grep -q 'lists: action.lists, listCursors: action.cursors' src/state/listsReducer.ts && grep -q 'reloadListPages(listsRef.current, fetchLists)' src/state/useHydration.ts && grep -q 'pages.lists === null) return { error: pages.error, lists: null };' src/state/useHydration.ts && grep -q "status === 'loading'" src/screens/ListsScreen.tsx && grep -q 'replay(' src/state/useHydration.ts && ! grep -q 'replay' src/state/listsReducer.ts && grep -q 'const hydrateLists = useCallback' src/state/useHydration.ts && grep -q "dirty = useRef<Set<string> | 'all'>" src/state/useHydration.ts && grep -A3 'const refresh = useCallback' src/state/useHydration.ts | grep -q 'if (flushing.current || retry.current) return;' && grep -A3 'const refresh = useCallback' src/state/useHydration.ts | grep -q 'dirty.current = new Set();' && grep -A3 'const drainDirty = useCallback' src/state/useHydration.ts | grep -q 'if (flushing.current || retry.current || fetching.current) return;' && grep -A15 'const refreshSoon = useCallback' src/state/useHydration.ts | grep -q '(listId?: string)' && grep -A15 'const refreshSoon = useCallback' src/state/useHydration.ts | grep -q 'drainDirty();' && ! grep -A15 'const refreshSoon = useCallback' src/state/useHydration.ts | grep -q 'void refresh()' && grep -q 'await hydrate();' src/state/ListsContext.tsx && grep -q "addEventListener('visibilitychange'" src/state/ListsContext.tsx && test "$(grep -c 'listsRef.current = loaded;' src/state/useHydration.ts)" = 2 && test "$(grep -c 'listCursorsRef.current = ' src/state/useHydration.ts)" = 2 && grep -q 'listCursorsRef.current = cached.cursors;' src/state/ListsContext.tsx && grep -q 'listsRef.current = lists;' src/state/ListsContext.tsx && grep -q 'listsRef.current = replay(' src/state/usePaging.ts && test "$(grep -c 'if (!retry.current) void flushRef.current?.();' src/state/useHydration.ts)" = 2 && grep -q 'flushRef.current = flush;' src/state/ListsContext.tsx && grep -q 'const listCounts = action.counts ?? state.listCounts;' src/state/listsReducer.ts && grep -q 'if (read.counts === null) return { error: read.error, lists: null };' src/state/useHydration.ts && grep -q "dispatch({ type: 'lists/loaded', lists: loaded, cursors });" src/state/useHydration.ts
related: [writes-retry-from-an-outbox, list-cache-holds-acknowledged-rows, queries-go-through-a11y-labels, realtime-is-a-nudge-to-a-per-user-inbox, writes-can-land-on-a-tombstone]
---

`lists/loaded` **replaces** the whole array, and the list cursors with it — it does not merge.
Anything the reducer holds that a fetch does not include is silently discarded; no error, no warning.
The one exception is deliberate: its `counts` (`listCounts`, what the list limits warn from) is
optional, and when omitted the reducer keeps the counts state already holds.

**Step 4 narrowed that, above the reducer.** The provider dispatches `replay(fetched, outbox)` —
[src/state/replay.ts](../../../src/state/replay.ts) folds pending writes back over fetched rows with
the reducer itself — so a write that reached the outbox survives a hydration, and `lists/loaded`
stays a wholesale replace. **Do not turn hydration into a merge**; the merge already exists, one
level up, where it can be pure.

The race is narrower but not gone: the hydration effect assigns `queue.current = ops` wholesale when
`loadOutbox` resolves, so a write dispatched before that lands is dropped from the queue as well as
from state. `status` is still the gate.

`useLists()` exposes `status: 'loading' | 'ready'`, and consumers must wait for `'ready'` before
writing. [ListsScreen](../../../src/screens/ListsScreen.tsx) renders a spinner instead of `AddBar`
until then — the race bit a **test** instead, whose harness created a list before the provider's own
effect ran. The same gate is why "No lists yet" never flashes before the first answer arrives. **A
cache hit reaches `'ready'` without the network at all**, and a fetch that fails afterwards is
swallowed rather than banner-ed ([list-cache-holds-acknowledged-rows](list-cache-holds-acknowledged-rows.md)):
`status` means "there is something to show", not "the database has been heard from".

**The replace happens repeatedly, not once at mount** — whenever the app comes to the front
(`AppState` going `active`, and on web `visibilitychange` beside `online`), after every membership
change on `SharingScreen`, and on realtime nudges. Everything above applies to every re-read.

**So a replace must re-read as deep as the screen had scrolled, or it snaps back to page 1.**
`hydrate` re-reads the pages of lists first (`reloadListPages`: each stream from page 1, one page per
request, until it holds as many database-stamped lists as before), then each open list's item pages
(`reloadPages`). **A failed list page fails the whole `hydrate` — nothing dispatched, state
untouched** — deliberately unlike the item re-read, which snaps just that list back: snapping list
pages back would drop the list open on List detail, or one with writes still queued. Since task 23
step 2 `fetchListCounts()` runs beside the pages and **fails `hydrate` the same way**: `replayState`
counts pending creates and bins on top of the server's numbers, so falling back to state's counts,
which already include them, would count them twice.

**Three fetch functions, and which one a caller reaches for is the part to get wrong.** `hydrate`
(every loaded page) and `hydrateLists` (one or more named lists — see
[realtime-is-a-nudge-to-a-per-user-inbox](realtime-is-a-nudge-to-a-per-user-inbox.md)), with
`refresh`, `refreshSoon` and `drainDirty`, live in [useHydration.ts](../../../src/state/useHydration.ts).
`hydrate` and `hydrateLists` are both **private and unguarded**. `refresh` is the only one the context
exposes, wraps `hydrate` alone, and **skips while `flushing` or `retry` is set** — a read issued while
a write is in the air can come back without that write just as the loop dequeues it.

**A realtime nudge does not go through `refresh` at all.** `refreshSoon(listId?)` records what was
named in `dirty` (`Set<string>`, or `'all'` once anything arrives with no id — a malformed payload or
a resubscribe, which can never know what it missed) and, after its debounce, calls `drainDirty`.
`drainDirty` re-implements `refresh`'s guard itself (`flushing`, `retry`, and also `fetching`, since
nothing else stops two fetches racing) and hands off to `runDirty`, which drains `dirty` in a loop —
`hydrate` for `'all'`, `hydrateLists` for a set — so a nudge arriving mid-fetch is picked up by the
same loop rather than lost. `dirty` is written before the guard is checked, so it already holds
whatever a turned-away nudge named. `hydrateLists` dispatches **no counts** (a few named lists say
nothing about the rest), so a list shared with you, or taken away, moves the limit counts only at
the next full `hydrate` — approximate by design.

**Self-draining deliberately does not live inside `hydrate`'s or `hydrateLists`'s own `finally`.**
That would make a `useCallback` cycle (`drainDirty` → `runDirty` → `hydrateLists` → `drainDirty`), and
would race `discardBlocked`/`restoreBlocked`'s `hydrate().then(() => flush())` chains: a drain firing
synchronously inside `hydrate`'s `finally` sets `fetching.current` back to `true` before that `.then`
resumes, so `flush` would see it set and silently skip a queued write.

**Those `finally` blocks call `flush` instead**, as `if (!retry.current) void flushRef.current?.();`.
Without it, a write enqueued while a nudge-triggered fetch ran found `fetching.current` still `true`,
bailed, and waited for an unrelated foreground or enqueue. Reading `flush` through a ref (`flushRef`,
since `useHydration` runs before `useOutbox` builds `flush` from `hydrate`) is neither a closure nor a
cycle, and `flush` never touches `fetching.current`. Guarded on `retry.current` alone, mirroring
`enqueueOp`, so a fetch completing mid-backoff does not fire an out-of-schedule retry.

**Step 9 gave the flush loop a second reason to call `hydrate` directly** (never `hydrateLists` — the
flush loop does not know which list changed) **and made the *timing* load-bearing.** When a write
comes back `target_deleted`, the loop awaits `hydrate()` before announcing anything; announcing first
reads the pre-delete view and silently discards the write — see
[writes-can-land-on-a-tombstone](writes-can-land-on-a-tombstone.md). A third guard, `stuck`, stops the
loop while a blocked write sits at its head.

**Three guarded doors onto `hydrate`/`hydrateLists`, each guarding something different.** `refresh`
(`flushing`, `retry`) is the one every screen calls; `drainDirty` (`flushing`, `retry`, `fetching`) is
realtime's own; the flush loop's direct `hydrate()` calls carry **no** guard, because they run *with*
`flushing.current` already set. `refresh` still does not check `fetching` — that would make a
user-triggered refresh silently do nothing while a nudge-driven fetch happens to be in flight.

**The same trap lives on the refs, and it has now bitten three times.** `listsRef` and
`listCursorsRef` mirror state through `useEffect`s — safe for a scroll callback, not for anything that
runs in the same commit as the dispatch or before the effects have run. React fires a child's
effects before its parent's. So every dispatch something reads back at once assigns the refs itself:
`hydrate` and `hydrateLists`, right after dispatching (a screen's mount effect lands in that commit);
**the cold-start cache dispatch** in `ListsContext` (`hydrate` counts "loaded before" from the refs
before its first await — without it a cold start re-read one page of lists, not the cached depth);
and **`usePaging.loadList`**, which folds in one list fetched by id (List detail's mount effect asks
`loadListItems` for it in the commit it appears, found nothing, and never asked again). Both task-23
cases were caught by tests that fail without the assignment.

**What to do:** any new harness, screen or effect that creates a list or item waits for
`status === 'ready'` first — in a test, await something the loaded screen renders before firing
events. A new dispatch whose result a same-commit effect, or a not-yet-awaited read, depends on
assigns the mirrored refs synchronously too. A new caller that knows which list changed reaches for
`refreshSoon(listId)`, not `refresh`, which forces a full `hydrate`.

The `verify:` command asserts: `lists/loaded` still assigns lists and cursors wholesale; `hydrate`
re-reads list pages and bails on a failed one; `ListsScreen` still gates on `status`; the replay
happens in the provider, not the reducer; the `dirty` machinery and the three guards are intact; the
web `visibilitychange` listener is still there; all four synchronous ref assignments remain; and
`counts` stays optional, a failed counts read fails `hydrate`, and `hydrateLists` dispatches none.
The ref check counts the literal `listsRef.current = loaded;`, so renaming that variable fails it
with the fact intact — which is why `hydrate` calls the replayed state `replayed`.
