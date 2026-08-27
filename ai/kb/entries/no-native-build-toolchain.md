---
id: no-native-build-toolchain
title: No native toolchain installed yet — web and Expo Go are the default verification path
type: environment
status: current
tags: [environment, verification, expo]
sources: [ai/tasks/1/implementation-log-step-1.md, README.md]
last_verified: 2026-08-27
related: [expo-sdk-54-pinned]
---

As of 2026-08-27 this machine has only Xcode Command Line Tools (`/Library/Developer/CommandLineTools`)
— no full Xcode, so no `simctl` and no simulator — no Android SDK (`ANDROID_HOME` unset, no
`~/Library/Android/sdk`), and no CocoaPods. So `npm run ios` and `npm run android` fail today.

**Reach for these first — they need no setup:**

- `npm run web` — Expo dev server at http://localhost:8081. Playwright MCP is allowlisted for
  driving it, which is how step 1 was verified end to end.
- `npm start` — QR code for Expo Go on a physical device.

**The absence is incidental, not a rule.** Nothing about this project forbids native builds; the
tools simply have not been installed. If a task genuinely needs one — a native module, a config
plugin, a build-time behaviour web and Expo Go cannot show — then installing Xcode or Android
Studio is a legitimate option. Raise it with the user and let them decide; do not silently assume a
native build is off the table, and do not quietly burn an hour installing one either.

What still follows from today's state: don't *default* to `pod install`, an `expo prebuild`, or a
simulator screenshot as the verification step for ordinary UI and state work. Those cost a
toolchain install to buy something the web run already shows.

**Historical note:** this is why the project is Expo rather than bare React Native CLI. When the
project was scaffolded, a bare RN CLI app could have been created here but never built or run,
so Expo was chosen for its zero-toolchain web and Expo Go targets. That reasoning explains the
framework choice; it is not an ongoing prohibition.

No `verify:` command. A probe would have to assert *the absence of* a toolchain, which encodes a
temporary machine state as an invariant to defend — it would go red the day someone usefully
installs Xcode, which is exactly the outcome this entry permits. Re-check by hand when the machine
changes and overwrite this entry, per the charter's rule for `environment` facts. The Running
section of [README.md](../../README.md) says the same thing for humans; keep the two in step.
