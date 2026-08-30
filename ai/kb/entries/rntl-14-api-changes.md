---
id: rntl-14-api-changes
title: RNTL 14 made render/fireEvent/unmount async and removed toHaveAccessibilityState
type: gotcha
status: current
tags: [testing, rntl]
sources: [ai/tasks/1/implementation-log-step-1.md, ai/tasks/2/implementation-log-step-2.md]
last_verified: 2026-08-30
verify: grep -q '"@testing-library/react-native": "\^14' package.json
related: [queries-go-through-a11y-labels, screens-take-navigation-props, supabase-client-module-boundary]
---

React Native Testing Library 14 changed two things that break tests written from memory:

**1. `render`, `fireEvent.press`, `fireEvent.changeText` — and `unmount` — are `async` and must be
awaited.** Forgetting produces a misleading failure:

```
`render` function has not been called
```

`render()` *had* been called — it returns a Promise, so the `screen` singleton was still unpopulated
when the assertions ran. This cost a full debugging cycle in step 1; the component test files carry
a header comment so it does not recur. `unmount` bites the same way and is easier to miss, because
it fails as a *wrong assertion* rather than an error: step 2's unsubscribe-on-unmount test saw zero
calls until it became `await screen.unmount()`.

**2. `toHaveAccessibilityState` was removed.** Use `toBeChecked()` / `not.toBeChecked()`.

**A third trap, React's rather than RNTL's: a state change pushed in from outside React needs
`act`.** A test that invokes a captured callback directly — Supabase's `onAuthStateChange`
subscriber, say — updates the provider without RNTL knowing, and prints
`An update to SessionProvider inside a test was not wrapped in act(...)`. Awaiting the assertion
with `findBy*` does not settle it; wrap the trigger instead:
`await act(async () => emitAuthChange(session))`. Anything RNTL itself drives (`fireEvent`) is
already wrapped, which is why this only shows up for callbacks the test holds.

**What to do:** `await` every `render`, `fireEvent` and `unmount` call. Retire this entry if the
project ever moves off RNTL 14 — the `verify:` command pins the major version — but note that the
`act` point is React's behaviour and outlives it.
