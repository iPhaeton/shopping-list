---
id: ids-minted-outside-reducer
title: Ids and timestamps are minted outside the reducer and arrive on the action
type: convention
status: current
tags: [state, reducer, testing]
sources: [ai/tasks/1/implementation-log-step-1.md, ai/tasks/3/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-2.md]
last_verified: 2026-09-11
verify: ! grep -qE 'randomUUID|Date\.now|Math\.random|toISOString|newId' src/state/listsReducer.ts && grep -q 'newId()' src/state/ListsContext.tsx
related: [writes-retry-from-an-outbox, server-stamps-done-at, update-list-identity-preserving, expo-crypto-undefined-under-jest]
---

[src/state/listsReducer.ts](../../../src/state/listsReducer.ts) generates nothing non-deterministic.
Every action that creates something carries the new id on it
(`{ type: 'list/created', id, name }`), and
[src/state/ListsContext.tsx](../../../src/state/ListsContext.tsx) mints it at dispatch time via
`newId()` from [src/lib/ids.ts](../../../src/lib/ids.ts).

**As of step 3 the same rule governs a second value: the `doneAt` timestamp.** `item/setDone` carries
the absolute value the item should hold — `new Date().toISOString()` or `null` — computed in the
provider. The reducer is never asked to read the clock, and never asked to flip.

**Step 8's idempotency change does not touch this.** `list/created` and `item/added` now match on the
id the action already carries before deciding to append or update
([update-list-identity-preserving](update-list-identity-preserving.md)); the id is still minted in
the provider and the reducer still reads no clock.

**The rule is about non-determinism, not about every field.** Step 7's `list/created` writes
`role: 'owner'` inside the reducer without it arriving on the action, and that is fine: it is a
constant the database's `on_list_created` trigger is guaranteed to agree with, so the case stays a
pure function of its input. Do not "fix" it by putting `role` on the action.

**And it is about values that are *created*, not every write.** `list/renamed`, the fourth action,
mints nothing at all: the list already has its id, and the name comes from the user. There is no
`renamedAt` on it, because nothing stores one — do not add a timestamp to an action just to match
the shape of `item/setDone`.

**That timestamp is only a placeholder for the optimistic row.** The stored `done_at` is minted by
Postgres, not by the device, and the request that triggers it carries a boolean
([server-stamps-done-at](server-stamps-done-at.md)). The convention here is untouched — the value
still arrives on the action and the reducer stays deterministic — but do not read the dispatched
`doneAt` as the time the database holds.

**The ids are uuids now, not the `makeId(prefix)` counter** that produced `list-1` and `item-3`
before persistence landed. Counter ids cannot be primary keys in a table shared by every account, and
two devices would collide on `item-3` immediately. `newId()` wraps `expo-crypto`'s `randomUUID`,
which is a native call — hence the mock in `jest.setup.ts`, and why that call has its own module:
see [expo-crypto-undefined-under-jest](expo-crypto-undefined-under-jest.md).

**Why it matters:** it keeps the reducer pure and deterministic, so
[src/state/listsReducer.test.ts](../../../src/state/listsReducer.test.ts) passes literal ids
(`'l1'`, `'i1'`) and fixed timestamp strings, and needs no fake timers and no uuid mocking. Minting
the id up front is also what makes the optimistic write possible — the row is on screen under the
same id the insert was given, so a retry cannot duplicate it. Since step 4 that property is load
bearing rather than merely tidy: a queued insert may be sent many times, and the duplicate-key error
the second one earns is read as "already applied"
([writes-retry-from-an-outbox](writes-retry-from-an-outbox.md)).

**What to do:** a new case that creates an entity, or records a moment, puts the value on the action
and mints it in the provider. `crypto.randomUUID()` or `new Date()` inside the reducer is the mistake
this prevents; the `verify:` command greps for both.
