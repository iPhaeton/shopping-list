# Step 1 — Two themes, switchable by hand

Task 20 restyles the whole app to the **Quiet Horizon** design. The design is four images in
`ai/ux/primary/`, all 1170×2532 px @3x (390×844 pt — divide a measurement by 3 to get points):

| screen | day | night ("Moonlit") |
|---|---|---|
| Lists | `lists-screen-quiet-horizon.png` | `lists-screen-quiet-horizon-moonlit.png` |
| List detail | `list-detail-screen-quiet-horizon.png` | `list-detail-screen-quiet-horizon-moonlit.png` |

Nothing else is the design. `ai/ux/other/*` are alternatives the user did not pick — take nothing from
them. The List detail pair was drawn afterwards, in the Lists pair's language and the palette below.
No image covers Sign in, Set name, Account, or Sharing; step 5 carries the same language there.

| step | delivers |
|---|---|
| 1 (this) | theme plumbing, both palettes and the new type applied flat to every screen, a manual Day/Night choice |
| 2 | Auto — Moonlit from local sunset to sunrise |
| 3 | the Lists screen built to the mockup: sky, sun/moon, horizon-band rows, icons |
| 4 | the List detail screen built to its mockup: horizon lead-in, items on one stretch of land, icons |
| 5 | Sign in, Set name, Account, Sharing, the remaining shared components, the launch screen |

## Phone first (applies to every step)

- **The product is the phone app:** iOS and Android, in portrait. Web is where flows are built and
  tested against the local stack. How web *looks* is not a goal.
- **When web can't render what the phone design needs, fix it on the web side.** Examples: fonts,
  SVG, translucency and shadows, `Appearance.setColorScheme`, `keyboardAppearance`, safe areas,
  overscroll. The options are a `Platform.OS === 'web'` fallback, a simpler web rendering, or
  accepting a web-only flaw. **Never** simplify or bend the phone design to suit web.
- **Web must keep working.** Every screen stays usable, nothing crashes, and the Playwright flows
  still pass, because web is still the check for everything that isn't visual.
- **Visual sign-off happens on a phone.** Compare against the mockups on the **iPhone 17e**
  simulator. Its screen is exactly the mockups' 1170×2532 @3x, so a simulator screenshot
  (`xcrun simctl io booted screenshot`) lines up with a mockup pixel for pixel.
  - Every screenshot saved under `ai/tasks/20-ux/screenshots/` comes from the simulator.
  - Check each step once more on a taller phone (iPhone 17 Pro Max) and on the Android emulator
    (`Pixel_10`).
- **Two gaps on this machine, both first hit in step 1.** Step 1 closes both and records how in its
  log:
  - The iOS dev build has never run to a booted app: `ios/build` has no `.app`
    (`ai/kb/entries/native-build-toolchain.md`). Get `npm run ios` to a booted app on the iPhone
    17e.
  - Nothing can drive the native UI: no Maestro, idb, or Detox is installed. Decide how later steps
    will reach each screen and state on the simulator. Maestro is the usual choice for Expo apps; ask
    the user before installing anything.
- This priority is new to the project. Say so in the step-1 log so the librarian records it.

## This step

Plumbing plus a flat re-color: every screen keeps its current layout, and only colors and type
change. No illustrations, icons, or layout changes (step 3 onward).

**1. Palettes.** `src/theme.ts` exports two palettes with identical, semantic keys: `day` and
`night`. The first nine rows were sampled from the Lists mockups. They come from a compressed PNG,
so treat them as close approximations to refine by eye. The last six rows are the exact values the
List detail mockups were drawn with:

| role | day | night |
|---|---|---|
| sky, top → near the horizon | `#dee6f0` → `#e6e4f0` | `#10162e` → `#161c3a` |
| surface: input / sync banner | `#f6f6fa` / `#f8f8fc` | `#282e48` (outline `#4a4f64`) / `#343c68` |
| text | `#2c2f4e` | `#eef0fa` |
| text muted (placeholder, chevron) | `#75778f` | `#a9aecb` |
| primary button fill / label | `#2e3460` / `#f7f4fb` | `#e6e2fa` / `#1b2137` |
| outline (Account pill) | `#a6abbc` | `#5f6376` |
| switch track (off) / knob | `#c8c8d6` / `#fefefe` | `#40445c` / `#e8eaf4` |
| sun / moon | `#feecd2` | `#f8f9fd` |
| horizon bands, top → bottom | `#e4d8ea` `#d0c4e0` `#b2a8d2` `#5e5a92` `#4a4e82` `#2e3460` | `#56628a` `#465276` `#384264` `#2c3452` `#202842` `#161c30` |
| item ground, top → bottom of screen | `#e6dbee` → `#d6cae4` | `#434e78` → `#2a3252` |
| far hill (at 85% opacity) | `#e3d8ec` | `#56628a` |
| done item text | `#52546f` | `#c3c7de` |
| checkbox outline (unchecked) | `#6e7090` | `#c9cde6` |
| icon-button fill | `rgba(255,255,255,0.55)` | `rgba(255,255,255,0.12)` |
| row divider | `rgba(44,47,78,0.11)` | `rgba(255,255,255,0.09)` |

