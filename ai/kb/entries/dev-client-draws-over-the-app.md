---
id: dev-client-draws-over-the-app
title: The dev client draws its own UI over the app — a floating Dev tools button on the top-right pills, a Refreshing banner, a perf monitor — so screenshot a tap that "did nothing" before blaming the app
type: environment
status: current
tags: [environment, verification, expo, dev-client, maestro, ios, android]
sources: [ai/tasks/21-expo-sdk-57/implementation-log-step-1.md, ai/tasks/20-ux/implementation-log-step-1.md, ai/tasks/20-ux/implementation-log-step-4.md]
last_verified: 2026-09-27
verify: grep -q '"expo-dev-client"' package.json && grep -q '"EXDevMenuShowFloatingActionButton"' node_modules/expo-dev-menu/ios/Modules/DevMenuPreferences.swift && grep -q 'var showFab' node_modules/expo-dev-menu/android/src/debug/java/expo/modules/devmenu/DevMenuPreferences.kt && grep -q '"expo.modules.devmenu.sharedpreferences"' node_modules/expo-dev-menu/android/src/debug/java/expo/modules/devmenu/DevMenuPreferences.kt
related: [maestro-drives-the-native-ui, theme-reaches-native-surfaces, native-build-toolchain, phone-is-the-product]
indexed: false
---

Every native check here runs on the **dev client**, not a release build
([native-build-toolchain](native-build-toolchain.md)). The dev client puts things on screen that
are not the app. Maestro cannot see most of them, and a tap that lands on one is lost or opens the
dev menu. **When a tap "did nothing", screenshot around it before suspecting the app.** Release
builds have none of these.

**The floating "Dev tools" button (new in SDK 57).** It is a gear over the top-right corner, which
is exactly where Lists' Account pill and List detail's Share pill sit. Maestro's `tapOn: Account`
and `tapOn: Share list` hit the gear and opened the dev menu instead. It is on by default on both
platforms. Turn it off per device, **with the app terminated first**:

- **iOS simulator:** `xcrun simctl spawn <udid> defaults write com.shoppingloop.app EXDevMenuShowFloatingActionButton -bool NO`.
  A dragged position is stored separately (`DevMenuFAB.positionX/Y`).
- **Android emulator:** add `<boolean name="showFab" value="false" />` to
  `shared_prefs/expo.modules.devmenu.sharedpreferences.xml`, through
  `adb shell run-as com.shoppingloop.app`.

Both are done on the iPhone 17e (iOS 27) and on `Pixel_10` as of 2026-09-27. The setting lives in
the app's own data, so a reinstall that wipes the container brings the button back. The key names
come from `expo-dev-menu`'s `DevMenuPreferences`; the `verify:` checks they are still the ones it
reads.

**The blue "Refreshing…" banner** covers the top ~58 pt, including the back button. It sometimes
appears by itself on a push that fetches, with no file changed. It is not in the app's hierarchy,
so `extendedWaitUntil: notVisible` will not wait for it. A tap that landed on it looked exactly
like the old react-native-screens dead-back-button bug
([react-native-screens-past-the-sdk-pin](react-native-screens-past-the-sdk-pin.md)) until a
screenshot showed the banner.

**The perf-monitor overlay** was once saved on in the app's dev settings
(`RCTDevMenu.RCTPerfMonitorKey` in the container's `Library/Preferences/com.shoppingloop.app.plist`).
If it shows up in a screenshot, turn it off there with `xcrun simctl spawn booted defaults write …`.

**The dev menu can open by itself.** On the iPhone 17 Pro Max's first launch after a boot,
`open-app.yaml`'s optional `Continue` tap opened it. Close it with its ✕ at `point: "89%,47%"`.

**Cold start.** Between the launch screen and the app's root view, the dev client shows its white
"Downloading 100%…" loader and, since SDK 57, about 0.3 s of pure black. Neither is a product
frame. [theme-reaches-native-surfaces](theme-reaches-native-surfaces.md) says what the product
frames are. The black frame has not been checked in a release build.
