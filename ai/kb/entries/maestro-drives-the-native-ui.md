---
id: maestro-drives-the-native-ui
title: Maestro drives the native app — installed by hand at ~/.maestro, not on PATH; a simulator needs its keyboards reset before it can type, and no software keyboard shows while DeviceHub runs
type: environment
status: current
tags: [environment, verification, maestro, ios, android, simulator, keyboard]
sources: [ai/tasks/20-ux/implementation-log-step-1.md, ai/tasks/20-ux/implementation-log-step-2.md, ai/tasks/20-ux/implementation-log-step-3.md, ai/tasks/20-ux/implementation-log-step-4.md, ai/tasks/20-ux/implementation-log-step-5.md, ai/tasks/21-expo-sdk-57/implementation-log-step-1.md, ai/tasks/20-ux/implementation-log-step-6.md, ai/tasks/22-sticky-headers/implementation-log-step-1.md, ai/tasks/24-search-and-sort/implementation-log-step-3.md, ai/tasks/26-apple-sign-in/implementation-log-step-2.md, b15d384, ai/tasks/28-invitations/implementation-log-step-3.md, 5ab9b85, ai/tasks/28-invitations/implementation-log-step-4.md, 0508f98]
last_verified: 2026-10-09
verify: test -x ~/.maestro/bin/maestro && ls ~/.maestro/lib | grep -q '^maestro-cli-2\.' && test -x /opt/homebrew/opt/openjdk/bin/java && grep -q '^appId: com.shoppingloop.app$' .maestro/flows/open-app.yaml && grep -q 'exp+shopping-list://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081' .maestro/flows/open-app.yaml && grep -q '/auth/v1/otp' .maestro/seed.mjs && grep -q "rpc('invite_to_list'" .maestro/seed.mjs && grep -q "rpc('my_notifications'" .maestro/seed.mjs && grep -q "rpc('accept_invitation'" .maestro/seed.mjs && ! grep -q "'share_list'" .maestro/seed.mjs && grep -q '^- tapOn: "Invite \.\*"$' .maestro/flows/tour-signed-in.yaml && grep -q '^- tapOn: Remove Sam$' .maestro/flows/tour-signed-in.yaml && grep -q '^- tapOn: Back$' .maestro/flows/tour-signed-in.yaml && grep -q '^- tapOn: Back$' .maestro/flows/set-theme.yaml && ! grep -rqE '^- tapOn: "?(My Lists|Navigate up)"?$' .maestro/flows && ! grep -rq '^- hideKeyboard' .maestro/flows && grep -q '^- pressKey: Enter$' .maestro/flows/tour-search-and-sort.yaml
related: [phone-is-the-product, list-headers-are-pinned-and-opaque, native-build-toolchain, dev-client-draws-over-the-app, supabase-local-stack, session-still-valid-guards-writes, queries-go-through-a11y-labels, metro-inspector-reads-live-app-state, auto-theme-follows-the-time-zone, screens-take-navigation-props]
---

**Maestro 2.10.0** drives the iOS simulator and Android emulator — sign in, navigate, flip the theme,
screenshot. It is the only UI driver installed; no idb or Detox ([native-build-toolchain](native-build-toolchain.md)).

**Run it by full path, with Java 17+:**

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk ~/.maestro/bin/maestro test --test-output-dir <dir> \
  .maestro/flows/<flow>.yaml -e THEME=Night
