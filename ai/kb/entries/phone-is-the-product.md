---
id: phone-is-the-product
title: The product is the phone app — web is where flows are tested, never what the design bends to
type: constraint
status: current
tags: [product, verification, web, ios, android, design]
sources: [ai/tasks/20-ux/description-step-1.md, ai/tasks/20-ux/implementation-log-step-1.md, ai/tasks/20-ux/implementation-log-step-3.md, ai/tasks/20-ux/implementation-log-step-4.md, ai/tasks/20-ux/implementation-log-step-5.md, ai/tasks/20-ux/description-step-6.md, ai/tasks/20-ux/implementation-log-step-6.md, ai/tasks/21-expo-sdk-57/implementation-log-step-1.md, ai/tasks/24-search-and-sort/implementation-log-step-1.md, d58a9cf, 962533c, a7416fd, 3ccf224]
last_verified: 2026-10-02
verify: ! grep -q accessibilityState node_modules/react-native-web/dist/modules/createDOMProps/index.js && grep -q "Platform.OS === 'web'" src/state/ThemeContext.tsx && ! grep -rq 'linking={' src --include='*.tsx' && grep -q 'stopColor={colors.bandRim} stopOpacity={0.2}' src/components/Band.tsx && grep -q 'stopColor={colors.bandRim} stopOpacity={0.2}' src/components/Horizon.tsx && grep -q 'color & 0x00ffffff | alpha << 24' node_modules/react-native-svg/lib/module/lib/extract/extractGradient.js && grep -q 'bandAt(colors, index)' src/components/ItemRow.tsx && grep -q "from '../../../src/theme.ts'" ai/ux/source/tokens.mjs
related: [maestro-drives-the-native-ui, list-headers-are-pinned-and-opaque, native-build-toolchain, theme-reaches-native-surfaces, supabase-local-stack, queries-go-through-a11y-labels, scope-boundaries, absolute-decoration-needs-pointer-events-on-its-wrapper, flatlist-footer-absent-when-list-is-empty, svg-percent-size-frozen-on-ios, screens-take-navigation-props]
---

**Since task 20 step 1: the product is the phone app** — iOS and Android, portrait. Before that the
browser was the de facto target, and older entries still read that way; verifying in the browser
([supabase-local-stack](supabase-local-stack.md)) still holds for flows, not for looks. The priority
is the user's: task 20's step-1 description sets it for every later step, and its log asks that it
be treated as standing.

| | role |
|---|---|
| **phone** | the product. Visual sign-off happens here |
| **web** | where flows are built and tested against the local stack (Playwright + Mailpit). It must keep working — every screen usable, no crash, the flows passing — but how it *looks* is not a goal |

**When web cannot render what the phone design needs, fix it on the web side**: a
`Platform.OS === 'web'` fallback, a simpler web rendering, or an accepted web-only flaw. **Never
simplify or bend the phone design to suit web.** Typical cases: fonts, SVG, translucency and
shadows, safe areas, overscroll, and anything native-only — `Appearance.setColorScheme` and
`expo-system-ui` are skipped on web in
[ThemeContext.tsx](../../../src/state/ThemeContext.tsx) because react-native-web has neither.

**Where visual sign-off happens.** The iOS simulator, then the **`Pixel_10`** Android emulator.
The **iPhone 17e**, whose screen is exactly the mockups' 1170×2532 @3x (390×844 pt), **is gone from
this Mac** (by 2026-09-30). Task 20 step 6 was checked on the **iPhone 18 Pro** only, by the user's
instruction: 1206×2622 @3x (402×874 pt), so a screenshot no longer overlays a mockup pixel for
pixel — compare by measure. It is the simulator prepared for Maestro. The large phone, the
**iPhone 18 Pro Max**, has never been run — task 20 step 5 skipped it by the user's decision.
Screenshots saved under `ai/tasks/*/screenshots/` come from the simulator, not the browser.
**Shoot only the screens a step changed** — the user's standing rule since task 20 step 6, not
`shoot-all.sh`'s full tours. How to reach each screen: [maestro-drives-the-native-ui](maestro-drives-the-native-ui.md).

