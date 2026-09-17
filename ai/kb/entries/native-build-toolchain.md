---
id: native-build-toolchain
title: iOS simulator works on this machine; Android SDK and CocoaPods are still absent
type: environment
status: current
tags: [environment, verification, expo, ios, android]
sources: [README.md, ai/tasks/1/implementation-log-step-1.md, ai/tasks/2/implementation-log-step-2.md, ai/tasks/3/implementation-log-step-1.md, ai/tasks/5-supabase-cloud/implementation-log-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-2.md]
last_verified: 2026-09-17
verify: xcode-select -p | grep -q Xcode.app && xcrun simctl list devices available | grep -q iPhone
related: [expo-sdk-54-pinned, supabase-local-stack, supabase-target-picked-at-runtime, shoppingloop-is-the-visible-name-only]
---

Machine state as of 2026-08-29, probed directly. **Xcode arrived on 2026-08-28** — before that this
entry said no simulator existed, and any advice you remember to that effect is out of date.

**Works today, no setup:**

| target | command | what backs it |
|---|---|---|
| web | `npm run web` | dev server at http://localhost:8081; Playwright MCP is allowlisted for driving it |
| iOS simulator | `npm run ios` | Xcode 26.6 and the iOS 26.5 runtime, both installed — boots a simulator and opens the app in Expo Go |
| physical device | `npm start` | QR code into Expo Go |

`xcode-select -p` points at `/Applications/Xcode.app/Contents/Developer` (it used to point at
`/Library/Developer/CommandLineTools`), so `xcrun simctl` works and iPhone-family simulators are
available — ask `xcrun simctl list devices available` rather than trusting a list written down here.
`npm run ios` has been run end to end and the app opened in the simulator; that, not just a probe of
the tools, is the evidence behind this entry.

**Still absent:**

- **Android.** `ANDROID_HOME` is unset and there is no `~/Library/Android/sdk`, so `npm run android`
  fails. Android Studio is the install if a task genuinely needs it.
- **CocoaPods.** `pod` is not on PATH. The system Ruby is 2.6.10, too old for current CocoaPods
  gems, so `sudo gem install cocoapods` is the wrong turn — `brew install cocoapods` is the route.

**A native dev build is neither set up nor needed.** There is no `ios/` directory: this is still the
managed workflow, and `/ios` and `/android` are gitignored. `npx expo run:ios` would need CocoaPods
*and* an `ios.bundleIdentifier` in [app.json](../../../app.json), which is not there. Nothing in the
app calls for one — `expo-status-bar`, `react-native-screens`, `react-native-safe-area-context` and
React Navigation all ship inside the Expo Go runtime — as do `@supabase/supabase-js` and
`@react-native-async-storage/async-storage`, added in step 2, `expo-crypto`, added in step 3, and
`expo-device`, added in step 5. `expo-crypto` is the first *native* module the app calls directly; it
is an Expo SDK module and so is present in Expo Go, but note it is absent under jest, which is a
separate problem with a separate fix
— see [expo-crypto-undefined-under-jest](expo-crypto-undefined-under-jest.md). `expo-device` is the
second, and was weighed against exactly this entry before being added: an Expo SDK module keeps the
managed workflow intact, where a community native module would not have. So don't reach for `expo prebuild` or
`pod install`; they cost an install to buy what Expo Go already gives you. Step 2 did add a
`scheme` to `app.json`, which is groundwork for a future dev build (the proposed biometric unlock
needs one) — it is not a dev build and does not imply one exists.

**Picking a target.** Web is still the fastest loop for ordinary UI and state work, and `npm test`
covers the reducer, so the simulator arriving is not a reason to stop using either. Reach for the
simulator when what you are checking is platform-specific — safe-area insets, keyboard and gesture
behaviour, real navigation animations — where `react-native-web`'s shims genuinely differ from the
device. A simulator screenshot is now a cheap verification step; it was not before.

**The browser is still the only target verified end to end behind sign-in, but the reason changed in
step 5.** It used to be reachability: everything ran on this machine's `127.0.0.1` and a phone in
Expo Go stopped at the sign-in screen no matter how healthy the native tooling was. A device now gets
a cloud project instead ([supabase-target-picked-at-runtime](supabase-target-picked-at-runtime.md)),
so the wall is gone — what remains is that only Mailpit makes the six-digit code machine-readable,
and that no device has yet completed a sign-in against production. The simulator picks the local stack like the
browser and boots against it, though no sign-in has been driven there either. See
[supabase-local-stack](supabase-local-stack.md) for the state of both environments.

**Historical note:** the *original* absence of a toolchain is why this project is Expo rather than
bare React Native CLI. At scaffolding time a bare RN CLI app could have been created here but never
built or run, so Expo was chosen for its zero-toolchain web and Expo Go targets. Xcode showing up
since does not argue for ejecting — that reasoning explains the framework choice and nothing more.

**About the `verify:`.** The earlier version of this entry deliberately carried no check, on the
grounds that asserting the *absence* of a toolchain encodes a temporary machine state as an invariant
to defend, and would go red the day someone usefully installed Xcode. That is precisely what
happened. The check now asserts the **presence** that flipped — full Xcode selected, at least one
iPhone simulator available — where going red means the capability really was lost, which is worth
being told. The remaining absences stay unchecked for the original reason. Note that this command
probes the *machine*, not the repo, so it is expected to fail on any machine that is not this one;
that is the check reporting honestly rather than a broken command. Keep this entry and the Running
section of [README.md](../../../README.md) in step.
