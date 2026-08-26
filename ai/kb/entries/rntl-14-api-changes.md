---
id: rntl-14-api-changes
title: RNTL 14 made render/fireEvent async and removed toHaveAccessibilityState
type: gotcha
status: current
tags: [testing, rntl]
sources: [ai/tasks/1/implementation-log-step-1.md]
last_verified: 2026-08-26
verify: grep -q '"@testing-library/react-native": "\^14' package.json
related: [queries-go-through-a11y-labels, screens-take-navigation-props]
---

React Native Testing Library 14 changed two things that break tests written from memory:

**1. `render`, `fireEvent.press`, and `fireEvent.changeText` are `async` and must be awaited.**
Forgetting produces a misleading failure:

```
`render` function has not been called
```

`render()` *had* been called — it returns a Promise, so the `screen` singleton was still unpopulated
when the assertions ran. This cost a full debugging cycle in step 1; both component test files carry
a header comment so it does not recur.

**2. `toHaveAccessibilityState` was removed.** Use `toBeChecked()` / `not.toBeChecked()`.

**What to do:** `await` every `render` and `fireEvent` call. Retire this entry if the project ever
moves off RNTL 14 — the `verify:` command pins the major version.
