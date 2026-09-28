---
id: maestro-drives-the-native-ui
title: Maestro drives the native app — installed by hand at ~/.maestro, not on PATH, and each simulator needs its keyboards reset before it can type
type: environment
status: current
tags: [environment, verification, maestro, ios, android, simulator]
sources: [ai/tasks/20-ux/implementation-log-step-1.md, ai/tasks/20-ux/implementation-log-step-2.md, ai/tasks/20-ux/implementation-log-step-3.md, ai/tasks/20-ux/implementation-log-step-4.md, ai/tasks/21-expo-sdk-57/implementation-log-step-1.md, ai/tasks/22-sticky-headers/implementation-log-step-1.md]
last_verified: 2026-09-28
verify: test -x ~/.maestro/bin/maestro && ls ~/.maestro/lib | grep -q '^maestro-cli-2\.' && test -x /opt/homebrew/opt/openjdk/bin/java && grep -q '^appId: com.shoppingloop.app$' .maestro/flows/open-app.yaml && grep -q 'exp+shopping-list://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081' .maestro/flows/open-app.yaml && grep -q '/auth/v1/otp' .maestro/seed.mjs && grep -q '^- tapOn: Back$' .maestro/flows/tour-signed-in.yaml
related: [phone-is-the-product, list-headers-are-pinned-and-opaque, native-build-toolchain, dev-client-draws-over-the-app, supabase-local-stack, session-still-valid-guards-writes, queries-go-through-a11y-labels, metro-inspector-reads-live-app-state, auto-theme-follows-the-time-zone]
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
so the release zip was unpacked into `~/.maestro` by hand. The first run on a new simulator installs Maestro's XCTest driver (~1m45s); every
later invocation pays ~20–40 s of JVM and driver start. **On iOS 27 the driver sometimes fails to
start** ("iOS driver not ready in time"); a second attempt worked each time, and
`MAESTRO_DRIVER_STARTUP_TIMEOUT=180000` (ms) in the environment helps.

**A simulator must have its keyboards reset before `inputText` works.** Simulators inherit the
Mac's multilingual keyboard list, and Maestro's typing came out mangled (`maya@example.com` →
`ya@example.comm`), then stopped landing at all. Fixed only on the iPhone 17e (iOS 27, 2026-09-27);
any other simulator Maestro types into needs the same, then a reboot of that simulator:

```bash
xcrun simctl spawn <udid> defaults write .GlobalPreferences AppleKeyboards -array "en_US@sw=QWERTY;hw=Automatic"
```

plus `KeyboardPrediction`, `KeyboardAutocorrection`, `KeyboardCheckSpelling`,
`KeyboardAutocapitalization`, `KeyboardShowPredictionBar`, `SmartQuotesEnabled`,
`SmartDashesEnabled` set to `NO` in `com.apple.Preferences`.

