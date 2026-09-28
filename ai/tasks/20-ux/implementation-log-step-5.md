# Implementation log — task 20, step 5: Sign in, Set name, Account, Sharing, and the launch

**Date:** 2026-09-29. Description: [description-step-5.md](description-step-5.md). Plan approved by
the user before work began.

**The mockups are the design.** Commit `962533c` (20-ux-5) added 18 images to `ai/ux/primary/` for
exactly this step's screens, after the description was written:
- sign-in (email, code), set-name, launch
- account (plain; editing + sign-out-everywhere confirm)
- sharing (owner with suggestions; member with Leave confirm; owner with Remove confirm)

Each is in day and moonlit. The description's "No image covers Sign in…" (step 1) is superseded; its
constraints and done-when list still governed. Expo docs read: v57 (AGENTS.md), not the v54 the
description names.

## Decisions

**Made by the user during the step:**
1. **The invite row (`RolePicker` + `Share`) appears only once the name field has text**, as the
   Remove-confirm mockup draws it (empty field, nothing below). The picked role survives the row
   hiding. `SharingScreen.test`'s "will not share without picking a suggestion" now types first.
2. **The iPhone 18 Pro Max pass was skipped** (the large-phone check; the iOS 27 runtime has no 17
   Pro Max). Not run at all.

**Made here, open to veto:**
3. **Real blur: `expo-blur` 57.0.3** (new native module). Sampled: every card is `surface` at ~74%
   over a *blurred* backdrop — band edges soften inside the sign-in card; stars vanish behind the
   Account cards.
   - A translucent fill alone shows band edges as hard lines through the card.
   - iOS uses `systemUltraThinMaterialLight/Dark` at intensity 50. Plain `light`/`dark` tints
     darkened the card ~5 levels over the land.
   - Android wraps the art in `BlurTargetView` (`Backdrop`) and passes `blurTarget` +
     `blurMethod="dimezisBlurViewSdk31Plus"`.
   - Outside a `Backdrop`, Android draws `cardFill` only.
4. **Every screen is headerless.** `SignIn`, `SetName`, `Sharing` and `Account` get
   `headerShown: false` beside their `title` (still the web tab title); the Lists/ListDetail lines are
   untouched (KB verify). The four native-header `screenOptions` were deleted as dead;
   `contentStyle` stays. Account and Sharing draw `ScreenHeader` (outlined round `Back` at y 60, serif
   40 title) — Sharing's `List not found` included, which would otherwise have no way back on iOS
   without the swipe.
5. **The splash is held until the first screen is fully drawn.** `src/navigation/splash.ts`
   `hideSplash()`, called by `RootNavigator`:
   - the loading view's emblem `Image` `onLoad`/`onError`, with a 1.5 s fallback timer;
   - or `NavigationContainer` `onReady`.

   The loading view is the launch screen carried on: the same emblem PNG at the same place and size,
   on `ScreenSky`, with a spinner below.
   - First version: `App.tsx` hid the splash on a root `View`'s first `onLayout`. That was too early —
     see Problems.
6. **The Account/Sharing horizon (`HorizonFooter`) closes the page, not the screen.** It comes after
   the content, pushed down by a `flex: 1` spacer with `minHeight: 64`. On a short page it sits at the
   bottom; on a long one it sits below the fold — the long owner mockups show no sun. With 24 the sun
   peeked under the Remove-confirm page's invite field; 64 keeps it off.
7. A reader/writer's own un-confirmed row shows `Leave list` as a small outlined pill with `error`
   text (not drawn in any mockup). `Sign out of all devices` uses the same `tone="danger"`.
8. The revoked notice is a `bannerSurface` pill at the top of the sign-in card. Sign-in errors are an
   `ErrorBanner` above the field, as the Account editing mockup places its error. Copy unchanged.
9. **`textSecondary`** (`#5d5f7a` / `#a9aecb`) is sampled from the mockups' hints and labels. Day
   `textMuted` (`#75778f`) is 3.4–4.1:1 on every day surface, which fails the step's AA bar.
   - `textMuted` stays for placeholders, disabled text (the resend countdown, as drawn) and
     decoration (the birds).
   - `EmptyState`'s un-inked hint moved to `textSecondary`.
