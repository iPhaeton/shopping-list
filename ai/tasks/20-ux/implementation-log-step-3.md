# Implementation log — task 20, step 3: the Lists screen, built to the mockup

**Date:** 2026-09-26. Description: [description-step-3.md](description-step-3.md).

## What changed

**`react-native-svg` added** (`npx expo install react-native-svg` → 15.12.1). It was allowlisted in
`package.json`'s Jest `transformIgnorePatterns` already but had never been installed. Required a
native rebuild on both platforms: `npx expo prebuild --platform ios`/`--platform android` (neither
`--clean`), then `cd ios && pod install` by hand (a non-clean prebuild does not run it —
[native-build-toolchain](../../kb/entries/native-build-toolchain.md)). Renders correctly under Jest
with no mock needed — `jest-expo`'s native-module mocking covers it, confirmed by the full suite
passing with real `<Svg>` trees in the RNTL output.

**`src/theme.ts`** gains two tokens, in both palettes: `iconButtonFillInverse` (a low-opacity white
fill for an icon button under a light `onPrimary` glyph on a dark band — the existing
`iconButtonFill`, 0.55 day / 0.12 night, is right for a dark glyph on a light band but composites to
only 1.83–2.27:1 under a white glyph on the darkest day bands, below the 3:1 icon-contrast floor;
hand-computed and verified with a throwaway script, not eyeballed) and `bandRim` (a translucent
white top-edge highlight, drawn into every band's wave — needed once a row's color holds past
`bands.length`, since two identically-colored adjacent rows have no other edge to read by). Also
`fonts.sansMedium: 'NunitoSans_500Medium'` (the mockup's row name is "sans ~22pt, medium"; the
weight file already ships in `@expo-google-fonts/nunito-sans`). `ThemeContext.tsx`'s `FONT_FILES`
loads it via the usual per-weight subpath import.

