---
id: update-list-identity-preserving
title: updateList returns the original state object when nothing changed
type: convention
status: current
tags: [state, reducer, immutability]
sources: [ai/tasks/1/implementation-log-step-1.md, ai/tasks/3/implementation-log-step-1.md, 6ef87a2]
last_verified: 2026-09-07
verify: grep -q 'is a no-op' src/state/listsReducer.test.ts && npx jest -t 'is a no-op' --silent
related: [ids-minted-outside-reducer, writes-retry-from-an-outbox]
---

The private `updateList` helper in
[src/state/listsReducer.ts](../../../src/state/listsReducer.ts) returns the **original `state`
object**, not a fresh one, in two cases: the list id is unknown, and the `update` callback returned
the same list it was given. `item/setDone` leans on the second case twice over — it returns `list`
untouched when the item id is not in that list, *and* when the item already holds the `doneAt` value
being set.

**That second condition is load-bearing beyond rendering.** Writes carry absolute values rather than
flips precisely so a repeat is harmless (see
[writes-retry-from-an-outbox](writes-retry-from-an-outbox.md)); the identity check is what makes the
repeat free as well as harmless. Since step 4 a repeat is routine rather than hypothetical — a
pending write is replayed over fetched rows on every hydration.

**Why it matters:** referential equality is what lets React skip re-rendering on a no-op dispatch.
A reducer that always spreads into a new object defeats that silently — nothing fails, the app just
re-renders on every miss.

**What to do:** new cases that mutate a list go through `updateList` and return the *same* list
object when they decide there is nothing to change. The tests named `is a no-op ...` assert this
with `toBe`, so a regression here is caught — that is what this entry's `verify:` runs.

The `verify:` command greps for the test names *before* running jest, because `jest -t` exits 0 when
its filter matches nothing: delete or rename those tests and the jest half alone would go on passing
while nothing was being checked.
