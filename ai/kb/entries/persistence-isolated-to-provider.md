---
id: persistence-isolated-to-provider
title: Storage, if it ever lands, touches only ListsContext
type: decision
status: current
tags: [state, architecture, persistence]
sources: [ai/tasks/1/implementation-log-step-1.md, README.md, 6ef87a2]
last_verified: 2026-08-26
verify: test "$(grep -rl useReducer src --include='*.ts' --include='*.tsx')" = src/state/ListsContext.tsx
related: [scope-boundaries, ids-minted-outside-reducer]
---

The state layer was shaped so that persistence would be a **single-file change**.
[src/state/ListsContext.tsx](../../../src/state/ListsContext.tsx) owns the `useReducer` call, mints
ids, and exposes `useLists()`. The reducer is pure and the screens read through the hook, so neither
knows where state comes from.

**Decision:** when storage arrives, it goes in the provider — hydrate the reducer's initial state
there and write on change. The reducer, the screens, and the components stay untouched.

**Why it matters:** the obvious alternative — reaching for AsyncStorage inside the reducer or in
each screen's `useEffect` — spreads I/O through pure code and breaks the tests' ability to run
without mocking storage.

Persistence is currently out of scope: see [scope-boundaries](scope-boundaries.md). This entry is the
plan for *if* it lands, not a licence to build it. Being a `decision`, it is never edited — a
different approach supersedes it with a new entry.

The `verify:` command asserts what makes the plan possible: `ListsContext.tsx` is the **only** file
under `src/` that calls `useReducer`. A screen that grew its own reducer state would break the
single-file property, and the check fails the moment a second file appears.
