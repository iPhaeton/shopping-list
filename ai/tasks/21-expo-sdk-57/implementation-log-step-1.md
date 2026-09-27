# Implementation log — task 21, step 1: Expo SDK 54 → 57

**Date:** 2026-09-27. Description: [description-step-1.md](description-step-1.md). Input: the
investigation report `ai/docs/xcode-27-report-2026-09-27.md` (Xcode 27 + iOS 27 runtime only on
this Mac; SDK 54 builds but is killed at launch). Plan approved by the user before work began.

## Decisions

1. **Scene support through `expo-build-properties`' `ios.enableSceneSupport`, not a local config
   plugin.** The approved plan had a hand-written `plugins/withIosSceneLifecycle.js`, copied from
   the SDK 58 preview template, because a search of `expo`, `@expo/prebuild-config`,
   `@expo/config-plugins` and `expo-template-bare-minimum` 57 found nothing that switches scenes
   on. The SDK 57 changelog (https://expo.dev/changelog/sdk-57) then named the official opt-in:
   `expo@57.0.23` added it to `expo-build-properties`, a package that search had not downloaded.
   Its `build/iosSceneSupport.js` makes the same edits the plugin would have made:
   - `AppDelegate` gains `ExpoReactNativeFactoryProvider`, and its `UIWindow` + `startReactNative`
     are removed;
   - `Info.plist` gets `UIApplicationSceneManifest`, with `UISceneDelegateClassName =
     EXExpoAppSceneDelegate` (the Expo class directly, no subclass file);
   - it throws on a non-standard AppDelegate, and it is a no-op with a warning on SDK ≥ 58.

   So the custom plugin was dropped; no project code owns the scene wiring. **Remove the
   `expo-build-properties` entry (or just the property) when moving to SDK 58**, whose template
   adopts scenes itself.
2. **Jumped 54 → 57 directly**, not one SDK at a time. The project started life on 57.0.16
   (task 1) and was downgraded in `4d55c18` only for Expo Go on a phone. Since task 13, Expo Go
   cannot run the app on any SDK (`googleSignIn.ts` loads a native module Expo Go lacks), so that
   reason is gone. Read the SDK 55, 56 and 57 changelogs first; nothing breaking touches a package
   or API this app uses.
3. **The pre-existing cold-cache jest timeouts were left alone.** See "Problems hit".

## What changed

- **`package.json` / `package-lock.json`.** `npx expo install expo@~57.0.25`, then
  `npx expo install --fix`, then `npx expo install expo-build-properties` and
  `npx expo install -- --save-dev @react-native/jest-preset`:

  | | before | after |
  |---|---|---|
  | expo | ^54.0.37 | ~57.0.25 (`@expo/cli` 57.0.27+) |
  | react-native | 0.81.5 | 0.86.3 |
  | react / react-dom | 19.1.0 | 19.2.3 |
  | react-native-screens | ~4.19.0 (deliberately past the SDK's ~4.16) | ~4.26.0 (the SDK pin) |
  | react-native-safe-area-context | ~5.6.0 | ~5.7.0 |
  | react-native-svg | 15.12.1 | 15.15.4 |
  | expo-crypto / -dev-client / -device / -font / -status-bar / -system-ui | 15.0 / 6.0 / 8.0 / 14.0 / 3.0 / 6.0 | 57.0.x each (SDK 55 made every Expo package share the SDK major) |
  | @expo/metro-runtime | ~6.1.2 | ~57.0.16 |
  | expo-build-properties | — | ~57.0.22 (new) |
  | jest-expo | ~54.0.18 | ~57.0.5 (still Jest 29) |
  | @react-native/jest-preset | — | ^0.86.3 (new; a required peer of jest-expo 57) |
  | typescript | ~5.9.2 | ~6.0.3 |
  | @types/react | ~19.1.10 | ~19.2.4 |

  Unchanged: async-storage 2.2.0, google-signin 16.1.5 (still the latest; peer `expo >=52`),
  React Navigation 7, supabase-js, react-native-web, the fonts, jest ~29.7, RNTL 14,
  test-renderer.
- **`app.json` plugins.** `--fix` added `"expo-status-bar"`. With no options it does nothing
  (`plugin/build/withStatusBar.js` returns early). It is the SDK 55 replacement for the deprecated
  `StatusBar` props; kept because the next `--fix` would add it back. Added
  `["expo-build-properties", { "ios": { "enableSceneSupport": true } }]`. `--fix` also reflowed the
  google-signin plugin's options onto several lines.
- **`AGENTS.md`**: the docs link now points to `v57.0.0`.
- **No source file changed.** The app's React Native imports include nothing 0.86 removed, and
  `Appearance.setColorScheme` only ever gets `'light'`/`'dark'`. Typecheck under TS 6 was clean
  first time; the `"types": ["jest", "react", "node"]` array already covers TS 6's empty default.
- **`ios/` and `android/` regenerated** by `npx expo prebuild --clean`. **In SDK 57, a plain
  `expo prebuild` cleans by default** (`--no-clean` keeps the folders). Generated results:
  - `AppDelegate.swift` conforms to `ExpoReactNativeFactoryProvider`, with no `UIWindow(frame:`.
  - `Info.plist` has the scene manifest.
  - The Podfile, `Podfile.properties.json` and project use **iOS 16.4** (was 15.1; the SDK 56
    minimum).
  - `EXPO_USE_PRECOMPILED_MODULES` is `true`.
  - `android/app/debug.keystore` came through `--clean` byte-identical (MD5
    `4d3dbe5438b4d52b2707d5c039d09afb` before and after).

## How each of the report's three findings resolved

1. **Simulator.app gone → fixed by `@expo/cli` 57.0.27.** `npm run ios` passed the Simulator
   check, and `DeviceHub.app` (`/Applications/Xcode.app/Contents/Applications/DeviceHub.app`) was
   running afterwards.
2. **Pod deployment targets below 15.0 → fixed by `expo-modules-autolinking` 57.0.13.** Its
   `reconcile_resource_bundle_deployment_targets` post-install hook, whose comment names Xcode 27,
   printed `Raised resource bundle deployment targets to match their pods:` with exactly the
   report's nine targets (`AppAuth-AppAuthCore_Privacy`, …, `RNSVG-RNSVGFilters`). React Native
   0.86's own `updateOSDeploymentTarget` still raises only library targets, never resource
   bundles. `xcodebuild` then went **0 errors, 1 warning, `Build Succeeded`** with no command-line
   override. The report's options table claimed SDK 57 fixes this without checking; it does, but
   through autolinking, not React Native.
3. **UIScene required → not fixed by the upgrade alone.** SDK 57 ships `ExpoAppSceneDelegate`, but
   it is **opt-in** (decision 1). Without `enableSceneSupport` the SDK 57 template still makes its
   own window and would hit the same UIKit trap. With it: launched on the iPhone 17e (iOS 27) with
   **no new `~/Library/Logs/DiagnosticReports/ShoppingLoop-*.ips`**. The only two on disk are the
   report's, from 17:14 and 17:15.

## Problems hit

- **`pod install` crashed inside `npx expo prebuild`**: `Unicode Normalization not appropriate for
  ASCII-8BIT (Encoding::CompatibilityError)` from `cocoapods/config.rb:167`. CocoaPods 1.17.0 runs
  on Homebrew Ruby 4.0.7 and needs a UTF-8 locale. The agent shell has no `LANG` (it is
  commented out at `~/.zshrc:82`). Fix per command:
  `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install` (and the same prefix on `npm run ios`,
  which runs `pod install` itself).
- **`xcrun simctl openurl` times out (`NSPOSIXErrorDomain 60`) intermittently, not only after a
  fresh boot.** It hit `expo run:ios`'s own launch step, which then exits and takes Metro with it,
  and the first step (`openLink`) of one `shoot-all.sh` run. The URL still arrives: after the
  timeout the app came up and followed the link to Metro. Timed on purpose:
  - cold (app terminated) 3/3 fine, in 7 s, 1 s and 3 s;
  - warm: one fine in 1 s; one sent while the app was still reloading from the previous link
    timed out at 14 s.

  It looks like `simctl` waiting on a busy app, not scene URL delivery losing links. If
  `npm run ios` dies at "Opening … on iPhone 17e", start Metro yourself with
  `npx expo start --dev-client`, then send the link again (or run `open-app.yaml`).
- **Metro's inspector now rejects a DevTools socket with no `Origin` header.** Metro logs
  `Connection from DevTools failed to be established for origin 'undefined' … Was expecting origin:
  'http://127.0.0.1:8081', or origin hostname to be one of: localhost, 127.0.0.1, 0.0.0.0, [::]`,
  and the socket closes with 1006. Node's global `WebSocket` sends no `Origin`, so the recipe in
  `metro-inspector-reads-live-app-state` no longer works as written. The fix is Node's
  non-standard options argument:
  `new WebSocket(url, { headers: { Origin: 'http://127.0.0.1:8081' } })`. With it,
  `Runtime.evaluate` answers as before.
- **The SDK 57 dev client draws a floating "Dev tools" gear button over the top-right corner, on
  top of Lists' Account pill.** Maestro's `tapOn: Account` landed on the gear, so `set-theme.yaml`
  failed at the next step. It is dev-client only; release builds don't have it. Turned off per
  simulator, with the app terminated first:
  `xcrun simctl spawn <udid> defaults write com.shoppingloop.app EXDevMenuShowFloatingActionButton -bool NO`
  (key from `expo-dev-menu`'s iOS sources; `DevMenuFAB.positionX/Y` store a dragged position).
  Like the perf-monitor flag, it lives in the app container's user defaults, so a reinstall that
  wipes the container brings it back.
- **iOS 27 shows a one-time "Speed up your typing by sliding your finger…" tip over the
  keyboard** the first time a new simulator types a few words. It took the next tap, so
  `sign-in.yaml`'s `tapOn: Send code` did nothing and `extendedWaitUntil: Six-digit code` failed.
  It is not part of the maestro KB entry's keyboard reset. The tip that was already up had to be
  dismissed with `tapOn: Continue`. Also set, as a candidate for that reset:
  `xcrun simctl spawn <udid> defaults write com.apple.Preferences DidShowContinuousPathIntroduction -bool YES`.
  **Unproven:** it was written after the tip had appeared, so nothing shows it suppresses the tip
  on a fresh simulator.
- **One `tapOn: Send code` was lost.** This is the first sighting of what open question 2 later
  traces to extreme load. With no tip on screen and the button
  enabled, the tap "COMPLETED" but no `POST /otp` reached `supabase_auth_shopping-list`, and the
  screen stayed on the email phase with no error. In the same session the driver was crawling:
  `eraseText` took 29.7 s, `inputText` 8.9 s, `tapOn: Email address` 10.1 s. A single
  `tapOn: Send code` sent by hand moments later worked: code phase shown, one `/otp` logged.
  `SignInScreen` has no `ScrollView`, so it is not the keyboard-eats-the-first-tap trap.
- **Maestro 2.10's iOS driver sometimes fails to start on iOS 27** ("iOS driver not ready in time,
  consider increasing timeout by configuring MAESTRO_DRIVER_STARTUP_TIMEOUT"). This happened on
  the first flow on the new simulator, and again at the start of one `shoot-all.sh` run. The next
  attempt worked each time. `MAESTRO_DRIVER_STARTUP_TIMEOUT=180000` (ms) in the environment was
  used for the later tour runs.
- **Jest on a cold transform cache times out the first test of several screen suites** (5 s
  default) when all 8 workers transform React Native at once: 5–6 failures in 5 suites on SDK 57.
  Every warm run passes (3/3: 27 suites, 489 tests). Alone and cold,
  `SignInScreen.test.tsx`'s first test takes 1.6 s. **Not caused by the upgrade.** The pre-upgrade
  tree (`git archive HEAD`, `npm ci`, SDK 54) did the same, with 1 and then 4 failures in the same
  suites. Not changed here. After an install or `--clearCache`, run `npm test` a second time
  before believing a failure.

## Hermes V1, re-measured

SDK 57 runs Hermes V1 by default. `HermesInternal.getRuntimeProperties()` reports
`"Static Hermes": true`, OSS release `250829098.0.17`, bytecode 98. Task 20 step 2 measured `Intl`
on the old Hermes. I ran the same probe over the inspector, with the `Origin` fix. Both platforms
report the same Hermes build:

| | iOS, SDK 54 (task 20, iOS 26.5) | iOS, SDK 57 (iPhone 17e, iOS 27) | Android, SDK 54 (task 20) | Android, SDK 57 (`Pixel_10`, API 37) |
|---|---|---|---|---|
| `resolvedOptions().timeZone` | `Europe/Warsaw` | `Europe/Warsaw` | `Europe/Warsaw` | `Europe/Warsaw` |
| `resolvedOptions().locale` | `en-US` | `en-US` | `en-US` | `en-US` |
| `timeStyle: 'short'` | `9:01 PM` | `9:01 PM` | `9:01 PM` | `9:01 PM` |
| `timeZone: 'Asia/Calcutta'` (legacy) | accepted | accepted | accepted | accepted |
| `timeZone: 'Mars/Olympus_Mons'` | throws `RangeError` | throws `RangeError` | throws `JSRangeErrorException` | **throws `RangeError`** |

The one change: Android's unknown-zone error is now a plain `RangeError`. `clockTime`
(`src/state/resolveTheme.ts`) uses a bare `catch {}`, so it handles both.

The `TZ` route task 20 relied on still works: after `SIMCTL_CHILD_TZ=Pacific/Fiji xcrun simctl
launch …` and the deep link, `resolvedOptions().timeZone` was `Pacific/Fiji` and `new Date()`
printed `GMT+1200`.

## Verification

**Machine state.** Everything below, up to the Android bullet, ran while the Mac was heavily
loaded. The Android runs and the lost-tap re-test came after a Mac restart, at load 9–25. The 15-minute load
average peaked at 123 and stayed at 25–30 for hours. Dropbox ran at 110–175% CPU and
`kernel_task` at 140–280%. The repo lives in Dropbox, and none of `node_modules/`, `ios/` or
`android/` carries `com.dropbox.ignored`, so the reinstall and the `--clean` prebuild (about 2 GB)
were being synced. This is the likely cause of the slow Maestro driver and the lost taps below.

- **Unit tests:** `npm run typecheck` is clean. `npm test` passes 27 suites / 489 tests on every
  warm run; the cold-cache timeouts are in "Problems hit". `npx expo-doctor` passes 21/21.
- **The report's three findings on Xcode 27 / iOS 27, iPhone 17e:** see "How each of the report's
  three findings resolved". In short: DeviceHub opened, `Build Succeeded` with 0 errors, and no
  crash report.
- **Scene URL paths.**
  - A cold-start deep link (app terminated, then `simctl openurl` with `open-app.yaml`'s link)
    loaded the bundle from `127.0.0.1:8081`. That exercises `ExpoAppSceneDelegate` rebuilding the
    launch options from `connectionOptions`.
  - A warm deep link while the app was running reloaded it (`openURLContexts`).
  - Home and back again: a `GET /rest/v1/list_members…` hit Kong right after the return, so the
    foreground refetch still fires under the scene life cycle.
- **Maestro on the iOS 27 simulator.** `open-app` passed; OTP sign-in passed (the code came from
  Mailpit); `tour-signed-out` passed in Day; `tour-signed-in` passed in Day and in Night.
  `shoot-all.sh` itself never finished end to end, for the reasons in "Problems hit" and
  "Open questions". The tours were driven flow by flow.
- **Screenshots against task 20's.** Checked side by side:
  - Lists, against `step-3/lists-mockup-state-*`;
  - List detail with the bin shown, against `step-4/list-detail-bin-shown-*`;
  - Sharing, against `step-1/sharing-night`;
  - Account.

  Layout, fonts, the SVG sky, sun and moon, the hill, icons and the tombstone row all match. The
  band rims on Lists are fainter than in the step-3 shots, which are stale for the rim; see
  "Open questions".
- **Back-button repros on react-native-screens 4.26 (iOS 27).** A scratch flow ran both repros
  from the `react-native-screens-past-the-sdk-pin` KB entry, tapping the native back button by
  point (`18%,8%`), with an assertion after each pop:
  - Lists → Groceries → Share list → back → Share list → back;
  - drawn Back → Account → back.

  Every back popped.
- **Google Sign-In.** "Continue with Google" put up the system alert "“ShoppingLoop” Wants to Use
  “accounts.google.com” to Sign In", so the library still finds a presenting view controller under
  scenes. Cancelled there; a completed Google sign-in on iOS is still not recorded, as before.
- **Night cold start**, recorded with `simctl io recordVideo` and classified frame by frame:
  1. launch animation;
  2. white for about 17 s (the launch screen, which follows the device's light appearance, the
     known gap for task 20 step 5, followed by the dev client's load);
  3. **black (0,0,0) for 0.3 s**;
  4. the Night root view (15,19,44 ≈ `#10162e`) with the theme gate's spinner;
  5. Sign in at Night.

  So the restored background still paints before React, and no light frame follows the launch
  screen. The black flash was not in task 20's frame-by-frame record. It is probably the dev
  client swapping its loading view for the app's; that is not verified in a release build.
- **Web** (`http://localhost:8081`, headless Chromium from the cached `playwright-core` 1.60,
  because the Playwright MCP browser was locked by another instance):
  - OTP sign-in as maya, with the code from Mailpit;
  - the seeded lists shown;
  - a throwaway list created, an item added, then the list binned (`Web check muk4fu1a`, now a
    tombstone in maya's lists).

  All passed. The console showed two React dev warnings, "React does not recognize the
  `accessibilityElementsHidden` / `importantForAccessibility` prop on a DOM element". Same
  `react-native-web` 0.21.2 as before, and the props are the app's own on decoration `View`s, so
  almost certainly pre-existing; not compared against SDK 54.

- **Android** (`Pixel_10`, API 37). The user built and installed the dev client with
  `npm run android` after a Mac restart, which also wiped this session's scratchpad.
  - The Maestro walk passed: Lists → Groceries → Share list → system `back` → drawn Back →
    Account → system `back`.
  - OTP sign-in, the unmodified `sign-in.yaml` as maya, passed twice in a row. The emulator was
    then signed back in as `s4owner@example.com`, the account it had been on.
  - List detail matches `step-4/list-detail-android-day.png` exactly (same s4owner account).
  - Lists shows the same faint band rims as iOS, which is intended; see "Open questions".
  - The dev client's floating button covers the top-right pills here too: Account on Lists, and
    Share on List detail. A `tapOn: Share list` opened the dev menu instead. It was turned off by
    adding `<boolean name="showFab" value="false" />` to
    `shared_prefs/expo.modules.devmenu.sharedpreferences.xml` through
    `adb shell run-as com.shoppingloop.app` (key from `expo-dev-menu`'s `DevMenuPreferences.kt`).
  - `android/app/debug.keystore` still has MD5 `4d3dbe5438b4d52b2707d5c039d09afb`.
- **The lost-tap re-test at lower load.** The unmodified `sign-in.yaml` passed 2/2 on Android
  (load about 9–25) and 2/2 on the iOS 27 simulator (load 16–23, with the emulator also running).
  At load 60–120, while Dropbox was syncing, it had failed 4/4.

**Not checked:**
- The iOS 26 back-button bug: that runtime was deleted in the report's session.
- A completed Google sign-in on iOS.
- A release build.
- A large phone. The iOS 27 runtime has no iPhone 17 Pro Max; its large phone is the iPhone 18
  Pro Max, which was not run.

## Open questions for the user

1. **Resolved, not an upgrade change: the band rims on Lists are faint on purpose, and the
   step-3 screenshots predate that.** In task 20 step 3's Lists shots (`lists-mockup-state-*` on
   iOS, `lists-android-*` on Android), each band's top edge has a bright white highlight. SDK 57
   draws a faint blend: at `x = 585`, the reference's crest pixel (231,225,239) is lighter than
   both neighbouring bands, while the new build has no lighter pixel at all. It looks the same on
   both platforms. The rim is `Band.tsx`'s `bandRim` gradient, `stopColor={colors.bandRim}` with
   `stopOpacity={0.2}` → `0`, plus the same gradient in `Horizon.tsx`.

   **The user made the rim fainter by hand during step 3 and committed it in `d58a9cf`
   ("20-ux-3"), the same commit that added the step-3 screenshots.** The screenshots were taken
   before that edit. The step-3 log still describes rows "visibly separated by its rim despite
   sharing one color". Once `b66e076` made the band colours bounce, adjacent rows never share a
   colour, so a strong rim is no longer needed. No commit since `d58a9cf` changed any rim value
   (`git log -G'bandRim|stopOpacity'`). So SDK 57 renders exactly what is committed.

   First drafted here as an SDK 57 regression, from comparing only against those screenshots.
   That was wrong; the user corrected it. **The step-3 Lists screenshots are not a reference for
   the rim.** Do not "restore" the bright edge from them.
2. **Resolved, no change needed: Maestro flows that tap a button right after `inputText` lose
   the tap under extreme load.**
   `sign-in.yaml` failed four times in a row at `tapOn: Send code`; each time no `/otp` request
   was made and the button looked enabled afterwards. The same flow with a 5 s pause before the
   tap passed. A later, delayed `tapOn: Sign in` also went through at once, while the flow-timed
   one had been lost the same way. `tour-signed-out.yaml` never hit it: it takes a screenshot
   between typing and tapping. The best explanation is that the tap reaches `Pressable` while it
   still has the last committed render's `disabled`, before the text change's re-render has
   landed. People type far too slowly to hit this. At normal load the unmodified flow passed 4/4,
   two runs on each platform (see Verification). So the flows keep their current shape. If a
   typed-then-tapped step fails, check `uptime` before suspecting the app.
3. **Dropbox syncs `node_modules/`, `ios/` and `android/`.** None of them has
   `com.dropbox.ignored`, so every reinstall or `--clean` prebuild re-uploads gigabytes and loads
   the machine for hours. Setting the attribute on those three folders is your call. It is not
   project code.
4. **The cold-cache jest timeouts** (pre-existing; see "Problems hit") could be removed by raising
   `testTimeout`. Left alone because the behaviour is older than this task.

## For the librarian — candidate facts

- **Retire `expo-sdk-54-pinned`**, or rewrite it for 57: `expo` ~57.0.25, RN 0.86.3, React 19.2.3,
  TS ~6.0.3, jest-expo ~57.0.5, and `@react-native/jest-preset` is now a required dev dependency.
  AGENTS.md points to the v57 docs. Its `verify:` fails now.
- **Retire `react-native-screens-past-the-sdk-pin`.** SDK 57 pins ~4.26, which is past 4.19, so
  the deviation is over; `npx expo install --fix` is safe again. Both repros passed on 4.26 on
  iOS 27. The iOS 26 case was not re-run, because that runtime is gone. Its `verify:` fails now,
  as the entry itself said it would.
- **New: scene support is on through `expo-build-properties` `ios.enableSceneSupport`.** Without
  it, an app linked against the iOS 27 SDK is killed at launch
  (`_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`). SDK 57 ships the delegate but
  leaves it opt-in (needs expo ≥ 57.0.23). Drop the property at SDK 58, where the template adopts
  scenes and the plugin only warns. It points `UISceneDelegateClassName` at
  `EXExpoAppSceneDelegate` directly. URL, user-activity and life-cycle events are re-fed to
  `ExpoAppDelegate` and its subscribers (dev launcher, `GoogleSignInAppDelegate`).
- **`native-build-toolchain`:**
  - Xcode 27.0 with only the iOS 27 runtime; Simulator.app is replaced by
    `Contents/Applications/DeviceHub.app`, which `@expo/cli` 57 opens.
  - Deployment target 16.4.
  - `expo prebuild` now cleans by default.
  - `pod install` needs `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` in the agent shell (Homebrew Ruby
    4.0.7 + CocoaPods 1.17.0).
  - `expo run:ios` can die at "Opening …" on an `openurl` timeout and take Metro with it; run
    Metro separately.
  - The debug keystore again survived `--clean`.
  - The iOS 27 runtime's large phone is the iPhone 18 Pro Max.
- **`maestro-drives-the-native-ui`:**
  - The iPhone 17e (iOS 27, `EFE93063-…`) had its keyboards reset on 2026-09-27.
  - Also set `com.apple.Preferences DidShowContinuousPathIntroduction` (unproven; see "Problems
    hit").
  - The dev client's floating Dev tools button (new in SDK 57) covers the top-right pills: Account
    on Lists, Share on List detail. Turn it off per device, with the app stopped:
    - on iOS, `xcrun simctl spawn <udid> defaults write com.shoppingloop.app
      EXDevMenuShowFloatingActionButton -bool NO`;
    - on Android, add `<boolean name="showFab" value="false" />` to
      `shared_prefs/expo.modules.devmenu.sharedpreferences.xml` via
      `adb shell run-as com.shoppingloop.app`.

    Both are done on the iPhone 17e and `Pixel_10`. A reinstall that wipes app data brings it
    back.
  - `MAESTRO_DRIVER_STARTUP_TIMEOUT=180000` helps on iOS 27.
  - A tap right after `inputText` is lost only under extreme load; at normal load `sign-in.yaml`
    passes unchanged.
- **`metro-inspector-reads-live-app-state`:** the inspector proxy now requires an `Origin` of
  localhost/127.0.0.1. Pass `new WebSocket(url, { headers: { Origin: 'http://127.0.0.1:8081' } })`.
- **`auto-theme-follows-the-time-zone`:** Hermes V1 (`Static Hermes`, 250829098.0.17) was
  measured on iOS 27 and Android API 37, with the same results as the table there. The one
  exception: Android's unknown-zone error is now a plain `RangeError`, not
  `JSRangeErrorException` (see "Hermes V1, re-measured").
- **Band rims are faint by design.** The user made them fainter in step 3 and committed that in
  `d58a9cf`. That commit's `ai/tasks/20-ux/screenshots/step-3/lists-*` shots still show the
  older, brighter rim, so comparing against them makes the current rim look like a rendering
  regression. This session made exactly that mistake (open question 1). Anyone checking Lists
  visually should know the step-3 Lists screenshots are stale for the rim.
- **`theme-reaches-native-surfaces`:** a 0.3 s black frame now sits between the launch screen and
  the Night root view in the dev build (see Verification). It is not light, so the constraint
  holds.
- **The KB audit under load:** `update-list-identity-preserving`'s `verify:` runs jest and timed
  out while the machine was at load 60–75. Run by hand, it passes (16 tests, 164 s). The fact
  holds; the check is load-sensitive.
