# Implementation log — task 22, step 1: pin the Lists and List detail headers

**Date:** 2026-09-28. Description: [description-step-1.md](description-step-1.md). Plan approved by
the user before work began. One deviation from it: List detail keeps its status-bar strip (see
Decision 3).

## Decisions

1. **`stickyHeaderIndices={[0]}` on both `FlatList`s. The header stays their
   `ListHeaderComponent`.**
   - Rejected alternative: moving the header out of the list, above it. The header would then stop
     moving on a pull-down bounce, and a top overscroll would open a gap between the hill and row 0
     that needs its own band-0 cover.
   - With the sticky header, the existing overscroll sky keeps working unchanged:
     - `ScrollViewStickyHeader` does not translate at a negative offset, so the header rides the
       bounce down.
     - Lists' screen-wide `Sky` layer and List detail's `overscrollSky` fill the space above it.
   - Mechanics, confirmed in `node_modules`:
     - `VirtualizedList` maps sticky index 0 to the header cell when `ListHeaderComponent` is set.
     - RN 0.86 wraps it in `ScrollViewStickyHeader`: native-driver translateY and `zIndex: 10`. On
       Fabric it syncs the shadow tree after a 64 ms (iOS) or 15 ms (Android) debounce, for hit
       testing.
     - RNW 0.21 wraps it in a `position: sticky; top: 0; zIndex: 10` View.
     - Nothing in `src` sets `zIndex` or `elevation`.
2. **The Lists header got its own sky, a clipped `<Sky height={SKY_HEIGHT} />` (`styles.headerSky`,
   absolute fill, `overflow: 'hidden'`).**
   - Rows now pass behind the header. It was transparent over the screen-wide `Sky` layer, and
     `Horizon`'s SVG is transparent above the hill's curve.
   - Same drawing, same top, so at rest it matches the layer under it pixel for pixel.
   - Numeric height, so the `svg-percent-size-frozen-on-ios` bug does not apply while the header
     grows from loading to the Create bar.
   - `pointerEvents="none"` is on the wrapper, per `absolute-decoration-needs-pointer-events-on-its-wrapper`.
   - With an error or blocked banner above the list, the gradient restarts at the header's top.
     Across `#dee6f0`→`#e6e4f0` over 520 pt that is a few RGB steps, so it was accepted.
   - List detail's header was already opaque (`SkyFill`, `Hillside`'s sky rect, `overscrollSky`),
     so it needed nothing.
3. **Status-bar strips: removed on Lists, kept on List detail.**
   - The plan removed both, on the grounds that they exist only for rows scrolling under the status
     bar.
   - **Lists:** it did nothing else. It also drew the whole 520 pt gradient and its 24 stars
     squeezed into 47 pt, which left a faint seam and a crowded star field there. Removing it
     changes pixels only inside that 47 pt.
   - **List detail:** removing it exposed a light blur over the top ~47 pt: (45,54,84) against the
     sky's (16,22,46), with the `SkyFill` stars blurred. What was ruled out:
     - It is **not caused by this step**: HEAD with only the strip zeroed shows it identically. The
       strip had been hiding it all along.
     - It is not on Lists.
     - react-native-screens `scrollEdgeEffects` does not touch it. Tried `top: 'hidden'` as a static
       option in `RootNavigator`, then as a post-mount `navigation.setOptions` (because RNS 4.26
       applies the option in `finalizeUpdates` when it changes, to the scroll view found in the
       first-child chain at that moment). Also tried `top: 'hard'`. No pixel changed.
     - Breaking the first-child chain with a non-collapsible empty first child did not remove it
       either.
     - Source still unidentified. A sibling drawn above the `KeyboardAvoidingView` covers it, so it
       lives in the list's subtree or below.
   - The strip, `DRAWN_SKY_H` and its styles stay. The comment now states this as its job, and
     `RootNavigator` is unchanged.

## What changed

- `src/screens/ListsScreen.tsx`:
  - `stickyHeaderIndices={[0]}`;
  - the `headerSky` backdrop as the header's first child, with a comment on why the header is
    opaque;
  - the `statusBarSky` view and style removed.
- `src/screens/ListDetailScreen.tsx`:
  - `stickyHeaderIndices={[0]}`;
  - comments on the header (sticky and opaque), the `pinned` banners, and the status-bar strip.
    `DRAWN_SKY_H`'s doc no longer says "with the list at the top".
