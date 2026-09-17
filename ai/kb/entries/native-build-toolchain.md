---
id: native-build-toolchain
title: iOS simulator and Android emulator both work; CocoaPods is still absent — and a native dev build or community module is allowed the day a feature needs one
type: environment
status: current
tags: [environment, verification, expo, ios, android]
sources: [README.md, ai/suggestions/social-sign-in.md, ai/suggestions/otp-biometric-auth.md, ai/tasks/1/implementation-log-step-1.md, ai/tasks/2/implementation-log-step-2.md, ai/tasks/3/implementation-log-step-1.md, ai/tasks/5-supabase-cloud/implementation-log-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-2.md]
last_verified: 2026-09-17
verify: xcode-select -p | grep -q Xcode.app && xcrun simctl list devices available | grep -q iPhone && test -x ~/Library/Android/sdk/platform-tools/adb && test -x ~/Library/Android/sdk/emulator/emulator
related: [expo-sdk-54-pinned, supabase-local-stack, supabase-target-picked-at-runtime, shoppingloop-is-the-visible-name-only, suggestions-are-proposals, expo-crypto-undefined-under-jest]
---

Machine state as of 2026-09-17, probed directly. **Xcode arrived on 2026-08-28, the Android SDK and
an emulator on 2026-09-17** — before that this entry said neither existed, and any advice you
remember to that effect is out of date.

**Works today, no setup:**

| target | command | what backs it |
|---|---|---|
| web | `npm run web` | dev server at http://localhost:8081; Playwright MCP is allowlisted for driving it |
| iOS simulator | `npm run ios` | Xcode 26.6 and the iOS 26.5 runtime, both installed — boots a simulator and opens the app in Expo Go |
| Android emulator | `npm run android` | Android SDK, platform-tools, emulator and a `Pixel_10` AVD (arm64 Google Play image) all installed — boots the emulator and opens the app in Expo Go |
| physical device | `npm start` | QR code into Expo Go |

`xcode-select -p` points at `/Applications/Xcode.app/Contents/Developer` (it used to point at
`/Library/Developer/CommandLineTools`), so `xcrun simctl` works and iPhone-family simulators are
available — ask `xcrun simctl list devices available` rather than trusting a list written down here.
`ANDROID_HOME` is `~/Library/Android/sdk`, exported from `~/.zshrc`; the SDK holds platform-tools,
emulator, build-tools and one AVD, `Pixel_10`, an arm64 Google Play image (this machine is Apple
Silicon, so no HAXM/x86 image applies). `npm run ios` and `npm run android` have each been run end
to end and opened the app in the simulator or emulator; that, not just a probe of the tools, is the
evidence behind this entry — `adb devices` showing `emulator-5554 device` after boot is the
mechanical proof for Android, matching what `xcrun simctl` gives for iOS.

**Still absent:**

- **Everything a native dev build needs.** There is no `ios/` directory (`/ios` and `/android` are
  gitignored — still the managed workflow), `pod` and `eas` are not on PATH, `expo-dev-client` is
  not in `package.json`, and [app.json](../../../app.json) has no `ios.bundleIdentifier`. Nothing the
  app imports needs more than Expo Go carries: `expo-crypto` and `expo-device` are the two native
  modules it calls directly, both Expo SDK modules and so present in Expo Go (though absent under
  jest — a separate problem with its own fix in
  [expo-crypto-undefined-under-jest](expo-crypto-undefined-under-jest.md)).