```

Not on PATH on purpose (the install script edits `~/.zshrc`). A new simulator's first run installs the XCTest driver (~1m45s); later runs pay ~20–40 s.
**On iOS 27 the driver sometimes fails to start** ("iOS driver not ready in time"); a second attempt
worked each time, and `MAESTRO_DRIVER_STARTUP_TIMEOUT=180000` (ms) in the environment helps.

**Typing on a simulator — three things have broken it:**

- **Its keyboards must be reset first.** Simulators inherit the Mac's multilingual keyboard list,
  and `inputText` came out mangled (`maya@example.com` → `ya@example.comm`), then stopped landing at
  all. Done on the iPhone 18 Pro (iOS 27, 2026-09-30; the 17e that had it is gone); any other
  simulator needs the same, then a reboot of that simulator:

  ```bash
  xcrun simctl spawn <udid> defaults write .GlobalPreferences AppleKeyboards -array "en_US@sw=QWERTY;hw=Automatic"
  ```

  plus `KeyboardPrediction`, `KeyboardAutocorrection`, `KeyboardCheckSpelling`,
  `KeyboardAutocapitalization`, `KeyboardShowPredictionBar`, `SmartQuotesEnabled`,
  `SmartDashesEnabled` set to `NO` in `com.apple.Preferences`.
- **While DeviceHub runs, no software keyboard appears.** Xcode 27's simulator UI, which
  `expo run:ios` opens, attaches the Mac's keyboard as hardware; the number pad showed only a "Go"
  pill. **`killall DeviceHub`** brings it back, and the device stays booted.
- **iOS 27's one-time "Speed up your typing by sliding your finger…" tip** eats the next tap; dismiss
  it with `tapOn: Continue`.

**Traps in writing flows:**

- **Going back, and the screen underneath.** Every screen draws its own `Back` and `back` is
  Android-only, so `tapOn: Back`; no `Groceries`/`My Lists`/"Navigate up" back label
  exists, and the `verify:` keeps them out. But a screen below stays in the hierarchy at its real
  coordinates: **on Sharing, List detail's `Back` is still there underneath**, so the tour taps by
  point (`"10%,9%"`, inside Back at y ≈ 75–111 pt on the 18 Pro). Sharing's header is pinned since
  step 6, so the keyboard no longer scrolls Back away. Flows find things by text and a11y label, so
  renaming either breaks them as it breaks the RNTL suites
  ([queries-go-through-a11y-labels](queries-go-through-a11y-labels.md)).
- **While the software keyboard is up, a tap can land on it** — even on a button drawn above it
  (`Send code` typed "t", `Continue` "y"). Submit with **`pressKey: Enter`** instead; it also closes
  the keyboard from a search field or an empty Add bar. Never `hideKeyboard`: on iOS it is a swipe
  on the content, and one opened the row at the screen's centre (the `verify:` keeps it out).
  `eraseText: 60` did not clear a long field.
- **iOS's share sheet** ignores Maestro's swipes and outside taps, and its elements leave the
  hierarchy after a moment: tap `Copy` by point. **Apple's sign-in sheet** works: Maestro can choose
  Share or Hide and tap `close`.
- **Maestro cannot perform the iOS edge-swipe back.** A `swipe` from x 0–1%, fast or slow, popped
  nothing and landed on the content, once checking off a row. Test the swipe by hand.
- **Tap a row only once the list is still and the row is in the open.** A tap during scroll momentum
  only stops the scroll, and `scrollUntilVisible` returns while the list coasts: add
  `waitForAnimationToEnd` first. A row scrolled up behind a pinned header
  ([list-headers-are-pinned-and-opaque](list-headers-are-pinned-and-opaque.md)) taps the header.
  To get back to the top of a very long list, `tapOn: { point: "50%,1%" }` taps the status bar.
- **The dev client draws over the app.** Since SDK 57 a Dev tools button covers the top-right
  pills until it is turned off per device, so `tapOn: Account` opens the dev menu. The fix, and the
  other overlays: [dev-client-draws-over-the-app](dev-client-draws-over-the-app.md).
- **Under heavy machine load a tap right after `inputText` is lost, and `inputText` drops
  characters** (`maya@example.com` → `mxample.com`). Check `uptime` first; rerun.
- **A shot right after a push can catch it mid-slide** (`extendedWaitUntil` returns before the
  transition ends): `waitForAnimationToEnd` first.
- `takeScreenshot` takes a bare name; PNGs land in `<dir>/takeScreenshot/`. `xcrun simctl status_bar
  <udid> override --time 9:41 …` sets the mockups' clock until reboot (24-hour locale: `09:41`).

**Reaching a time of day** (Auto's sunset and sunrise) takes no code — move the zone, not the clock:

- **iOS simulator**, per launch: `xcrun simctl terminate booted com.shoppingloop.app`, then
  `SIMCTL_CHILD_TZ=<zone> xcrun simctl launch booted com.shoppingloop.app` (a Release build too),
  then `xcrun simctl openurl booted` with `open-app.yaml`'s deep link — not `open-app.yaml` itself,
  whose `stopApp` ends the process carrying the variable. Hermes's `Intl` and `Date` follow `TZ`.
- **Android emulator**: `adb shell cmd time_zone_detector set_time_zone_state_for_tests --zone_id
  <zone> --user_should_confirm_id false`, Home before and resume after; restore `Europe/Warsaw`
  and `set_auto_detection_enabled true` afterwards.
- To find a zone whose transition is minutes away, run `resolveTheme` over every `ZONE_COORDS` key in
  a throwaway jest file. The `status_bar` override keeps showing 9:41, never the time under test;
  read what the app believes through [metro-inspector-reads-live-app-state](metro-inspector-reads-live-app-state.md).

**Android** (no flow run since task 20 step 5): `adb reverse tcp:8081 tcp:8081` first; the first
driver install leaves the app stopped, so start with `open-app` and wait for the list before a gesture.

**What lives in `.maestro/`** (kept in the repo, for task 20 and after), against the local stack.
If sign-in fails with "Error sending magic link email", the app is on cloud:
[supabase-target-picked-at-runtime](supabase-target-picked-at-runtime.md).

- `flows/`: `open-app` (cold-starts the dev client into Metro by deep link), `sign-in` (`EMAIL`;
  `scripts/mailpit-code.js` reads the code from Mailpit), `ensure-signed-in`, `sign-out`,
  `set-theme` (`THEME` = `Day`/`Night`/`Auto`), the two screenshot tours, and `tour-search-and-sort`
  (`THEME` = `day`/`night`). **The sort preference persists on the device**, so a flow that sets a
  sort must set it back before it ends, or it leaks into every later run and shot.
- `shoot-all.sh <out> <owner-email> <fresh-prefix>` — both tours in both themes, each set
  explicitly, so Auto's default never reaches them. Set name only appears for a never-seen address,
  so each run needs a fresh prefix. Not for a task's shots, which cover only the changed screens
  ([phone-is-the-product](phone-is-the-product.md)).
- `seed.mjs [owner] [member]` — the tour data, made **through the API** (OTP via Mailpit, then the
  app's RPCs; a psql role switch fails every write RPC's `auth.sessions` check —
  [session-still-valid-guards-writes](session-still-valid-guards-writes.md)). Every share is an
  invite the recipient accepts, found through `my_notifications`. Once per stack, as names are
  unique; on a stack holding the load-test users its "Jor" search finds generated names
  ([supabase-local-stack](supabase-local-stack.md)).
- **`tour-signed-in` hardcodes `Sam`, and display names are unique (`users_name_lower_unique`)**,
  so it runs only as the seed's own owner — on this stack `maya@`, which is off limits. A throwaway
  run needs the member's name as a flow parameter first. Its suggestion rows are `"Invite .*"`
  since task 28, and that version has **not yet run on a device**.
