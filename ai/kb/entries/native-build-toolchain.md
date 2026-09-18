---
id: native-build-toolchain
title: A native dev build now works end to end — CocoaPods, both bundle identifiers, and expo-dev-client are set; `npm run ios`/`npm run android` build it, not Expo Go
type: environment
status: current
tags: [environment, verification, expo, ios, android, java]
sources: [README.md, ai/marketing/app-naming-candidates.md, app.json, package.json, ai/suggestions/social-sign-in.md, ai/suggestions/otp-biometric-auth.md, ai/tasks/1/implementation-log-step-1.md, ai/tasks/2/implementation-log-step-2.md, ai/tasks/3/implementation-log-step-1.md, ai/tasks/5-supabase-cloud/implementation-log-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-2.md, ai/tasks/13-google-sign-in/plan-step-1.md, ai/tasks/13-google-sign-in/implementation-log-step-1.md, ai/tasks/13-google-sign-in/implementation-log-step-2.md]
last_verified: 2026-09-18
verify: xcode-select -p | grep -q Xcode.app && xcrun simctl list devices available | grep -q iPhone && test -x ~/Library/Android/sdk/platform-tools/adb && test -x ~/Library/Android/sdk/emulator/emulator && command -v pod >/dev/null && grep -q '"expo-dev-client"' package.json && test "$(node -p "require('./app.json').expo.ios.bundleIdentifier")" = com.shoppingloop.app && test "$(node -p "require('./app.json').expo.android.package")" = com.shoppingloop.app && grep -q '"android": "expo run:android"' package.json && grep -q '"ios": "expo run:ios"' package.json && test -x /opt/homebrew/opt/openjdk/bin/java && /opt/homebrew/opt/openjdk/bin/java -version 2>&1 | grep -qE '"(1[7-9]|[2-9][0-9])' && (! test -f android/app/build.gradle || grep -q "storeFile file('debug.keystore')" android/app/build.gradle)
related: [expo-sdk-54-pinned, supabase-local-stack, supabase-target-picked-at-runtime, shoppingloop-is-the-visible-name-only, suggestions-are-proposals, expo-crypto-undefined-under-jest, scope-boundaries, google-native-signin-library-gaps]
---

Machine state as of 2026-09-17. Everything this entry used to list as "still absent" for a native
dev build — CocoaPods, both platform identifiers, `expo-dev-client`, a prebuild — is now present and
an Android build has been run end to end. **The headline change: `npm run ios` and `npm run android`
no longer boot Expo Go.** They now run `expo run:ios`/`expo run:android`, which build and install the
native dev client. Anything written before today that assumes those two scripts open Expo Go is wrong.

| target | command | what backs it |
|---|---|---|
| web | `npm run web` | dev server at http://localhost:8081; Playwright MCP is allowlisted for driving it |
| iOS simulator, Expo Go | `npx expo start --ios --go` | Xcode 26.6, iOS 26.5 runtime |
| iOS simulator, dev build | `npm run ios` (`expo run:ios`) | CocoaPods installed, `ios/Pods` populated; not run to a booted app this session — `ios/build` has no `.app` yet, only Android has the end-to-end proof below |
| Android emulator, Expo Go | `npx expo start --android --go` | SDK, platform-tools, emulator, one AVD (`Pixel_10`, arm64 Google Play) |
| Android emulator, dev build | `npm run android` (`expo run:android`) | run end to end 2026-09-17, produced `android/app/build/outputs/apk/debug/app-debug.apk` (61MB) |
| physical device | `npm start` | QR code into Expo Go — not reverified since `expo-dev-client` landed; it may now default away from Expo Go too, confirm before trusting this row |

`xcode-select -p` points at `/Applications/Xcode.app/Contents/Developer`; `ANDROID_HOME` is
`~/Library/Android/sdk`, exported from `~/.zshrc`. Both were already true before today — see
`adb devices` / `xcrun simctl` to reprobe rather than trusting a device list written down here.

**New gotcha, cost a debugging cycle: the Android Gradle Plugin needs Java 17+, and plain `java`
silently resolved to 11.** `JAVA_HOME` was unset, so `/usr/bin/java` fell through to
`/usr/libexec/java_home`, which had only Homebrew's `openjdk@11` registered — even though the
unversioned `openjdk` formula (Java 23) was already sitting at `/opt/homebrew/opt/openjdk`, just never
wired up. `expo run:android` failed with "Android Gradle plugin requires Java 17 to run. You are
currently using Java 11." Nothing needed installing; the fix was two lines in `~/.zshrc`, right after
the existing `ANDROID_HOME` block:
```
export JAVA_HOME="/opt/homebrew/opt/openjdk"
export PATH="$JAVA_HOME/bin:$PATH"
```
Same caveat as `ANDROID_HOME` below: the audit runs `verify:` under `/bin/sh`, which never sources
`~/.zshrc`, so the check below probes the Homebrew path directly rather than the env var.

**What was filled in today, all under the "pay it when a task calls for it" note this entry used to
carry:**

- **CocoaPods** — `brew install cocoapods` (not `sudo gem install`; system Ruby 2.6.10 is too old),
  `pod 1.17.0` at `/opt/homebrew/bin/pod`.