- No test changes. Jest's `ScrollView` mock ignores sticky indices, and this is layout, per
  `component-suite-earned-by-owned-logic`.

## Problems hit

- **The dev server pointed the simulator at cloud.** `.env` (untracked) has
  `EXPO_PUBLIC_SUPABASE_TARGET=cloud`, which overrides `pickTarget()`'s runtime choice. The first
  Maestro `sign-in.yaml` run asked the cloud project for an OTP to `maya@example.com`, and got
  "Error sending magic link email".
  - Fix without editing `.env`: `EXPO_PUBLIC_SUPABASE_TARGET=local npx expo start --dev-client
    --clear`. A shell env var wins over `.env` (`@expo/env` does not overwrite, and the `env:
    export` line then omits it).
- **Maestro `hideKeyboard` on iOS taps the content.** It sends short swipes at screen centre, e.g.
  (195,422)→(195,396) in 0.05 s. That opened whichever row sat there ("List 813"). The simulator had
  no soft keyboard up, so the step was pure risk; dropped it.
- **Maestro `swipe` with a long `duration` does not scroll gradually**, so a mid-bounce screenshot
  was not captured. The pull-down path is unchanged by design (Decision 1) and was not observed.
- **Android fast swipe straight after `open-app` became a tap** (opened "Bakery run"). With an
  `extendedWaitUntil` first, the same 150 ms swipe scrolls on both HEAD and this change. It was
  launch timing, not the sticky header.
- A mid-edit Fast Refresh threw `ReferenceError: Property 'DRAWN_SKY_H' doesn't exist` (constant
  removed before its use) and fell back to Lists. Transient.

## Found, not fixed (pre-existing)

- **Android List detail: a 1–2 px light line across the full width** at the foot of the Add bar
  block, where `Hillside` begins: y 606 of 2424 on `Pixel_10`, (70,82,118). HEAD shows the same
  pixel. It is probably subpixel rounding between the padded block and `Hillside`, showing the
  screen background. iOS is clean.
- Web console: `accessibilityElementsHidden` / `importantForAccessibility` "not recognized on a DOM
  element". These come from `Sky`'s `<Svg>` props and predate this step.

## Verification

- `npm run typecheck` clean. `npm test`: 27 suites, 489 tests pass.
- **iPhone 17e simulator (Night), local stack.** An account with ~100 lists; List 796 has 12 items
  plus 1 binned.
  - At rest, against pre-change screenshots:
    - Lists differs only inside y 6–141 px (the removed strip);
    - List detail differs only at the clock.
  - Scrolled, mid-fling and while typing: both headers stay pinned, and rows pass behind the hill.
  - Taps that landed while scrolled or right after a fling: Account, Create input, Show deleted
    (on and off), Rename (the bar opens in place), Add input, Share.
- **Web (Playwright, 390×600).** After `scrollTop` 400 the Create input's `top` is unchanged (84)
  and `elementFromPoint` returns the input. The List detail Add input likewise stays at 126. Show
  deleted clicked while scrolled shows "Restore Paper towels". Nothing shows through either header.
- **`Pixel_10` emulator.**
  - Lists fast swipe: pinned, and rows reach the end.
  - After a 150 ms fling, Account opens.
  - Typing into Create works.
  - List detail at rest and scrolled: pinned, and Show deleted, Share and Back work.
- **Day theme, iPhone 17e.** Lists and List detail scrolled: pinned, opaque, and the rows pass
  behind the hill. Left on Night afterwards.
- Not exercised: items paging under a pinned header (`onEndReached` is untouched).

## For the user's eye

- **The hill stays band 0's colour, whatever row is under it.** Once the list scrolls, a sliver of
  the first band's colour (the hill below its curve, at most `HILL_H` = 20 pt) meets the row
  underneath along a straight edge. It shows most in Day, where band 0 is the lightest lavender and
  the rows mid-ramp are dark. This follows directly from pinning a header whose bottom edge *is* row
  0's top edge. Not changed; flagged for sign-off.

## Gotcha for flows

- **Rows scrolled behind the pinned header stay in the accessibility hierarchy, at their real
  coordinates.** A Maestro `tapOn: <row>` for a row hidden under the header therefore taps the
  header. Also, when a flow read positions during a scroll-to-top animation, the tap on
  "List 796" landed on the Create input. Scroll the row into the open area, and wait, before tapping
  it.
