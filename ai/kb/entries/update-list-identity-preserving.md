---
id: update-list-identity-preserving
title: Every write action is idempotent by id, and updateList returns the original state object when nothing changed
type: convention
status: current
tags: [state, reducer, immutability]
sources: [ai/tasks/1/implementation-log-step-1.md, ai/tasks/3/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-2.md, ai/tasks/8-realtime/implementation-log-step-1.md, ai/tasks/9-deletion/implementation-log-step-1.md, 6ef87a2]
last_verified: 2026-09-11
verify: grep -q 'is a no-op' src/state/listsReducer.test.ts && grep -q 'returns the same state object when the name is unchanged' src/state/listsReducer.test.ts && grep -q 'yields one row when a write the fetch already contains is replayed anyway' src/state/replay.test.ts && grep -q 'yields one item when an add the fetch already contains is replayed anyway' src/state/replay.test.ts && grep -q 'state.lists.some((candidate) => candidate.id === action.id)' src/state/listsReducer.ts && npx jest -t 'is a no-op|returns the same state object|yields one row|yields one item' --silent
related: [ids-minted-outside-reducer, writes-retry-from-an-outbox, list-cache-holds-acknowledged-rows, realtime-is-a-nudge-to-a-per-user-inbox, deletion-is-a-tombstone]
indexed: false
---

The private `updateList` helper in
[src/state/listsReducer.ts](../../../src/state/listsReducer.ts) returns the **original `state`
object**, not a fresh one, in two cases: the list id is unknown, and the `update` callback returned
the same list it was given. `item/setDone` leans on the second case twice over — it returns `list`
untouched when the item id is not in that list, *and* when the item already holds the `doneAt` value
being set. Step 7's `list/renamed` is the third case and follows the same shape: a rename to the name
the list already has returns that same list object.

**Step 8 extended this to the two actions that used to append blindly, and that is now the bigger
half of the entry.** `list/created` and `item/added` are **idempotent by id**: a create whose id is
already in `state.lists` becomes a rename through `updateList`, and an add whose id is already in the
list becomes a title update that deliberately leaves `doneAt` alone — somebody may have ticked it
since. Both therefore return the same list object when the fetched row already matches, which is what
makes `replay(fetched, outbox)` idempotent.

Why it changed: appending blindly was only ever safe because a row cannot be in the fetched set *and*
still in the outbox — an invariant the provider keeps by never letting a fetch and a flush overlap.
Realtime fetches far more often
([realtime-is-a-nudge-to-a-per-user-inbox](realtime-is-a-nudge-to-a-per-user-inbox.md)), so that
invariant went from incidental to load-bearing and the reducer was hardened instead of relied upon.
**This does not license caching the replayed view** — that rule has its own reason
([list-cache-holds-acknowledged-rows](list-cache-holds-acknowledged-rows.md)) — and the fold itself
stays one level up in `replay.ts`, where it can be pure.

**Step 9's two `setDeleted` arms are the fourth and fifth cases, and `list/setDeleted` is the one to
look at.** It goes through `updateList` like every other change to a list rather than filtering
`state.lists` — a binned list stays in the array, where the bin can show it and a restore can find it
([deletion-is-a-tombstone](deletion-is-a-tombstone.md)). Both arms return the same list object when
`deletedAt` already holds the value being set, and `item/added` now leaves `deletedAt` alone as well
as `doneAt` when the id is already there, for the same reason: somebody may have binned it since.

**That second condition is load-bearing beyond rendering.** Writes carry absolute values rather than
flips precisely so a repeat is harmless (see
[writes-retry-from-an-outbox](writes-retry-from-an-outbox.md)); the identity check is what makes the
repeat free as well as harmless. Since step 4 a repeat is routine rather than hypothetical — a
pending write is replayed over fetched rows on every hydration.

**Why it matters:** referential equality is what lets React skip re-rendering on a no-op dispatch.
A reducer that always spreads into a new object defeats that silently — nothing fails, the app just
re-renders on every miss.

**What to do:** a new case that creates something matches on id first and updates rather than
appends; a new case that mutates a list goes through `updateList` and returns the *same* list object
when it decides there is nothing to change. The tests named `is a no-op ...` assert this with `toBe`,
so a regression is caught — that is what this entry's `verify:` runs.

The `verify:` command greps for the test names *before* running jest, because `jest -t` exits 0 when
its filter matches nothing: delete or rename those tests and the jest half alone would go on passing
while nothing was being checked. It names four patterns — the `is a no-op …` family, the rename case
("returns the same state object when the name is unchanged"), and step 8's two replay tests, which
were **inverted** from a test that used to assert duplication. The `-t` filter is a regex, so all of
them run together. It also greps the reducer for the `list/created` id check directly, since that arm
is the one a refactor would "simplify" back into an append. Name a new no-op test to match one of the
patterns, or add it here.
