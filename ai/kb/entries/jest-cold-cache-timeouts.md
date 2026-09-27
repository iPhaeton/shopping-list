---
id: jest-cold-cache-timeouts
title: The first `npm test` after an install or `--clearCache` times out a handful of screen tests — run it again before believing a failure
type: gotcha
status: current
tags: [testing, jest, environment]
sources: [ai/tasks/21-expo-sdk-57/implementation-log-step-1.md]
last_verified: 2026-09-27
verify: ! grep -q 'testTimeout' package.json jest.setup.ts
related: [expo-sdk-version, update-list-identity-preserving, native-build-toolchain]
indexed: false
---

**On a cold transform cache, `npm test` fails the first test of several screen suites with a
timeout.** All 8 workers transform React Native at once, and each suite's first test pays for that
inside Jest's default 5 s `testTimeout`. Task 21 saw 5–6 failures across 5 suites. Every warm run
passed: 3 out of 3, 27 suites and 489 tests. Run alone and cold, `SignInScreen.test.tsx`'s first
test takes 1.6 s.

**It is not the SDK upgrade, and it is not the app.** A pre-upgrade tree (SDK 54, from
`git archive HEAD` and `npm ci`) did the same, with 1 and then 4 failures in the same suites. A
loaded machine makes it worse. The repo lives in Dropbox, which re-syncs `node_modules/` after an
install ([native-build-toolchain](native-build-toolchain.md)).

**What to do:** after `npm install`, `npm ci`, an SDK upgrade, or `npx jest --clearCache`, run
`npm test` a second time before chasing a failure. A failure that survives a warm run is real.

Raising `testTimeout` would make this go away. That was left alone in task 21, because the
behaviour predates it. The `verify:` asserts no timeout override exists yet; retire this entry if
one is added.