10. **Keyboard reveal (`useKeyboardReveal`), added after the simulator showed it was needed.** iOS's
    `automaticallyAdjustKeyboardInsets` scrolls only the focused field into view, which left
    `Send code` under the keyboard. The hook scrolls a whole block — the auth card, or Sharing's
    invite block with its suggestions and Share row — just above the keyboard on `keyboardDidShow`
    and whenever that block's layout changes.
11. **`Backdrop` covers the status bar with its own art.** The art is screen-fixed, so its top slice
    drawn again over the status bar is invisible at rest and hides content scrolled under the clock.

## What changed

**Tokens (`src/theme.ts`).**
- Added `textSecondary`, `cardFill` (`surface` at 0.74), `fieldFill`/`fieldOutline` (a field inside a
  card: `#fcfcfd`/`#e2e2e8` day, `#1e2440`/`#4a4f64` night) and `controlFill` (segmented track and
  trash circle: `rgba(44,47,78,0.06)` / `rgba(255,255,255,0.06)`), all sampled.
- Added a non-palette `google` export: the G's four brand colours.
- **Deleted as orphaned:** `radius.sm`, `radius.md`, `fonts.sansBold`, plus its
  `NunitoSans_700Bold` load in `ThemeContext`. No other palette, spacing or radius key is unused.
- The `skyTop` doc notes that `app.json`'s splash colours repeat it by hand.

**New components.**
- `Backdrop`: fixed art in a `BlurTargetView`, a blur-target context, and the status-bar slice.
- `Card`: outer view with radius 20, 1pt `surfaceOutline` rim and a `barShadow` shadow; inside, a
  clipped `BlurView` + `cardFill`.
- `Landscape`: the auth art, traced off sign-in and set-name.
  - The sky with `STARS` at night, a centred sun (r 54) with birds or a moon (r 46) at y 318.
  - Five edges in `bands[0..4]`, drawn as Catmull-Rom curves through points sampled every 20pt. The
    upper three are anchored to the safe-area top, the lower two to the bottom.
- `HorizonFooter`: sun r 30 (moon 27) at `SUN_FROM_RIGHT`, with the hill and front edges traced off
  Account, and a 1000pt `bands[1]` block below for the bottom bounce.
