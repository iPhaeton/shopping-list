---
id: maestro-drives-the-native-ui
title: Maestro drives the native app — installed by hand at ~/.maestro, not on PATH; a simulator needs its keyboards reset before it can type, and no software keyboard shows while DeviceHub runs
type: environment
status: current
tags: [environment, verification, maestro, ios, android, simulator, keyboard]
sources: [ai/tasks/20-ux/implementation-log-step-1.md, ai/tasks/20-ux/implementation-log-step-2.md, ai/tasks/20-ux/implementation-log-step-3.md, ai/tasks/20-ux/implementation-log-step-4.md, ai/tasks/20-ux/implementation-log-step-5.md, ai/tasks/21-expo-sdk-57/implementation-log-step-1.md, ai/tasks/22-sticky-headers/implementation-log-step-1.md]
last_verified: 2026-09-29
verify: test -x ~/.maestro/bin/maestro && ls ~/.maestro/lib | grep -q '^maestro-cli-2\.' && test -x /opt/homebrew/opt/openjdk/bin/java && grep -q '^appId: com.shoppingloop.app$' .maestro/flows/open-app.yaml && grep -q 'exp+shopping-list://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081' .maestro/flows/open-app.yaml && grep -q '/auth/v1/otp' .maestro/seed.mjs && grep -q '^- tapOn: Back$' .maestro/flows/tour-signed-in.yaml && grep -q '^- tapOn: Back$' .maestro/flows/set-theme.yaml && ! grep -rqE '^- tapOn: "?(My Lists|Navigate up)"?$' .maestro/flows
related: [phone-is-the-product, list-headers-are-pinned-and-opaque, native-build-toolchain, dev-client-draws-over-the-app, supabase-local-stack, session-still-valid-guards-writes, queries-go-through-a11y-labels, metro-inspector-reads-live-app-state, auto-theme-follows-the-time-zone, screens-take-navigation-props]
---

**Maestro 2.10.0** is how an agent reaches a screen and state on the iOS simulator or Android
emulator: sign in, navigate, flip the theme, screenshot. It is the only UI driver installed; there
is no idb or Detox ([native-build-toolchain](native-build-toolchain.md)).

**Run it by full path, with Java 17+:**

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk ~/.maestro/bin/maestro test --test-output-dir <dir> \
  .maestro/flows/<flow>.yaml -e THEME=Night
