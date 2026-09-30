---
id: component-suite-earned-by-owned-logic
title: A component gets its own test suite only once it owns real logic — every other component is tested through its screen
type: convention
status: current
tags: [testing, components, architecture]
sources: [ai/tasks/18-share-by-name/implementation-log-step-1.md, ai/tasks/20-ux/implementation-log-step-1.md, ai/tasks/20-ux/implementation-log-step-3.md, ai/tasks/20-ux/implementation-log-step-4.md, ai/tasks/20-ux/implementation-log-step-5.md, src/components/UserAutocomplete.tsx, src/components/UserAutocomplete.test.tsx]
last_verified: 2026-09-30
verify: test "$(ls src/components/*.test.tsx 2>/dev/null | wc -l | tr -d ' ')" = 1 && test -f src/components/UserAutocomplete.test.tsx && grep -q 'setTimeout' src/components/UserAutocomplete.tsx && grep -q 'useFakeTimers' src/components/UserAutocomplete.test.tsx
related: [rntl-14-api-changes, queries-go-through-a11y-labels, supabase-client-module-boundary]
indexed: false
---

Every component under [src/components/](../../../src/components/) — `ItemRow`, `ListRow`,
`RolePicker`, `SegmentedPicker`, `AddBar`, `ShowDeletedToggle`, `BlockedBanner`,
`SyncBanner`, `EmptyState`, `ErrorBanner`; since task 20 steps 3–4 `Band`, `Horizon`, `IconButton`,
`PillButton`, `Sky`, `Hillside` and `icons.tsx`'s icon set; and since step 5 `AuthFrame`, `Avatar`,
`Backdrop`, `Card`, `HorizonFooter`, `Landscape`, `ScreenHeader` and `TextField` — is exercised only
through the screen that renders it; none has its own `.test.tsx`. [UserAutocomplete](../../../src/components/UserAutocomplete.tsx),
added in step 18, is the first and only exception, and the reason is not "it's new" — it's that it owns
logic none of the others do: a debounce timer, a fetch, and an in-flight-response race (`cancelled`) that a screen-level test
would have to reach through two layers of indirection and fake timers to exercise at all. Step 3's
six new components are purely presentational (colors and geometry from props and theme tokens),
which is why none of them earned a suite either, despite being the single biggest batch of new
components any step has added — the logic worth testing there (contrast, band color) lives in
[src/state/bands.ts](../../../src/state/bands.ts) instead, which has its own
`src/state/bands.test.ts`. Step 5's contrast rules went the same way, into `src/theme.test.ts`.
The one step-5 piece with state of its own, the `useKeyboardReveal` hook (keyboard events plus a
scroll offset), has no suite either: it was checked only on the iPhone 17e simulator, with the
keyboard up on every form.

**The line is "does this component own async logic of its own," not "is it new" or "is it complex
to render."** `RolePicker` has real branching (three roles, a `labelFor` prop, disabled state) but
zero logic — every output is a pure function of its props — so `SharingScreen.test.tsx` covers it
completely by asserting what's on screen after a tap. `UserAutocomplete` cannot be covered that way:
proving the debounce fires once per pause, that a stale in-flight response is discarded when a newer
query supersedes it, and that `selected` clears the suggestion list, all need the fake-timer and
promise-ordering control a component-level suite gives you room to exercise precisely, without
`SharingScreen`'s other state (roster, roles, pending writes) as noise around every assertion.

**What to do:** a new component earns its own suite only when it owns a timer, a fetch, or comparable
async state — not for having more props or more render branches than its siblings. Reach for it, and
put the suite beside the component (`Component.test.tsx`), mocking the query module one layer down
exactly as a screen suite would
([supabase-client-module-boundary](supabase-client-module-boundary.md)). A purely presentational
component stays covered by its screen; giving it a redundant suite doubles the maintenance cost of a
label or copy change for no new coverage.
