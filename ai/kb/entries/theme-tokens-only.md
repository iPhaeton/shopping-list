---
id: theme-tokens-only
title: Every color and font comes from src/theme.ts, read at render through themedStyles — no literals, no module-scope palette, no fontWeight
type: convention
status: current
tags: [styling, theme, fonts]
sources: [ai/tasks/1/implementation-log-step-1.md, ai/tasks/2/implementation-log-step-2.md, ai/tasks/20-ux/description-step-1.md, ai/tasks/20-ux/implementation-log-step-1.md]
last_verified: 2026-09-25
verify: test -z "$(grep -rnE '#[0-9a-fA-F]{3,8}|rgba?\(' src --include='*.ts' --include='*.tsx' | grep -v src/theme.ts)" && test "$(grep -rl 'StyleSheet.create' src --include='*.tsx' | grep -v '\.test\.')" = src/state/ThemeContext.tsx && ! grep -rq 'fontWeight' src --include='*.tsx' && ! grep -rqE "from '@expo-google-fonts/[a-z0-9-]+'" src && ! grep -q 'export const colors' src/theme.ts
related: [queries-go-through-a11y-labels, theme-reaches-native-surfaces, recycled-text-input-keeps-letter-spacing, phone-is-the-product]
indexed: false
---

> **Not in `INDEX.md`, still true.** The audit enforces the rule by itself: the `verify:` sweeps
> `src/` on every run, so breaking it fails `npm run kb:audit` whether or not anybody read this
> first. Reached from [queries-go-through-a11y-labels](queries-go-through-a11y-labels.md) and
> [theme-reaches-native-surfaces](theme-reaches-native-surfaces.md).

[src/theme.ts](../../../src/theme.ts) is the only file in `src/` holding a color literal, hex or
`rgba()`. Since task 20 step 1 it exports **two palettes with identical, role-named keys** —
`day` and `night` ("Moonlit"), typed `Palette`, gathered in `palettes` — plus `fonts`, `spacing`, and
`radius` (`pill: 999` added). **There is no `colors` export any more**, on purpose: a module-scope
`StyleSheet.create({ … colors.x … })` froze whichever palette was current at import.

**Colors are read at render, through one pattern.** `themedStyles(factory)` in
[ThemeContext.tsx](../../../src/state/ThemeContext.tsx), at module scope in place of
`StyleSheet.create`, returns a hook; `const styles = useStyles()` at render. It builds once per
palette and caches. An inline color (a `placeholderTextColor`, an `ActivityIndicator`) reads
`useTheme().colors`. Two consequences:

- `useStyles()` is a hook, so it goes **before any early return** — first in the component.
- **Key nothing by theme.** A switch must only change the context value: `NavigationContainer`, the
  providers, open editors, drafts, scroll positions and the stack all survive it.

The context default is the day palette rather than a throw for a missing provider — that is what lets
every screen suite render without a `ThemeProvider` and never wait on fonts.

**Fonts: one family per weight, never `fontWeight`.** `fonts.sans`, `sansSemiBold`, `sansBold`
(Nunito Sans) and `fonts.serif` (Source Serif 4, screen titles). Android does not pick a weight
inside a custom family, so `fontWeight: '700'` on `fonts.sans` renders regular there. Font files are
imported by subpath (`@expo-google-fonts/nunito-sans/700Bold`) — each package index `require`s all
16 weights and Metro would bundle every one.

**Token values are the task description's, not ours to tune.** Day `textMuted` (`#75778f`) is
3.48:1 on the day sky, below AA for hint text; it was kept as given and flagged to the user, who
decides. `error` did change (`#b3261e` / `#ff9b90`) because the old red failed AA on the new sky.

**What to do:** need a shade, weight, or gap with no token? Add it to `theme.ts`, in both palettes.
The `verify:` fails on a hex or `rgb(a)` literal outside `theme.ts`, a `StyleSheet.create` anywhere
but `themedStyles`, any `fontWeight` in a `.tsx`, a package-index Google Fonts import, or a returning
`colors` export.
