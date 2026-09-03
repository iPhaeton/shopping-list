---
id: first-fetch-replaces-list-state
title: Hydration replaces list state, so nothing may write before status is 'ready'
type: gotcha
status: current
tags: [state, persistence, testing]
sources: [ai/tasks/3/implementation-log-step-1.md, ai/tasks/4-offline-support/implementation-log-step-1.md, src/state/listsReducer.ts, src/screens/ListsScreen.tsx, src/state/replay.ts]
last_verified: 2026-09-02
verify: grep -q 'lists: action.lists' src/state/listsReducer.ts && grep -q "status === 'loading'" src/screens/ListsScreen.tsx && grep -q 'replay(' src/state/ListsContext.tsx && ! grep -q 'replay' src/state/listsReducer.ts
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

**What to do:** any new harness, screen or effect that creates a list or item waits for
`status === 'ready'` first. In a test that means awaiting something the loaded screen renders (
`await screen.findByLabelText('New list name')`) before firing events — the mocked `fetchLists`
resolves a microtask later, not synchronously.

The `verify:` command asserts all of it: that `lists/loaded` still assigns the action's array
wholesale, that `ListsScreen` still gates on `status`, and that the replay happens in the provider
and **not** inside the reducer. If hydration ever becomes a merge, this entry is what changed.
