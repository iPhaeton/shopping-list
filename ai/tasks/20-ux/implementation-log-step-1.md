# Implementation log — task 20, step 1: two themes, switchable by hand

**Date:** 2026-09-25. Description: [description-step-1.md](description-step-1.md).

## New project priority: phone first (for the librarian)

Task 20 is the first task where **the product is the phone app** (iOS + Android, portrait) and web is
only the place flows are built and tested against the local stack. When web cannot render what the
phone design needs, the fix goes on the web side (a `Platform.OS === 'web'` fallback, a simpler web
rendering, or an accepted web-only flaw) — never a simplification of the phone design. Web must still
work: every screen usable, no crash, Playwright flows passing. Visual sign-off is on the **iPhone 17e**
simulator, whose screen is exactly the mockups' 1170×2532 @3x, with a second look on iPhone 17 Pro
Max and the `Pixel_10` emulator. This priority did not exist before this step; it applies to every
later step of task 20 and should be treated as standing.

## What changed

**Dependencies / config.**
- `npx expo install expo-font expo-system-ui @expo-google-fonts/nunito-sans @expo-google-fonts/source-serif-4`
  → `expo-font ~14.0.12` (was present only nested at `node_modules/expo/node_modules/expo-font`; now
  a direct dependency, and npm removed the nested copy), `expo-system-ui ~6.0.9`,
  `@expo-google-fonts/nunito-sans ^0.4.2`, `@expo-google-fonts/source-serif-4 ^0.4.1`.
- `expo install` appended a bare `"expo-font"` to `app.json` `plugins` (no `fonts` option → embeds
  nothing; kept because `expo install` adds it by design). It also reformatted the google-signin
  plugin block; that was reverted to the original one-liner.
- `app.json` `userInterfaceStyle`: `"light"` → `"automatic"`. No `expo-system-ui` plugin entry is
  needed: `expo prebuild` wrote `expo_system_ui_user_interface_style=automatic` into Android
  `strings.xml`, `AppTheme` parent is `Theme.AppCompat.DayNight.NoActionBar`, and iOS `Info.plist`
  `UIUserInterfaceStyle` became `Automatic`. `MainActivity` already had `uiMode` in
  `configChanges`, so a runtime scheme switch does not recreate the activity.

**`src/theme.ts`** — tokens only. `colors` is gone (so nothing can import a frozen palette);
exports `Palette`, `day`, `night`, `palettes`, `ThemeName`, `fonts`, `spacing`, `radius` (+ `pill:
999`). Palette keys (same in both): `skyTop skyHorizon surface surfaceOutline bannerSurface text
textMuted textDone primary onPrimary primaryDisabled outline switchTrack switchKnob celestial bands[6]
groundTop groundBottom farHill checkboxOutline iconButtonFill divider error onError`. Values are the
description's table verbatim, plus four it did not give:

| key | day | night | basis |
|---|---|---|---|
| `surfaceOutline` | `#ffffff` | `#4a4f64` | night from the table ("outline #4a4f64"); day input in the mockup has a white rim |
| `primaryDisabled` | `#989fb6` | `#666880` | primary at ~40% over `skyTop` |
| `error` | `#b3261e` | `#ff9b90` | WCAG contrast computed: day 5.19 on `skyTop`, 6.06 on `surface`; the old `#c0392b` was **4.32 on the new day sky — fails AA**, so it changed. Night ≥ 5.19 on every night surface (8.79 `skyTop`, 6.57 `surface`, 5.19 `bannerSurface`) |
| `onError` | `#ffffff` | `#1b2137` | danger-button label; white on `#b3261e` 6.54, `#1b2137` on `#ff9b90` 7.84 |

`fonts`: `serif: 'SourceSerif4_400Regular'`, `sans: 'NunitoSans_400Regular'`, `sansSemiBold:
'NunitoSans_600SemiBold'`, `sansBold: 'NunitoSans_700Bold'` — one family per weight, and every
former `fontWeight: '600'/'700'` became the matching family with `fontWeight` removed (Android does not
pick weights inside a custom family).

**`src/lib/themePreference.ts`** — `nameCache.ts`'s shape. Key `theme-preference` (per device, not per
account), value `{"v":1,"preference":"day"|"night"}`. `readThemePreference()` never rejects: absent,
unparseable, wrong `v`, unknown value, or a rejecting `getItem` → `'day'`. `writeThemePreference()`
goes through `inOrder`.