**`src/state/bands.ts`** (new) — pure, no React, no `../lib/` import (`ListRow` may not import from
`lib/` — [supabase-client-module-boundary](../../kb/entries/supabase-client-module-boundary.md)'s
`verify:` sweeps it explicitly, so this couldn't live in `src/lib/` however natural that felt).
`contrastRatio(a, b)`: WCAG relative-luminance contrast, 6-digit hex only. `bandAt(colors, index)`:
picks `{ ink: text, iconFill: iconButtonFill }` or `{ ink: onPrimary, iconFill:
iconButtonFillInverse }`, whichever `ink` scores higher against `colors.bands[index]` (clamped to
the last index past 5), and caches the six results per `Palette` object the same way `themedStyles`
caches. Verified against the real palettes: day picks `text` for bands 0–2 (5.80–9.43:1) and
`onPrimary` for 3–5 (5.75–10.86:1); night picks `text` for every band (5.27–14.87:1) — this
reproduces the mockup's dark-ink-on-light-bands / white-on-dark split exactly, using only the two
ink tokens that already existed. `src/state/bands.test.ts` pins all of this; its own
contrast-rejection test builds a black/white hex and a bad input at runtime (`hex(r,g,b)`,
`` `#${'f'.repeat(3)}` ``) rather than writing literals, and even a *comment* mentioning `rgba(` or
`#000000` verbatim trips `theme-tokens-only`'s audit, which sweeps every `.ts`/`.tsx` including
tests — hit this myself, twice, before landing on wording that describes the pattern without typing
it.

**New presentational components**, none with their own test suite —
[component-suite-earned-by-owned-logic](../../kb/entries/component-suite-earned-by-owned-logic.md)'s
`verify:` caps `src/components/*.test.tsx` at exactly one file (`UserAutocomplete.test.tsx`), so a
`Band.test.tsx` or similar would fail the audit outright; the logic worth testing (contrast, band
color) already lives in `bands.ts` and is tested there.
- `src/components/icons.tsx` — `TrashIcon`, `RestoreIcon`, `ChevronIcon`, `CloudIcon`, `CloudPuff`,
  stroke-based, `{ color, size? }`, no literal colors.
- `src/components/IconButton.tsx` — the round translucent delete/restore control.
- `src/components/PillButton.tsx` — the outlined pill (Account here; Rename/Share are step 4's).
- `src/components/Band.tsx` — one horizon-band row. Colored and inked by `bandAt(index)` — **the
  row's visible position, never the list count**, so creating a list never recolors the rows above
  it. The wavy top edge is self-contained inside each row's own bounds (a backdrop rect in the
  previous band's color, this band's own color painted over it as a wave, plus the `bandRim`
  highlight) rather than bleeding across a `FlatList` row boundary via `overflow: visible` — that
  bleed approach was considered and rejected up front as fragile on Android and under
  `removeClippedSubviews`.
- `src/components/Sky.tsx` — the gradient (`skyTop` → `skyHorizon`) plus, at night, a fixed
  24-star field (hand-picked `[xPercent, yPercent, r, opacity]` tuples, never re-randomized — the
  description calls this out explicitly).
- `src/components/Horizon.tsx` — the sun (day: warm glow + three small birds) or moon (night: soft
  halo), sitting half-sunk behind the first band. Implemented as one small fixed-size (170×60)
  SVG whose own `viewBox` only contains the *top half* of the disc (`cy` sits exactly on the
  viewBox's bottom edge) — not a full circle clipped by a parent `overflow: hidden`, and not a
  percentage-scaled viewBox, both of which were tried first and rejected: the former made the
  strip's own height fight with how much of the disc should show, the latter turns a circle into an
  ellipse under `preserveAspectRatio="none"` once the rendered aspect ratio drifts from the
  viewBox's.

**`AddBar.tsx`, `ShowDeletedToggle.tsx`, `SyncBanner.tsx`, `EmptyState.tsx` — restyled, not
rewritten.** Props, submit/debounce/visibility logic, and a11y roles/labels are untouched except
one: `ShowDeletedToggle`'s `accessibilityRole` is now `"switch"`, not `"checkbox"` (see Constraints
below). `AddBar` becomes one pill (`radius.pill`, `surface` fill, borderless input, filled pill
button), owning its own `marginHorizontal` but not vertical spacing, which callers now control. My
`SyncBanner` text color moved from `textMuted` to `text` — `textMuted` on this surface, and on the
sky, is below AA (flagged in step 1's log as an accepted gap in the *given* token values; using it
for new copy would have made a new instance of a gap that's only "accepted" for the string it was
already touching). `EmptyState` gained an optional `ink` prop so it can sit inside a `Band` and stay
legible — its default colors are unchanged for every other call site.

**`ListRow.tsx`** rewritten. New props: `{ list, index, onOpen(listId), onSetDeleted?(listId,
deleted) }` — `onOpen`/`onSetDeleted` now take the id, so `ListsScreen` doesn't allocate a closure
per row. Wrapped in `memo`. The delete/restore `IconButton` is a sibling of the row's main
`Pressable`, absolutely positioned over a spacer reserved inside the `Pressable`'s own flex row —
kept as a separate element (not nested inside the row's own `Pressable`) so it stays its own
accessible control rather than disappearing into the row's hit target.

**`ListsScreen.tsx`** rewritten around the same data logic (`useLists()`, `liveLists`,
`showDeleted`, `binned`) — none of that changed. New: `useSafeAreaInsets()`; a `header` JSX value
(title row + Account `PillButton`, loading spinner **or** `SyncBanner`+`AddBar`, `Horizon` wrapping
the switch) built once per render as a plain value, never an inline component type — the latter
would remount `AddBar` (and its draft/focus) on every render; `renderItem` passing `index` through;
`ListEmptyComponent` wrapped in `Band index={0}`. The literal `` <SyncBanner pending={pending} /> ``
stays exactly that literal —
[sync-banner-mount-is-unconditional](../../kb/entries/sync-banner-mount-is-unconditional.md)'s
`verify:` string-matches it in this file, so the header had to be built inline here rather than
factored into a separate `ListsHeader.tsx`.

**`RootNavigator.tsx`**: `Lists`' `Stack.Screen options` is now the static `{ title: 'My Lists',
headerShown: false }` — no navigation-dependent function needed, since the Account entry point now
lives inside `ListsScreen` itself as a `PillButton` calling `navigation.navigate('Account')`
directly (still a prop, never a hook). `title` stays: it is still the iOS back-button label from
`ListDetail`/`Account`, and the web page title. `HeaderButton`'s import was dropped from this file;
its doc comment now says it has one call site (`ListDetailScreen`'s Rename/Share), not two.

## The sky, the ground, and a real bug that only showed up empirically

**Layering, back to front:** a bounded `Sky` (`SKY_HEIGHT = 520`, an absolute View behind the
`FlatList`, `pointerEvents="none"`) comfortably covers the header plus a pull-to-refresh buffer; the
outer screen `View`'s own background is `bandAt(colors, lastVisibleIndex).color` — the *ground* —
so any area neither `Sky` nor an opaque row covers reads as a continuation of the last band, not a
seam; a second, thin `Sky` instance is pinned at `insets.top` as the topmost layer so the status bar
always sits on sky-colored pixels even once a dark band has scrolled up underneath it in a long
list.

**A missing `pointerEvents="none"` on the `Sky` wrapper `View` (not just the `<Svg>` inside it)
silently ate every tap on the header and the first several rows, confirmed on web.** An absolutely
positioned sibling stacks above a `position: static` one regardless of DOM order — a plain CSS rule
— so `Sky`, despite being earlier in the JSX than the `FlatList`, was painting *and receiving
events* on top of it. Fixed by adding `pointerEvents="none"` to the wrapper, not just the SVG.
Every other decorative absolute layer (`Band`'s wave, `Horizon`'s celestial graphic, `SyncBanner`'s
puff) already had it, from having been written with this in mind; this one wrapper, added last, was
the one instance that got missed. Worth a general note: a decorative `position: absolute` layer
needs `pointerEvents="none"` on the outermost element that establishes the absolute stacking
context, not just on the leaf that happens to be non-interactive-looking.

**A short or empty list left `Sky`'s stars visible in the middle of the screen, below a
short band that didn't reach far enough down to cover `Sky`'s 520pt bound — a real seam, not a
one-off rendering glitch.** Two things had to be fixed, and neither was `flexGrow`, which does not
propagate through `FlatList`'s content container the way it might on native — confirmed empirically
(inspecting the actual DOM: a `contentContainerStyle={{flexGrow:1}}` container and a `flexGrow: 1`
`ListEmptyComponent` both measured `flexGrow: 0` at runtime) rather than assumed from React Native
docs:
1. `ListFooterComponent` **does not render at all when the list is empty** (`ListEmptyComponent` is
   showing) — also confirmed by inspection, not the RN docs, which don't say so explicitly. So the
   empty state has to guarantee its own height.
2. Both cases are handled with a concrete `minHeight: SKY_HEIGHT`, not flex: the `Band` wrapping
   `ListEmptyComponent` gets it directly; a `ListFooterComponent` (rendered only when
   `visible.length > 0`) gets it for a short but non-empty list. Either way, real content always
   extends at least `SKY_HEIGHT` past wherever it starts, which is always ⩾ where `Sky`'s own bound
   ends, so `Sky` can never be the thing showing through.

**A second false lead, recorded so it isn't re-chased:** after the `minHeight` fix, the bug
appeared to persist across several browser reloads and even a full `page.goto` — it was stale
Metro/Fast-Refresh state in the long-running `npm run web` process, not the code. A full restart of
that process (kill + `npm run web` again) picked up the fix immediately. Web hot-reload lying about
a fix taking effect cost real time here; a page reload alone was not enough evidence that a change
had landed.

## Constraints, resolved as anticipated by the description

- **`screens-take-navigation-props`'s `verify:` no longer matches `options={({ navigation })` in
  `RootNavigator.tsx`.** Deliberate — see above. `ListsScreen` still takes `navigation` as a prop and
  calls `navigation.navigate` directly, never a hook; nothing else about the convention changed.
- **`ShowDeletedToggle` is `accessibilityRole="switch"`, not `"checkbox"`.** Same props, same label
  logic (`Show 1 deleted` / `Show N deleted` / `Show N+ deleted`, still load-bearing).
  `toBeChecked()` needed no change — confirmed in
  `node_modules/@testing-library/react-native/dist/matchers/to-be-checked.js` that it already
  supports `"switch"`, not just `"checkbox"`/`"radio"`. `ListDetailScreen.test.tsx`'s `itemLabels()`
  dropped its `.filter((label) => !label.startsWith('Show '))` — `getAllByRole('checkbox')` now
  excludes the toggle on its own.
- **`ListRow`'s a11y label is unchanged**: `list.name` / `` `${list.name}, shared with you` ``. Only
  the *visible* subtitle now splits by role via `canEditItems`: `Shared with you · can edit`
  (writer) / `Shared with you · view only` (reader); an owner's row still has none.

## Decisions not dictated by the description

- **Row color is a function of visible index**, per the description. Binning a row or toggling
  "Show deleted" therefore does shift the colors of the rows below the changed one, since their
  *position* changed. This is the intended reading of "index, not list count," not a bug — noted
  here so nobody "fixes" it later.
- **Past `bands.length`, color holds at the last step**, relying on `bandRim`'s highlight (not a
  darkening formula) to keep adjacent rows distinguishable — confirmed by eye on a 15+ list native
  screenshot; every row past index 5 is visibly separated by its rim despite sharing one color.
- **`Horizon`'s "half-sunk" effect uses a pre-cropped viewBox, not a clip from a wrapping
  `overflow: hidden`.** Keeps the whole effect inside one small, fixed-size, real-units SVG with no
  cross-component or cross-platform clipping assumptions.
- **Icon-button contrast is computed from the actual composite (a translucent white fill over the
  band color), not just the band color itself**, because that composite is what the glyph is
  actually read against. This is what surfaced the need for `iconButtonFillInverse` — the existing
  `iconButtonFill` alone was fine against the raw band color but not once painted at 0.55 opacity
  under a white glyph on a dark band.

## Verification

**`npm test`: 27 suites / 485 tests** (was 26 / 472). New: `src/state/bands.test.ts` (12).
Changed: `ListsScreen.test.tsx` (role-specific subtitle cases for reader/writer, an Account-button
navigation test, "checkbox" → "switch" wording in two bin tests), `ListDetailScreen.test.tsx`
(`itemLabels()` filter removed). `jest.setup.ts` gained the shipped
`react-native-safe-area-context/jest/mock` (confirmed necessary: the real `useSafeAreaInsets()`
throws `NO_INSETS_ERROR` with no provider in the tree, read directly from
`node_modules/react-native-safe-area-context/src/SafeAreaContext.tsx:149`, not assumed). `npm run
typecheck`: clean.

**`npm run kb:audit`: one failure, `screens-take-navigation-props`**, exactly the anticipated one —
everything else, including `theme-tokens-only`, passes. (`theme-tokens-only` failed twice during
development, both times because `bands.test.ts` itself — not app code — had a hex-looking literal in
a value or in a comment; fixed by building the test colors at runtime instead of writing them out,
see above.)

**Web (Playwright MCP, 390×844, local stack, signed in as `maya@example.com`):**
- Both themes checked against the mockup state (Groceries/Hardware store/Pharmacy/Camping trip
  owned, Weekend BBQ writer, Birthday party reader) — composition, band colors, wave edges, and the
  contrast-picked ink split all matched by eye before ever touching a simulator.
- Found and fixed the `pointerEvents` bug (row taps timing out) and the empty/short-list seam bug,
  both above.
- Scrolling past 15 lists, the bin toggle (checked/unchecked, `Restore`/`Delete` label flip, the
  `Deleted` tag), a long name wrapping to two lines with an ellipsis, sync-banner text — all
  exercised directly in the browser, not just inferred from the unit suite.
- `ListDetailScreen` (unchanged this step) still renders correctly with the restyled `AddBar` and
  `ShowDeletedToggle` — no regression from the shared-component restyle.

**iPhone 17e simulator** (`npm run ios -- --device "iPhone 17e"`, after
`prebuild`+`pod install`): booted end to end; screenshots below. `Show N deleted`'s count reads
higher than the mockup's `Show 2 deleted` (23, from this session's own throwaway test lists binned
along the way, all soft-deleted and harmless) — the six *live* lists and their roles match the
mockup exactly, which is what the composition check is about. Theme switching driven by
`.maestro/flows/set-theme.yaml`. Checked and screenshotted: the mockup state (day + night), the bin
shown, a 15-list scroll (wave-rim separation past index 5, smooth scroll, status bar staying on sky
mid-scroll via the pinned top `Sky` layer), a long name wrapping/truncating to two lines, the sync
banner appearing (Kong container `docker pause`d to force an offline write — chosen over `supabase
stop` as far less disruptive to the running session) and clearing after `docker unpause`, and a
fresh account's empty state (`step3empty@example.com`, OTP read from Mailpit's API) confirming the
seam fix on a genuinely empty list, not just a short one.

**iPhone 17 Pro Max**: the same `.app` from DerivedData, `xcrun simctl install`ed with no rebuild.
Both themes checked; the dynamic-island status-bar area is correctly covered by the pinned top `Sky`
layer at the taller device's own `insets.top`.

**Android `Pixel_10`**: `npx expo prebuild --platform android` (non-clean) + `npm run android
-- --no-bundler` against the Metro `npm run web`/`ios` already had running (BUILD SUCCESSFUL in
16m 9s, cold). A freshly booted emulator's "System UI isn't responding" needed several rounds of
"Wait" before the system UI recovered — the app itself was fine underneath the whole time,
confirmed once the dialog cleared. Both themes checked; composition, band colors, and the
edge-to-edge status-bar area (no notch/dynamic-island cutout, unlike iOS, so the pinned top `Sky`
layer only has to cover the plain status bar) all match.

**Found, and not fixed — an existing Maestro-tooling gap, not a regression from this step:**
`.maestro/flows/set-theme.yaml`'s last step, `tapOn: My Lists`, fails on Android
(`Element not found: Text matching regex: My Lists`). Inspecting the hierarchy
(`maestro hierarchy`) on both platforms explains why: iOS's native-stack back button keeps the
previous screen's `title` as its accessibility label regardless of `headerShown`, so `My Lists`
still resolves there — confirmed by hierarchy dump, the label is present twice (the header
landmark and the in-screen `accessibilityRole="header"` Text) even with the native header hidden.
Android's back button, though, always reads the OS-generic **"Navigate up"**, never the previous
screen's title — this is a plain Android accessibility convention, unrelated to `headerShown` or
anything in this step. The flow almost certainly never ran successfully against Android before
this step: step 1's Android verification section describes manual checks, not a Maestro run, and
nothing in the repo's history suggests `set-theme.yaml` was ever exercised there. Worked around
here with a one-off flow (`tapOn: "Navigate up"`) to reach the Lists screenshot; the shipped
`.maestro/flows/set-theme.yaml` was left as-is since fixing cross-platform Maestro selectors is
tooling maintenance outside this step's scope, but it's a real gap someone should close before
relying on that flow for an Android-inclusive automated run.

## Screenshots

`ai/tasks/20-ux/screenshots/step-3/`: `lists-mockup-state-{day,night}.png` (the six-list, two-role
mockup state), `lists-17-pro-max-{day,night}.png`, `lists-android-{day,night}.png`,
`sync-banner-appearing-day.png`, `sync-banner-cleared-day.png`.

## For the librarian — candidate facts

1. **`ListRow`/presentational components may not import `../lib/`**
   ([supabase-client-module-boundary](../../kb/entries/supabase-client-module-boundary.md) already
   says this in prose; this step is a second data point that the `verify:` genuinely enforces it —
   the band/contrast logic had to move to `src/state/bands.ts` specifically because of it).
2. **`src/components/*.test.tsx` is capped at one file by
   [component-suite-earned-by-owned-logic](../../kb/entries/component-suite-earned-by-owned-logic.md)'s
   `verify:`** — worth surfacing more prominently for whoever adds the next presentational
   component, since the natural instinct is to add a co-located test file.
3. **`theme-tokens-only`'s hex/`rgba(`-literal sweep covers test files and comments, not just app
   code** — a color value used only to exercise a function like `contrastRatio` has to be built at
   runtime (`` `#${...}` ``), and a comment describing the rule can't type out the pattern it's
   warning against either.
4. **`ShowDeletedToggle` is now `accessibilityRole="switch"`** —
   [queries-go-through-a11y-labels](../../kb/entries/queries-go-through-a11y-labels.md)'s table
   still says `"checkbox"` for it.
5. **`Lists`' native header is gone** (`headerShown: false`) —
   [screens-take-navigation-props](../../kb/entries/screens-take-navigation-props.md)'s "third
   header-wiring shape" section (the `options={({ navigation }) => …}` example) no longer has a
   live example in the codebase.
6. **A decorative `position: absolute` layer needs `pointerEvents="none"` on its own outermost
   View, not only on an inner `<Svg>`** — an absolutely positioned sibling paints (and receives
   touches) above a static one regardless of DOM order on web; this cost real debugging time once
   in this step and is a general enough trap to be worth a line somewhere.
7. **`FlatList`'s `ListFooterComponent` does not render when the list is empty**
   (`ListEmptyComponent` showing instead) — confirmed by DOM inspection, not documented explicitly
   by React Native. Anything that needs guaranteed trailing space regardless of list state has to
   handle the empty case on the empty-state element itself.
8. **`.maestro/flows/set-theme.yaml`'s `tapOn: My Lists` step does not work on Android** — the
   Android back button's accessibility label is always the OS-generic `"Navigate up"`, never the
   previous screen's title, unlike iOS's native-stack back button. Pre-existing, not caused by this
   step's `headerShown: false` change (confirmed: iOS's back button still carries `My Lists` as its
   label with the native header hidden). Likely never exercised on Android before now.
   [maestro-drives-the-native-ui](../../kb/entries/maestro-drives-the-native-ui.md) should probably
   record this if any flow is meant to run cross-platform.
