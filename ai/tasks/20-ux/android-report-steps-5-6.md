# Android check of steps 5 and 6 — problems found

2026-09-30, after `6b0ec67`. A report, not a step log: no code changed. The user asked: "Run the
checks for steps 5 and 6 on android simulator. Remember to check only changed screens."

**Setup:**
- Device: `Pixel_10` emulator, API 37, arm64, 1080×2424 at 420 dpi (411×923 dp, 2.625 px/dp).
- App: the Debug dev client installed 13:53 that day, with `ExpoBlur`.
- Backend: the local stack, through a second Metro
  (`EXPO_PUBLIC_SUPABASE_TARGET=local npx expo start --dev-client --port 8082` plus
  `adb reverse tcp:8082 tcp:8082`), because the user's cloud Metro held 8081.
- Account: `maya@example.com`.
- Screens: only those steps 5–6 changed, in Day and Night.
- Shots: `screenshots/step-7/`, 35 PNGs. Pixel positions below are in px.

## Problems

### 1. Sign in, the code screen and Set name: the keyboard covers the card's button

- **Hidden under the keyboard:**
  - Email phase: `Send code` and `Continue with Google`.
  - Code phase: `Sign in`, `Resend code` and `Use a different email`.
  - Set name: `Continue`.
- **Shots:** `sign-in-email-keyboard-*`, `sign-in-code-keyboard-*`, `set-name-keyboard-*`. The card
  stays where it is at rest, and the keyboard's top edge is at y ≈ 1538.
- **Cause:** `useKeyboardReveal` (`src/components/useKeyboardReveal.ts`), used by `AuthFrame`.
  - On Android it counts the whole `ScrollView` height as visible (`frame.current - 0`). Its doc
    comment gives the assumption: "on Android the window shrinks instead".
  - The app is edge-to-edge (`edgeToEdgeEnabled=true` in `android/gradle.properties`, targetSdk 36),
    and the window did not shrink. So the card's bottom counts as in view, and nothing scrolls.
  - This is inferred from behaviour (neither this reveal nor Sharing's scroll range, problem 2,
    reacted to the keyboard). The root view's height was not measured directly.
- **A second gap:** `AuthFrame`'s `automaticallyAdjustKeyboardInsets` is iOS-only.
  - The content (`flexGrow: 1`) fits the 923 dp screen, so on Android there is nothing to scroll
    into even with a correct target.
  - The content needs extra bottom padding equal to the keyboard height.
- **Not blocking:** each field submits from the keyboard's action key (`returnKeyType`
  send/go/done, `onSubmitEditing` → `send`/`verify`/`submit`). This was not exercised on Android.
  The Google button and the links are reachable only after closing the keyboard.
- **Maestro:** `.maestro/flows/sign-in.yaml` and `tour-signed-out.yaml` tap the covered buttons,
  which stay in the hierarchy under the keyboard. The Android runs used copies with `hideKeyboard`
  before each button; the unmodified flows were not run.
- **Fix directions (undecided):**
  - An Android branch in `useKeyboardReveal`: subtract the keyboard height there too, and pad the
    content by it.
  - Or a `KeyboardAvoidingView` `behavior` on Android.
  - Or `react-native-keyboard-controller`, a native module that needs a dev-client rebuild.
  - Read the SDK 57 docs on edge-to-edge keyboard handling first (AGENTS.md).

### 2. Sharing: the end of a long roster cannot be scrolled above the keyboard

- **Shot:** `sharing-keyboard-end-*`.
  - Roster: Maya, Sam and Priya, plus three readers seeded by SQL.
  - Steps: focus `Name`, then two upward swipes, which leave the content at its end.
  - Result: `Aaliyah Jordan 152351`, `Aaliyah Jordan 174851` and the hint "A list must keep at least
    one owner." stay under the keyboard.
- **Cause:** `SharingScreen`'s `KeyboardAvoidingView` sets
  `behavior={Platform.OS === 'ios' ? 'padding' : undefined}` (`src/screens/SharingScreen.tsx:297`),
  so it does nothing on Android.
  - The window does not shrink either (problem 1), so the `ScrollView` spans the full screen.
  - At maximum scroll, the last keyboard-height of the content lies under the keyboard.
- **Impact:** low. The pinned header with the bar stays in view while typing, and the covered cards
  are reachable once the keyboard closes.
- **Fix direction:** follow whatever problem 1 settles on. The smallest change is a `behavior` on
  Android.

### 3. Sharing: the suggestions card is see-through

- **Shots:** `sharing-suggestions-*`. "People with access", Maya's card and its segmented picker
  read through the rows. By night the moon shows through the first rows.
- **Cause:** `Card` (`src/components/Card.tsx:34`) blurs on Android only when `useBlurTarget()` is
  non-null, which means inside a `Backdrop`.
  - Step 6 removed `Backdrop` from Sharing, so the card is `cardFill` alone.
  - `cardFill` is 74% opaque (`src/theme.ts:84` Day, `:114` Night).
  - The member cards are drawn the same way, but they lie on a flat band, so nothing shows through.
