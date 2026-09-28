# Step 2 — Remove the Android hairline under List detail's Add bar

Follow-up to step 1's "Found, not fixed": on Android (`Pixel_10`), List detail shows a 1–2 px light
line across the full width where the header's padded block (title, sync banner, Add bar) meets the
`Hillside` strip. It predates step 1 (HEAD showed the same pixel). iOS and web are clean. The user's
request was not preserved verbatim; the plan below was approved by the user.

## Diagnosis (step-1 screenshots, `Pixel_10` 1080×2424, Night)

- The line is exactly the screen background, not a blend: Bakery run (3 items) `#384264` =
  `bands[2]`; Groceries `#465276` = `bands[1]`.
- Each is `bandAt(colors, visible.length - 1)`, the `last.color` `ListDetailScreen` sets on its root
  View. So one pixel row inside the header box is left uncovered by both `SkyFill` (the absolute
  `fill` behind the padded block, sized from `onLayout`) and `Hillside`'s SVG.
- Likely cause: Android rounding a fractional dp edge at 2.625×. Which drawing leaves the row was not
  pinned down; the fix does not need it.

## Fix (approved)

- `src/screens/ListDetailScreen.tsx`: the header's outer `View` gets `styles.header`,
  `backgroundColor: colors.skyHorizon`.
- `skyHorizon` is the colour on both sides of the seam (`SkyFill`'s gradient ends on it; `Hillside`
  fills its strip with a `skyHorizon` rect), so any uncovered row there vanishes.
- iOS and web already cover the whole box, so the fill is never seen there: the signed-off phone look
  stays pixel-identical (`phone-is-the-product`).
- Lists needs nothing: its `headerSky` is one fixed-height `Sky` clipped to the whole header, and the
  step-1 Android shots show no line.

## Verification planned

- `npm run typecheck`, `npm test`.
- `Pixel_10`: Groceries and Bakery run at rest, Rename bar open, Day, and scrolled; the seam rows must
  read `skyHorizon`, never a band colour.
- iPhone 17e: List 796 at rest, pixel-diffed against the pre-change look; only the clock may differ.
- Local stack only; `.env` says `cloud`, so Metro starts with `EXPO_PUBLIC_SUPABASE_TARGET=local`.
