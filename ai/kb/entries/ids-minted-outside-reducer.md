---
id: ids-minted-outside-reducer
title: Ids are minted outside the reducer and arrive on the action
type: convention
status: current
tags: [state, reducer, testing]
sources: [ai/tasks/1/implementation-log-step-1.md]
last_verified: 2026-08-26
verify: ! grep -qE 'randomUUID|Date\.now|Math\.random' src/state/listsReducer.ts
related: [persistence-isolated-to-provider, update-list-identity-preserving]
---

[src/state/listsReducer.ts](../../../src/state/listsReducer.ts) never generates an id. Every action
that creates something carries the new id on it (`{ type: 'list/created', id, name }`).
[src/state/ListsContext.tsx](../../../src/state/ListsContext.tsx) mints ids in its action creators,
via a module-level `makeId(prefix)` counter.

**Why it matters:** it keeps the reducer pure and deterministic, so
[src/state/listsReducer.test.ts](../../../src/state/listsReducer.test.ts) passes literal ids
(`'l1'`, `'i1'`) and needs no mocking of `Date.now` or `crypto.randomUUID`.

**What to do:** when adding a case that creates an entity, put the id on the action and mint it in
the provider. Reaching for `crypto.randomUUID()` inside the reducer is the mistake this prevents,
and it breaks every existing test's determinism.
