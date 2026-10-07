---
id: phone-is-the-product
title: The product is the phone app — web is where flows are tested, never what the design bends to
type: constraint
status: current
tags: [product, verification, web, ios, android, design]
sources: [ai/tasks/20-ux/description-step-1.md, ai/tasks/20-ux/implementation-log-step-1.md, ai/tasks/20-ux/implementation-log-step-3.md, ai/tasks/20-ux/implementation-log-step-4.md, ai/tasks/20-ux/implementation-log-step-5.md, ai/tasks/20-ux/description-step-6.md, ai/tasks/20-ux/implementation-log-step-6.md, ai/tasks/21-expo-sdk-57/implementation-log-step-1.md, ai/tasks/24-search-and-sort/implementation-log-step-1.md, ai/tasks/24-search-and-sort/implementation-log-step-3.md, ai/tasks/25-account-deletion/implementation-log-step-1.md, ai/tasks/26-apple-sign-in/implementation-log-step-1.md, ai/tasks/26-apple-sign-in/implementation-log-step-2.md, b4cafe0, b15d384, d58a9cf, 962533c, a7416fd, 3ccf224]
last_verified: 2026-10-07
verify: ! grep -q accessibilityState node_modules/react-native-web/dist/modules/createDOMProps/index.js && ! grep -qE 'accessibilityValue([^A-Za-z]|$)' node_modules/react-native-web/dist/modules/createDOMProps/index.js && grep -q "Platform.OS === 'web'" src/state/ThemeContext.tsx && ! grep -rq 'linking={' src --include='*.tsx' && grep -q 'stopColor={colors.bandRim} stopOpacity={0.2}' src/components/Band.tsx && grep -q 'stopColor={colors.bandRim} stopOpacity={0.2}' src/components/Horizon.tsx && grep -q 'color & 0x00ffffff | alpha << 24' node_modules/react-native-svg/lib/module/lib/extract/extractGradient.js && grep -q 'bandAt(colors, index)' src/components/ItemRow.tsx && grep -q "from '../../../src/theme.ts'" ai/ux/source/tokens.mjs
related: [maestro-drives-the-native-ui, list-headers-are-pinned-and-opaque, native-build-toolchain, theme-reaches-native-surfaces, supabase-local-stack, queries-go-through-a11y-labels, scope-boundaries, absolute-decoration-needs-pointer-events-on-its-wrapper, flatlist-footer-absent-when-list-is-empty, svg-percent-size-frozen-on-ios, screens-take-navigation-props, search-fold-fallbacks-ship]
---

**Since task 20 step 1: the product is the phone app** — iOS and Android, portrait — by the user's
standing priority. Verifying in the browser ([supabase-local-stack](supabase-local-stack.md)) holds
for flows, not for looks.

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

**Where visual sign-off happens: the iOS simulator only.** No step since task 20 step 5 has been
checked on the `Pixel_10` emulator, and task 25 rules it out for every step ("only on iPhone").
The **iPhone 17e**, exactly the mockups' 1170×2532 @3x (390×844 pt), **is gone from this Mac**.
The prepared simulator, Maestro's too, is the **iPhone 18 Pro**: 1206×2622 @3x (402×874 pt), so a
screenshot no longer overlays a mockup pixel for pixel — compare by measure: it sits **~15.3 pt
lower throughout**, and with that offset taken out relative geometry matches to ≤ 0.4 pt. The
**iPhone 18 Pro Max** has never been run, by the user's decision. Screenshots under
`ai/tasks/*/screenshots/` come from the simulator, not the browser. **Shoot only the screens a step
changed** — the user's standing rule, not `shoot-all.sh`'s full tours. How to reach each screen:
[maestro-drives-the-native-ui](maestro-drives-the-native-ui.md).