- **[`app.json`](../../../app.json)'s `ios.bundleIdentifier` and `android.package`, both
  `com.shoppingloop.app`.** A new, independent
  decision — not the ShoppingLoop/shopping-list split in
  [shoppingloop-is-the-visible-name-only](shoppingloop-is-the-visible-name-only.md), which never
  covered these keys. Chosen deliberately: reverse-DNS of the `shopping-loop.com` domain the project
  already controls (verified via Resend for auth mail — see
  [cloud-auth-mail-goes-through-resend](cloud-auth-mail-goes-through-resend.md)), hyphen dropped
  because Android package segments must be valid Java identifiers, `.app` appended so one string
  serves both platforms. `ai/marketing/app-naming-candidates.md` line 12 ("no `ios.bundleIdentifier`/
  `android.package` set yet — nothing blocks a rename") is now stale; that file is research, not KB,
  so nothing here edits it — read this entry instead.
- **`expo-dev-client` `~6.0.21`** added to [`package.json`](../../../package.json) via
  `npx expo install expo-dev-client`, which also rewrote the `android`/`ios` scripts (the headline
  change above).
- **`npx expo prebuild`** ran — `ios/` and `android/` exist on disk now, still gitignored
  (`.gitignore:41-42`), still regenerable, still the managed workflow underneath; nothing here argues
  for ejecting (see the historical note below).

**"Still regenerable" was predicted to have a cost; task 13 phase 2 actually ran the experiment and
the prediction did not hold.** `android/app/build.gradle`'s `signingConfigs.debug` points at
`file('debug.keystore')` — relative to `android/app/`, so it is this project-local, gitignored file,
not the OS default `~/.android/debug.keystore` (which does not exist on this machine). Its SHA-1
(`keytool -list -v -keystore android/app/debug.keystore -alias androiddebugkey -storepass android
-keypass android`) is what a Google Cloud OAuth Android client is registered against, and reading
`build.gradle` alone suggests `npx expo prebuild --clean` — which deletes `android/` outright —
would have Gradle mint a fresh one with a different, effectively random fingerprint. Backed up
`debug.keystore` before running `--clean` expecting to need the restore; the file after prebuild was
byte-identical (same MD5) and `keytool` confirmed the same SHA-1, so the Android OAuth registration
stayed valid with no Console update needed. Whatever `expo prebuild --clean` does in Expo SDK 54, it
does not touch an existing debug keystore — treat the backup as cheap insurance rather than a
required step, and if a future SDK version ever does regenerate it, re-run the `keytool` command
above and update the Console registration to match.

**Still absent:**

- **`eas`**, not on PATH and not resolvable via `npx eas` — needed for TestFlight/App Store builds.
- **A completed iOS dev-build run.** Pods are installed but `expo run:ios` has not been driven to a
  booted simulator with the app open; only Android has the end-to-end proof.
- **The Apple Developer account.** Still available on request — needed for a physical-device run,
  TestFlight, or the App Store; the simulator needs none of this.
- **A production sign-in from any device.** Unrelated to the toolchain — see below.

**The "don't build speculatively" preference is now moot for the toolchain itself.** This entry used
to say a dev build should wait for a feature that needs one. CocoaPods, both identifiers,
`expo-dev-client`, and a proven Android build now all exist independent of any single feature — that
cost is already paid. What is still worth deferring is `eas`/store distribution and the Apple account;
pay those when a feature actually needs a physical-device or store build.

**The browser was the only target verified end to end behind sign-in — until task 13 phase 2's
Android run.** A real Google account completed native sign-in on the `Pixel_10` emulator's dev build,
reaching "My Lists" with real data, once `supabaseTarget.ts` learned the Android emulator's
`127.0.0.1` isn't the host's
([supabase-target-picked-at-runtime](supabase-target-picked-at-runtime.md)). iOS is still unproven
past "the app opens": the launch-time `iosClientId` crash is fixed
([google-native-signin-library-gaps](google-native-signin-library-gaps.md)), but no session yet had a
way to drive the native Google sheet or an OTP code on a dev build. See
[supabase-local-stack](supabase-local-stack.md) for which environment each target talks to.

**Historical note:** the *original* absence of any toolchain is why this project is Expo rather than
bare React Native CLI — Xcode and the Android SDK showing up since, and a dev build now existing,
argue for none of that: a dev build is still Expo, with the managed config intact.

**About the `verify:`.** Every clause asserts *presence*, the same principle as before: full Xcode
plus a simulator, `adb`/`emulator` under the SDK path, CocoaPods on PATH, both identifiers in
`app.json`, `expo-dev-client` in `package.json`, the `expo run:*` scripts, and Java 17+ at the
Homebrew path rather than through `java_home` (which still only registers 11 — the env var bypasses
it, so the check does too). All of it probes the *machine* and `app.json`/`package.json`, so a FAIL
on another machine, or before these files are committed, is expected. Keep this entry and the Running
section of [README.md](../../../README.md) in step — that file still describes the old
`expo start --ios`/`--android` behavior and has not been swept for today's script change.
