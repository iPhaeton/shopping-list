---
id: maestro-drives-the-native-ui
title: Maestro drives the native app — installed by hand at ~/.maestro, not on PATH, and each simulator needs its keyboards reset before it can type
type: environment
status: current
tags: [environment, verification, maestro, ios, android, simulator]
sources: [ai/tasks/20-ux/implementation-log-step-1.md]
last_verified: 2026-09-25
verify: test -x ~/.maestro/bin/maestro && ls ~/.maestro/lib | grep -q '^maestro-cli-2\.' && test -x /opt/homebrew/opt/openjdk/bin/java && grep -q '^appId: com.shoppingloop.app$' .maestro/flows/open-app.yaml && grep -q 'exp+shopping-list://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081' .maestro/flows/open-app.yaml && grep -q '/auth/v1/otp' .maestro/seed.mjs
related: [phone-is-the-product, native-build-toolchain, supabase-local-stack, session-still-valid-guards-writes, queries-go-through-a11y-labels]
---

Since task 20 step 1, **Maestro 2.10.0** is how an agent reaches a screen and state on the iOS
simulator or Android emulator — sign in, navigate, flip the theme, screenshot. Before it, nothing
could drive the native UI (no Maestro, idb, or Detox), which is why the iOS dev build went unproven
past launch for so long ([native-build-toolchain](native-build-toolchain.md)).

**Run it by full path, with Java 17+:**

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk ~/.maestro/bin/maestro test --test-output-dir <dir> \
  .maestro/flows/<flow>.yaml -e THEME=Night
```

It is not on PATH on purpose. `brew install mobile-dev-inc/tap/maestro` refuses on this machine
(Homebrew calls Xcode 26.6 "too outdated" and wants 27), and the official `get.maestro.mobile.dev`
script appends PATH lines to `~/.zshrc` and `~/.bash_profile` — so the release zip was unpacked into
`~/.maestro` by hand and no dotfile changed. The first run on a new simulator installs Maestro's
XCTest driver (~1m45s); every later invocation pays ~20–40 s of JVM and driver start.

**A simulator must have its keyboards reset before `inputText` works.** Simulators inherit the
Mac's multilingual keyboard list, and Maestro's typing came out mangled (`maya@example.com` →
`ya@example.comm`), then stopped landing at all. Fixed on the iPhone 17e and 17 Pro Max only — any
other simulator Maestro types into needs the same, then a reboot of that simulator:

```bash
xcrun simctl spawn <udid> defaults write .GlobalPreferences AppleKeyboards -array "en_US@sw=QWERTY;hw=Automatic"
```

plus `KeyboardPrediction`, `KeyboardAutocorrection`, `KeyboardCheckSpelling`,
`KeyboardAutocapitalization`, `KeyboardShowPredictionBar`, `SmartQuotesEnabled`,
`SmartDashesEnabled` set to `NO` in `com.apple.Preferences`.

**Traps in writing flows:**

- `back` is Android-only. On iOS the native-stack back button's label is the **previous screen's
  title**, so flows `tapOn: My Lists` / `tapOn: Groceries`. Flows tap by visible text and a11y label
  throughout, so a renamed header title or label breaks them as surely as it breaks the RNTL suites
  ([queries-go-through-a11y-labels](queries-go-through-a11y-labels.md)).
- `takeScreenshot` refuses a path outside the run's output folder. Use a bare name and pass
  `--test-output-dir`; PNGs land in `<dir>/takeScreenshot/` at the simulator's full resolution.
- A simulator that has never opened `exp+shopping-list://` asks "Open in “ShoppingLoop”?" first —
  `open-app.yaml` waits and taps `Open` optionally.
- `xcrun simctl status_bar <udid> override --time 9:41 …` matches the mockups' clock; it does not
  survive a simulator reboot.
- A React Native perf-monitor overlay was saved on in the app's dev settings
  (`RCTDevMenu.RCTPerfMonitorKey` in the app container's
  `Library/Preferences/com.shoppingloop.app.plist`); if it shows up in a screenshot, turn it off
  there with `xcrun simctl spawn booted defaults write …`.

**Android:** `back` works. Run `adb reverse tcp:8081 tcp:8081` first so `open-app.yaml`'s
`127.0.0.1:8081` reaches Metro. After Maestro's first-time driver install the app was not running
(no crash in `logcat -b crash`), so start with `open-app`. A freshly booted emulator may put "System
UI isn't responding" over everything — tap Wait.

**What lives in `.maestro/`** (kept in the repo, for task 20 and after), against the local stack:

- `flows/open-app.yaml` — cold-starts the dev client straight into Metro through its deep link.
- `flows/sign-in.yaml` (`EMAIL`) — OTP sign-in; `scripts/mailpit-code.js` reads the code from
  Mailpit's HTTP API inside the flow. Also `ensure-signed-in`, `sign-out`, `set-theme` (`THEME` =
  `Day`/`Night`), and the two screenshot tours (`THEME` = `day`/`night`).
- `shoot-all.sh <out> <owner-email> <fresh-prefix>` — both tours in both themes. Set name only
  appears for a never-seen address, so each run needs a fresh prefix.
- `seed.mjs [owner] [member]` — the tour data, made **through the API** (OTP via Mailpit, then the
  app's own RPCs). A psql role switch cannot do it: every write RPC checks for a live
  `auth.sessions` row ([session-still-valid-guards-writes](session-still-valid-guards-writes.md)).
  Once per stack — names are unique.
