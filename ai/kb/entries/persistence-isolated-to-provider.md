---
id: persistence-isolated-to-provider
title: Storage, if it ever lands, touches only ListsContext
type: decision
status: current
tags: [state, architecture, persistence]
sources: [ai/tasks/1/implementation-log-step-1.md, ai/tasks/2/implementation-log-step-2.md, README.md, 6ef87a2]
last_verified: 2026-08-30
verify: test "$(grep -rl 'useReducer(' src --include='*.ts' --include='*.tsx')" = src/state/ListsContext.tsx
related: [scope-boundaries, ids-minted-outside-reducer, supabase-client-module-boundary]
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

Auth took this shape and did not disturb it: `SessionContext` holds its session in plain `useState`,
and its Supabase client sits behind its own module seam — see
[supabase-client-module-boundary](supabase-client-module-boundary.md). List state remains untouched
by step 2.

The `verify:` command asserts what makes the plan possible: `ListsContext.tsx` is the **only** file
under `src/` that calls `useReducer`. A screen that grew its own reducer state would break the
single-file property, and the check fails the moment a second file appears.

**The check greps text, so a *comment* naming the hook trips it too.** In step 2 the audit went red
on a comment in `SessionContext.tsx` that explained the file deliberately does not use a reducer —
the check cannot tell prose from code. The command now matches `useReducer(` rather than the bare
name, which lets ordinary prose through; write "reach for a reducer" rather than the call form if
you need to mention it. Do not edit source to satisfy this check: if a second file legitimately
calls `useReducer`, the decision above is what changed, and it needs a superseding entry.
