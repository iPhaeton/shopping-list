---
id: native-build-toolchain
title: A native dev build works end to end on both platforms — `npm run ios`/`npm run android` build it, not Expo Go; `pod install` needs a UTF-8 locale, and after a `--no-clean` prebuild you run it yourself
type: environment
status: current
tags: [environment, verification, expo, ios, android, java, xcode, cocoapods]
sources: [README.md, ai/marketing/app-naming-candidates.md, app.json, package.json, ai/suggestions/social-sign-in.md, ai/suggestions/otp-biometric-auth.md, ai/tasks/1/implementation-log-step-1.md, ai/tasks/2/implementation-log-step-2.md, ai/tasks/3/implementation-log-step-1.md, ai/tasks/5-supabase-cloud/implementation-log-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-2.md, ai/tasks/13-google-sign-in/plan-step-1.md, ai/tasks/13-google-sign-in/implementation-log-step-1.md, ai/tasks/13-google-sign-in/implementation-log-step-2.md, ai/tasks/20-ux/implementation-log-step-1.md, ai/tasks/21-expo-sdk-57/implementation-log-step-1.md, ai/docs/xcode-27-report-2026-09-27.md, ai/tasks/22-sticky-headers/implementation-log-step-2.md]
last_verified: 2026-09-28
verify: xcode-select -p | grep -q Xcode.app && xcrun simctl list devices available | grep -q 'iPhone 17e' && test -x ~/Library/Android/sdk/platform-tools/adb && test -x ~/Library/Android/sdk/emulator/emulator && command -v pod >/dev/null && grep -q '"expo-dev-client"' package.json && test "$(node -p "require('./app.json').expo.ios.bundleIdentifier")" = com.shoppingloop.app && test "$(node -p "require('./app.json').expo.android.package")" = com.shoppingloop.app && grep -q '"android": "expo run:android"' package.json && grep -q '"ios": "expo run:ios"' package.json && test -x /opt/homebrew/opt/openjdk/bin/java && /opt/homebrew/opt/openjdk/bin/java -version 2>&1 | grep -qE '"(1[7-9]|[2-9][0-9])' && (! test -f android/app/build.gradle || grep -q "storeFile file('debug.keystore')" android/app/build.gradle) && grep -q 'return !_env.env.CI;' node_modules/expo/node_modules/@expo/cli/build/src/start/server/metro/instantiateMetro.js && env -u LANG -u LC_ALL -u LC_CTYPE /opt/homebrew/opt/ruby/bin/ruby -e 'exit(Encoding.default_external == Encoding::UTF_8 ? 1 : 0)'
related: [expo-sdk-version, ios-scene-support-is-opt-in, supabase-local-stack, supabase-target-picked-at-runtime, shoppingloop-is-the-visible-name-only, suggestions-are-proposals, expo-crypto-undefined-under-jest, scope-boundaries, google-native-signin-library-gaps, maestro-drives-the-native-ui, dev-client-draws-over-the-app, phone-is-the-product, theme-reaches-native-surfaces, jest-cold-cache-timeouts]
---

Machine state as of 2026-09-27. **`npm run ios` and `npm run android` do not boot Expo Go** — they
run `expo run:ios`/`expo run:android`, which build and install the native dev client. The phone is
the product and visual sign-off happens on these builds
([phone-is-the-product](phone-is-the-product.md)).

| target | command | what backs it |
|---|---|---|
| web | `npm run web` | dev server at http://localhost:8081; Playwright MCP is allowlisted for driving it |
| iOS simulator, dev build | `npm run ios -- --device "iPhone 17e"` | **Xcode 27.0 with only the iOS 27.0 runtime** (26.x is deleted), CocoaPods 1.17.0. Built and launched on SDK 57 on 2026-09-27. The runtime's large phone is the **iPhone 18 Pro Max** (no 17 Pro Max), not yet run |
| Android emulator, dev build | `npm run android` | SDK, platform-tools, emulator, one AVD (`Pixel_10`, API 37, arm64 Google Play); rebuilt on SDK 57 on 2026-09-27 |
| Expo Go | — | **cannot run this app on any SDK** since task 13: `src/lib/googleSignIn.ts` loads a native module Expo Go lacks |
| physical device | `npm start` | serves a dev build installed on the device, which for iOS needs the Apple Developer account (below). No dev build has been on a phone yet |

`xcode-select -p` is `/Applications/Xcode.app/Contents/Developer`; `ANDROID_HOME` is
`~/Library/Android/sdk`, exported from `~/.zshrc`. Reprobe devices with `adb devices` /
`xcrun simctl list` rather than trusting a list written here. Driving either app's UI:
[maestro-drives-the-native-ui](maestro-drives-the-native-ui.md).

**Start Metro with no `CI` in its environment.** Under `CI=1` or `CI=true`, Expo CLI turns Metro's
watcher off ("reloads are disabled"). No edit reaches the app, and a before/after made by swapping a
file compares one bundle with itself. If you expect *no* change, relaunch the app for each version.
Identical pixels cannot show that a refresh landed.

**iOS — what has cost a cycle:**

- **`pod install` needs a UTF-8 locale.** CocoaPods 1.17.0 runs on Homebrew Ruby 4.0.7, and with no
  locale it crashes in `cocoapods/config.rb` with `Unicode Normalization not appropriate for
  ASCII-8BIT (Encoding::CompatibilityError)`. An agent shell may have no `LANG`; it is commented
  out at `~/.zshrc:82`. Prefix `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` to `pod install`,
  `npx expo prebuild` and `npm run ios`, all of which run it.