- `ScreenHeader`, `TextField` (52pt pill; `on="card"|"sky"`; sets the three native colours and
  `letterSpacing: 0`), `Avatar` (initial on `bandAt(hash(userId) % 3)` with that band's ink),
  `AuthFrame` (name + card over `Landscape`), `useKeyboardReveal`.

**Changed components.**
- `PillButton`: sizes `sm` 36 / `md` 46 / `lg` 52, `disabled`, variant `danger`,
  `tone="danger"`, `icon`, `style`. Label sizes follow the mockups: 17 on `sm` outline (16 filled),
  16 on `md`, 17 on `lg`.
- `IconButton` gets `disabled` (opacity 0.45).
- `SegmentedPicker` is now a pill track with an inset `primary` checked pill and equal segments, with
  `track="card"|"surface"`, `size="regular"|"compact"` and disabled at 0.45. Its a11y shape is
  unchanged. `RolePicker` passes both props through.
- `UserAutocomplete` renders `TextField on="sky"` + a suggestions `Card` of 44pt `Avatar` rows.
- `ErrorBanner` gets `style`.
- `icons.tsx` gains `GoogleIcon`.
- `Sky` exports `STARS` and `ScreenSky`, and no longer passes `accessibilityElementsHidden`/
  `importantForAccessibility` to its `<Svg>`: every caller wraps it in a hidden `View`. On web those
  props reached a DOM element and React errored on every load.

**Screens.**
- `SignInScreen`/`SetNameScreen` sit on `AuthFrame`. `PrimaryButton` is gone, replaced by
  `PillButton lg`.
- The code field is the field's own 17pt with 12pt letter spacing, measured: digits 12pt tall, 22.35pt
  apart.
- `AccountScreen` and `SharingScreen` are rebuilt per the mockups (see Calibration).
- `RootNavigator` is headerless, with the loading view and splash hide described above.
- `ListDetailScreen` only has a comment changed: Sharing no longer reads its title.
- `App.tsx` calls `SplashScreen.preventAutoHideAsync()` and `setOptions({ fade: true, duration: 250 })`
  at module scope.

**Launch.**
- `expo-splash-screen` 57.0.9 plugin in `app.json`: `#dee6f0` + `emblem-day.png`, a `dark` variant
  with `#10162e` + `emblem-night.png`, and `imageWidth` 152.
- `assets/splash/emblem-{day,night}.svg` are the hand-traced sources: 152pt circle, four bands, sun
  r 24 with birds / moon r 21 with stars, and a 1.5pt ring.
- Rasterized with Playwright's Chromium to 608 px transparent PNGs, via `page.setContent` +
  `locator.screenshot({ omitBackground: true })`. The script has to sit under the project root:
  Playwright MCP refuses other paths.
- `assets/splash-icon.png` deleted (unused).

**Other.**
- `.maestro/`: the drawn `Back` replaces the native-back taps `Groceries`/`My Lists`. On Sharing,
  List detail's `Back` is underneath, so the tap goes by point (`10%,9%`).
- The tour adds Remove confirm, suggestions, the member view + Leave confirm, and Account editing +
  confirm.
- `seed.mjs` adds Priya (reads Groceries and Birthday party) and Jordan/Jorge/Jorja.

## Calibration against the mockups (iPhone 17e, pt, mockup vs simulator)

The mockups were measured by pixel (Python/PIL) and the font sizes fitted against the actual TTFs.

| screen | element | mockup | simulator |
|---|---|---|---|
| Sign in | name ink | 137–180 | 137–179 |
| Sign in | card | 372–715 | 372–715 |
| Sign in | field | 507–559 | 508–558 |
| Sign in | Send code | 573–625 | 573–625 |
| Sign in | Google | 639–691 | 639–691 |
| Sign in (day) | card fill | `#f1eef6`→`#e4e1f1` | `#f2eff6`→`#e7e5f1` |
| Code | Resend | 652 | 652.3 |
| Account | title ink | 120.7–146.7 | 121.3–147.3 |
| Account | card 1 | 172–319 | 172–319 |
| Account | Email label / value / Name label / value | 191 / 212.3 / 264 / 285.7 | 191.3 / 212.7 / 264.3 / 286 |
| Account | track | 380–424 | 379–423 |
| Account (night) | card fill | `#222843` | `#232842` |
| Sharing (Remove confirm) | card 1 | 212–326 | 212–326 |

The last Sharing and Account spacing fixes each moved elements by 1–2pt.

## Problems hit

- **The machine's disk filled up (205 MB free) during the Android build.**
  - The emulator crashed (exit 139, "No space left on device"), Gradle failed after 6 min, load
    reached ~790, and Docker (the local Supabase) stopped answering.
  - Freed ~6 GB, only this session's own output: the Release simulator build (products and
    intermediates in DerivedData) and extracted video frames. Nothing else was deleted (Gradle
    caches, AVDs, simulator devices, the Debug build).
  - Docker stayed hung after the space came back; the user rebooted the machine to recover it.
- **Maestro showed no software keyboard.**
  - The simulator treats the Mac's keyboard as connected hardware while **DeviceHub** (Xcode 27's
    simulator UI, opened by `expo run:ios`) runs. The number pad showed only a floating "Go" pill.
  - `killall DeviceHub` (the device stays booted) brought the software keyboard back.
  - Clearing the device's `HardwareKeyboardLastSeen` preference and rebooting did not help.
  - `osascript` cannot send Cmd+Shift+K: no accessibility permission.
- **With the keyboard up, `Send code` was under the keyboard.** Maestro's `tapOn: Send code` typed a
  "t" into the address. Fixed by decision 10.
- **The splash hid before the loading view's emblem image had decoded.** One Release cold start showed
  ~1.1 s of night sky with a spinner and no emblem. Fixed by decision 5's hide points.
- **On web the card's blur layer blurred the text field.** RNW's `TextInput` is not positioned, so the
  card's absolute blur layer painted over it. `TextField` sets `position: 'relative'` (a no-op on
  native).
- **Fast Refresh did not reach the iOS dev client after edits.** No reload arrived; relaunching
  through `open-app.yaml` picked up the changes each time.