**iOS 27 adds a one-time "Speed up your typing by sliding your finger…" tip** over the keyboard the
first time a new simulator types a few words. It eats the next tap (`sign-in.yaml`'s `tapOn: Send
code` did nothing); dismiss it with `tapOn: Continue`. The 17e's `DidShowContinuousPathIntroduction
-bool YES` in `com.apple.Preferences` was set after the tip had shown, so it is unproven as a fix.

**Traps in writing flows:**

- **Going back.** `back` is Android-only. `Lists` and `ListDetail` draw their own header, so leaving
  List detail is `tapOn: Back` on both platforms. `Sharing` and `Account` keep the native header,
  whose back button is labelled with the **previous screen's title** on iOS (`Groceries` on Sharing,
  `My Lists` on Account, even while the header is hidden) but **"Navigate up"** on Android. So
  `set-theme.yaml`'s last `tapOn: My Lists` fails on Android; use `"Navigate up"` or `back` there.
- **Tapping a title can hit the screen underneath.** After a theme switch on Account,
  `tapOn: My Lists` matched Lists' own drawn title, still in the hierarchy below Account, instead of
  the back button; tap it by point (`point: "18%,8%"`). Flows find things by visible text and a11y
  label, so renaming either breaks them as it breaks the RNTL suites ([queries-go-through-a11y-labels](queries-go-through-a11y-labels.md)).
- **Maestro cannot perform the iOS edge-swipe back.** A `swipe` from x 0–1%, fast or slow, popped
  neither List detail nor Sharing (a native header), so the fault is Maestro's synthesized touch. It
  lands on the content too, and once checked off a row. Test the swipe by hand.
- **Tap a row only once the list is still and the row is in the open.** A tap during scroll
  momentum only stops the scroll, and `scrollUntilVisible` returns while the list still coasts, so
  add `waitForAnimationToEnd` first. Both list screens pin their header since task 22
  ([list-headers-are-pinned-and-opaque](list-headers-are-pinned-and-opaque.md)), and a row scrolled
  up behind it **stays in the hierarchy at its real coordinates**: `tapOn: <row>` taps the header
  on top of it. Positions read mid-scroll are stale too; during a scroll-to-top, a tap on
  `List 796` landed on the Create input. Scrolling back up a very long list times out;
  `tapOn: { point: "50%,1%" }` taps the status bar, which scrolls to the top.
- **`hideKeyboard` on iOS is a swipe on the content.** It sends short swipes at the screen's centre,
  and one opened the row there. Leave it out unless a soft keyboard is actually up.
- **The dev client draws over the app.** Since SDK 57 a Dev tools button covers the top-right
  pills until it is turned off per device, so `tapOn: Account` opens the dev menu. The fix, and the
  other overlays: [dev-client-draws-over-the-app](dev-client-draws-over-the-app.md).
- **Under heavy machine load, a tap right after `inputText` can be lost.** At load 60–120 it
  failed 4/4. At normal load `sign-in.yaml` passed 4/4 unchanged. Check `uptime` first.
- `takeScreenshot` refuses a path outside the run's output folder. Use a bare name and pass
  `--test-output-dir`; PNGs land in `<dir>/takeScreenshot/` at the simulator's full resolution.
- A simulator that has never opened `exp+shopping-list://` asks "Open in “ShoppingLoop”?" first —
  `open-app.yaml` waits and taps `Open` optionally.
- `xcrun simctl status_bar <udid> override --time 9:41 …` matches the mockups' clock; it does not
  survive a simulator reboot.

**Reaching a time of day** (Auto's sunset and sunrise) takes no code — move the zone, not the clock:

- **iOS simulator**, per launch: `xcrun simctl terminate booted com.shoppingloop.app`, then
  `SIMCTL_CHILD_TZ=<zone> xcrun simctl launch booted com.shoppingloop.app`, then `xcrun simctl
  openurl booted` with `open-app.yaml`'s deep link — not `open-app.yaml` itself, whose `stopApp`
  ends the process carrying the variable. Hermes's `Intl` and `Date` both follow `TZ`. `openurl` can
  time out (`NSPOSIXErrorDomain 60`) after a fresh boot or mid-reload, and the link still arrives.
- **Android emulator** (a Play Store image, so no `adb root`): `adb shell cmd time_zone_detector
  set_time_zone_state_for_tests --zone_id <zone> --user_should_confirm_id false`.
  `suggest_manual_time_zone` is refused — the shell lacks `SUGGEST_MANUAL_TIME_AND_ZONE`. Press
  Home before and resume after, to exercise the foreground re-check. Restore `Europe/Warsaw` and
  `set_auto_detection_enabled true` afterwards.
- To find a zone whose transition is minutes away, run `resolveTheme` over every `ZONE_COORDS` key in
  a throwaway jest file. The `status_bar` override keeps showing 9:41, never the time under test;
  read what the app believes through [metro-inspector-reads-live-app-state](metro-inspector-reads-live-app-state.md).

**Android:** `back` works. Run `adb reverse tcp:8081 tcp:8081` first so `open-app.yaml`'s
`127.0.0.1:8081` reaches Metro. After the first-time driver install the app was not running (no
crash in `logcat -b crash`), so start with `open-app`, and wait for the list (`extendedWaitUntil`)
before the first gesture: a fast swipe straight after it became a tap and opened a row. A freshly
booted emulator may put "System UI isn't responding" over everything — tap Wait.

**What lives in `.maestro/`** (kept in the repo, for task 20 and after), against the local stack.
If sign-in fails with "Error sending magic link email", the app is on cloud:
[supabase-target-picked-at-runtime](supabase-target-picked-at-runtime.md).

- `flows/open-app.yaml` — cold-starts the dev client straight into Metro through its deep link.
- `flows/sign-in.yaml` (`EMAIL`) — OTP sign-in; `scripts/mailpit-code.js` reads the code from
  Mailpit's HTTP API inside the flow. Also `ensure-signed-in`, `sign-out`, `set-theme` (`THEME` =
  `Day`/`Night`/`Auto`), and the two screenshot tours (`THEME` = `day`/`night`).
- `shoot-all.sh <out> <owner-email> <fresh-prefix>` — both tours in both themes, each set
  explicitly, so Auto's default never reaches them. Set name only appears for a never-seen address,
  so each run needs a fresh prefix.
- `seed.mjs [owner] [member]` — the tour data, made **through the API** (OTP via Mailpit, then the
  app's own RPCs). A psql role switch cannot do it: every write RPC checks for a live
  `auth.sessions` row ([session-still-valid-guards-writes](session-still-valid-guards-writes.md)).
  Once per stack — names are unique.
