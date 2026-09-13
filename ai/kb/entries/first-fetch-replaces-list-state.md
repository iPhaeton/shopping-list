---
id: first-fetch-replaces-list-state
title: Hydration replaces list state, so nothing may write before status is 'ready' — and it runs more than once now
type: gotcha
status: current
tags: [state, persistence, testing]
sources: [ai/tasks/3/implementation-log-step-1.md, ai/tasks/4-offline-support/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-2.md, ai/tasks/8-realtime/implementation-log-step-1.md, ai/tasks/9-deletion/implementation-log-step-1.md, ai/tasks/11-pagination/implementation-log-step-2.md, ai/tasks/11-pagination/implementation-log-step-3.md, ai/tasks/11-pagination/implementation-log-step-4.md, src/state/listsReducer.ts, src/screens/ListsScreen.tsx, src/state/replay.ts, src/state/useHydration.ts, src/state/ListsContext.tsx]
last_verified: 2026-09-13
verify: grep -q 'lists: action.lists' src/state/listsReducer.ts && grep -q "status === 'loading'" src/screens/ListsScreen.tsx && grep -q 'replay(' src/state/useHydration.ts && ! grep -q 'replay' src/state/listsReducer.ts && grep -q 'const hydrateLists = useCallback' src/state/useHydration.ts && grep -q "dirty = useRef<Set<string> | 'all'>" src/state/useHydration.ts && grep -A3 'const refresh = useCallback' src/state/useHydration.ts | grep -q 'if (flushing.current || retry.current) return;' && grep -A3 'const refresh = useCallback' src/state/useHydration.ts | grep -q 'dirty.current = new Set();' && grep -A3 'const drainDirty = useCallback' src/state/useHydration.ts | grep -q 'if (flushing.current || retry.current || fetching.current) return;' && grep -A15 'const refreshSoon = useCallback' src/state/useHydration.ts | grep -q '(listId?: string)' && grep -A15 'const refreshSoon = useCallback' src/state/useHydration.ts | grep -q 'drainDirty();' && ! grep -A15 'const refreshSoon = useCallback' src/state/useHydration.ts | grep -q 'void refresh()' && grep -q 'await hydrate();' src/state/ListsContext.tsx && grep -q "addEventListener('visibilitychange'" src/state/ListsContext.tsx && grep -q 'listsRef.current = loaded;' src/state/useHydration.ts && test "$(grep -c 'if (!retry.current) void flushRef.current?.();' src/state/useHydration.ts)" = 2 && grep -q 'flushRef.current = flush;' src/state/ListsContext.tsx
related: [writes-retry-from-an-outbox, list-cache-holds-acknowledged-rows, queries-go-through-a11y-labels, realtime-is-a-nudge-to-a-per-user-inbox, writes-can-land-on-a-tombstone]
---

`lists/loaded` **replaces** the whole array — it does not merge. Anything the reducer holds that a
fetch does not include is silently discarded; no error, no warning.

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
until then, so the race cannot happen in the app — it bit in a **test** instead, whose harness
created a list before the provider's own effect ran; the harness now gates on `status === 'ready'`
too. The same gate is also why "No lists yet" — a claim about the database — never flashes before the
first answer arrives.

**A cache hit reaches `'ready'` without the network at all**, and a fetch that fails afterwards is
swallowed rather than banner-ed, because the screen already holds an answer — see
[list-cache-holds-acknowledged-rows](list-cache-holds-acknowledged-rows.md). `status` means "there is
something to show", not "the database has been heard from".

**Since step 7's sharing UI this replace happens repeatedly, not once at mount.**
[ListsContext](../../../src/state/ListsContext.tsx) re-fetches whenever the app comes to the front —
`AppState` going `active`, and on web a `visibilitychange` listener beside the existing `online` one —
and `SharingScreen` calls it after every membership change. Everything above applies to every one of
those re-reads, not only the first.

**Three fetch functions now, and which one a caller reaches for is the part to get wrong.** `hydrate`
(full, all lists) and `hydrateLists` (step 11-3, one or more named lists — see
[realtime-is-a-nudge-to-a-per-user-inbox](realtime-is-a-nudge-to-a-per-user-inbox.md)), along with
`refresh`, `refreshSoon` and `drainDirty` below, all now live in
[useHydration.ts](../../../src/state/useHydration.ts), split out of `ListsContext.tsx` in step 11-4 —
same functions, same guards, just not a `useCallback` in the provider component any more. `hydrate`
and `hydrateLists` are both **private and unguarded**. `refresh` is the only one the context exposes, wraps `hydrate` alone, and
**skips while `flushing` or `retry` is set** — `flush` already guards itself against a fetch, but
nothing guarded a fetch against a flush, and a read issued while a write is in the air can come back
without that write just as the loop dequeues it.