**`src/state/ThemeContext.tsx`** — `ThemeProvider`, `useTheme()`, `themedStyles()`.
- `ThemeProvider` reads the preference once and loads the four fonts with `useFonts` in parallel;
  **returns `null` until the preference is read and fonts are loaded-or-failed** (a font failure falls
  back to system faces rather than holding the app closed). The gate opens once and never closes;
  afterwards a switch only changes the context value. Font files are imported by subpath
  (`@expo-google-fonts/nunito-sans/400Regular`), because each package index `require`s all 16
  weights and Metro would bundle every one.
- A `useLayoutEffect` on the scheme calls `Appearance.setColorScheme('light'|'dark')` and
  `SystemUI.setBackgroundColorAsync(colors.skyTop)`, native only (react-native-web has neither; RNW's
  `Appearance` has no `setColorScheme`).
- `useTheme()` → `{ name, scheme, colors, preference, setPreference }`. `name` and `preference` are
  identical today; step 2's `'auto'` is why both exist.
- **The context default is the day palette**, not a throw for a missing provider. That is what lets
  all 22 pre-existing suites render screens without a `ThemeProvider` untouched, and why none of them
  touch font loading.
- `themedStyles(factory)` is the single styling pattern: `const useStyles = themedStyles((colors) =>
  ({ … }))` at module scope, `const styles = useStyles()` at render. It `StyleSheet.create`s once per
  palette object and caches in a `Map` (≤ 2 entries). The factory parameter is named `colors` so
  style bodies read exactly as before.

**`App.tsx`** — `SafeAreaProvider > ThemeProvider > SessionProvider > ListsForSignedInUser`.
`<StatusBar style="dark" />` → `ThemedStatusBar` (`'light'` at night, `'dark'` by day).

**The 18 `colors` importers** (`grep -rl "from '../theme'" src` before this step) all moved to
`themedStyles`, with `const styles = useStyles()` as the first hook — before the early returns in
`AccountScreen`, `SetNameScreen`, `ListsScreen`, and in the local `PrimaryButton`s of `SignInScreen`
and `SetNameScreen`. Inline colors (`placeholderTextColor`, four `ActivityIndicator`s) read
`useTheme()`. Every `TextInput` (7) gained `keyboardAppearance={scheme}` and
`selectionColor={colors.primary}` (the caret was iOS system blue, off-palette). Token mapping:

| old | where | new |
|---|---|---|
| `background` | screen / loading backgrounds | `skyTop` |
| `background` | input fills, RolePicker option fill | `surface` |
| `background` | binned rows (`rowDeleted`) | `skyHorizon` |
| `surface` | cards, rows, AddBar strip, Error/Blocked banners | `surface` |
| `surface` | SyncBanner | `bannerSurface` |
| `border` | input / card / row edges | `surfaceOutline` |
| `border` | ItemRow checkbox, ShowDeletedToggle box | `checkboxOutline` |
| `border` | outlined buttons (Cancel on Account/Sharing, SegmentedPicker option) | `outline` |
| `border` | AddBar bottom rule, suggestion divider | `divider` |
| `textMuted` | ItemRow `titleDone` | `textDone` |
| `accent` | fills, checked states, text links, spinners, BlockedBanner border | `primary` |
| `accentDisabled` | disabled fills and text | `primaryDisabled` |
| `onAccent` | on `primary` | `onPrimary` |
| `onAccent` | on the danger buttons | `onError` |

**`RootNavigator`** — loading view/spinner themed; `screenOptions` gain `headerStyle.backgroundColor:
skyTop`, `headerTintColor: text`, `headerTitleStyle.fontFamily: fonts.serif` (the serif applies to
native header titles only in this step; in-card titles like "Sign in" stay sans semibold),
`headerBackTitleStyle.fontFamily: fonts.sans`, `contentStyle: skyTop`. `NavigationContainer` gets a
`theme` memoized per palette (`DarkTheme`/`DefaultTheme` base, `background`/`card` = `skyTop`, `text`,
`border` = `divider`, `primary`) so nothing white shows behind a push at night. `ListDetailScreen`'s
`setOptions` effect gained `styles` in its deps.

