---
id: queries-go-through-a11y-labels
title: Interactive components are queried by a11y label; static copy is queried by its text
type: convention
status: current
tags: [testing, accessibility, components]
sources: [ai/tasks/1/implementation-log-step-1.md, ai/tasks/2/implementation-log-step-2.md, ai/tasks/3/implementation-log-step-1.md, ai/tasks/4-offline-support/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-2.md, ai/tasks/9-deletion/implementation-log-step-1.md, ai/tasks/11-pagination/implementation-log-step-2.md, ai/tasks/13-google-sign-in/implementation-log-step-2.md, ai/tasks/14-account-screen/implementation-log-step-1.md, ai/tasks/16-sync-banner-flicker/implementation-log-step-1.md, ai/tasks/17-user-names/implementation-log-step-1.md, ai/tasks/18-share-by-name/implementation-log-step-1.md, ai/tasks/19-remove-oneself/implementation-log-step-1.md, 6ef87a2, d81a5ef]
last_verified: 2026-09-23
verify: for f in $(grep -rl '<Pressable' src --include='*.tsx' | grep -v '\.test\.'); do grep -q accessibilityRole "$f" && grep -q accessibilityLabel "$f" || exit 1; done; grep -q 'checked: done, disabled: !editable' src/components/ItemRow.tsx && grep -q 'accessibilityRole="alert"' src/components/ErrorBanner.tsx && grep -q 'Loading your lists' src/screens/ListsScreen.tsx && grep -q 'Loading who has access' src/screens/SharingScreen.tsx && grep -q "will sync when you're back online" src/components/SyncBanner.tsx && grep -q 'shared with you' src/components/ListRow.tsx && grep -q 'Show 1 deleted' src/components/ShowDeletedToggle.tsx && grep -q 'Restore it and keep your change?' src/components/BlockedBanner.tsx && grep -q "'Restore' : 'Delete'" src/components/ItemRow.tsx && grep -q "'Restore' : 'Delete'" src/components/ListRow.tsx && grep -q "Remove \${displayNameFor(member)}" src/screens/SharingScreen.tsx && grep -q "accessibilityLabel=\"Edit name\"" src/screens/AccountScreen.tsx && grep -q 'accessibilityLabel="Your name"' src/screens/SetNameScreen.tsx && grep -q 'accessibilityLabel="Name"' src/components/UserAutocomplete.tsx && grep -q 'accessibilityLabel={`Share with \${user.name}`}' src/components/UserAutocomplete.tsx && grep -q 'accessibilityLabel="Leave list"' src/screens/SharingScreen.tsx && grep -q 'accessibilityLabel="Confirm leave list"' src/screens/SharingScreen.tsx
related: [rntl-14-api-changes, theme-tokens-only, first-fetch-replaces-list-state, screens-take-navigation-props, writes-retry-from-an-outbox, deletion-is-a-tombstone, sync-banner-mount-is-unconditional]
---

Every **interactive** element is reached through its accessibility props, so those props are
load-bearing, not decoration:

