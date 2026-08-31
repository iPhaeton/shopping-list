---
id: first-fetch-replaces-list-state
title: Hydration replaces list state, so nothing may write before status is 'ready'
type: gotcha
status: current
tags: [state, persistence, testing]
sources: [ai/tasks/3/implementation-log-step-1.md, src/state/listsReducer.ts, src/screens/ListsScreen.tsx]
last_verified: 2026-08-31
verify: grep -q 'lists: action.lists' src/state/listsReducer.ts && grep -q "status === 'loading'" src/screens/ListsScreen.tsx
related: [optimistic-list-writes, queries-go-through-a11y-labels]
---

`lists/loaded` **replaces** the whole array — it does not merge. It is used both for the mount-time
hydration and for rolling a failed write back, and both want server truth to win. The consequence:
anything created between mount and the first fetch landing is silently discarded. No error, no
warning; the row is simply gone.

`useLists()` therefore exposes `status: 'loading' | 'ready'`, and consumers must wait for `'ready'`
before writing. [ListsScreen](../../../src/screens/ListsScreen.tsx) does this by rendering a spinner
instead of the `AddBar`, so in the app the race cannot happen. It bit in a **test** instead:
`ListDetailScreen.test.tsx`'s harness created its list in a `useEffect` that runs before the
provider's, and the list vanished. The harness now gates on `status === 'ready'`, mirroring what the
app does.

**The spinner also exists for a second reason.** "No lists yet" is a claim about the database, and
without the gate the screen made it before asking — the empty state flashed on every load. A test
asserts the empty state is *absent* while a deferred fetch is in flight.

**What to do:** any new harness, screen or effect that creates a list or item waits for
`status === 'ready'` first. In a test that means awaiting something the loaded screen renders (
`await screen.findByLabelText('New list name')`) before firing events — the mocked `fetchLists`
resolves a microtask later, not synchronously.

The `verify:` command asserts both halves: that `lists/loaded` still assigns the action's array
wholesale, and that `ListsScreen` still gates on `status`. If hydration ever becomes a merge, this
entry is what changed.
