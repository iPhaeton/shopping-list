---
id: native-build-toolchain
title: A native dev build works end to end on both platforms — `npm run ios`/`npm run android` build it, not Expo Go; after a non-clean prebuild, run `pod install` yourself
type: environment
status: current
tags: [environment, verification, expo, ios, android, java]
sources: [README.md, ai/marketing/app-naming-candidates.md, app.json, package.json, ai/suggestions/social-sign-in.md, ai/suggestions/otp-biometric-auth.md, ai/tasks/1/implementation-log-step-1.md, ai/tasks/2/implementation-log-step-2.md, ai/tasks/3/implementation-log-step-1.md, ai/tasks/5-supabase-cloud/implementation-log-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-2.md, ai/tasks/13-google-sign-in/plan-step-1.md, ai/tasks/13-google-sign-in/implementation-log-step-1.md, ai/tasks/13-google-sign-in/implementation-log-step-2.md, ai/tasks/20-ux/implementation-log-step-1.md]
last_verified: 2026-09-25
verify: xcode-select -p | grep -q Xcode.app && xcrun simctl list devices available | grep -q 'iPhone 17e' && test -x ~/Library/Android/sdk/platform-tools/adb && test -x ~/Library/Android/sdk/emulator/emulator && command -v pod >/dev/null && grep -q '"expo-dev-client"' package.json && test "$(node -p "require('./app.json').expo.ios.bundleIdentifier")" = com.shoppingloop.app && test "$(node -p "require('./app.json').expo.android.package")" = com.shoppingloop.app && grep -q '"android": "expo run:android"' package.json && grep -q '"ios": "expo run:ios"' package.json && test -x /opt/homebrew/opt/openjdk/bin/java && /opt/homebrew/opt/openjdk/bin/java -version 2>&1 | grep -qE '"(1[7-9]|[2-9][0-9])' && (! test -f android/app/build.gradle || grep -q "storeFile file('debug.keystore')" android/app/build.gradle)
related: [expo-sdk-54-pinned, supabase-local-stack, supabase-target-picked-at-runtime, shoppingloop-is-the-visible-name-only, suggestions-are-proposals, expo-crypto-undefined-under-jest, scope-boundaries, google-native-signin-library-gaps, maestro-drives-the-native-ui, phone-is-the-product, theme-reaches-native-surfaces]
---

Machine state as of 2026-09-25. **`npm run ios` and `npm run android` do not boot Expo Go** — they
run `expo run:ios`/`expo run:android`, which build and install the native dev client. Anything that
assumes those scripts open Expo Go is wrong. Since task 20 the phone is the product and visual
sign-off happens on these builds ([phone-is-the-product](phone-is-the-product.md)).

| target | command | what backs it |
|---|---|---|
| web | `npm run web` | dev server at http://localhost:8081; Playwright MCP is allowlisted for driving it |
| iOS simulator, dev build | `npm run ios -- --device "iPhone 17e"` | Xcode 26.6, iOS 26.5 runtime, CocoaPods. **Booted end to end 2026-09-25** on the iPhone 17e, then the 17 Pro Max |
| Android emulator, dev build | `npm run android` | SDK, platform-tools, emulator, one AVD (`Pixel_10`, arm64 Google Play); end to end since 2026-09-17 |
| either, Expo Go | `npx expo start --ios --go` / `--android --go` | still works, but has none of this project's native modules |
| physical device | `npm start` | QR code into Expo Go — not reverified since `expo-dev-client` landed; it may now default away from Expo Go, confirm first |

`xcode-select -p` is `/Applications/Xcode.app/Contents/Developer`; `ANDROID_HOME` is
`~/Library/Android/sdk`, exported from `~/.zshrc`. Reprobe devices with `adb devices` /
`xcrun simctl list` rather than trusting a list written here. Driving either app's UI:
[maestro-drives-the-native-ui](maestro-drives-the-native-ui.md).

**iOS — three things that cost a cycle in task 20 step 1:**

- **`npx expo prebuild --platform ios` (without `--clean`) does not reinstall pods.** After adding a
  native module, `Podfile.lock` still pointed at the old module paths and lacked the new one
  (`ExpoSystemUI`). Run `cd ios && pod install` before `npm run ios`.
