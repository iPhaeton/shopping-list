---
id: expo-crypto-undefined-under-jest
title: expo-crypto's randomUUID() returns undefined under jest instead of throwing
type: gotcha
status: current
tags: [testing, jest, expo, ids]
sources: [ai/tasks/3/implementation-log-step-1.md, ai/tasks/4-offline-support/implementation-log-step-1.md, ai/tasks/5-supabase-cloud/implementation-log-step-1.md, jest.setup.ts, src/lib/ids.ts]
last_verified: 2026-09-03
verify: grep -q "jest.mock('expo-crypto'" jest.setup.ts && grep -q "jest.mock('@react-native-async-storage/async-storage'" jest.setup.ts && grep -q '"<rootDir>/jest.setup.ts"' package.json && ! grep -q 'expo-device' jest.setup.ts && grep -q "jest.mock('expo-device'" src/lib/supabaseTarget.test.ts
related: [ids-minted-outside-reducer, writes-retry-from-an-outbox, list-cache-holds-acknowledged-rows, supabase-target-picked-at-runtime]
indexed: false
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

**`expo-device` is the third native module, and it deliberately is *not* in that file.** Step 5's
[src/lib/supabaseTarget.test.ts](../../../src/lib/supabaseTarget.test.ts) mocks it inside the suite,
because the whole point of the suite is to vary `Device.isDevice` per test — a global mock would
freeze it at one value and the branch table would go untested. So the split is: **a native module
whose behaviour every suite wants the same goes in `jest.setup.ts`; one whose value a suite needs to
steer is mocked in that suite.** The `verify:` command pins both halves, because moving the
`expo-device` mock into `jest.setup.ts` looks like tidying and silently guts the tests.

That module is also this entry's lesson repeating: `Device.isDevice` is exactly the kind of native
constant that can come back `undefined` rather than throwing, so `pickTarget()` carries an explicit
fallback and a test for it instead of trusting the flag.

**What to do:** keep [src/lib/ids.ts](../../../src/lib/ids.ts) as the single call site of
`randomUUID`, so this stays a one-line problem. A further native module used in code under test needs
a decision about *where* its mock lives — `jest.setup.ts` when one behaviour serves everyone, the
suite when the test steers it — and check first whether the library ships its own mock, as
AsyncStorage does. Retire this entry if the app stops minting ids on the client.

**Demoted out of `INDEX.md` at step 12** (`indexed: false`), not retired: still true, still checked
every audit, still found by `/librarian ask`, and linked from
[ids-minted-outside-reducer](ids-minted-outside-reducer.md), where anyone touching id minting starts,
and from [writes-retry-from-an-outbox](writes-retry-from-an-outbox.md) and
[list-cache-holds-acknowledged-rows](list-cache-holds-acknowledged-rows.md), where a storage test
starts — the shared in-memory AsyncStorage above is the trap those readers would otherwise miss.
No step since 5 has cited it, the fix is already wired in `jest.setup.ts`, and the `verify:` catches
the one edit that could undo it.
