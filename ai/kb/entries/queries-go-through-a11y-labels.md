---
id: queries-go-through-a11y-labels
title: Interactive components are queried by a11y label; static copy is queried by its text
type: convention
status: current
tags: [testing, accessibility, components]
sources: [ai/tasks/1/implementation-log-step-1.md, ai/tasks/2/implementation-log-step-2.md, ai/tasks/3/implementation-log-step-1.md, ai/tasks/4-offline-support/implementation-log-step-1.md, 6ef87a2]
last_verified: 2026-09-01
verify: grep -q accessibilityLabel src/components/ListRow.tsx && grep -q accessibilityLabel src/components/ItemRow.tsx && grep -q accessibilityLabel src/components/AddBar.tsx && grep -q accessibilityState src/components/ItemRow.tsx && grep -q accessibilityLabel src/components/SignOutButton.tsx && grep -q accessibilityLabel src/screens/SignInScreen.tsx && grep -q 'accessibilityRole="alert"' src/components/ErrorBanner.tsx && grep -q 'Loading your lists' src/screens/ListsScreen.tsx && grep -q "will sync when you're back online" src/components/SyncBanner.tsx
related: [rntl-14-api-changes, theme-tokens-only, first-fetch-replaces-list-state, writes-retry-from-an-outbox]
---

Every **interactive** element is reached through its accessibility props, so those props are
load-bearing, not decoration:

| component | props |
|---|---|
| [ListRow](../../../src/components/ListRow.tsx) | `accessibilityRole="button"`, label is the composed `` `${list.name}, ${summary}` `` |
| [ItemRow](../../../src/components/ItemRow.tsx) | `accessibilityRole="checkbox"`, `accessibilityState={{ checked: done }}` where `done` is `item.doneAt !== null`, label is the item title |
| [AddBar](../../../src/components/AddBar.tsx) | label on the input is its `placeholder`; the button has `accessibilityRole="button"` and `accessibilityState={{ disabled: !canSubmit }}` |
| [SignInScreen](../../../src/screens/SignInScreen.tsx) | inputs labelled `"Email address"` / `"Six-digit code"`; buttons `"Send code"`, `"Sign in"`, `"Resend code"`, `"Use a different email"`, each with `accessibilityState={{ disabled }}` where it can be disabled |
| [SignOutButton](../../../src/components/SignOutButton.tsx) | `accessibilityRole="button"`, label `"Sign out"`, `accessibilityState={{ disabled: pending }}` |
| [ListsScreen](../../../src/screens/ListsScreen.tsx) loading spinner | the `ActivityIndicator` carries `accessibilityLabel="Loading your lists"` — an element with no text needs a label to be assertable at all |

**Why it matters:** `ListRow`'s label is *composed* — a test looking for the "Groceries" row asks for
`"Groceries, 1 of 3 done"`. Changing how that summary reads breaks the query, so change the tests
with it.

**The inverse is a technique worth copying.** The resend button's visible text counts down
("Resend code in 43s") while its `accessibilityLabel` stays the constant `"Resend code"`, so no test
has to chase a moving string. Give a control whose text is dynamic a fixed label, and reserve
composed labels for cases like `ListRow` where the composition is the information.

**A component that renders arbitrary text gets a role but no label.**
[ErrorBanner](../../../src/components/ErrorBanner.tsx) has `accessibilityRole="alert"` and nothing
else: the message comes from the database, so tests assert the string they arranged to fail with
(`findByText('permission denied')`). Labelling it would hide the only content worth asserting.

**[SyncBanner](../../../src/components/SyncBanner.tsx) is the same case with a count in it.** It
carries `accessibilityLiveRegion="polite"` and no label, and three suites assert its sentence
verbatim — `"1 change will sync when you're back online"`, `"2 changes …"`. The singular/plural
split and that wording are load-bearing; the `verify:` command pins the phrase.

**Static copy is queried by its visible text instead.**
[EmptyState](../../../src/components/EmptyState.tsx) carries no accessibility props at all, and the
tests assert its strings verbatim — `getByText('No lists yet')`, `getByText('Nothing on this list')`,
`getByText('List not found')` — as they do for the `ListRow` name and summary Texts
(`getByText('No items yet')`). So the user-facing copy in `EmptyState` call sites is load-bearing
too: rewording an empty state is a test change, not a cosmetic one. Do not "fix" `EmptyState` by
adding a label to it; nothing queries it that way.

**In the browser, screen-level chrome appears twice.** React Navigation keeps the `Lists` screen
mounted underneath `ListDetail`, so a Playwright run on the detail screen finds *two* sync banners in
the DOM — only one of them visible. That is the navigator working, not a rendering bug: filter by
visibility or take `.last()` rather than "fixing" the duplicate. RNTL suites never see it, because
they render one screen at a time.

**What to do:** give new interactive components a role, a label, and — if they have on/off state —
an `accessibilityState`. It is what makes them testable and what makes the app usable with a screen
reader, in that order of how often it gets forgotten.
