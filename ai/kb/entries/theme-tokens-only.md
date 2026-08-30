---
id: theme-tokens-only
title: All colors and spacing come from src/theme.ts — no literals in components
type: convention
status: current
tags: [styling, theme]
sources: [ai/tasks/1/implementation-log-step-1.md, ai/tasks/2/implementation-log-step-2.md]
last_verified: 2026-08-30
verify: test -z "$(grep -rn '#[0-9a-fA-F]\{3,8\}' src --include='*.ts' --include='*.tsx' | grep -v src/theme.ts)"
related: [queries-go-through-a11y-labels]
---

[src/theme.ts](../../../src/theme.ts) exports three token objects and is the only file in `src/`
containing a color literal:

- `colors` — `background`, `surface`, `border`, `text`, `textMuted`, `accent`, `accentDisabled`, `onAccent`, `error`
- `spacing` — `xs: 4`, `sm: 8`, `md: 12`, `lg: 16`, `xl: 24`
- `radius` — `sm: 8`, `md: 12`

**Why it matters:** it is what makes a future dark mode or restyle a one-file change, and it keeps
the app visually consistent without anyone policing it by eye.

**What to do:** need a shade or a gap that has no token? Add the token to `theme.ts` rather than
inlining the value — that is how `error` arrived in step 2, when the sign-in screen became the
first place in the app that renders a failure message. The `verify:` command greps `src/` for hex literals outside `theme.ts` and
fails if one appears.
