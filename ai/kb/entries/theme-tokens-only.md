---
id: theme-tokens-only
title: Every color and font comes from src/theme.ts, read at render through themedStyles — no literals, no module-scope palette, no fontWeight, no orphaned token
type: convention
status: current
tags: [styling, theme, fonts, contrast]
sources: [ai/tasks/1/implementation-log-step-1.md, ai/tasks/2/implementation-log-step-2.md, ai/tasks/20-ux/description-step-1.md, ai/tasks/20-ux/implementation-log-step-1.md, ai/tasks/20-ux/implementation-log-step-2.md, ai/tasks/20-ux/implementation-log-step-3.md, ai/tasks/20-ux/implementation-log-step-4.md, ai/tasks/20-ux/description-step-5.md, ai/tasks/20-ux/implementation-log-step-5.md, src/state/bands.test.ts, src/theme.test.ts]
last_verified: 2026-09-29
verify: for k in $(sed -n '/^export type Palette = {/,/^};/p' src/theme.ts | grep -oE '^  [a-zA-Z]+:' | tr -d ' :'); do grep -rqE "colors\.$k\b" src --include='*.ts' --include='*.tsx' --exclude=theme.ts --exclude='*.test.*' || exit 1; done; for g in fonts spacing radius; do for k in $(sed -n "/^export const $g = {/,/^};/p" src/theme.ts | grep -oE '^  [a-zA-Z]+:' | tr -d ' :'); do grep -rqE "$g\.$k\b" src --include='*.ts' --include='*.tsx' --exclude=theme.ts --exclude='*.test.*' || exit 1; done; done; test -z "$(grep -rnE '#[0-9a-fA-F]{3,8}|rgba?\(' src --include='*.ts' --include='*.tsx' | grep -v src/theme.ts)" && test "$(grep -rl 'StyleSheet.create' src --include='*.tsx' | grep -v '\.test\.')" = src/state/ThemeContext.tsx && ! grep -rq 'fontWeight' src --include='*.tsx' && ! grep -rqE "from '@expo-google-fonts/[a-z0-9-]+'" src && ! grep -q 'export const colors' src/theme.ts && grep -q "(\['text', 'textSecondary', 'error', 'primary'\] as const)" src/theme.test.ts
related: [queries-go-through-a11y-labels, theme-reaches-native-surfaces, recycled-text-input-keeps-letter-spacing, phone-is-the-product, theme-provider-suites-fake-the-clock]
indexed: false
---

> **Not in `INDEX.md`, still true.** The audit enforces the rule by itself: the `verify:` sweeps
> `src/` on every run, so breaking it fails `npm run kb:audit` whether or not anybody read this
> first. Reached from [queries-go-through-a11y-labels](queries-go-through-a11y-labels.md) and
> [theme-reaches-native-surfaces](theme-reaches-native-surfaces.md).

[src/theme.ts](../../../src/theme.ts) is the only file in `src/` holding a color literal, hex or
`rgba()`. Since task 20 step 1 it exports **two palettes with identical, role-named keys** —
`day` and `night` ("Moonlit"), typed `Palette`, gathered in `palettes` — plus `fonts`, `spacing`, and
`radius` (`lg: 20` for cards and notice cards, `pill: 999`). A shadow's color is a token too:
`boxShadow` reads `barShadow`, which is fully transparent at night. **There is no `colors` export
any more**, on purpose: a module-scope `StyleSheet.create({ … colors.x … })` froze whichever palette
was current at import. The one non-palette color export is `google`, the G's four brand colours,
the same in both themes because Google's branding asks for them as they are.

**Colors are read at render, through one pattern.** `themedStyles(factory)` in
[ThemeContext.tsx](../../../src/state/ThemeContext.tsx), at module scope in place of
`StyleSheet.create`, returns a hook; `const styles = useStyles()` at render. It builds once per
palette and caches. An inline color (a `placeholderTextColor`, an `ActivityIndicator`) reads
`useTheme().colors`. Two consequences:

- `useStyles()` is a hook, so it goes **before any early return** — first in the component.
- **Key nothing by theme.** A switch must only change the context value: `NavigationContainer`, the
  providers, open editors, drafts, scroll positions and the stack all survive it.

The context default is the day palette rather than a throw for a missing provider — that is what lets
every screen suite render without a `ThemeProvider`, never wait on fonts, and never depend on the
time of day: it stays a fixed Day although the provider's own default is now Auto
([theme-provider-suites-fake-the-clock](theme-provider-suites-fake-the-clock.md)).

**Fonts: one family per weight, never `fontWeight`.** `fonts.sans`, `sansMedium`, `sansSemiBold`
(Nunito Sans) and `fonts.serif` (Source Serif 4, screen titles); `sansBold` was deleted, unused, in
task 20 step 5. Android does not pick a weight inside a custom family, so `fontWeight: '600'` on
`fonts.sans` renders regular there. Font files are imported by subpath
(`@expo-google-fonts/nunito-sans/600SemiBold`) — each package index `require`s all 16 weights and
Metro would bundle every one.

**Which ink goes where is a contrast rule, and a suite enforces it.** `textMuted` is for
placeholders, disabled text and decoration only: by day (`#75778f`) it is 3.4–4.1:1 on every
surface, below AA. Hints and field labels use `textSecondary`, sampled from the step-5 mockups.
[src/theme.test.ts](../../../src/theme.test.ts) asserts `text`, `textSecondary`, `error` and
`primary` at 4.5:1 or better on every surface body text sits on, in both palettes — the skies,
`surface`, the banner, `cardFill` composited over the sky and bands 0–2, `fieldFill`, the segmented
track — plus `onPrimary`/`onError` on their fills. A new surface goes into its list; a new body-text
ink goes into its inks.

**`cardFill` assumes the blur under it.** It is `surface` at 0.74, sampled from mockups that
composite the card over a *blurred* backdrop (`Card`, `expo-blur`). A translucent fill alone shows
band edges as hard lines through the card, and iOS's plain `light`/`dark` blur tints darkened it
about five levels; `systemUltraThinMaterial*` at intensity 50 matched. On Android the blur samples
`Backdrop`'s `BlurTargetView`, which is **unverified on device** — step 5 skipped Android.

**No token stays orphaned.** Task 20 step 5 deleted `radius.sm`, `radius.md` and `fonts.sansBold`
once nothing used them. The `verify:` requires every `Palette` key to be read as `colors.<key>`, and
every `fonts`/`spacing`/`radius` key as `<group>.<key>`, somewhere in non-test `src/` outside
`theme.ts` — so add a token in the change that first uses it.

**The sweep covers every `.ts`/`.tsx` under `src/`, test files and comments included — not just
app code.** A comment merely *describing* a rejected input in the usual `#rrggbb`/`rgba(` notation
trips the check as surely as a literal would; it failed this way twice in task 20 step 3. Build a
test's own throwaway colors at runtime instead (`` `#${'f'.repeat(3)}` ``, or from numeric channels
as `theme.test.ts`'s `hex()` does) and describe a rejected shape in prose rather than by example.

**What to do:** need a shade, weight, or gap with no token? Add it to `theme.ts`, in both palettes,
and to `theme.test.ts` if text sits on it. The `verify:` fails on a hex or `rgb(a)` literal outside
`theme.ts`, a `StyleSheet.create` anywhere but `themedStyles`, any `fontWeight` in a `.tsx`, a
package-index Google Fonts import, a returning `colors` export, an unused token, or a contrast suite
that stops covering `textSecondary`.
