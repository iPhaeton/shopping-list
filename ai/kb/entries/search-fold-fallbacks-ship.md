---
id: search-fold-fallbacks-ship
title: Search's accent fold and A–Z collator ship with fallbacks that iOS never takes — not dead code until Android's Hermes is measured
type: constraint
status: current
tags: [search, sort, hermes, android, intl]
sources: [ai/tasks/24-search-and-sort/implementation-log-step-3.md, src/state/arrange.ts, src/state/arrange.test.ts]
last_verified: 2026-10-03
verify: grep -qF "'é'.normalize('NFD').length === 2" src/state/arrange.ts && grep -qF ": (text) => foldByTable(text).replace(MARKS, '').toLowerCase();" src/state/arrange.ts && grep -qF "if (intl.compare('Item 2', 'Item 10') >= 0 || intl.compare('a', 'Á') !== 0) return null;" src/state/arrange.ts && grep -qF 'const compareText: (a: string, b: string) => number = collator() ?? compareFolded;' src/state/arrange.ts && grep -qF 'for (let code = 0xc0; code <= 0x17f; code++)' src/state/arrange.test.ts
related: [metro-inspector-reads-live-app-state, phone-is-the-product, native-build-toolchain]
indexed: false
---

**[src/state/arrange.ts](../../../src/state/arrange.ts) picks each of its two text primitives once,
at module load, by feature test — and both fallbacks are real, tested code paths.**

| primitive | primary path | taken when | fallback |
|---|---|---|---|
| `fold` (search: case and accents) | `normalize('NFD')`, marks stripped | `'é'.normalize('NFD').length === 2` | a table of 161 letters, U+00C0–U+017F, mapped to their base (`foldByTable`) |
| `compareText` (A–Z sort) | `Intl.Collator`, `sensitivity: 'base'`, `numeric: true` | the collator exists and `Item 2` < `Item 10` and `a` == `Á` | `compareFolded`: folded strings by code unit, digit runs as numbers |

The fold table was generated from Node's `normalize`, and
[arrange.test.ts](../../../src/state/arrange.test.ts) loads the module afresh with each feature taken
away and checks the fallback against the primary path over the table's whole range.

**Measured on iOS, not on Android.** On the iOS 27 simulator, Hermes `250829098.0.17`: NFD
decomposes, `typeof Intl.Collator` is `function`, `compare('Item 2', 'Item 10')` is −1 with
`numeric`, `compare('a', 'Á')` is 0 with `sensitivity: 'base'` — so **iOS takes both primary
paths**, and the fallbacks run there only in tests. Android's Hermes has not been measured: the
Android check was the user's call to skip, and the installed dev client predates `expo-blur`
([native-build-toolchain](native-build-toolchain.md)).

**Why both ship regardless:** the task's test list required both paths, so they were built
unconditionally rather than after the device checks. They are the answer if Android's build lacks
either feature.

**What to do:** do not delete a fallback, or the load-time check that picks it, as dead code until
Android's Hermes has been measured. Measure it in the running dev build through Metro's inspector
([metro-inspector-reads-live-app-state](metro-inspector-reads-live-app-state.md)) with the same four
expressions. If both primary paths hold there too, removing the fallbacks becomes a judgment call
rather than a risk — record the result here either way.