The primary button inverts between themes: dark on light by day, light on dark by night. A checked
checkbox uses the primary fill with the primary label color for its tick. The done-text colors were
chosen to pass AA across the whole item ground. `error` needs a night value that passes AA on the
night surfaces. The band, ground, hill, and divider colors are first used in steps 3–4. Define them
now so the palette lives in one place. `spacing` and `radius` stay static. Add a pill
radius.

**2. Runtime theme.** Add a provider above `SessionProvider` in `App.tsx`, and a hook (e.g.
`useTheme()`) that returns the resolved palette, the preference, and a setter. A module-scope
`StyleSheet.create({ … colors.x … })` freezes a color at import time. So every file that imports
`colors` must read it at render instead: 18 files, `grep -rl "from '../theme'" src`. The pattern is
yours (a style factory memoized per palette, say), but use one pattern everywhere. **Switching must
not remount** `NavigationContainer` or any provider, so key nothing by theme. After a switch, an open
rename editor, an `AddBar` draft, a scroll position, and the navigation stack all survive.

**3. Typography.** The mockup sets the screen title ("My Lists") in a serif display face and
everything else in a soft geometric/humanist sans. The sans is Avenir Next, which is licensed and
ships on iOS only, so pick open-licence Google Fonts that match closely. The closest found so far:
Source Serif 4 at weight 400 for the serif, and Nunito Sans for the sans (Mulish is the runner-up).
The List detail mockups were drawn with exactly these two. Load them with `expo-font` +
`@expo-google-fonts/*`, installed via `npx expo install`, and expose them as tokens. Apply the sans
everywhere now, and the serif to screen titles (native header titles in this step). Both themes use
the same fonts.

**4. Preference.** The value is `'day' | 'night'` (step 2 adds `'auto'`), stored **per device** in
AsyncStorage. It is not stored per account, because it applies on the signed-out screens and survives
an account switch, and it is not stored on the server. Write it through `inOrder`
(`src/lib/storageQueue.ts`), like every other AsyncStorage write. An absent or unreadable value falls
back to `'day'` for now.

**5. No wrong-theme frame.** Nothing paints until the preference and the fonts are read. This is the
rule `SessionContext` already follows for sessions (`ai/kb/entries/restored-session-state-waits-for-evidence.md`).
A night user must never see a day frame at cold start.

**6. Picker.** Add an "Appearance" section to `AccountScreen`: a segmented radio control with `Day`
and `Night`. It takes `RolePicker`'s a11y shape: `accessibilityRole="radio"`,
`accessibilityState={{ checked }}`, and labels unique on the screen. Generalizing `RolePicker` is fine
if it stays readable. A choice applies immediately and persists.

**7. Native surfaces follow the theme.** Today they are pinned light: `App.tsx` renders
`<StatusBar style="dark" />`, and `app.json` sets `"userInterfaceStyle": "light"`. Each of these must
match the resolved theme:

- the status bar
- `RootNavigator`'s `headerStyle`, `headerTintColor`, `contentStyle`, and its loading view
- every `placeholderTextColor`
- every `ActivityIndicator`
- `TextInput` `keyboardAppearance`
- system dialogs

RN 0.81's `Appearance.setColorScheme` exists for the native half. Read the Expo v54 docs for
`userInterfaceStyle`: Android needs `expo-system-ui`. An `app.json` change reaches the native app only
after a dev-client rebuild (`npm run ios` / `npm run android`).

## Constraints

- Color literals live only in `src/theme.ts`. `npm run kb:audit` fails otherwise
  (`ai/kb/entries/theme-tokens-only.md`).
- Change no a11y role, no label, and no user-facing copy. Existing suites should pass untouched
  (`ai/kb/entries/queries-go-through-a11y-labels.md`).
- `jest.setup.ts` already mocks AsyncStorage. Make sure no suite blocks on font loading under jest.

## Done when

- Every screen renders in both palettes with no leftover pre-task color. That covers Sign in (both
  phases), Set name, Lists, List detail (bin shown, rename open, read-only), Sharing, and Account.
  Check on the iPhone 17e simulator, including the status bar, keyboard, and alerts, then do one pass
  on the Android emulator. Web only has to work.
- Choosing Night recolors the app at once and survives a reload. A cold start at Night paints no day
  frame.
- New tests cover: the default, a stored choice restored, the picker switching and persisting, and
  unreadable storage falling back.
- `npm test`, `npm run typecheck`, and `npm run kb:audit` pass.
- Day and night screenshots of every screen are saved to `ai/tasks/20-ux/screenshots/step-1/`.