**That absence is a description of the current state, not a rule — since 2026-09-17.** Earlier
versions of this entry read the same facts as a boundary: "don't reach for `expo prebuild` or `pod
install`", "a community native module would break the managed workflow". On 2026-09-17 the user set
that aside in chat, directing that agents **assume community native modules may be used when a
feature needs them, and assume a paid Apple Developer account will be made available when something
needs one** — a dev build on a physical iPhone, TestFlight, the App Store, Sign in with Apple. The
Running section of [README.md](../../../README.md) records the same. So the first feature that pulls
in a module Expo Go does not carry brings a dev build (`npx expo run:ios`, or `expo-dev-client` on
top of the dev server) with it, and that is an allowed outcome — not a smell to design around.

What that costs is real and still unpaid. Pay it *when* a task calls for it, not before:

- **CocoaPods** — `brew install cocoapods`. The system Ruby is 2.6.10, too old for current gems, so
  `sudo gem install cocoapods` is the wrong turn.
- **An `ios.bundleIdentifier`** — none is set, and `ai/marketing/app-naming-candidates.md` notes
  the same. Choose it deliberately: it is the app's permanent identity on the App Store, and
  [shoppingloop-is-the-visible-name-only](shoppingloop-is-the-visible-name-only.md) says which
  machine identifiers are meant to stay `shopping-list`.
- **`expo-dev-client`**, if the build is to keep the dev-server loop rather than be a one-off run.
- **The Apple Developer account**, for a physical device or a store build — ask for it. The
  simulator needs none, and neither does anything above.

Two preferences survive the change. Reach for an Expo SDK module first when one does the job —
`expo-device` was weighed against this entry before being added, an SDK module over a community one
([supabase-target-picked-at-runtime](supabase-target-picked-at-runtime.md)), and keeping Expo Go as a
target keeps the cheapest device loop there is. And do not add a dev build speculatively: the
`scheme` in `app.json` (step 2) is groundwork for one, not one.

Two suggestion docs were written under the old boundary and revised on 2026-09-17 at the user's
direction to match the current one —
[suggestions-are-proposals](suggestions-are-proposals.md) records the shape of that revision.
[ai/suggestions/social-sign-in.md](../../suggestions/social-sign-in.md) and
[ai/suggestions/otp-biometric-auth.md](../../suggestions/otp-biometric-auth.md) no longer assume no
native toolchain exists; neither design changed.

**Picking a target.** Web is still the fastest loop for ordinary UI and state work, and `npm test`
covers the reducer, so a simulator or emulator arriving is not a reason to stop using either. Reach
for one when what you are checking is platform-specific — safe-area insets, keyboard and gesture
behaviour, real navigation animations — where `react-native-web`'s shims genuinely differ from the
device. A screenshot from either is now a cheap verification step; it was not before.

**The browser is still the only target verified end to end behind sign-in, but the reason changed in
step 5.** It used to be reachability: everything ran on this machine's `127.0.0.1` and a phone in
Expo Go stopped at the sign-in screen no matter how healthy the native tooling was. A device now gets
a cloud project instead ([supabase-target-picked-at-runtime](supabase-target-picked-at-runtime.md)),
so the wall is gone — what remains is that only Mailpit makes the six-digit code machine-readable,
and that no device has yet completed a sign-in against production. The simulator and the emulator
both pick the local stack like the browser and boot against it, though no sign-in has been driven on
either yet. See [supabase-local-stack](supabase-local-stack.md) for the state of both environments.

**Historical note:** the *original* absence of a toolchain is why this project is Expo rather than
bare React Native CLI. At scaffolding time a bare RN CLI app could have been created here but never
built or run, so Expo was chosen for its zero-toolchain web and Expo Go targets. Xcode and the
Android SDK showing up since does not argue for ejecting, and neither does a dev build being
allowed — a dev build is still Expo, with the managed config intact; that reasoning explains the
framework choice and nothing more.

**About the `verify:`.** The earlier version of this entry deliberately carried no check, on the
grounds that asserting the *absence* of a toolchain encodes a temporary machine state as an invariant
to defend, and would go red the day someone usefully installed it. That is precisely what happened
twice — Xcode on 2026-08-28, the Android SDK on 2026-09-17. The check now asserts the **presence**
that flipped: full Xcode selected with at least one iPhone simulator, and `adb`/`emulator` present
under `~/Library/Android/sdk` rather than `$ANDROID_HOME` (the audit runs `verify:` under `/bin/sh`,
which never sources `~/.zshrc`) — where going red means a capability really was lost, which is worth
being told. Both halves probe the *machine*, not the repo, so a FAIL on any machine but this one is
expected and honest, not a broken command. The remaining absences stay unchecked for the same reason,
doubly so now that each is expected to flip the day a feature needs it. Keep this entry and the
Running section of [README.md](../../../README.md) in step.