- **iOS** is unaffected: its `BlurView` needs no target.
- **Fix: a design choice for the user.**
  - (a) An opaque fill for this card on Android, e.g. a `Card` prop, or `cardFill` at alpha 1
    wherever there is no blur target.
  - (b) A blur target behind the card, as `Backdrop` provides. Check how `Backdrop` nests the
    target and the cards: the suggestions card currently sits inside the sticky header inside the
    `ScrollView`. The blur's cost over a scrolling list is unmeasured.

### 4. Sharing: the suggestion rows are missing from the accessibility tree

- **Evidence:** a `uiautomator dump` with "Jor" typed.
  - Each `Share with …` node has bounds like `[56,626][1026,607]`, `[56,741][1026,607]` and so on.
  - The top is the row's real top. The bottom is clamped to 607, the bottom of `UserAutocomplete`'s
    root `View`, which is only as tall as the 52 dp bar; the card is `position: 'absolute'` below it.
  - So every row's rect is empty.
- **Cause:** Android's `View.getBoundsOnScreen` intersects a node's bounds with every ancestor's.
- **Consequences:**
  - Maestro cannot see the rows: `extendedWaitUntil: "Share with .*"` timed out at 45 s with five
    rows on screen. So `.maestro/flows/tour-signed-in.yaml` stops at the suggestions on Android.
  - TalkBack very likely skips nodes with empty bounds. This was not tested with TalkBack.
- **Touch works:** `adb shell input tap 540 1143` on the fifth row picked the person, below the
  sticky header's bottom edge (y ≈ 810), and the role picker appeared (`sharing-picked-*`). So
  step 6's taps outside the header's frame hold on Android too.
- **Fix direction:** every ancestor up to the `ScrollView` must contain the rows. Growing
  `UserAutocomplete`'s root alone is not enough, because the next ancestor would clamp them.
  - One way: render the card in a screen-level absolute layer outside the `ScrollView`, as the
    `statusBarSky` strip is, positioned from the bar's measured frame.

## Passed, Day and Night

- **Sign in (email and code) and Set name at rest** match the step-5 mockups. The card's blur works:
  `Landscape` sits inside `Backdrop`'s `BlurTargetView`, and band edges come through the card soft.
- **Account**, at rest and editing with the sign-out-everywhere confirm, matches the mockups, with
  the sky blurred behind the cards.
- **Sharing's other states** match the step-6 mockups: owner at rest, the Remove confirm, picked
  (the role picker in the strip, Share live), scrolled (cards pass under the hill, the header stays
  pinned), and the member view with the Leave confirm.
- **Hardware back** works:
  - Account → Lists.
  - Sharing → List detail → Lists, with the keyboard closed first.
  - The member's Sharing → Birthday party → Lists.
- **Splash:**
  - The emblem fits Android 12+'s circle mask.
  - Day draws the light background. Night, with the device in dark mode (`cmd uimode night yes`),
    draws the dark one, and no light frame appears on a Night cold start.

## Not checked

- **A Release cold start.** In the dev client the splash hides before the app draws, and then:
  - A black frame.
  - The dev client's loader: white by Day; grey with "Loading from 127.0.0.1:8082…" by Night
    (`launch-dev-client-loader-night.png`).
  - Then the app's own dark or light first frame, and Lists.

  Only a Release build shows the real hand-off from the splash.
- **Scroll cost of the blur on Account.** A clean run rendered 7 frames over 8 swipes: the content
  fits 923 dp and does not scroll. Other emulator timings were noisy (a blur-free list: median
  31 ms, p90 125 ms), so performance needs a device or a Release build.
- **The keyboard's action keys** (problem 1).
- **TalkBack** (problem 4).
- **Sharing's `List not found` state.**

## Reproducing: environment notes

- **GPU:**
  - The emulator had resolved `hw.gpu.mode` to `lavapipe`, a software renderer (see
    `~/.android/avd/Pixel_10.avd/hardware-qemu.ini`; `config.ini` says `auto`).
  - The app then drew about 1 frame per second with the keyboard up.
  - Maestro's driver hit an ANR at start ("did not start up in time", even with
    `MAESTRO_DRIVER_STARTUP_TIMEOUT=180000`).
  - `emulator @Pixel_10 -gpu host` (Metal) fixed both. The driver then starts in about 40 s.
- **Noise:** `android.hardware.uwb-service` crash-loops every ~5 s ("failed to open the serial
  device"). It is harmless logcat noise.
- **Maestro:**
  - Pass `--device emulator-5554` while an iOS simulator is also booted.
  - Hardware `back` replaces the point tap on the drawn Back.
  - Suggestion rows can only be tapped by coordinates: take the row's top from a `uiautomator dump`
    and add 55 px (problem 4).
- **Emulator settings:**
  - With `hw.keyboard=yes`, `settings put secure show_ime_with_hard_keyboard 1` brings up the soft
    keyboard.
  - SystemUI demo mode pins the clock to 09:41.
  - Both were reverted afterwards.
- **Memory and disk:** the Mac has 8 GB of RAM, and the emulator held about 8 GB resident.
  - Swap grew until free disk fell to about 400 MB.
  - The emulator was powered off with `adb shell reboot -p`, so it wrote no quick-boot snapshot.
  - Its `default_boot` snapshot is gone, so the next start is a cold boot.
- **Test data left on the local stack:** `s7android-day@example.com` and
  `s7android-night@example.com`, both named. Groceries' roster was restored to Maya, Sam and Priya.
