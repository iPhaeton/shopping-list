---
id: theme-reaches-native-surfaces
title: The in-app theme reaches native surfaces through Appearance and expo-system-ui — except the Google consent sheet, Android's keyboard, and the launch screen until JS runs, which follow the device
type: constraint
status: current
tags: [theme, ios, android, native, cold-start, splash]
sources: [ai/tasks/20-ux/description-step-1.md, ai/tasks/20-ux/implementation-log-step-1.md, ai/tasks/20-ux/implementation-log-step-2.md, ai/tasks/20-ux/implementation-log-step-3.md, ai/tasks/20-ux/implementation-log-step-4.md, ai/tasks/20-ux/description-step-5.md, ai/tasks/20-ux/implementation-log-step-5.md, ai/tasks/21-expo-sdk-57/implementation-log-step-1.md]
last_verified: 2026-09-29
verify: grep -q '"userInterfaceStyle": "automatic"' app.json && grep -q 'Appearance.setColorScheme(scheme)' src/state/ThemeContext.tsx && grep -q 'SystemUI.setBackgroundColorAsync(colors.skyTop)' src/state/ThemeContext.tsx && grep -q '"expo-system-ui"' package.json && (! test -f android/app/src/main/AndroidManifest.xml || grep -q 'android:name=".MainActivity" android:configChanges="[^"]*uiMode' android/app/src/main/AndroidManifest.xml) && node -e "const t=require('fs').readFileSync('src/theme.ts','utf8');const [d,n]=[...t.matchAll(/skyTop: '(#[0-9a-f]{6})'/g)].map(m=>m[1]);const s=require('./app.json').expo.plugins.find(p=>p[0]==='expo-splash-screen')[1];process.exit(s.backgroundColor===d&&s.dark.backgroundColor===n?0:1)" && grep -q 'SplashScreen.preventAutoHideAsync()' App.tsx && grep -q 'onLoad={hideSplash}' src/navigation/RootNavigator.tsx && grep -q 'onReady={hideSplash}' src/navigation/RootNavigator.tsx
related: [phone-is-the-product, dev-client-draws-over-the-app, theme-tokens-only, restored-session-state-waits-for-evidence, native-build-toolchain, google-native-signin-library-gaps, auto-theme-follows-the-time-zone, maestro-drives-the-native-ui]
indexed: false
---

The theme — Day, Night, or whichever Auto resolves to — is an in-app preference, not the device's. `ThemeProvider`
([ThemeContext.tsx](../../../src/state/ThemeContext.tsx)) pushes it out to native in a layout
effect, native only: `Appearance.setColorScheme('light'|'dark')` and
`SystemUI.setBackgroundColorAsync(colors.skyTop)`. Measured on the iPhone 17e (status bar also on
`Pixel_10`):

| surface | follows the app? |
|---|---|
| status bar, iOS keyboard (`keyboardAppearance`), caret | yes. No screen has a native header since task 20 step 5 |
| **Android keyboard** (Gboard, `Pixel_10`) | **no** — stays light at Night. `keyboardAppearance` is an iOS-only prop, and `setColorScheme` does not reach the input method, which follows the device. Accepted |
| in-process system UI — the text edit menu (Paste/Select/AutoFill) | yes, via `setColorScheme` — dark at Night with the device light. The app has no `Alert.alert` of its own to check |
| root view behind the app, including **before JS runs** | yes, via `expo-system-ui` — see below |
| **Google sign-in consent alert** ("Wants to Use accounts.google.com") | **no** — drawn out of process by AuthenticationServices; follows the device. No app API reaches it. Accepted |
| **native launch screen** | **not until JS runs.** The `expo-splash-screen` plugin in `app.json` draws the day sky and emblem, or its `dark` variant, by the *device's* appearance. Once `setColorScheme` runs, the splash view still covering the app switches to the app's variant. Accepted |

