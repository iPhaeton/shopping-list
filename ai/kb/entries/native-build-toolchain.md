---
id: native-build-toolchain
title: A native dev build works end to end on both platforms — `npm run ios`/`npm run android` build it, not Expo Go; `pod install` needs a UTF-8 locale, and after a `--no-clean` prebuild you run it yourself
type: environment
status: current
tags: [environment, verification, expo, ios, android, java, xcode, cocoapods, signing, apple-developer]
sources: [README.md, ai/marketing/app-naming-candidates.md, app.json, package.json, ai/suggestions/social-sign-in.md, ai/suggestions/otp-biometric-auth.md, ai/tasks/1/implementation-log-step-1.md, ai/tasks/2/implementation-log-step-2.md, ai/tasks/3/implementation-log-step-1.md, ai/tasks/5-supabase-cloud/implementation-log-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-2.md, ai/tasks/13-google-sign-in/plan-step-1.md, ai/tasks/13-google-sign-in/implementation-log-step-1.md, ai/tasks/13-google-sign-in/implementation-log-step-2.md, ai/tasks/20-ux/implementation-log-step-1.md, ai/tasks/21-expo-sdk-57/implementation-log-step-1.md, ai/docs/xcode-27-report-2026-09-27.md, ai/tasks/22-sticky-headers/implementation-log-step-2.md, ai/tasks/20-ux/implementation-log-step-5.md, ai/tasks/20-ux/implementation-log-step-6.md, ai/tasks/24-search-and-sort/implementation-log-step-3.md]
last_verified: 2026-10-05
verify: xcode-select -p | grep -q Xcode.app && xcrun simctl list devices available | grep -q 'iPhone 18 Pro (' && test -x ~/Library/Android/sdk/platform-tools/adb && test -x ~/Library/Android/sdk/emulator/emulator && command -v pod >/dev/null && grep -q '"expo-dev-client"' package.json && test "$(node -p "require('./app.json').expo.ios.bundleIdentifier")" = com.shoppingloop.app && test "$(node -p "require('./app.json').expo.android.package")" = com.shoppingloop.app && grep -q '"android": "expo run:android"' package.json && grep -q '"ios": "expo run:ios"' package.json && test -x /opt/homebrew/opt/openjdk/bin/java && /opt/homebrew/opt/openjdk/bin/java -version 2>&1 | grep -qE '"(1[7-9]|[2-9][0-9])' && (! test -f android/app/build.gradle || grep -q "storeFile file('debug.keystore')" android/app/build.gradle) && defaults read com.apple.dt.Xcode IDEProvisioningTeamByIdentifier | grep -q 'teamID = YZ75T58P4Z;' && security find-identity -v -p codesigning | grep -q '"Apple Development: ' && grep -q 'return !_env.env.CI;' node_modules/expo/node_modules/@expo/cli/build/src/start/server/metro/instantiateMetro.js && env -u LANG -u LC_ALL -u LC_CTYPE /opt/homebrew/opt/ruby/bin/ruby -e 'exit(Encoding.default_external == Encoding::UTF_8 ? 1 : 0)'
related: [expo-sdk-version, ios-device-build-skips-provisioning-flags, ios-scene-support-is-opt-in, supabase-local-stack, supabase-target-picked-at-runtime, shoppingloop-is-the-visible-name-only, suggestions-are-proposals, expo-crypto-undefined-under-jest, scope-boundaries, google-native-signin-library-gaps, maestro-drives-the-native-ui, dev-client-draws-over-the-app, phone-is-the-product, theme-reaches-native-surfaces, jest-cold-cache-timeouts]
---

Machine state as of 2026-09-30. **`npm run ios` and `npm run android` do not boot Expo Go** — they
run `expo run:ios`/`expo run:android`, which build and install the native dev client. The phone is
the product and visual sign-off happens on these builds
([phone-is-the-product](phone-is-the-product.md)).

