---
id: queries-go-through-a11y-labels
title: Interactive components are queried by a11y label; static copy is queried by its text
type: convention
status: current
tags: [testing, accessibility, components]
sources: [ai/tasks/1/implementation-log-step-1.md, ai/tasks/2/implementation-log-step-2.md, ai/tasks/3/implementation-log-step-1.md, ai/tasks/4-offline-support/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-2.md, 6ef87a2]
last_verified: 2026-09-08
verify: for f in $(grep -rl '<Pressable' src --include='*.tsx' | grep -v '\.test\.'); do grep -q accessibilityRole "$f" && grep -q accessibilityLabel "$f" || exit 1; done; grep -q 'checked: done, disabled: !editable' src/components/ItemRow.tsx && grep -q 'accessibilityRole="alert"' src/components/ErrorBanner.tsx && grep -q 'Loading your lists' src/screens/ListsScreen.tsx && grep -q 'Loading who has access' src/screens/SharingScreen.tsx && grep -q "will sync when you're back online" src/components/SyncBanner.tsx && grep -q 'shared with you' src/components/ListRow.tsx
related: [rntl-14-api-changes, theme-tokens-only, first-fetch-replaces-list-state, screens-take-navigation-props, writes-retry-from-an-outbox]
---

Every **interactive** element is reached through its accessibility props, so those props are
load-bearing, not decoration:

| component | props |
|---|---|
| [ListRow](../../../src/components/ListRow.tsx) | `accessibilityRole="button"`, label is the composed `` `${list.name}, ${summary}` `` — plus `, shared with you` when `list.role !== 'owner'` |
| [ItemRow](../../../src/components/ItemRow.tsx) | `accessibilityRole="checkbox"`, `accessibilityState={{ checked: done, disabled: !editable }}` where `done` is `item.doneAt !== null`, label is the item title |
| [AddBar](../../../src/components/AddBar.tsx) | label on the input is its `placeholder`; the button has `accessibilityRole="button"` and `accessibilityState={{ disabled: !canSubmit }}` |
| [SignInScreen](../../../src/screens/SignInScreen.tsx) | inputs labelled `"Email address"` / `"Six-digit code"`; buttons `"Send code"`, `"Sign in"`, `"Resend code"`, `"Use a different email"`, each with `accessibilityState={{ disabled }}` where it can be disabled |
| [SignOutButton](../../../src/components/SignOutButton.tsx) | `accessibilityRole="button"`, label `"Sign out"`, `accessibilityState={{ disabled: pending }}` |
| [HeaderButton](../../../src/components/HeaderButton.tsx) | same shape, label passed in — `"Rename list"` (owners) and `"Share list"` (every member) on `ListDetail` |
| [RolePicker](../../../src/components/RolePicker.tsx) | three `accessibilityRole="radio"` pressables with `accessibilityState={{ checked }}`; the label comes from a `labelFor` prop so two pickers on one screen never collide — `"Share as reader"` in the invite form, `"Set bob@example.com to writer"` on a member row |
| [SharingScreen](../../../src/screens/SharingScreen.tsx) | invite input `"Email address"`, buttons `"Share"` and `` `Remove ${email}` `` with `accessibilityState={{ disabled }}`, spinner `"Loading who has access"` |
| [ListDetailScreen](../../../src/screens/ListDetailScreen.tsx) rename bar | an `AddBar` with placeholder/label `"List name"` and button `"Save"` |
| [ListsScreen](../../../src/screens/ListsScreen.tsx) loading spinner | the `ActivityIndicator` carries `accessibilityLabel="Loading your lists"` — an element with no text needs a label to be assertable at all |

**Why it matters:** `ListRow`'s label is *composed* — a test looking for the "Groceries" row asks for
`"Groceries, 1 of 3 done"`, and for a list somebody shared with you,
`"Groceries, 1 of 3 done, shared with you"`. Changing how that summary reads breaks the query, so
change the tests with it. A list you *own* reads exactly as it did before sharing existed, which is
why no pre-step-7 query moved.

**A label that names a row's subject is the escape hatch when one screen renders many of the same
control.** `RolePicker`'s `labelFor` exists because the sharing screen has one picker per member plus
one in the invite form, and `getByLabelText('Writer')` would match four things. Take the same route
before reaching for `getAllBy*` and an index — an index-based query silently follows the wrong row
when the order changes.

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

**Step 7 added seven more sentences to that load-bearing set**, asserted verbatim by the screen
suites: `Read only — you can see this list but not change it.`, `Nobody has added anything yet.`
(the empty state's *hint* for a reader; its title stays `Nothing on this list`),
`Only an owner can change who has access.`, `A list must keep at least one owner.`,
`You need a connection to change who has access.`, `You have read-only access to this list.`, and
`Shared with you`. The last-owner hint deliberately mirrors what the `keep_last_owner` trigger
raises, so the disabled control and the database's own refusal read as one rule rather than two; the
read-only line and `ListsContext`'s `You have read-only access to this list.` guard are the same
pairing. Change one half and change the other.

**In the browser, screen-level chrome appears twice.** React Navigation keeps the `Lists` screen
mounted underneath `ListDetail`, so a Playwright run on the detail screen finds *two* sync banners in
the DOM — only one of them visible. That is the navigator working, not a rendering bug: filter by
visibility or take `.last()` rather than "fixing" the duplicate. RNTL suites never see it, because
they render one screen at a time.

**What to do:** give new interactive components a role, a label, and — if they have on/off state —
an `accessibilityState`. It is what makes them testable and what makes the app usable with a screen
reader, in that order of how often it gets forgotten. A control that is merely *unavailable* keeps
its role and label and gains `disabled` — `ItemRow` stays a labelled checkbox for a reader, because
whether an item is done is information they want.

**The `verify:` command sweeps rather than naming files, and that is a deliberate change.** It finds
every non-test `.tsx` under `src/` containing a `<Pressable` and requires an `accessibilityRole` and
an `accessibilityLabel` in it, so a new interactive component cannot be added without them — the old
command listed five specific files and covered nothing written after it. It also cost something real:
step 7's `HeaderButton` is ten lines identical to `SignOutButton`, and was left duplicated because
the old check grepped `SignOutButton.tsx` by name and only the librarian may edit an entry. **That
constraint is gone** — merging the two is now a free refactor as far as the audit is concerned. The
copy pins beside the sweep are separate and stay: `ErrorBanner`'s alert role, both spinner labels,
`SyncBanner`'s sentence, and `ListRow`'s shared suffix.