**The splash is held until the first screen is fully drawn.** `App.tsx` calls
`SplashScreen.preventAutoHideAsync()` at module scope, and only `hideSplash()`
([splash.ts](../../../src/navigation/splash.ts)) lets it go: from `RootNavigator`'s loading view once
its emblem image has loaded (1.5 s fallback), or from `NavigationContainer`'s `onReady`. Both render
only after `ThemeProvider`'s gate, so the first frame uncovered is already in the right theme. The
loading view carries the launch screen on — the same emblem, same place and size, on the in-app sky.

**The splash colours repeat `skyTop` by hand** (`#dee6f0` day, `#10162e` moonlit): native config
cannot import `theme.ts`. Change one, change the other — the `verify:` compares them — then rebuild
the dev client, since a splash or `app.json` change reaches the app only after one
([native-build-toolchain](native-build-toolchain.md)). The emblem PNGs are 608 px (4 × the 152 pt
`imageWidth`) transparent rasters of the hand-traced `assets/splash/emblem-{day,night}.svg`: edit
the SVG, then re-rasterize. Step 5 used Playwright's Chromium (`omitBackground: true`), from a
script under the project root, because Playwright MCP refuses paths outside it.

**Why the root view was already right before the splash existed.** `setBackgroundColorAsync`
*persists* the colour in the app's user defaults (`ExpoSystemUI.backgroundColor`) and restores it on
the next launch before any JS runs. Frame-by-frame on a Night cold start (task 20 step 1): launch
screen → root view at `#10162e` with nothing drawn (the gate holding) → Lists at Night. The held
splash now covers that gap as well. Nobody has tested dropping the call, so keep it: it still sets
the root view behind every screen.

**Measured on a Release simulator build (task 20 step 5), no light frame:** Night chosen, device
dark: dark splash → Lists at Night. Auto after sunset — the last session ended in Day, then launched
with `SIMCTL_CHILD_TZ=Asia/Tokyo` ([auto-theme-follows-the-time-zone](auto-theme-follows-the-time-zone.md)):
with the device dark, no frame with a light sky; with the device light, the light splash (the
accepted row above), which turns dark in place once JS sets the theme and fades into Lists at Night.
The earlier worry that Auto would uncover last session's root-view colour is closed by the held
splash.

**Measure a cold start on a Release build, not the dev client.** In dev builds the dev client's
white "Downloading 100%…" loader and, since SDK 57, about 0.3 s of black sit between the launch
screen and the app. Neither is a product frame
([dev-client-draws-over-the-app](dev-client-draws-over-the-app.md)).
`npx expo run:ios --configuration Release` builds one for the simulator.

**Android has not seen the launch screen.** Step 5 skipped Android, so whether the 152 pt emblem
survives Android 12+'s circular icon mask is **unverified on device**.

**What keeps it working:**

- `app.json` `userInterfaceStyle` is `"automatic"` (it was `"light"`, pinning everything). On Android,
  `expo-system-ui` is what applies that key — `expo prebuild` writes it into `strings.xml` and makes
  `AppTheme` DayNight; no plugin entry is needed.
- **Android: `MainActivity`'s `configChanges` must include `uiMode`.** `setColorScheme` goes through
  `AppCompatDelegate.setDefaultNightMode`; without `uiMode` the activity is recreated and every
  draft, scroll position and the navigation stack are lost on a switch. It is in the Expo template,
  and `android/` is gitignored and regenerated by prebuild — so the `verify:` checks it whenever
  `android/` exists. Proven on `Pixel_10` with a draft surviving Night → Day. Auto's timed switch is the same
  context-value change: on the iPhone 17e a draft, its focus, and the open keyboard survived a live
  sunrise, the keyboard turning light in place.
- Nothing may render before the preference and fonts are read — the gate in `ThemeProvider`,
  the same rule as [restored-session-state-waits-for-evidence](restored-session-state-waits-for-evidence.md).