- **The built `.app` lands in Xcode's DerivedData** —
  `~/Library/Developer/Xcode/DerivedData/ShoppingLoop-*/Build/Products/Debug-iphonesimulator/ShoppingLoop.app`
  — not `ios/build`, which only ever holds `generated/`. "`ios/build` has no `.app`" was never
  evidence that the build had not run.
- That `.app` can be `xcrun simctl install`ed onto another simulator with no rebuild — how the 17 Pro
  Max was checked.

**Android.** `npm run android -- --no-bundler` builds against the Metro that `npm run ios` already
started. **The Android Gradle Plugin needs Java 17+, and plain `java` resolved to 11** —
`/usr/libexec/java_home` registers only Homebrew's `openjdk@11`, though the unversioned `openjdk`
(Java 23) sits at `/opt/homebrew/opt/openjdk`. Fixed in `~/.zshrc`, after the `ANDROID_HOME` block:

```
export JAVA_HOME="/opt/homebrew/opt/openjdk"
export PATH="$JAVA_HOME/bin:$PATH"
```

The audit runs `verify:` under `/bin/sh`, which never sources `~/.zshrc`, so the check probes that
Homebrew path directly rather than the env var. Maestro needs the same Java.

**What is set up:**

- **CocoaPods** — `brew install cocoapods` (not `sudo gem install`; system Ruby 2.6.10 is too old).
- **[`app.json`](../../../app.json)'s `ios.bundleIdentifier` and `android.package`, both
  `com.shoppingloop.app`** — reverse-DNS of the `shopping-loop.com` domain the project controls,
  hyphen dropped because Android package segments must be Java identifiers. A separate decision from
  [shoppingloop-is-the-visible-name-only](shoppingloop-is-the-visible-name-only.md), which never
  covered these keys. `ai/marketing/app-naming-candidates.md` line 12 ("nothing blocks a rename") is
  stale; it is research, not KB.
- **`expo-dev-client`**, added with `npx expo install`, which also rewrote the `ios`/`android`
  scripts.
- **`ios/` and `android/`** exist from `npx expo prebuild`, gitignored (`.gitignore:41-42`) and
  regenerable — still the managed workflow; nothing argues for ejecting. The Expo project was chosen
  over bare React Native CLI when no toolchain existed at all; the toolchain showing up since does
  not change that.
- **The debug keystore survives `prebuild --clean`.** `android/app/build.gradle` signs debug builds
  with the project-local, gitignored `android/app/debug.keystore`, whose SHA-1 is what the Google
  Cloud OAuth Android client is registered against. Reading `build.gradle` suggests `--clean` would
  mint a new one; tested in task 13, the file came back byte-identical (same MD5), and task 20's
  non-clean prebuild left it unchanged too. Back it up before `--clean` anyway; if a future SDK does regenerate it, re-read the
  SHA-1 with `keytool -list -v -keystore android/app/debug.keystore -alias androiddebugkey -storepass
  android -keypass android` and update the Console.

**What has been proven on a device:**

- Android: a real Google account completed native sign-in on `Pixel_10` against local (task 13),
  once `supabaseTarget.ts` learned the emulator's `127.0.0.1` isn't the host's
  ([supabase-target-picked-at-runtime](supabase-target-picked-at-runtime.md)).
- iOS: OTP sign-in against local, driven by Maestro with the code read from Mailpit, and every
  signed-in screen (task 20 step 1). The Google consent alert was reached; a completed Google
  sign-in on iOS is not recorded ([google-native-signin-library-gaps](google-native-signin-library-gaps.md)).

**Still absent:**

- **`eas`** — not on PATH nor via `npx eas`; needed for TestFlight/App Store builds.
- **The Apple Developer account** — available on request; needed for a physical-device run,
  TestFlight, or the App Store. The simulator needs none of it.
- **A production sign-in from any device** — see [supabase-local-stack](supabase-local-stack.md).

Defer `eas` and the Apple account until a feature needs a physical-device or store build; the rest
of the toolchain is already paid for.

**About the `verify:`.** Every clause asserts *presence* on this machine — full Xcode plus the
iPhone 17e simulator, `adb`/`emulator`, CocoaPods, both identifiers, `expo-dev-client`, the
`expo run:*` scripts, Java 17+ at the Homebrew path (not through `java_home`, which still registers
only 11), and the project-local debug keystore — so a FAIL on another machine is expected. The
Running section of [README.md](../../../README.md) has not been swept for the `expo run:*` change;
trust this entry over it.