- **The local stack holds 1,000,000 generated users** (commit `a572bd3` "Db scripts").
  - `search_users_by_name` takes ~3.5 s cold and hit the authenticated role's 8 s `statement_timeout`
    under build load (500 / 57014). Warm, 245 ms.
  - "Jor" returns "Aaliyah Jordan 107351"… — names that sort before the seeded Jordan/Jorge/Jorja — so
    the suggestions screenshots show generated names. The tour waits for `"Share with .*"`.
- **`PillButton`'s single 17pt label on every tall pill truncated "Yes, sign out everywhere"** in the
  mockup's 208pt. The mockup draws 46pt pills at 16pt; the danger pill also gets 12pt sides and Cancel
  18pt, as drawn.
- **The final screenshot run stopped on Sharing's `Back`.** `useKeyboardReveal` had scrolled the
  header off the top to show the invite block, and the page stays scrolled once the field empties, so
  the `10%,9%` tap hit the "People with access" heading. `scrollUntilVisible: Sharing` did nothing:
  the title's descender still shows under the status bar, which Maestro counts as visible. The tour
  now swipes down (`50%,25%` → `50%,60%`, clear of the keyboard) before the tap.
- **A cold start spends ~7 s in `simctl launch` before the process's first log line.** That is the
  simulator spawning the process at load 12–30, not the app. The launch screen covers it.

## Verification

- **Suites.** `npm test` 28 suites / **585 tests** (489 before). New:
  - `src/theme.test.ts` (90): `text`, `textSecondary`, `error` and `primary` against 11 surfaces
    (skies, surface, banner, `cardFill` composited over the sky and bands 0–2, field, track), in both
    palettes; `onPrimary`/`onError` on their fills. All pass.
  - Back on Account and Sharing; Sharing's not-found still offering Back.
  - The invite row absent until typing, and keeping its role.
  - The role badge; the `ShoppingLoop` header.