**Picker.** `RolePicker`'s body moved into a generic `src/components/SegmentedPicker.tsx`
(`options: {value,title}[]`, `value`, `labelFor`, `disabled`, `onChange`; same `radio` +
`{checked, disabled}` a11y shape). `RolePicker` is now a thin wrapper with unchanged props, so
`SharingScreen` and its suite did not change. `AccountScreen` has a new card between Name and Sign
out: label "Appearance" + `SegmentedPicker` Day/Night (labels `Day`, `Night` — unique on the screen),
`onChange={setPreference}`. Step 5 restyles `SegmentedPicker` once for both uses.

**Placeholder letter-spacing leak (iOS, pre-existing, fixed).** After the sign-in code field
(`codeInput`, `letterSpacing: 6`) had existed once in a JS session, other inputs' placeholders
rendered spaced out — `N e w  l i s t  n a m e`, `Y o u r  n a m e`. Fabric reuses native text-input
views and a recycled one keeps the old kerning when the new style simply omits `letterSpacing`.
Reproduced on the iPhone 17e (sign out → code phase → sign in → Lists placeholder spaced), fixed by an
explicit `letterSpacing: 0` on every input style, re-checked on the same path. Not caused by this
step, but the new screenshots made it obvious.

## Machine gaps closed

**iOS dev build → booted app.** `npx expo prebuild --platform ios` (not `--clean`) updated
`Info.plist` but **did not reinstall pods**: `Podfile.lock` still pointed at the nested
`expo/node_modules/expo-font` and had no `ExpoSystemUI`. `cd ios && pod install`, then `npm run ios --
--device "iPhone 17e"` built (0 errors, 3 warnings) and opened the app. **The built `.app` lands in
Xcode's DerivedData** (`~/Library/Developer/Xcode/DerivedData/ShoppingLoop-*/Build/Products/Debug-iphonesimulator/ShoppingLoop.app`),
not `ios/build` — `ios/build` only ever holds `generated/`, so "`ios/build` has no `.app`" was never
evidence either way. That `.app` can be `xcrun simctl install`ed onto another simulator without a
rebuild.

**Driving the native UI: Maestro 2.10.0** (user approved the install).
- `brew install mobile-dev-inc/tap/maestro` **refused**: Homebrew reports Xcode 26.6 as "too
  outdated" on this macOS (it wants Xcode 27). The official `get.maestro.mobile.dev` script would work
  but appends PATH lines to `~/.zshrc` and `~/.bash_profile`; instead its download step was done by
  hand — the GitHub release zip unpacked into `~/.maestro` — so no dotfile changed. Maestro is **not
  on PATH**; run it as `JAVA_HOME=/opt/homebrew/opt/openjdk ~/.maestro/bin/maestro …` (it needs Java
  17+, same as Gradle). First run on a simulator installs its XCTest driver (~1m45s); later
  invocations cost ~20–40 s of JVM + driver start each.
- **`inputText` mangled text** (`maya@example.com` → `ya@example.comm`, then typing stopped landing at
  all). Cause: the simulator had inherited the Mac's multilingual keyboards (`AppleKeyboards` =
  `en_US@…;ml=1`, `pl_PL@ml=1`, `pl_PL@…;ml=2`, `en_US@ml=2`, `be@…`, `en_GB@…;ml=3`, `pl_PL@ml=3`,
  `emoji@sw=Emoji`). Fixed on the iPhone 17e only: `xcrun simctl spawn <udid> defaults write
  .GlobalPreferences AppleKeyboards -array "en_US@sw=QWERTY;hw=Automatic"` + simulator reboot; also
  `KeyboardPrediction`/`KeyboardAutocorrection`/`KeyboardCheckSpelling`/`KeyboardAutocapitalization`/
  `KeyboardShowPredictionBar`/`SmartQuotesEnabled`/`SmartDashesEnabled` = NO in `com.apple.Preferences`.
  Any other simulator Maestro types into needs the same.
- Maestro's `back` is Android-only. On iOS the native-stack back button's accessibility label is the
  **previous screen's title** (`My Lists`, `Groceries`), so flows `tapOn` that.
- Maestro 2.x refuses a `takeScreenshot` path outside the run's output folder; flows use bare names,
  runs pass `--test-output-dir`, and PNGs land in `<dir>/takeScreenshot/`. They are XCTest captures of
  the simulator at full 1170×2532.
