---
id: no-native-build-toolchain
title: This machine cannot build native — verify on web or Expo Go
type: environment
status: current
tags: [environment, verification, expo]
sources: [ai/tasks/1/implementation-log-step-1.md, README.md]
last_verified: 2026-08-26
related: [expo-sdk-54-pinned]
---

`npm run ios` and `npm run android` **do not work here**. The machine has only Xcode Command Line
Tools — no full Xcode, so no `simctl` and no simulator — no Android SDK (`ANDROID_HOME` unset), and
no CocoaPods.

Verify changes one of two ways:

- `npm run web` — Expo dev server at http://localhost:8081. Playwright MCP is allowlisted for
  driving it, which is how step 1 was verified end to end.
- `npm start` — QR code for Expo Go on a physical device.

**Why it matters:** this constraint chose the framework. A bare React Native CLI project could be
scaffolded here but never built or run, which is why the project is Expo. Do not propose native
builds, `pod install`, or simulator screenshots as verification steps — suggest the web run instead.

No `verify:` command: probing for a toolchain that is deliberately absent is slow and noisy.
Re-check by hand if the machine changes.