| component | props |
|---|---|
| [ListRow](../../../src/components/ListRow.tsx) | `accessibilityRole="button"`, label is `list.name` — plus `, shared with you` when `list.role !== 'owner'`; no count or summary text since step 11 stopped fetching items with lists |
| [ItemRow](../../../src/components/ItemRow.tsx) | `accessibilityRole="checkbox"`, `accessibilityState={{ checked: done, disabled: !editable }}` where `done` is `item.doneAt !== null`, label is the item title |
| [AddBar](../../../src/components/AddBar.tsx) | label on the input is its `placeholder`; the button has `accessibilityRole="button"` and `accessibilityState={{ disabled: !canSubmit }}` |
| [SignInScreen](../../../src/screens/SignInScreen.tsx) | inputs labelled `"Email address"` / `"Six-digit code"`; buttons `"Send code"`, `"Sign in"`, `"Resend code"`, `"Use a different email"`, `"Continue with Google"` (native only, hidden on web), each with `accessibilityState={{ disabled }}` where it can be disabled |
| [SetNameScreen](../../../src/screens/SetNameScreen.tsx) | input labelled `"Your name"`; button `"Continue"` with `accessibilityState={{ disabled }}` until non-empty — the blocking name gate, since step 17 |
| [AccountScreen](../../../src/screens/AccountScreen.tsx) | `"Sign out"` — `accessibilityRole="button"`, `accessibilityState={{ disabled: pending }}`; `"Sign out of all devices"` reveals a confirm row instead of firing — `"Cancel"` plus a fixed `"Confirm sign out of all devices"` label whose visible text toggles `"Yes, sign out everywhere"` / `"Signing out…"`; since step 17, email is plain static text (no label needed) and `"Edit name"` — disabled until a name is confirmed — reveals a `"Your name"` input plus `"Save name"`/`"Cancel editing name"` |
| [HeaderButton](../../../src/components/HeaderButton.tsx) | same shape, label passed in — `"Rename list"` (owners) and `"Share list"` (every member) on `ListDetail`, `"Account"` on `Lists` |
| [RolePicker](../../../src/components/RolePicker.tsx) | three `accessibilityRole="radio"` pressables with `accessibilityState={{ checked }}`; the label comes from a `labelFor` prop so two pickers on one screen never collide — `"Share as reader"` in the invite form, `"Set bob@example.com to writer"` on a member row |
| [SharingScreen](../../../src/screens/SharingScreen.tsx) | invite input is a [UserAutocomplete](../../../src/components/UserAutocomplete.tsx) labelled `"Name"`, since step 18 — each suggestion `Pressable` is `` `Share with ${user.name}` ``; buttons `"Share"` and `` `Remove ${displayNameFor(member)}` `` (falls back to email pre-gate, since step 17) with `accessibilityState={{ disabled }}`, spinner `"Loading who has access"`; since step 19, a reader/writer's own row gets `"Leave list"`, which reveals a fixed `"Confirm leave list"` label whose visible text toggles `"Leave list"`/`"Leaving…"` — same fixed-label-over-toggling-text convention as `AccountScreen`'s sign-out-everywhere confirm |
| [ListDetailScreen](../../../src/screens/ListDetailScreen.tsx) rename bar | an `AddBar` with placeholder/label `"List name"` and button `"Save"` |
| [ListsScreen](../../../src/screens/ListsScreen.tsx) loading spinner | the `ActivityIndicator` carries `accessibilityLabel="Loading your lists"` — an element with no text needs a label to be assertable at all |
| [ShowDeletedToggle](../../../src/components/ShowDeletedToggle.tsx) | `accessibilityRole="checkbox"` with `{ checked }`; the label **is** the visible text and counts — `"Show 1 deleted"`, `"Show 2 deleted"` |
| [BlockedBanner](../../../src/components/BlockedBanner.tsx) | `accessibilityRole="alert"` on the view, plus two buttons labelled `"Restore and keep my change"` and `"Discard my change"` — note the second's label is not its visible text, which reads just `Discard` |
| the delete/restore action on a row | `` `${deleted ? 'Restore' : 'Delete'} ${item.title}` `` in `ItemRow`, the same over `list.name` in `ListRow` — so `"Delete Milk"` becomes `"Restore Milk"` when it is in the bin |

**Why it matters:** `ListRow`'s label used to be *composed* with an item-count summary — a test
looked for `"Groceries, 1 of 3 done"` — until step 11's "Do not fetch items with lists" dropped the
summary along with the eager items fetch it depended on; the label is now just `list.name`, plus
`, shared with you`. A query written against the old composed string does not fail loudly: it just
finds nothing, so match the label the component renders today, not this entry's history.

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
split and that wording are load-bearing; the `verify:` command pins the phrase. Its mount pattern is
a separate, unrelated gotcha —
[sync-banner-mount-is-unconditional](sync-banner-mount-is-unconditional.md).

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

**Step 9 added four more load-bearing sentences and one label that changes with state.** The banner
copy is asserted verbatim — `That list is in the bin. Restore it and keep your change?` and its item
twin, plus the binned-list screen's `This list is in the bin. Restoring it brings back everything
except the items you deleted separately…`, which exists because restoring a list does **not** restore
its items ([deletion-is-a-tombstone](deletion-is-a-tombstone.md)). Two conventions are worth copying
from that work. `ShowDeletedToggle`'s label carries the **count**, which is the opposite of the resend
button's fixed label above and is right for the same reason: here the number is the information, so a
test asking for `"Show 1 deleted"` is asserting that exactly one thing is in the bin. And the
delete/restore action flips its whole label rather than its state, so `queryByLabelText('Delete
Milk')` returning nothing is a real assertion that the row is binned.

**A disabled control can carry `disabled` on the `Pressable` without saying so in
`accessibilityState`, and RNTL's `toBeDisabled()` still passes.** `ItemRow` keeps
`accessibilityState={{ checked: done, disabled: !editable }}` while the Pressable is
`disabled={!editable || deleted}` — a binned item's checkbox is genuinely untappable and the matcher
reads the prop. Worth knowing before "fixing" the apparent mismatch: the state object is what a
*reader*'s read-only case is asserted through, and widening it there would change what those tests
mean.

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
command listed five specific files and covered nothing written after it. **Step 14 finished the merge
this paragraph used to wait on:** `SignOutButton` is gone, folded straight into `AccountScreen`'s own
"Sign out" button, and `HeaderButton` now also carries the `Lists` header's "Account" entry point. The
copy pins beside the sweep are separate and stay: `ErrorBanner`'s alert role, both spinner labels,
`SyncBanner`'s sentence, `ListRow`'s shared suffix, the toggle's `Show 1 deleted`, the blocked
banner's question, and the flipping `Restore`/`Delete` label on both row components.