- A React Native **perf-monitor overlay** was on in the app's saved dev settings
  (`RCTDevMenu.RCTPerfMonitorKey = 1` in the app container's `Library/Preferences/com.shoppingloop.app.plist`);
  turned off with `xcrun simctl spawn booted defaults write <that path without .plist> RCTDevMenu -dict …`.
- `xcrun simctl status_bar <udid> override --time 9:41 …` makes screenshots match the mockups' clock;
  it does not survive a simulator reboot.

**What is in `.maestro/`** (checked in, for steps 2–5):
- `flows/open-app.yaml` — cold-starts the dev client straight into Metro via
  `exp+shopping-list://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081`.
- `flows/sign-in.yaml` (`EMAIL`) — OTP sign-in; `scripts/mailpit-code.js` reads the code from Mailpit's
  HTTP API inside the flow (`http.get` + `json`).
- `flows/ensure-signed-in.yaml`, `flows/sign-out.yaml`, `flows/set-theme.yaml` (`THEME` = `Day`/`Night`).
- `flows/tour-signed-out.yaml`, `flows/tour-signed-in.yaml` (`THEME` = `day`/`night`) — screenshot
  every screen state the description lists.
- `shoot-all.sh <out> <owner-email> <fresh-prefix>` — runs both tours in both themes; Set name needs a
  never-seen address per theme, so it names that account with one `psql` `update` and cold-starts.
- `seed.mjs [owner] [member]` — creates the tour data **through the API** (OTP via Mailpit, then the
  app's own RPCs/inserts). A psql role switch cannot do it: every write RPC checks for a live
  `auth.sessions` row. Tested on `maya3@`/`sam3@`. Run once per stack (names are unique).

Local accounts used here: `maya@example.com` (Maya — owner of Groceries [Bread done, Coffee binned,
Sam as writer], Hardware store, Pharmacy; writer on Weekend BBQ; reader on Birthday party),
`sam@example.com` (Sam), and throwaway `nora1-*`/`nora2-*`/`maya3`/`sam3`. Maya's own lists were
first made through the web UI; Sam's side came from what became `seed.mjs`.

## Native surfaces — what follows the theme and what cannot

| surface | result on iPhone 17e |
|---|---|
| status bar | dark icons by day, light at night |
| native header, `contentStyle`, loading view | sky color per theme; serif title |
| keyboard | light/dark via `keyboardAppearance` (and `setColorScheme`) |
| in-app system UI (text edit menu: Paste/Select/AutoFill) | follows the in-app choice — dark at Night with the device light (`system-edit-menu-night.png`) |
| caret / selection | `primary` |
| Google sign-in consent alert ("Wants to Use accounts.google.com") | **follows the device, not the app** — light at Night (`system-alert-night.png`); turned dark only after `xcrun simctl ui booted appearance dark`. It is drawn out of process by AuthenticationServices; no app API reaches it. Accepted. The app has no `Alert.alert` of its own. |
| native launch screen | white; follows system appearance — step 5's to configure |

## No wrong-theme frame at cold start

Recorded a Night cold start (`xcrun simctl io booted recordVideo`, terminate → `openurl` the dev-client
link), split into frames with ffmpeg, and measured each frame's mean luma. Order: home screen → white
native launch screen → the dev client's white "Downloading 100%…" loader (**dev builds only**) → the
root view in `#10162e` with nothing painted (the gate holding) → first painted frame is Lists at Night.
**No day-palette frame is ever painted by the app.** The night root color at that moment comes from
`expo-system-ui`: `setBackgroundColorAsync` persists the color in the app's user defaults
(`ExpoSystemUI.backgroundColor` = `0xff10162e`) and restores it on the next launch, before JS runs —
which covers the gap between the native launch screen and the first React frame. Step 5 still has to
keep the splash up until the gate opens.

## Web (Playwright MCP, local stack, 390×844)

Sign-in via Mailpit, set name, three lists, five items, one done, one binned — all working. The theme
was flipped **in place** while List detail had the rename bar open with a draft
(`Groceries draft rename`) and the Add bar held `half-typed item`: both drafts, the title, and the
stack survived; the input fill went `rgb(246,246,250)` → `rgb(40,46,72)`; storage held
`{"v":1,"preference":"night"}`. (No Appearance control is reachable from that screen, so the flip
called `setPreference` on `ThemeProvider`'s context value found through the React fiber tree — the
same call the picker makes.) Reload stayed Night; the Account picker switched back to Day and
persisted. Web-only flaws, accepted: before the gate opens the page is blank white even at night; the
browser's focus ring is blue. **RNW 0.21 drops `accessibilityState`**, so web radios/checkboxes carry
no `aria-checked` — pre-existing (the same is true of `RolePicker` and `ItemRow` before this step), so
Playwright cannot assert checked state on web; RNTL and native can.

## Verification

- `npm test`: 24 suites / 426 tests (was 22 / 412). New: `src/lib/themePreference.test.ts` (6 —
  default, round-trip, unparseable, wrong version, unknown value, rejecting `getItem`),
  `src/state/ThemeContext.test.tsx` (5 — nothing renders **while** `getItem` is held open, day default,
  stored night restored + `Appearance.setColorScheme('dark')`, unreadable storage → day, switch
  recolors with the child's draft and mount count intact and persists), and a new `describe` in
  `src/screens/AccountScreen.test.tsx` (3 — Day checked by default, pressing Night checks it, recolors
  and persists, a stored Night shows checked). The gate test was mutation-checked: dropping
  `preference === null` from the gate fails it. No existing test was edited. `useFonts` resolves under
  jest-expo's `ExpoFontLoader` mock; no suite waits on it.
- `npm run typecheck`: clean. `npm run kb:audit`: 0 errors (warnings are "ground moved" only).
- Screenshots: `ai/tasks/20-ux/screenshots/step-1/` — `<screen>-<day|night>.png` for sign-in-email,
  sign-in-email-keyboard, sign-in-code, set-name, lists, list-detail-bin-shown,
  list-detail-rename-open, list-detail-read-only, sharing, account; plus `system-alert-night.png` and
  `system-edit-menu-night.png`. All from the iPhone 17e simulator, taken after the letter-spacing and
  caret fixes.

**iPhone 17 Pro Max** — the same `.app` from DerivedData, `xcrun simctl install`ed with no rebuild
(the keyboard fix above applied first). `tour-signed-in` in both themes: Lists, List detail (bin
shown, rename open, read-only), Sharing, Account all render at 1320×2868 with nothing clipped and no
leftover color. A simulator that has never opened `exp+shopping-list://` asks "Open in
“ShoppingLoop”?" first; `open-app.yaml` now waits for animations and taps `Open` optionally.

**Android `Pixel_10`** — `npx expo prebuild --platform android` (not `--clean`; `debug.keystore` MD5
unchanged, backed up first anyway), then `npm run android -- --no-bundler` against the Metro that
`npm run ios` had started (BUILD SUCCESSFUL in 3m 18s). Checked: day and night Lists, Account, List
detail; status-bar and gesture-bar icons flip with the theme; headers in the serif; Nunito Sans
everywhere. **The remount check:** with `Draft survives` typed into Lists' "New list name", Account →
Night → back → the draft was still there; → Day → back → still there. `Appearance.setColorScheme` on
Android goes through `AppCompatDelegate.setDefaultNightMode`; with `uiMode` in `MainActivity`'s
`configChanges` it does not recreate the activity, which is what this proves. Android notes for the
Maestro flows: `back` works there; run `adb reverse tcp:8081 tcp:8081` so `open-app.yaml`'s
`127.0.0.1:8081` reaches Metro; the app was not running after Maestro's first-time Android driver
install (no crash in `logcat -b crash` — only the emulator's own `android.hardware.uwb-service`
aborting), so start with `open-app`; a freshly booted emulator may show "System UI isn't responding"
over everything — tap Wait. No Android screenshots are saved to the step folder; the description
asks only for a pass there.

## Left for later / flagged for the user

- **Day `textMuted` `#75778f` is 3.48:1 on the day sky** (4.07 on `surface`) — below AA 4.5 for the
  hint text it is used for. Night `textMuted` passes (≥ 4.82). Kept exactly as the description's table
  gives it; the user decides.
- The `›` chevron in `ListRow` sits high in Nunito Sans (the glyph is small and near x-height). Step 3
  replaces chevrons with icons, so it was left.
- iOS 26 draws native header buttons (back, Rename list, Share list, Account) in Liquid Glass pills —
  system styling, not ours.
