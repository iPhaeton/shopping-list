---
id: expo-crypto-undefined-under-jest
title: expo-crypto's randomUUID() returns undefined under jest instead of throwing
type: gotcha
status: current
tags: [testing, jest, expo, ids]
sources: [ai/tasks/3/implementation-log-step-1.md, ai/tasks/4-offline-support/implementation-log-step-1.md, jest.setup.ts, src/lib/ids.ts]
last_verified: 2026-09-01
verify: grep -q "jest.mock('expo-crypto'" jest.setup.ts && grep -q "jest.mock('@react-native-async-storage/async-storage'" jest.setup.ts && grep -q '"<rootDir>/jest.setup.ts"' package.json
related: [ids-minted-outside-reducer, writes-retry-from-an-outbox, list-cache-holds-acknowledged-rows]
---

`randomUUID()` from `expo-crypto` is a native call. jest-expo mocks native modules away, and this
one does not throw when it is missing — it quietly returns `undefined`. Every row created in a test
would get the same id, and the failure would surface far from the cause, as a duplicate-key error or
a list that mysteriously has one item.

The fix is [jest.setup.ts](../../../jest.setup.ts), wired in through `setupFiles` in
[package.json](../../../package.json), mapping `expo-crypto`'s `randomUUID` onto Node's:

```ts
jest.mock('expo-crypto', () => ({
  randomUUID: () => (require('node:crypto') as typeof import('node:crypto')).randomUUID(),
}));
```

**The `require` inside the factory is not a style choice.** `jest.mock` is hoisted above the imports,
so a factory may not close over a top-level import — reaching for one throws "The module factory of
jest.mock() is not allowed to reference any out-of-scope variables".

**The general lesson is the one worth carrying:** a jest-expo native mock can be silently *falsy*
rather than absent, so a new native module is worth probing before writing tests against it. That is
how this was caught — a throwaway suite that did nothing but log the return value.

**AsyncStorage is the second module in that file, and it works out better.** The outbox and the list
cache read and write real storage, so step 4 added
`jest.mock('@react-native-async-storage/async-storage', () => require('.../jest/async-storage-mock'))`
— the library ships an in-memory stand-in for exactly this. Two consequences worth knowing before
writing a suite that touches storage:

- **Nothing above it is mocked.** `src/lib/outbox.ts` and `src/lib/listCache.ts` run for real, so
  what a test asserts is the round trip through disk. That is the point: "the write survives a
  restart" is the promise being tested, and a mocked outbox would assert nothing.
- **The store is shared and persists between tests.** Every suite that touches it does
  `await AsyncStorage.clear()` in `beforeEach`; skip that and one test's outbox flushes inside the
  next one, which reads as a mysterious extra call.

**What to do:** keep [src/lib/ids.ts](../../../src/lib/ids.ts) as the single call site of
`randomUUID`, so this stays a one-line problem. Any further native module used in code under test
needs its own entry in `jest.setup.ts`; that file is the place for them, not a `jest.mock` repeated
in each suite — and check first whether the library ships its own mock, as AsyncStorage does. Retire
this entry if the app stops minting ids on the client.