```

It is not on PATH on purpose: the official install script edits `~/.zshrc` and `~/.bash_profile`,
so the release zip was unpacked into `~/.maestro` by hand. The first run on a new simulator installs
Maestro's XCTest driver (~1m45s); every later invocation pays ~20–40 s of JVM and driver start.
**On iOS 27 the driver sometimes fails to start** ("iOS driver not ready in time"); a second attempt
worked each time, and `MAESTRO_DRIVER_STARTUP_TIMEOUT=180000` (ms) in the environment helps.

**Typing on a simulator — three things have broken it:**

- **Its keyboards must be reset first.** Simulators inherit the Mac's multilingual keyboard list,
  and `inputText` came out mangled (`maya@example.com` → `ya@example.comm`), then stopped landing at
  all. Fixed only on the iPhone 17e (iOS 27, 2026-09-27); any other simulator needs the same, then a
  reboot of that simulator:

  ```bash
  xcrun simctl spawn <udid> defaults write .GlobalPreferences AppleKeyboards -array "en_US@sw=QWERTY;hw=Automatic"
  ```

  plus `KeyboardPrediction`, `KeyboardAutocorrection`, `KeyboardCheckSpelling`,
  `KeyboardAutocapitalization`, `KeyboardShowPredictionBar`, `SmartQuotesEnabled`,
  `SmartDashesEnabled` set to `NO` in `com.apple.Preferences`.
- **While DeviceHub runs, no software keyboard appears.** Xcode 27's simulator UI, which
  `expo run:ios` opens, attaches the Mac's keyboard as hardware; the number pad showed only a "Go"
  pill. **`killall DeviceHub`** brings it back, and the device stays booted. Clearing
  `HardwareKeyboardLastSeen` did not help; `osascript` cannot send Cmd+Shift+K (no permission).
- **iOS 27's one-time "Speed up your typing by sliding your finger…" tip** eats the next tap; dismiss
  it with `tapOn: Continue`. `DidShowContinuousPathIntroduction -bool YES` in `com.apple.Preferences`
  is unproven as a fix.

**Traps in writing flows:**

- **Going back, and the screen underneath.** Since task 20 step 5 every screen draws its own `Back`
  and `back` is Android-only, so `tapOn: Back`; no `Groceries`/`My Lists`/"Navigate up" back label
  exists, and the `verify:` keeps them out. But a screen below stays in the hierarchy at its real
  coordinates: **on Sharing, List detail's `Back` is still there underneath**, so the tour taps by
  point (`"10%,9%"`) — which needs the page at rest. The keyboard reveal on the invite field scrolls
  the header off and leaves it there, so that tap hit a heading; `scrollUntilVisible: Sharing`
  returned at once, since a sliver of the title under the status bar counts as visible. The tour
  drags down first (`50%,25%` → `50%,60%`, clear of the keyboard). Flows find things by text and
  a11y label, so renaming either breaks them as it breaks the RNTL suites
  ([queries-go-through-a11y-labels](queries-go-through-a11y-labels.md)).
- **A tap on something the keyboard covers lands on the keyboard.** `tapOn: Send code` typed a "t"
  into the address until `useKeyboardReveal` kept the auth card above the keyboard. `hideKeyboard`
  on iOS is a swipe on the content, and one opened the row at the screen's centre: the tour leaves
  the keyboard up and empties a field with `eraseText`.
- **Maestro cannot perform the iOS edge-swipe back.** A `swipe` from x 0–1%, fast or slow, popped
  neither List detail nor Sharing, so the fault is Maestro's synthesized touch. It lands on the
  content too, and once checked off a row. Test the swipe by hand.
- **Tap a row only once the list is still and the row is in the open.** A tap during scroll momentum
  only stops the scroll, and `scrollUntilVisible` returns while the list coasts: add
  `waitForAnimationToEnd` first. A row scrolled up behind a pinned header
  ([list-headers-are-pinned-and-opaque](list-headers-are-pinned-and-opaque.md)) taps the header.
  To get back to the top of a very long list, `tapOn: { point: "50%,1%" }` taps the status bar.
- **The dev client draws over the app.** Since SDK 57 a Dev tools button covers the top-right
  pills until it is turned off per device, so `tapOn: Account` opens the dev menu. The fix, and the
  other overlays: [dev-client-draws-over-the-app](dev-client-draws-over-the-app.md).
- **Under heavy machine load a tap right after `inputText` is lost** (4/4 at load 60–120, 0/4 at
  normal load). Check `uptime` first.
- `takeScreenshot` takes a bare name only; PNGs land in `<--test-output-dir>/takeScreenshot/`.
- `xcrun simctl status_bar <udid> override --time 9:41 …` matches the mockups' clock until reboot.

**Reaching a time of day** (Auto's sunset and sunrise) takes no code — move the zone, not the clock:

- **iOS simulator**, per launch: `xcrun simctl terminate booted com.shoppingloop.app`, then
  `SIMCTL_CHILD_TZ=<zone> xcrun simctl launch booted com.shoppingloop.app` (a Release build too),
  then `xcrun simctl openurl booted` with `open-app.yaml`'s deep link — not `open-app.yaml` itself,
  whose `stopApp` ends the process carrying the variable. Hermes's `Intl` and `Date` both follow
  `TZ`. `openurl` can time out (`NSPOSIXErrorDomain 60`) after a fresh boot or mid-reload, and the
  link still arrives.
- **Android emulator** (a Play Store image, so no `adb root`): `adb shell cmd time_zone_detector
  set_time_zone_state_for_tests --zone_id <zone> --user_should_confirm_id false`
  (`suggest_manual_time_zone` is refused). Press Home before and resume after, to exercise the
  foreground re-check. Restore `Europe/Warsaw` and `set_auto_detection_enabled true` afterwards.
- To find a zone whose transition is minutes away, run `resolveTheme` over every `ZONE_COORDS` key in
  a throwaway jest file. The `status_bar` override keeps showing 9:41, never the time under test;
  read what the app believes through [metro-inspector-reads-live-app-state](metro-inspector-reads-live-app-state.md).

**Android:** run `adb reverse tcp:8081 tcp:8081` first so `open-app.yaml`'s `127.0.0.1:8081`
reaches Metro. After the first-time driver install the app was not running (no crash in
`logcat -b crash`), so start with `open-app`, and wait for the list (`extendedWaitUntil`) before the
first gesture: a fast swipe straight after it became a tap. A freshly booted emulator may show
"System UI isn't responding" — tap Wait. No flow has run on Android since step 5's drawn `Back`s.

**What lives in `.maestro/`** (kept in the repo, for task 20 and after), against the local stack.
If sign-in fails with "Error sending magic link email", the app is on cloud:
[supabase-target-picked-at-runtime](supabase-target-picked-at-runtime.md).

- `flows/`: `open-app` (cold-starts the dev client into Metro by deep link), `sign-in` (`EMAIL`;
  `scripts/mailpit-code.js` reads the code from Mailpit), `ensure-signed-in`, `sign-out`,
  `set-theme` (`THEME` = `Day`/`Night`/`Auto`), and the two screenshot tours (`THEME` = `day`/`night`).
- `shoot-all.sh <out> <owner-email> <fresh-prefix>` — both tours in both themes, each set
  explicitly, so Auto's default never reaches them. Set name only appears for a never-seen address,
  so each run needs a fresh prefix.
- `seed.mjs [owner] [member]` — the tour data, made **through the API** (OTP via Mailpit, then the
  app's RPCs; a psql role switch fails every write RPC's `auth.sessions` check —
  [session-still-valid-guards-writes](session-still-valid-guards-writes.md)). Once per stack, as
  names are unique. Its Jordan/Jorge/Jorja lose "Jor" to generated names on a stack holding the
  load-test users ([supabase-local-stack](supabase-local-stack.md)).
