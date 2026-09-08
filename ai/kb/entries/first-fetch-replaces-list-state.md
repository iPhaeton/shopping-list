---
id: first-fetch-replaces-list-state
title: Hydration replaces list state, so nothing may write before status is 'ready' — and it runs more than once now
type: gotcha
status: current
tags: [state, persistence, testing]
sources: [ai/tasks/3/implementation-log-step-1.md, ai/tasks/4-offline-support/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-2.md, src/state/listsReducer.ts, src/screens/ListsScreen.tsx, src/state/replay.ts]
last_verified: 2026-09-08
verify: grep -q 'lists: action.lists' src/state/listsReducer.ts && grep -q "status === 'loading'" src/screens/ListsScreen.tsx && grep -q 'replay(' src/state/ListsContext.tsx && ! grep -q 'replay' src/state/listsReducer.ts && grep -A3 'const refresh = useCallback' src/state/ListsContext.tsx | grep -q 'if (flushing.current || retry.current) return;' && grep -q 'await hydrate();' src/state/ListsContext.tsx && grep -q "addEventListener('visibilitychange'" src/state/ListsContext.tsx
related: [writes-retry-from-an-outbox, list-cache-holds-acknowledged-rows, queries-go-through-a11y-labels]
---

`lists/loaded` **replaces** the whole array — it does not merge. It is used for the mount-time
hydration and for rolling a *refused* write back, and both want server truth to win. The
consequence: anything the reducer holds that the fetch does not is silently discarded. No error, no
warning; the row is simply gone.

**Step 4 narrowed that, and did it above the reducer.** The provider dispatches
`replay(fetched, outbox)` — [src/state/replay.ts](../../../src/state/replay.ts) folds the pending
writes back on top with the reducer itself — so a write that has reached the outbox survives a
hydration, and `lists/loaded` stays a wholesale replace. **Do not turn hydration into a merge**; the
merge already exists, one level up, where it can be pure.

The race is narrower but not gone: the hydration effect assigns `queue.current = ops` wholesale when
`loadOutbox` resolves, so a write dispatched before that lands is dropped from the queue as well as
from the state. `status` is still the gate.

`useLists()` therefore exposes `status: 'loading' | 'ready'`, and consumers must wait for `'ready'`
before writing. [ListsScreen](../../../src/screens/ListsScreen.tsx) does this by rendering a spinner
instead of the `AddBar`, so in the app the race cannot happen. It bit in a **test** instead:
`ListDetailScreen.test.tsx`'s harness created its list in a `useEffect` that runs before the
provider's, and the list vanished. The harness now gates on `status === 'ready'`, mirroring what the
app does.

**The spinner also exists for a second reason.** "No lists yet" is a claim about the database, and
without the gate the screen made it before asking — the empty state flashed on every load. A test
asserts the empty state is *absent* while a deferred fetch is in flight.

**A cache hit now reaches `'ready'` without the network at all**, and a fetch that fails afterwards
is swallowed rather than banner-ed, because the screen already holds an answer — see
[list-cache-holds-acknowledged-rows](list-cache-holds-acknowledged-rows.md). `status` still means
"there is something to show", not "the database has been heard from".

**Since step 7's sharing UI, "the first fetch" is a misnomer: this replace happens repeatedly.** With
another person writing to your list, mount-time-only was stale within the hour, so
[ListsContext](../../../src/state/ListsContext.tsx) re-fetches whenever the app comes to the front —
`AppState` going `active`, and on web a `visibilitychange` listener beside the existing `online` one,
because coming back to a tab and connectivity returning are different events and neither implies the
other. `SharingScreen` also calls it after every membership change. Everything above still applies,
now on every one of those.

**There are two fetch functions, and the difference between them is the part to get right.**
`hydrate` is private and **unguarded**; `refresh` is what the context exposes and it **skips while
`flushing` or `retry` is set**. `flush` already guards itself against a fetch, but nothing guarded a
fetch against a flush: a read issued while a write is in the air can come back without that write
just as the loop dequeues it, and the row disappears from the screen until the next fetch.

**The guard cannot be moved down into `hydrate`, however much it looks like it belongs there.** The
flush loop's own rollback re-fetch — the one that repairs a `permanent` refusal — runs *with*
`flushing.current` set, and it has to go through. Putting the guard inside `hydrate` makes that
rollback a no-op and leaves a refused write on screen forever. So: the flush loop calls `hydrate`,
everyone else calls `refresh`, and the `verify:` command pins the guard to `refresh`'s body.

**What to do:** any new harness, screen or effect that creates a list or item waits for
`status === 'ready'` first. In a test that means awaiting something the loaded screen renders (
`await screen.findByLabelText('New list name')`) before firing events — the mocked `fetchLists`
resolves a microtask later, not synchronously.

The `verify:` command asserts all of it: that `lists/loaded` still assigns the action's array
wholesale, that `ListsScreen` still gates on `status`, that the replay happens in the provider and
**not** inside the reducer, that `refresh` still carries the flush guard while `hydrate` is still
called bare, and that the web `visibilitychange` listener is still there. If hydration ever becomes a
merge, this entry is what changed.
