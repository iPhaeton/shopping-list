---
id: expo-sdk-version
title: The project is on Expo SDK 57 — read the v57 docs; SDK 54 cannot launch on this Mac's iOS 27, and Expo Go is no reason to go back
type: reference
status: current
tags: [expo, versions, docs, react-native-screens, hermes]
sources: [ai/tasks/21-expo-sdk-57/implementation-log-step-1.md, ai/docs/xcode-27-report-2026-09-27.md, 4d55c18, ai/tasks/20-ux/implementation-log-step-4.md, ai/tasks/20-ux/implementation-log-step-5.md]
last_verified: 2026-09-29
verify: grep -q '"expo": "~57' package.json && grep -q 'docs.expo.dev/versions/v57.0.0/' AGENTS.md && grep -q '"@react-native/jest-preset"' package.json && test "$(node -p "require('./package.json').dependencies['react-native-screens']")" = "$(node -p "require('expo/bundledNativeModules.json')['react-native-screens']")"
related: [ios-scene-support-is-opt-in, native-build-toolchain, expo-sdk-54-pinned, react-native-screens-past-the-sdk-pin, jest-cold-cache-timeouts, auto-theme-follows-the-time-zone]
indexed: false
---

The stack since task 21 (versions as [package.json](../../../package.json) asks for them):

| | |
|---|---|
| Expo SDK | ~57.0.25 — `@expo/cli` 57.0.27+ |
| React Native / React | 0.86.3 / 19.2.3 |
| TypeScript | ~6.0.3 |
| jest-expo | ~57.0.5, still Jest 29 |
| react-native-screens | ~4.26.0 — **the SDK's own pin again** |
| JS engine | Hermes V1 (`"Static Hermes": true`), the SDK 57 default |

**Read https://docs.expo.dev/versions/v57.0.0/**, which [AGENTS.md](../../../AGENTS.md) also
links. The unversioned docs track the newest SDK.

**Do not downgrade.** Commit `4d55c18` once moved the project from 57 to 54, only so Expo Go on a
phone could run it. That reason died in task 13: `src/lib/googleSignIn.ts` imports a native module
Expo Go lacks, so Expo Go cannot run this app on any SDK. And SDK 54 cannot run on this Mac at all
now. Xcode 27 builds it only with a setting overridden, and iOS 27 then kills it at launch for want
of the scene life cycle ([ios-scene-support-is-opt-in](ios-scene-support-is-opt-in.md)). The iOS
26 runtime that SDK 54 could still use has been deleted.

**Things that look wrong and are not:**

- `expo-crypto`, `expo-font`, `expo-dev-client`, … all sit at `~57.0.x`, task 20 step 5's
  `expo-blur` and `expo-splash-screen` included. SDK 55 made every Expo package share the SDK major.
- **`@react-native/jest-preset` is a required peer of jest-expo 57.** Nothing in the project
  imports it, so it looks unused. jest-expo's `jest-preset.js` loads it and throws without it,
  so removing it breaks every suite.
- `react-native-screens` needs no special handling any more. Task 20 held it at ~4.19, past SDK
  54's ~4.16, because 4.16 kills iOS 26's back button
  ([react-native-screens-past-the-sdk-pin](react-native-screens-past-the-sdk-pin.md), now
  superseded). SDK 57 pins 4.26, and `npx expo install --fix` is safe again. Both of that entry's
  repros popped every time on 4.26 on iOS 27. The iOS 26 runtime is gone from this Mac, so iOS 26
  itself was not re-run.

**Implementation logs describe older stacks.** Task 1's log records 57.0.16. Tasks 2–20 ran on SDK
54 with RN 0.81.5. Read them for why something was done, never for versions or APIs.

**The next upgrade:** SDK 58 adopts scenes in its template. Remove `ios.enableSceneSupport` then
([ios-scene-support-is-opt-in](ios-scene-support-is-opt-in.md)). After any install, run `npm test`
twice before believing a failure ([jest-cold-cache-timeouts](jest-cold-cache-timeouts.md)).

The `verify:` pins SDK 57, the docs link, the jest preset, and that `react-native-screens` asks for
exactly what the installed SDK bundles. Rewrite this entry in place on the next SDK move.
