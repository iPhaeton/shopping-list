---
id: phone-is-the-product
title: The product is the phone app — web is where flows are tested, never what the design bends to
type: constraint
status: current
tags: [product, verification, web, ios, android, design]
sources: [ai/tasks/20-ux/description-step-1.md, ai/tasks/20-ux/implementation-log-step-1.md]
last_verified: 2026-09-25
verify: ! grep -q accessibilityState node_modules/react-native-web/dist/modules/createDOMProps/index.js && grep -q "Platform.OS === 'web'" src/state/ThemeContext.tsx
related: [maestro-drives-the-native-ui, native-build-toolchain, theme-reaches-native-surfaces, supabase-local-stack, queries-go-through-a11y-labels, scope-boundaries]
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

**Where visual sign-off happens.** The **iPhone 17e** simulator: its screen is exactly the mockups'
1170×2532 @3x (390×844 pt), so an `xcrun simctl io booted screenshot` lines up with a mockup pixel
for pixel. Then a second look on the **iPhone 17 Pro Max** (taller) and the **`Pixel_10`** Android
emulator. Screenshots saved under `ai/tasks/*/screenshots/` come from the simulator, not the
browser. How to reach each screen there:
[maestro-drives-the-native-ui](maestro-drives-the-native-ui.md).

**Web-only flaws already accepted** — do not spend a cycle "fixing" these:

- **No checked state on web.** react-native-web 0.21 has no `accessibilityState` handling at all
  (it maps `aria-checked`/`accessibilityChecked`, not the state object), so every radio and checkbox
  here — `ItemRow`, `ShowDeletedToggle`, `SegmentedPicker`/`RolePicker` — renders with no
  `aria-checked`. Playwright cannot assert checked state; RNTL and native can. The `verify:` pins
  this, so it fails the day RNW starts mapping the prop.
- The page is blank white before the theme gate opens, even at Night.
- The browser's own blue focus ring.

**What to do:** check looks on the simulator, flows on web, and both before calling a step done.
When the two disagree, the phone wins and web gets a fallback.