| target | command | what backs it |
|---|---|---|
| web | `npm run web` | dev server at http://localhost:8081; Playwright MCP is allowlisted for driving it |
| iOS simulator, dev build | `npm run ios -- --device "iPhone 18 Pro"` | **Xcode 27.0 with only the iOS 27.0 runtime** (26.x is deleted), CocoaPods 1.17.0. **The iPhone 17e is gone** (by 2026-09-30); the phones left are the iPhone 18 Pro, 18 Pro Max, Air and 17. The 18 Pro holds a Debug dev client built 2026-09-30, with `expo-blur` and the splash, and is the one prepared for Maestro. The 18 Pro Max has not been run |
| Android emulator, dev build | `npm run android` | SDK, platform-tools, emulator, one AVD (`Pixel_10`, API 37, arm64 Google Play); last built on SDK 57 on 2026-09-27, so **the installed dev client predates `expo-blur` and `expo-splash-screen`** (task 20 step 5), and in task 24 step 3 it booted but never brought up a JS target — **rebuild it before any Android check** |
| Expo Go | — | **cannot run this app on any SDK** since task 13: `src/lib/googleSignIn.ts` loads a native module Expo Go lacks |
| physical device | `npm run ios -- --device` | signed with the paid team below. One iPhone 13 ("iPhone (153)", iOS 27.0.1) is registered, and on 2026-10-05 the dev build installed and ran on it. No sign-in on it is recorded, nor which Supabase it reached: `.env` set no `EXPO_PUBLIC_SUPABASE_TARGET`, so the rule says cloud, but nobody watched. A new device, entitlement or expired profile needs one hand-run `xcodebuild -allowProvisioningUpdates` first ([ios-device-build-skips-provisioning-flags](ios-device-build-skips-provisioning-flags.md)) |

`xcode-select -p` is `/Applications/Xcode.app/Contents/Developer`; `ANDROID_HOME` is
`~/Library/Android/sdk`, exported from `~/.zshrc`. Reprobe devices (`adb devices`, `xcrun simctl
list`) rather than trusting a list here. Driving either app's UI: [maestro-drives-the-native-ui](maestro-drives-the-native-ui.md).

**Start Metro with no `CI` in its environment.** Under `CI=1` or `CI=true`, Expo CLI turns Metro's
watcher off ("reloads are disabled"). No edit reaches the app, and a before/after made by swapping a
file compares one bundle with itself: relaunch the app for each version, since identical pixels
cannot show that a refresh landed.

**iOS — what has cost a cycle:**

- **`pod install` needs a UTF-8 locale.** CocoaPods 1.17.0 runs on Homebrew Ruby 4.0.7, and with no
  locale it crashes in `cocoapods/config.rb` with `Unicode Normalization not appropriate for
  ASCII-8BIT (Encoding::CompatibilityError)`. An agent shell may have no `LANG`; it is commented
  out at `~/.zshrc:82`. Prefix `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` to `pod install`,
  `npx expo prebuild` and `npm run ios`, all of which run it.
- **In SDK 57, `npx expo prebuild` cleans by default**; `--no-clean` keeps the folders. A
  `--no-clean` prebuild does not reinstall pods: `Podfile.lock` kept old module paths and lacked
  the new one. Run `cd ios && pod install` before `npm run ios`.
- **`npm run ios` can die at "Opening … on <simulator>" and take Metro with it.** `simctl openurl`
  times out (`NSPOSIXErrorDomain 60`) now and then, and the link still arrives. Start Metro
  yourself with `npx expo start --dev-client`, then send the link again or run `open-app.yaml`.
- **Xcode 27 has no `Simulator.app`.** `Contents/Applications/DeviceHub.app` replaces it, and
  `@expo/cli` 57.0.27+ opens that; while it runs, the simulator shows no software keyboard
  ([maestro-drives-the-native-ui](maestro-drives-the-native-ui.md)). Xcode 27 rejects pod targets
  below iOS 15, and `expo-modules-autolinking`'s post-install hook raises them. The app targets 16.4.
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
- **A paid Apple Developer Program membership** since 2026-10-04 — individual team "ILYA
  BOHASLAUCHYK", ID `YZ75T58P4Z`. Xcode is signed in to it (paid, not a free personal team), the
  keychain holds a valid "Apple Development" identity, and the generated `ios/` project already
  carries `DEVELOPMENT_TEAM = YZ75T58P4Z`. Nothing in a store waits on the account.