**Android is two steps behind.** Task 20 step 5's screens — Sign in, Set name, Account, Sharing, the
launch screen — have not been seen on `Pixel_10`: the build that would have added `expo-blur` and
the splash filled the disk, and the user said to skip it. Step 6 skipped Android by instruction too.
So these are **unverified on Android**: the `BlurTargetView` blur and its scroll cost on Account
(Sharing's cards have had no blur target since step 6, so there they are plain `cardFill`), the
splash emblem under Android 12+'s circular mask, hardware back from Account and Sharing,
`useKeyboardReveal` with Android's keyboard (its code assumes the window shrinks), and step 6's
Sharing — its pinned header, its `KeyboardAvoidingView` (no `behavior` on Android), and taps on the
suggestion rows below the header's edge, which iOS reaches only through Fabric's overflow-aware hit
test. The installed dev client predates both native modules ([native-build-toolchain](native-build-toolchain.md)).

**The design is the mockups in `ai/ux/primary/`** — each screen, some in several states, day and
moonlit, compared by measure against the simulator. Where a description's prose about looks and
its images differ, the images win; its constraints and done-when still govern (task 20 step 5's 18
arrived in `962533c`, after its description said no image covered those screens).

**The four oldest Lists and List detail mockups are stale — do not build to them.**
[lists-screen-quiet-horizon](../../../ai/ux/primary/lists-screen-quiet-horizon.png) and
[list-detail-screen-quiet-horizon](../../../ai/ux/primary/list-detail-screen-quiet-horizon.png)
(and their `-moonlit` pairs) stay untouched as records, but since task 24 step 1 they are wrong
three ways:

- They show **create mode without its header button**, not the resting state. The resting design
  is search mode: `lists-screen-search-resting*` and `list-detail-screen-search-resting*`.
- Their toggles carry a count (`Show 2 deleted`, `Show 1 deleted`). The designed label is
  `Show deleted`, always, with no number.
- List detail's items sit on one pale ground with hairlines. The app has drawn one band per item
  row (`ItemRow` → `bandAt`) since `a7416fd`, and every newer List detail mockup does too.

Task 24 step 1 added nine stems for search, sort and the bin: `lists-screen-{search,
search-resting,bin,bin-empty}` and `list-detail-screen-{search,search-resting,search-sorted,bin,
bin-empty}`. Its log records each one's state, copy, a11y labels, and the geometry to measure by.

**Mockups are rendered, never hand-drawn.** The harness in `ai/ux/source/`
([README](../../../ai/ux/source/README.md)) imports `src/theme.ts` and `bandAt` directly, so the
palettes are the real ones, and it is calibrated against simulator shots. Change a mockup by
editing its scene and re-rendering, never by editing a PNG, and never overwrite one the user has
not asked to change. It renders the set's 390×844 pt @3x, not the 18 Pro's size.

**Task screenshots are records of their day, like the logs, not the current design.** The user
can hand-tune a look after the shots are taken, in the same commit. **The band rim on Lists is the
known case: faint on purpose.** Task 20 step 3's `screenshots/step-3/lists-*` show each band's top
edge as a bright white highlight. The user then made it fainter by hand, committed in `d58a9cf`
alongside those shots. Task 21 read the difference as an SDK 57 regression, and that was wrong: the
build draws exactly the committed values. The rim no longer has to separate rows, because since
`b66e076` adjacent rows never share a colour (`src/state/bands.ts`). **Do not "restore" the bright
edge from those shots.** The rim's brightness is `stopOpacity={0.2}` → `0` in `Band.tsx` and in
`Horizon.tsx` (the first band). On native, react-native-svg replaces a stop colour's own alpha with
`stopOpacity`, so the `bandRim` token's alpha (0.22 Day, 0.1 Night) changes nothing there. The
`verify:` pins the 0.2, so a deliberate change to the rim should update this paragraph too.

**Web-only flaws already accepted** — do not spend a cycle "fixing" these:

- **No checked state on web.** react-native-web 0.21 has no `accessibilityState` handling at all
  (it maps `aria-checked`/`accessibilityChecked`, not the state object), so every radio and checkbox
  here — `ItemRow`, `ShowDeletedToggle`, `SegmentedPicker`/`RolePicker` — renders with no
  `aria-checked`. Playwright cannot assert checked state; RNTL and native can. The `verify:` pins
  this, so it fails the day RNW starts mapping the prop.
- **The browser's back and forward buttons do nothing inside the app.** `NavigationContainer`
  (in `RootNavigator`) gets no `linking` prop. React Navigation only enables `useLinking`, the only
  thing that writes browser history, when `linking` is passed. So no screen has ever pushed a
  browser history entry. The user declined a web-only `linking` config in task 20 step 4. On web,
  the drawn `Back` is the way back, as the native header's back button was before.
- The page is blank white before the theme gate opens, even at Night.
- The browser's own blue focus ring.

**What to do:** check looks on the simulator, flows on web, and both before calling a step done.
When the two disagree, the phone wins and web gets a fallback.

**Checking the phone design on web catches its own bugs, not just fallback needs.** Task 20 step 3's
full-bleed `Sky`/`Band` background behind `ListsScreen`'s `FlatList` surfaced two rendering bugs only
visible on web — a tap-eating layering bug
([absolute-decoration-needs-pointer-events-on-its-wrapper](absolute-decoration-needs-pointer-events-on-its-wrapper.md))
and a seam below a short list
([flatlist-footer-absent-when-list-is-empty](flatlist-footer-absent-when-list-is-empty.md)). Both
would have shipped invisibly past RNTL and were only found by driving the actual browser DOM. Step 5
found the same family again: react-native-web's text input is not positioned, so a `Card`'s absolute
blur layer painted over — and blurred — the field inside it (hence `TextField`'s
`position: 'relative'`, a no-op on native).
