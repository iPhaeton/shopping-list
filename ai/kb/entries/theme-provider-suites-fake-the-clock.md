---
id: theme-provider-suites-fake-the-clock
title: Auto is the default, so a suite that renders ThemeProvider depends on the time of day unless it fakes the clock and mocks deviceTimeZone
type: gotcha
status: current
tags: [testing, jest, theme, time]
sources: [ai/tasks/20-ux/implementation-log-step-2.md]
last_verified: 2026-10-05
verify: for f in $(grep -rl '<ThemeProvider' src --include='*.test.tsx'); do grep -qE "jest.mock\('[./]+/lib/deviceTimeZone'" "$f" && grep -q 'useFakeTimers({ now:' "$f" || exit 1; done; grep -A7 'createContext<ThemeContextValue>' src/state/ThemeContext.tsx | grep -q "preference: 'day'" && grep -A7 'createContext<ThemeContextValue>' src/state/ThemeContext.tsx | grep -q 'nextChange: null'
related: [auto-theme-follows-the-time-zone, theme-tokens-only, rntl-14-api-changes, component-suite-earned-by-owned-logic]
indexed: false
---

Since task 20 step 2, a device that never chose a theme gets **Auto**, which resolves from
`new Date()` and the zone `Intl` reports
([auto-theme-follows-the-time-zone](auto-theme-follows-the-time-zone.md)). A suite that mounts
`ThemeProvider` over empty AsyncStorage therefore paints Day at noon and Night at 21:00, in
whatever zone the machine running jest is in — green at your desk, red in the evening.

**In any suite that renders `ThemeProvider`:**

- `jest.mock('../lib/deviceTimeZone', () => ({ deviceTimeZone: jest.fn() }))`, and set a zone in
  `beforeEach` (`jest.mocked(deviceTimeZone).mockReturnValue('Europe/Warsaw')`).
- `jest.useFakeTimers({ now: <a fixed instant> })` in `beforeEach`, `jest.useRealTimers()` after.
- Copy [ThemeContext.test.tsx](../../../src/state/ThemeContext.test.tsx) or the appearance
  `describe` in [AccountScreen.test.tsx](../../../src/screens/AccountScreen.test.tsx) — the only two
  today. The `verify:` fails on a `<ThemeProvider` suite that skips either.
- Prove it by re-running under another zone and locale — the theme suites pass with `TZ` set to
  `Pacific/Auckland`, `America/Los_Angeles`, `UTC`, or `Asia/Kolkata`, and `LANG=pl_PL.UTF-8`.

**Suites without a provider are safe, and must stay safe.** The `ThemeContext` default value is a
fixed Day — `preference: 'day'`, `nextChange: null` — not the provider's Auto. Every screen and
component suite renders through that default. Making it Auto "for consistency" would put every one
of them on the clock; the `verify:` pins it.

**Advance the fake clock in `act`-sized steps, never one long jump.** `ThemeProvider` arms its next
timer in an effect, and an effect runs only when `act` flushes. A single
`advanceTimersByTime(8 hours)` fires the first timer (capped at an hour), queues the state update,
then runs the remaining hours with nothing armed, so the flip at sunrise never comes.
`letTimePass` in `ThemeContext.test.tsx` steps ten minutes per `act`. The same holds for any timer
armed in an effect.
