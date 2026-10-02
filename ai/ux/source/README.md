# Mockup harness

Draws the PNGs in `ai/ux/primary/` from the app's own tokens, fonts and component geometry. Built in task 24 step 1;
task 20 step 6's harness for the Sharing mockups was lost, which is why this one lives in the repo. Change a mockup by
editing a scene and re-rendering, never by hand-editing a PNG.

## Render

```sh
ai/ux/source/render.sh <out-dir> <scene>...     # e.g. render.sh /tmp/m lists-screen-search
```

- Each scene comes out in day (`<scene>-quiet-horizon.png`) and night (`<scene>-quiet-horizon-moonlit.png`), 1170×2532
  = 390×844 pt @3x. Copy the ones you mean into `ai/ux/primary/`. Never overwrite a mockup the user has not asked to
  change.
- The script prints, per scene, `"clipped":[…]`: sort-button faces that would not fit. It should be empty.
- Needs Node ≥ 23.6 (type stripping), `python3`, and Playwright's `chrome-headless-shell`
  (`npx playwright install chromium-headless-shell`, or set `CHROME`). Env: `W H INSET` (390 844 47), `PORT` (8765).
- It regenerates `tokens.json` (git-ignored) from `src/theme.ts` and `src/state/bands.ts`, then serves the repo root,
  so `mock.html` can load the fonts from `node_modules/@expo-google-fonts`.

## Files

| file | what |
|---|---|
| `mock.html` | `@font-face` for Nunito Sans 400/500/600 and Source Serif 4 400; `.v` = React Native's View defaults (flex column, `border-box`, no shrink) |
| `mock.js` | the components (`Sky`, `Horizon`, `Hillside`, `SkyFill`, `Band`, `ListRow`, `ItemRow`, `AddBar`, `PillButton`, `IconButton`, `SegmentedPicker`, toggle, `EmptyState`, search field, sort buttons, coverage line, status bar, home indicator), both screens, and `SCENES` |
| `tokens.mjs` | writes `tokens.json`: both palettes plus `bandList` = `bandAt(palette, 0..63)` |
| `render.sh` | the export above |
| `offsets.py` | calibration: best (dx, dy) per region between a render and a simulator shot |

Page parameters: `scene`, `theme` (`day`/`night`), `w`, `h`, `inset`, `insetBottom`, and `measure=1`, which adds the
field, sort row, toggle and first-row rects (pt) to `document.title`. Read the title with `chrome-headless-shell
--dump-dom`. A scene is a plain object: `screen` (`lists`/`detail`), `button` (header button glyph and dot), `slot`
(`add` / `sentence` / `search`), `coverage`, `toggle`, `rows`, `empty`.

## Calibration

- The `calib-lists` and `calib-detail` scenes reproduce task 20 step 5's 17e simulator shots
  (`ai/tasks/20-ux/screenshots/step-5/lists-day.png`, `list-detail-bin-shown-{day,night}.png`), on the same 390×844
  canvas.
  - `offsets.py` found every region within 0.67 pt on Lists and 0.00–0.33 pt on List detail.
  - The exception was List detail's 40 pt serif title in a 52 pt `lineHeight`: iOS sets it 1.33 pt higher than CSS
    half-leading does, hence its `top: -1.33`.
- Both fonts have hhea = typo metrics (Nunito Sans 1011/−353, Source Serif 4 1036/−335), so `line-height: normal`
  matches iOS's natural line.
- Band rims are white at `stop-opacity` 0.2 → 0: react-native-svg replaces the token's alpha (KB phone-is-the-product).
- The home indicator is shaded from what is under it, as iOS does: light over dark bands, dark over pale ones.

## Gotchas

- Desktop Chrome's `--headless=new --screenshot` hangs after the first shot and leaves processes behind. Use the
  headless shell, one process per shot.
- macOS has no `timeout`; a script that calls it silently does nothing.
- The style serializer appends `px` to numbers except `opacity`, `flex`, `zIndex` and `fontWeight` (`UNITLESS`). Add any
  new unitless property there.