- **Edited existing tests.** `AccountScreen.test` asserts `Sign out` in `text`, not `primary` (the
  outline pill's ink); the intent, that a theme switch recolours live, is unchanged.
- **Typecheck.** `npm run typecheck` clean.
- **KB audit.** `npm run kb:audit` has two failures, both expected; see candidate facts 1–2.
- **iPhone 17e, Day and Night, side by side with every mockup:**
  - sign-in (email, code), set-name, account, account editing + confirm;
  - sharing owner, Remove confirm, suggestions, member + Leave confirm;
  - Lists and List detail (tour, unchanged);
  - the keyboard up on sign-in, code, set-name and Sharing's invite, with the whole card or invite
    block above it.
- **Cold start (Release simulator build**, the first on this machine, `npx expo run:ios --configuration
  Release`; recorded with `simctl io recordVideo`, frames via ffmpeg):
  - Night chosen, device dark: dark splash → Lists at Night, no light frame.
  - Auto after sunset (Auto set while Warsaw was in daylight, so the last session ended Day; then
    launched with `SIMCTL_CHILD_TZ=Asia/Tokyo`), device dark: no frame with a light sky.
  - Same, device light: light splash (accepted: the launch screen follows the device). Once JS sets
    the app's own theme, the splash view itself turns to its dark variant, then fades into Lists at
    Night, with no gap and no emblem-less frame after the fix.
- **Web** (Playwright, 390×844, local stack):
  - sign-in both phases with Mailpit; set-name on a fresh account;
  - Account: edit/cancel, confirm/cancel, theme switch, sign out;
  - Sharing as Maya: invite Jorja → Remove Jorja (confirm), Priya writer → reader, Leave confirm →
    Cancel. Seed restored: Maya owner, Sam writer, Priya reader.
  - No page errors.
- **iPhone 18 Pro Max:** skipped (decision 2).
- **Android `Pixel_10`: not run.** The build that would have added `expo-blur` and the splash to
  the dev client filled the disk (Problems); after the reboot the user said to skip it. So these are
  **unverified on Android**: the `BlurTargetView` blur and its scroll cost on Account/Sharing, the
  splash icon under Android 12+'s circle mask, hardware back from Account and Sharing, and
  `useKeyboardReveal` with Android's keyboard.

## Screenshots

`ai/tasks/20-ux/screenshots/step-5/`: 30 PNGs, each in `-day` and `-night`, from iPhone 17e
(Debug dev client, local stack, status bar 9:41). They were shot by `.maestro/shoot-all.sh
<dir> maya@example.com s5shot2` after the reboot; the first run stopped on the `Back` described in
Problems.
- Step 5's screens:
  - `sign-in-email`, `sign-in-email-keyboard`, `sign-in-code`, `set-name`
  - `account`, `account-editing` (the name editor and the sign-out-everywhere confirm open together,
    as the mockup draws them)
  - `sharing` (owner), `sharing-remove`, `sharing-suggestions` (generated names from the 1M-user
    stack, not the seeded ones; see Problems)
  - `sharing-member` (Maya reading "Birthday party"), `sharing-leave`
- Tour context, unchanged this step: `lists`, `list-detail-bin-shown`, `list-detail-rename-open`,
  `list-detail-read-only`.
- **Not in the set:** the launch screen and the loading view. Both were checked frame by frame in
  the Release cold-start recordings (Verification), and the frames were deleted with the disk
  cleanup. Nothing from Android, and nothing from the 18 Pro Max.

## For the librarian — candidate facts

1. [queries-go-through-a11y-labels](../../kb/entries/queries-go-through-a11y-labels.md): the
   `verify:` greps for `accessibilityLabel="Edit name"`, `"Leave list"`, `"Confirm leave list"` and
   `` `Confirm remove ${…}` `` fail by design — those are now `PillButton label=…` (same labels). New
   labels and copy:
   - `Back` on Account and Sharing (`ScreenHeader`);
   - `ShoppingLoop` is a `header` on Sign in / Set name;
   - `Remove …` is an `IconButton` (trash);
   - the role badge `Text` reads the role lowercase and is drawn capitalized
     (`textTransform`);
   - the invite row is absent until the field has text;
   - `PillButton` gained `disabled`/sizes/`danger`/`tone`/`icon`;
   - the `PillButton`/`TextField`/`IconButton` rows in the table need updating.
2. [recycled-text-input-keeps-letter-spacing](../../kb/entries/recycled-text-input-keeps-letter-spacing.md):
   its `grep -q 'letterSpacing: 6' src/screens/SignInScreen.tsx` fails. The code field is 12 now
   (measured), and every field's `letterSpacing: 0` reset lives in `TextField` alone.
3. [screens-take-navigation-props](../../kb/entries/screens-take-navigation-props.md) and
   [maestro-drives-the-native-ui](../../kb/entries/maestro-drives-the-native-ui.md):
   - No screen has a native header now.
   - `Sharing`/`Account` draw `Back`; there is no previous-title back button and no "Navigate up" on
     Android.
   - On Sharing, List detail's `Back` is in the hierarchy underneath: tap by point.
4. [theme-reaches-native-surfaces](../../kb/entries/theme-reaches-native-surfaces.md): the launch
   screen is configured (step 5).
   - It follows the device until JS runs `Appearance.setColorScheme`, after which the still-covering
     splash view switches to the app's variant.
   - It is held until the first screen is drawn (`hideSplash`).
   - Auto-after-sunset was measured this time (Release build): no light frame. The paragraph calling
     it "not measured" can go.
   - The native header row in its table is gone.
5. [theme-tokens-only](../../kb/entries/theme-tokens-only.md): new tokens (`textSecondary`,
   `cardFill`, `fieldFill`, `fieldOutline`, `controlFill`), the non-palette `google` export,
   `radius.sm`/`md` and `fonts.sansBold` deleted. `textMuted` is not body text.
6. **New gotcha: DeviceHub hides the iOS software keyboard.** While Xcode 27's DeviceHub runs, the
   simulator has a hardware keyboard attached; `killall DeviceHub` restores the software keyboard, and
   the device stays booted.
7. **New gotcha: a splash hidden on first layout can uncover an image still decoding.** Hide on the
   image's `onLoad`.
8. **New:** frosted cards need `expo-blur`, and Android needs the `Backdrop`'s `BlurTargetView` ref.
   A `BlurView` reads the ref once, on mount, so the target must mount first.
9. **New:** web text inputs are not positioned — an absolute sibling layer paints over them.
10. **New:** `useKeyboardReveal` — why `automaticallyAdjustKeyboardInsets` alone left the primary
    button under the keyboard.
11. **Environment:**
    - The first Release simulator build.
    - `SIMCTL_CHILD_TZ` works with `simctl launch` for a Release app too.
    - The local stack's 1M generated users slow and pollute the name search.
    - The disk-full episode.