**A realtime nudge no longer goes through `refresh` at all.** `refreshSoon(listId?)` records what was
named in `dirty` (`Set<string>`, or `'all'` once anything arrives with no id — a malformed payload or
a resubscribe, which can never know what it missed) and, after its debounce, calls `drainDirty`.
`drainDirty` re-implements `refresh`'s guard itself (`flushing`, `retry`, and now also `fetching`,
since nothing else stops two fetches racing) and hands off to `runDirty`, which drains `dirty` in a
loop — `hydrate` for `'all'`, `hydrateLists` for a set — so a nudge arriving mid-fetch is picked up by
the same loop rather than lost. There is no separate "remembered" flag any more: `dirty` is written
before the guard is even checked, so it already holds whatever a turned-away nudge named.

**Self-draining deliberately does not live inside `hydrate`'s or `hydrateLists`'s own `finally`.**
That would make a `useCallback` cycle (`drainDirty` → `runDirty` → `hydrateLists` → `drainDirty`), and
would race `discardBlocked`/`restoreBlocked`'s `hydrate().then(() => flush())` chains: a drain firing
synchronously inside `hydrate`'s `finally` sets `fetching.current` back to `true` before that `.then`
resumes, so `flush` would see it set and silently skip a queued write.

**Step 11-4 put a *different* call in those same `finally` blocks — `flush` itself, not
`drainDirty`/`hydrate`.** `flushing`/`stuck` are self-healing (something already running picks a
turned-away write back up); before this, nothing redelivered a write `enqueueOp` enqueued while a
nudge-triggered fetch was already running — its own call to `flush` found `fetching.current` still
`true` and bailed, and nothing retried until an unrelated foreground/online event or another enqueue
happened to fire `flush` while no fetch was in progress. Both `finally` blocks now end
`if (!retry.current) void flushRef.current?.();` (`flushRef`: a ref kept current the same way as
`listsRef`, needed because `useHydration` runs before `useOutbox` builds `flush` from `hydrate`).
Neither hazard above applies: reading `flush` through a ref is not a closure or a cycle, and `flush`
never touches `fetching.current`, so a racing `.then(() => flush())` chain sees `flushing.current` true
only because it is already sending the same write. Guarded on `retry.current` alone, mirroring
`enqueueOp`'s own guard, so a fetch completing mid-backoff does not fire an out-of-schedule retry.

**Step 9 gave the flush loop a second reason to call `hydrate` directly** (never `hydrateLists` — the
flush loop does not know which list changed) **and made the *timing* load-bearing.** When a write
comes back `target_deleted`, the loop awaits `hydrate()` before announcing anything, since the
tombstone is somebody else's write and the decision about what to offer is taken from state.
Announcing first reads the pre-delete view and silently discards the write — see
[writes-can-land-on-a-tombstone](writes-can-land-on-a-tombstone.md). A third guard, `stuck`, stops the
loop while a blocked write sits at its head.

**There are three guarded doors onto `hydrate`/`hydrateLists` now, each guarding something
different.** `refresh` (`flushing`, `retry`) is the one every screen calls; `drainDirty` (`flushing`,
`retry`, `fetching`) is realtime's own; the flush loop's direct `hydrate()` calls carry **no** guard,
because they run *with* `flushing.current` already set and the loop's own rollback would become a
no-op if `hydrate` refused to run inside it. `refresh` still does not check `fetching` — doing so
would make a user-triggered refresh silently do nothing while a nudge-driven fetch happens to be in
flight, worse for an explicit action than the bounded, self-healing race it would prevent.

**Step 11-2 found the same trap on the *ref* itself, and it generalises.** `listsRef.current` is kept
in sync by a mirroring `useEffect`, safe for a callback like `loadMore` that only ever fires from a
user's scroll, long after the ref has settled — not safe for a *screen's own mount effect*, since
React fires a child's effects before its parent's and both can land in the same commit as the dispatch
that first makes a list appear. Both `hydrate` and `hydrateLists` assign `listsRef.current`
synchronously, immediately after dispatching, so the ref is right before React begins the
commit/effect cycle, independent of ordering.

**What to do:** any new harness, screen or effect that creates a list or item waits for
`status === 'ready'` first — in a test, await something the loaded screen renders before firing
events. A new mount effect reading `listsRef.current` (or any ref mirrored the same way) needs the
same synchronous-assignment treatment if it can run on the same commit a list first appears. A new
caller that knows which list changed should reach for `refreshSoon(listId)`, not `refresh` — going
through `refresh` forces a full `hydrate` and loses the point of the narrower fetch.

The `verify:` command asserts: `lists/loaded` still assigns the action's array wholesale;
`ListsScreen` still gates on `status`; the replay happens in the provider, not the reducer;
`hydrateLists` and the `dirty` ref still exist; `refresh` still carries its two-guard check and still
resets `dirty`; `drainDirty` still carries its three-guard check; `refreshSoon` still takes an
optional `listId` and routes to `drainDirty`, never straight to `refresh`; `hydrate` is still called
bare somewhere; the web `visibilitychange` listener is still there; and `hydrate` still assigns
`listsRef.current` synchronously.