**Android is behind.** Task 20 step 5's screens — Sign in, Set name, Account, Sharing, the
launch screen — have not been seen on `Pixel_10`: the build that would have added `expo-blur` and
the splash filled the disk, and the user said to skip it. Step 6 skipped Android by instruction too.
So these are **unverified on Android**: the `BlurTargetView` blur and its scroll cost on Account
(Sharing's cards have had no blur target since step 6, so there they are plain `cardFill`), the
splash emblem under Android 12+'s circular mask, hardware back from Account and Sharing,
`useKeyboardReveal` with Android's keyboard (its code assumes the window shrinks), and step 6's
Sharing — its pinned header, its `KeyboardAvoidingView` (no `behavior` on Android), and taps on the
suggestion rows below the header's edge, which iOS reaches only through Fabric's overflow-aware hit
test. The installed dev client predates both native modules ([native-build-toolchain](native-build-toolchain.md)).
**Task 24's search and sort screens are unverified on Android too** — the user stopped the check.

**The design is the mockups in `ai/ux/primary/`** — each screen, some in several states, day and
moonlit, compared by measure against the simulator. Where a description's prose about looks and
its images differ, the images win; its constraints and done-when still govern.

**Eight mockups are stale records — keep them untouched, never build to what they get wrong:**

- [lists-screen-quiet-horizon](../../../ai/ux/primary/lists-screen-quiet-horizon.png) and
  [list-detail-screen-quiet-horizon](../../../ai/ux/primary/list-detail-screen-quiet-horizon.png)
  (and `-moonlit`), since task 24 step 1. They show **create mode without its header button**; the
  resting design is search mode, `lists-screen-search-resting*` and
  `list-detail-screen-search-resting*`. Their toggles carry a count (`Show 2 deleted`); the label
  is `Show deleted`, always. List detail's items sit on one pale ground with hairlines; the app
  has drawn one band per item row (`ItemRow` → `bandAt`) since `a7416fd`.
- `account-screen-quiet-horizon*` and `account-screen-editing-*`, since task 25 step 1: no 4th
  card, `Delete account`. **Account is `account-screen-delete*` now**; `-editing-` still draws the
  name editor, which is otherwise unchanged.

**Sign in differs by platform.** `sign-in-screen-apple*` is the current iOS Sign in;
`sign-in-screen-quiet-horizon*` stays current for Android, which has no Apple button, and
`sign-in-screen-deleted*` has no Apple version. `account-screen-hidden-email*` (a relay address) is
a *state* of Account beside `account-screen-delete*`, not a replacement. Each task's step-1 log
records its stems' state, copy, a11y labels, and the geometry to measure by.

**Mockups are rendered, never hand-drawn.** The harness in `ai/ux/source/`
([README](../../../ai/ux/source/README.md)) imports `src/theme.ts` and `bandAt` directly, so the
palettes are the real ones, and it is calibrated against simulator shots. Change a mockup by
editing its scene and re-rendering, never by editing a PNG, and never overwrite one the user has
not asked to change. It renders the set's 390×844 pt @3x, not the 18 Pro's size, and draws only
Lists, List detail, Account and Sign in; another screen has to be ported into it first. Apple's
button is native: Apple draws its inside, so only its frame is design, and the harness's
`AppleButton` (`APPLE_INSIDE`) is calibrated to the 18 Pro simulator's, within 0.3 pt.

**Task screenshots are records of their day, like the logs, not the current design.** The user
can hand-tune a look after the shots are taken. **The band rim on Lists is the known case: faint on
purpose.** Task 20 step 3's `screenshots/step-3/lists-*` show a bright white top edge; the user made
it fainter by hand in `d58a9cf`, and task 21 wrongly read that as an SDK 57 regression. Adjacent rows
never share a colour (`src/state/bands.ts`), so the rim need not separate them. **Do not "restore"
the bright edge from those shots.** The rim's brightness is `stopOpacity={0.2}` → `0` in `Band.tsx` and in
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
  (in `RootNavigator`) gets no `linking` prop, and React Navigation writes browser history only
  when it does. The user declined a web-only `linking` config; the drawn `Back` is the way back.
- **No accessibility value on web.** react-native-web 0.21 drops `accessibilityValue` (no
  `aria-valuetext` in the DOM) — the same family as the missing checked state. The sort buttons' and
  the magnifier's values (`SortButtons`, `IconButton`'s `value`) exist on native and in RNTL only.
  The `verify:` fails the day RNW maps the prop.
- The page is blank white before the theme gate opens, even at Night.
- The browser's own blue focus ring.

**Checking the phone design on web catches its own bugs, not just fallback needs** — ones RNTL
cannot see, found only by driving the browser DOM: a tap-eating layering bug
([absolute-decoration-needs-pointer-events-on-its-wrapper](absolute-decoration-needs-pointer-events-on-its-wrapper.md)),
a seam below a short list
([flatlist-footer-absent-when-list-is-empty](flatlist-footer-absent-when-list-is-empty.md)), and an
unpositioned RNW text input that a `Card`'s absolute blur layer painted over (hence `TextField`'s
`position: 'relative'`, a no-op on native).