- **[`app.json`](../../../app.json)'s `ios.bundleIdentifier` and `android.package`, both
  `com.shoppingloop.app`** — reverse-DNS of the `shopping-loop.com` domain the project controls,
  hyphen dropped because Android package segments must be Java identifiers. A separate decision from
  [shoppingloop-is-the-visible-name-only](shoppingloop-is-the-visible-name-only.md).
  `ai/marketing/app-naming-candidates.md` line 12 ("nothing blocks a rename") is stale research.
- **`ios/` and `android/`** exist from `npx expo prebuild`, gitignored and regenerable — still the
  managed workflow; the toolchain arriving later is no argument for ejecting. The iOS scene wiring
  is generated too ([ios-scene-support-is-opt-in](ios-scene-support-is-opt-in.md)).
- **The debug keystore survives `prebuild --clean`**, though `build.gradle` suggests otherwise.
  Debug builds are signed with the project-local, gitignored `android/app/debug.keystore`, whose
  SHA-1 the Google Cloud OAuth Android client is registered against; it came back byte-identical in
  tasks 13 and 21 (MD5 `4d3dbe5438b4d52b2707d5c039d09afb`). Back it up before a clean prebuild. If
  one ever regenerates it, re-read the SHA-1 (`keytool -list -v -keystore android/app/debug.keystore
  -alias androiddebugkey -storepass android`) and update the Console.

**Disk and load are the machine's limits.** The disk runs nearly full (5–17 GB free); task 20
step 5's Android build took it to 205 MB, crashing the emulator and Gradle and hanging Docker (the
local Supabase) until a reboot. Check `df -h /System/Volumes/Data` before a native build, and free
only what the session itself made. The repo lives in Dropbox with nothing heavy excluded
(`com.dropbox.ignored` is the user's call): re-syncing a reinstall plus clean prebuild (~2 GB) held
the load at 25–120 for hours in task 21, crawling Maestro and timing out jest. When native work
turns slow, check `uptime` and Dropbox before the app.

**What has been proven on a device:**

- Android: a real Google account completed native sign-in on `Pixel_10` against local (task 13),
  once `supabaseTarget.ts` learned the emulator's `127.0.0.1` isn't the host's
  ([supabase-target-picked-at-runtime](supabase-target-picked-at-runtime.md)).
- iOS: OTP sign-in against local, driven by Maestro reading Mailpit, and every screen — on iOS 26.5
  (task 20) and iOS 27 (tasks 21, 20 step 5, and step 6 on the 18 Pro). The Google consent alert was reached; a completed
  Google sign-in on iOS is not recorded ([google-native-signin-library-gaps](google-native-signin-library-gaps.md)).

**Still absent:**

- **`eas`** — not on PATH nor via `npx eas`. Defer it until a feature needs a TestFlight or App
  Store build; a physical-device dev build goes through Xcode's signing (`npm run ios -- --device`).
- **A Release build beyond the simulator's**, and **a production sign-in from any device** — see
  [supabase-local-stack](supabase-local-stack.md). `npx expo run:ios --configuration Release` built
  one for the simulator in task 20 step 5, for cold-start frames free of the dev client's loader
  ([theme-reaches-native-surfaces](theme-reaches-native-surfaces.md)); it was deleted after, for disk.

**About the `verify:`.** Most clauses assert *presence* on this machine, so a FAIL on another
machine is expected. Two assert behaviour: Expo CLI still disables the watcher under `CI`, and
CocoaPods' Ruby still falls back to non-UTF-8 with no locale (once it stops, the locale bullet can
go). README's Running section predates `expo run:*`; trust this entry over it.
