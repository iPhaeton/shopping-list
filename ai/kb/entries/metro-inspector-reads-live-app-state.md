---
id: metro-inspector-reads-live-app-state
title: Metro's inspector evaluates JS inside the running dev build — read Hermes's Intl or a provider's live state on a simulator without adding code or trusting a screenshot
type: environment
status: current
tags: [environment, verification, metro, hermes, debugging, ios, android]
sources: [ai/tasks/20-ux/implementation-log-step-2.md]
last_verified: 2026-09-26
verify: node -e 'process.exit(typeof WebSocket === "function" && typeof fetch === "function" ? 0 : 1)'
related: [maestro-drives-the-native-ui, phone-is-the-product, native-build-toolchain, auto-theme-follows-the-time-zone]
indexed: false
---

With Metro running and a dev build attached, `http://127.0.0.1:8081/json/list` lists one debugger
target per connected app, each with a `webSocketDebuggerUrl`. Sending the Chrome DevTools Protocol
message `Runtime.evaluate` (`returnByValue: true`) over that socket makes Hermes evaluate an
expression **inside the live app** — no `__DEV__` hook, no rebuild, nothing committed. Node 22+
has global `fetch` and `WebSocket`, so a throwaway script in the scratchpad needs no package (this
machine runs Node 24; the `verify:` checks both globals exist).

**Pick the device by `title`** when both are attached: `… (iPhone 17e)` versus
`… (sdk_gphone16k_arm64)` for the `Pixel_10` emulator. On a loaded emulator a call can time out;
retry rather than conclude.

**What it has answered:**

- **Runtime facts as that device's Hermes sees them** — task 20 step 2 measured `Intl`'s zone,
  `timeStyle`, legacy zone names, and `Date`'s offset this way on both platforms
  ([auto-theme-follows-the-time-zone](auto-theme-follows-the-time-zone.md)).
- **React state, with a timestamp.** `__REACT_DEVTOOLS_GLOBAL_HOOK__.getFiberRoots(id)` (for each id
  in the hook's `renderers`) gives the fiber roots; walk them for `type.name === 'ThemeProvider'` and
  scan its `memoizedState` chain for the hook value (`{ now, zone }`). That showed the provider
  re-checking 7 ms after the computed sunset — something no screenshot can show.

**Read the state before calling it a bug.** On the Android emulator, screenshots taken 2–3 s after
resuming twice showed the *previous* time zone's theme. The probe showed the provider had already
re-read the new zone about 3 s after `am start`; the screenshots had simply beaten the re-render.
Screenshots and Maestro ([maestro-drives-the-native-ui](maestro-drives-the-native-ui.md)) show what
is painted, not what the app believes — on a slow emulator those differ for seconds.
