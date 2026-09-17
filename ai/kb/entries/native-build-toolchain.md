---
id: native-build-toolchain
title: iOS simulator works, Android SDK and CocoaPods are absent — and a native dev build or community module is allowed the day a feature needs one
type: environment
status: current
tags: [environment, verification, expo, ios, android]
sources: [README.md, ai/suggestions/social-sign-in.md, ai/suggestions/otp-biometric-auth.md, ai/tasks/1/implementation-log-step-1.md, ai/tasks/2/implementation-log-step-2.md, ai/tasks/3/implementation-log-step-1.md, ai/tasks/5-supabase-cloud/implementation-log-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-2.md]
last_verified: 2026-09-17
verify: xcode-select -p | grep -q Xcode.app && xcrun simctl list devices available | grep -q iPhone
related: [expo-sdk-54-pinned, supabase-local-stack, supabase-target-picked-at-runtime, shoppingloop-is-the-visible-name-only, suggestions-are-proposals, expo-crypto-undefined-under-jest]
---

Machine state as of 2026-09-17, probed directly. **Xcode arrived on 2026-08-28** — before that this
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

**Two proposals were written under the old boundary and were revised on 2026-09-17 at the user's
direction** — the only suggestions edited so far; [suggestions-are-proposals](suggestions-are-proposals.md)
records the shape. Each carries a dated `**Revised 2026-09-17**` paragraph under its `**Date:**`
line, and the passages that stated the old premise are corrected in place under an *(revised
2026-09-17: …)* marker with the original wording still readable.
[ai/suggestions/social-sign-in.md](../../suggestions/social-sign-in.md) no longer says the project
"has decided not to buy" a dev build; its browser-based flow is still the proposed first step, now
for the reason that survives (no native setup at all), with native Google one-tap and Sign in with
Apple deferred by sequencing rather than policy.
[ai/suggestions/otp-biometric-auth.md](../../suggestions/otp-biometric-auth.md)'s Risks section no
longer believes Xcode is uninstalled, and its dead link to `no-native-build-toolchain` — a slug
commit `1dfeb14` deleted — now points here. Neither design changed.

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
and that no device has yet completed a sign-in against production. The simulator picks the local
stack like the browser and boots against it, though no sign-in has been driven there either. See
[supabase-local-stack](supabase-local-stack.md) for the state of both environments.

**Historical note:** the *original* absence of a toolchain is why this project is Expo rather than
bare React Native CLI. At scaffolding time a bare RN CLI app could have been created here but never
built or run, so Expo was chosen for its zero-toolchain web and Expo Go targets. Xcode showing up
since does not argue for ejecting, and neither does a dev build being allowed — a dev build is still
Expo, with the managed config intact; that reasoning explains the framework choice and nothing more.

**About the `verify:`.** The earlier version of this entry deliberately carried no check, on the
grounds that asserting the *absence* of a toolchain encodes a temporary machine state as an invariant
to defend, and would go red the day someone usefully installed Xcode. That is precisely what
happened. The check now asserts the **presence** that flipped — full Xcode selected, at least one
iPhone simulator available — where going red means the capability really was lost, which is worth
being told. The remaining absences stay unchecked for the same reason, and doubly so now that each is
expected to flip the day a feature needs it. Note that this command probes the *machine*, not the
repo, so it is expected to fail on any machine that is not this one; that is the check reporting
honestly rather than a broken command. Keep this entry and the Running section of
[README.md](../../../README.md) in step.