- **In SDK 57, `npx expo prebuild` cleans by default**; `--no-clean` keeps the folders. A
  `--no-clean` prebuild does not reinstall pods: `Podfile.lock` kept old module paths and lacked
  the new one. Run `cd ios && pod install` before `npm run ios`.
- **`npm run ios` can die at "Opening … on iPhone 17e" and take Metro with it.** `simctl openurl`
  times out (`NSPOSIXErrorDomain 60`) now and then, and the link still arrives. Start Metro
  yourself with `npx expo start --dev-client`, then send the link again or run `open-app.yaml`.
- **Xcode 27 has no `Simulator.app`.** `Contents/Applications/DeviceHub.app` replaces it, and
  `@expo/cli` 57.0.27+ opens that. Xcode 27 also rejects pod targets below iOS 15.
  `expo-modules-autolinking`'s post-install hook raises the resource bundles ("Raised resource
  bundle deployment targets…"), so no override is needed. The app itself targets iOS 16.4.
- **The built `.app` lands in Xcode's DerivedData** —
  `~/Library/Developer/Xcode/DerivedData/ShoppingLoop-*/Build/Products/Debug-iphonesimulator/ShoppingLoop.app`
  — not `ios/build`, which only ever holds `generated/`. It can be `xcrun simctl install`ed onto
  another simulator with no rebuild.

**Android.** `npm run android -- --no-bundler` builds against the Metro that `npm run ios` already
started. **The Android Gradle Plugin needs Java 17+, and plain `java` resolved to 11** —
`/usr/libexec/java_home` registers only Homebrew's `openjdk@11`, though the unversioned `openjdk`
(Java 23) sits at `/opt/homebrew/opt/openjdk`. Fixed in `~/.zshrc`, after the `ANDROID_HOME` block:

```
export JAVA_HOME="/opt/homebrew/opt/openjdk"
export PATH="$JAVA_HOME/bin:$PATH"
```

Maestro needs the same Java. The `verify:` probes that path, as the audit's `/bin/sh` skips `~/.zshrc`.

**What is set up:**

- **CocoaPods** — `brew install cocoapods` (not `sudo gem install`; system Ruby 2.6.10 is too old).
- **[`app.json`](../../../app.json)'s `ios.bundleIdentifier` and `android.package`, both
  `com.shoppingloop.app`** — reverse-DNS of the `shopping-loop.com` domain the project controls,
  hyphen dropped because Android package segments must be Java identifiers. A separate decision from
  [shoppingloop-is-the-visible-name-only](shoppingloop-is-the-visible-name-only.md).
  `ai/marketing/app-naming-candidates.md` line 12 ("nothing blocks a rename") is stale research.
- **`ios/` and `android/`** exist from `npx expo prebuild`, gitignored and regenerable — still the
  managed workflow; the toolchain arriving later is no argument for ejecting. The iOS scene wiring
  is generated too ([ios-scene-support-is-opt-in](ios-scene-support-is-opt-in.md)).
- **The debug keystore survives `prebuild --clean`.** `android/app/build.gradle` signs debug builds
  with the project-local, gitignored `android/app/debug.keystore`, whose SHA-1 is what the Google
  Cloud OAuth Android client is registered against. Reading `build.gradle` suggests `--clean` would
  mint a new one. It came back byte-identical in task 13 and again in task 21 (MD5
  `4d3dbe5438b4d52b2707d5c039d09afb`). Back it up before a clean prebuild anyway. If an SDK ever
  regenerates it, re-read the SHA-1 with `keytool -list -v -keystore android/app/debug.keystore
  -alias androiddebugkey -storepass android -keypass android` and update the Console.

**The repo lives in Dropbox, and nothing heavy is excluded.** None of `node_modules/`, `ios/` or
`android/` carries `com.dropbox.ignored`; setting it is the user's call. A reinstall plus a clean
prebuild is about 2 GB, and re-syncing it held the Mac's load at 25–120 for hours in task 21. That
crawled Maestro, lost taps, and timed out jest. When native work turns strangely slow, check
`uptime` and Dropbox before the app.

**What has been proven on a device:**

- Android: a real Google account completed native sign-in on `Pixel_10` against local (task 13),
  once `supabaseTarget.ts` learned the emulator's `127.0.0.1` isn't the host's
  ([supabase-target-picked-at-runtime](supabase-target-picked-at-runtime.md)).
- iOS: OTP sign-in against local, driven by Maestro with the code read from Mailpit, and every
  signed-in screen — on iOS 26.5 (task 20) and iOS 27 (task 21). The Google consent alert was
  reached; a completed Google sign-in on iOS is not recorded
  ([google-native-signin-library-gaps](google-native-signin-library-gaps.md)).

**Still absent:**

- **`eas`** — not on PATH nor via `npx eas`; needed for TestFlight/App Store builds.
- **The Apple Developer account** — available on request; needed for a physical-device run,
  TestFlight, or the App Store. The simulator needs none of it.
- **A release build** of either platform, and **a production sign-in from any device** — see
  [supabase-local-stack](supabase-local-stack.md).

Defer `eas` and the Apple account until a feature needs a physical-device or store build.

**About the `verify:`.** Most clauses assert *presence* on this machine: full Xcode plus the
iPhone 17e simulator, `adb`/`emulator`, CocoaPods, both identifiers, `expo-dev-client`, the
`expo run:*` scripts, Java 17+ at the Homebrew path, and the project-local debug keystore. A FAIL on
another machine is expected. Two clauses assert behaviour: Expo CLI still disables the watcher
under `CI`, and CocoaPods' Ruby still falls back to non-UTF-8 with no locale (once it stops, the
locale bullet can go). README's Running section predates `expo run:*`; trust this entry over it.
