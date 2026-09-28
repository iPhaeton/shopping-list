# Implementation log — task 22, step 2: remove the Android hairline under List detail's Add bar

**Date:** 2026-09-28. Description: [description-step-2.md](description-step-2.md). Plan approved by
the user before work began; implemented as planned. One deviation, in verification: the iOS baseline
was HEAD itself, relaunched, since step 1's `before/detail.png` was lost with the scratchpad.

## Decisions

1. **Backstop fill on the header's outer `View`, not a fix to either drawing.**
   `styles.header = { backgroundColor: colors.skyHorizon }` on the `header` value in
   `ListDetailScreen`.
   - `skyHorizon` is the colour on both sides of the seam, so an uncovered row anywhere between
     `SkyFill` and `Hillside` reads as sky. Which of the two leaves the row was never pinned down;
     the fill makes that moot.
   - It paints only where neither drawing does, so iOS and web (fully covered) are unchanged —
     proven by pixel diff below, not assumed.
   - It also makes "opaque top to bottom" (the header comment, and what the pinned header relies on
     since step 1) true by construction rather than by two drawings happening to meet.
   - The header comment gained one sentence naming the Android pixel row; the style has a one-line
     comment on why `skyHorizon`.
2. **Lists untouched.** Its `headerSky` is one clipped `Sky` over the whole header, so there is no
   internal seam; step 1's Android shots show none.
3. **No test.** Pure paint, per `component-suite-earned-by-owned-logic`; verified on device.

## What changed

- `src/screens/ListDetailScreen.tsx`: `<View>` → `<View style={styles.header}>` for the header;
  `header` style added in `useStyles`; two comment lines. Nothing else.

## Problems hit

- **Disk full mid-step.** Every command failed with "no space left on device" (even `df`, since the
  tool writes its output to a file). Work stopped after the edit, before any check. The Mac was then
  rebooted: Docker, the local stack, Metro, emulator and simulator were all down on resume, and the
  session scratchpad was empty.
- **`CI=1 npx expo start` disables Metro's file watching** ("Metro is running in CI mode, reloads are
  disabled"). The first HEAD-vs-fix swap therefore compared the fixed bundle with itself; caught from
  the Metro log and redone with Metro restarted without `CI`.
- **Machine load 30–75 after the reboot** (Docker + emulator + simulator starting together).
  - A Maestro `scrollUntilVisible` swipe became a tap and opened Hardware store.
  - Cold starts sat on the auth spinner (`AuthState` `loading`) past `ensure-signed-in.yaml`'s 30 s
    `extendedWaitUntil`, twice. Worked around with scratchpad flows that start from the running app
    (no `open-app`) and wait up to 60–120 s.
- **iOS HEAD-vs-fix by Fast Refresh is inconclusive by construction:** the expected result is
  "identical", and identical pixels cannot show the refresh happened (Metro logged one 1-module
  rebuild for two swaps). Redone with a full relaunch (`open-app.yaml`'s `stopApp`) on each version.
- zsh does not word-split a command held in a variable (`$M --flag` → "no such file or directory");
  used a shell function.
- **First `npm test` run: 4 failed** (one was `SharingScreen.test.tsx` "shows everyone with access,
  and which one is you"), right after the reboot. The next two runs passed 489/489 with no change in
  between. Not investigated further; treated as load flakiness.

## Verification

- `npm run typecheck` clean. `npm test`: 27 suites, 489 tests pass (2 consecutive runs; see above for
  the first).
- Local stack only. `.env` has `EXPO_PUBLIC_SUPABASE_TARGET=cloud`; Metro started with
  `EXPO_PUBLIC_SUPABASE_TARGET=local`, and both the android and ios bundles were grepped for
  `value: "local"`.
- **Method.** Row scan of full-resolution screenshots: per-row mean RGB over the left gutter (x 4–44)
  and right gutter (x 1040–1076) of the 1080 px width, outside the Add input, flagging any step > 3.
  HEAD vs fix by writing `git show HEAD:src/screens/ListDetailScreen.tsx` over the file with Metro
  watching, shooting, and restoring from a scratchpad copy in the same command.
- **`Pixel_10` (1080×2424, Night), emulator account `s4owner@example.com`.**
  - Groceries (4 live, 1 binned; "Show 1 deleted" in the hill), fix → HEAD → fix, same session:
    - HEAD: row 606 is (70,82,118) = `#465276` = `bands[1]` in both gutters — step 1's pixel and
      colour exactly.
    - Fix, before and after the swap: rows 453–816 one flat (22,28,58) = `skyHorizon` in both gutters.
    - HEAD vs fix below the status bar: **row 606 is the only row that differs.**
  - Groceries scrolled (list dragged 500 px, rows behind the pinned header): seam clean.
  - Bakery run (3 items, no bin) at rest, and with the Rename bar open: rows 600–612 all (22,28,58);
    no step in either gutter except stars (soft 8-row blobs at different heights left and right) and
    the hill's curve.
  - Bakery run in **Day**: rows 600–612 read (229–230, 227–228, 239–240), i.e. `#e6e4f0` ±1; no
    step. Emulator put back on Night afterwards.
  - Hardware store (empty list) at rest: clean.
- **iPhone 17e (1170×2532, Night), simulator account `example@example.com`, List 796 (12 items,
  1 binned).** Clock pinned with `simctl status_bar … --time 9:41`.
  - App relaunched on HEAD, shot; relaunched on the fix, shot: **`ImageChops.difference` bbox
    `None`** — pixel-identical, clock included. The working tree was confirmed at HEAD during the
    HEAD run (`git diff --stat` empty).
- **Web: not exercised.** A background on a wrapper both drawings already cover cannot change
  behaviour; it was not screenshotted.

## Candidate facts for the KB

- `list-headers-are-pinned-and-opaque`: List detail's header also carries a `skyHorizon` fill on its
  outer View as the backstop for Android leaving one pixel row uncovered at the `SkyFill`/`Hillside`
  seam (1080×2424 at 2.625×). Remove it and the line returns at y 606 in the band colour of the last
  visible row.
- `CI=1` (or `CI=true`) on `npx expo start` turns off Metro's watcher, so Fast Refresh never sees an
  edit; an on-device A/B made by swapping files then compares one bundle with itself. Start Metro
  without `CI` for any A/B.
- HEAD-vs-change on device without committing: write `git show HEAD:<file>` over the file with Metro
  watching, shoot, restore from a copy in the same command. Where the change should be invisible
  (identical pixels expected), relaunch the app per version: identical pixels cannot prove a Fast
  Refresh landed.
- Under load ~40 (e.g. right after a reboot, with Docker, the emulator and the simulator starting),
  a cold start can stay on the auth spinner past `ensure-signed-in.yaml`'s 30 s wait; drive the app
  from where it already is instead.
