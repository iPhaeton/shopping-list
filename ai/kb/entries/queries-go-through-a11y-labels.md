---
id: queries-go-through-a11y-labels
title: Interactive components are queried by a11y label; static copy is queried by its text
type: convention
status: current
tags: [testing, accessibility, components]
sources: [ai/tasks/1/implementation-log-step-1.md, ai/tasks/2/implementation-log-step-2.md, ai/tasks/3/implementation-log-step-1.md, ai/tasks/4-offline-support/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-2.md, ai/tasks/9-deletion/implementation-log-step-1.md, ai/tasks/11-pagination/implementation-log-step-2.md, ai/tasks/13-google-sign-in/implementation-log-step-2.md, ai/tasks/14-account-screen/implementation-log-step-1.md, ai/tasks/16-sync-banner-flicker/implementation-log-step-1.md, ai/tasks/17-user-names/implementation-log-step-1.md, ai/tasks/18-share-by-name/implementation-log-step-1.md, ai/tasks/19-remove-oneself/implementation-log-step-1.md, ai/tasks/19-remove-oneself/implementation-log-step-3.md, ai/tasks/20-ux/implementation-log-step-1.md, ai/tasks/20-ux/implementation-log-step-2.md, ai/tasks/20-ux/implementation-log-step-3.md, ai/tasks/20-ux/implementation-log-step-4.md, ai/tasks/20-ux/implementation-log-step-5.md, ai/tasks/20-ux/implementation-log-step-6.md, ai/tasks/23-list-limits/implementation-log-step-1.md, ai/tasks/23-list-limits/implementation-log-step-2.md, 6ef87a2, d81a5ef, 3320eee]
last_verified: 2026-10-01
verify: for f in $(grep -rl '<Pressable' src --include='*.tsx' | grep -v '\.test\.'); do grep -q accessibilityRole "$f" && grep -q accessibilityLabel "$f" || exit 1; done; grep -q 'checked: done, disabled: !editable || deleted' src/components/ItemRow.tsx && grep -q 'label="Back"' src/screens/ListDetailScreen.tsx && grep -q 'label="Share list"' src/screens/ListDetailScreen.tsx && grep -q 'accessibilityRole="header"' src/screens/ListDetailScreen.tsx && grep -q 'accessibilityRole="alert"' src/components/ErrorBanner.tsx && grep -q 'Loading your lists' src/screens/ListsScreen.tsx && grep -q 'Loading who has access' src/screens/SharingScreen.tsx && grep -q "will sync when you're back online" src/components/SyncBanner.tsx && grep -q 'shared with you' src/components/ListRow.tsx && grep -q 'Show 1 deleted' src/components/ShowDeletedToggle.tsx && grep -q 'accessibilityRole="switch"' src/components/ShowDeletedToggle.tsx && grep -q 'Restore it and keep your change?' src/components/BlockedBanner.tsx && grep -q "'Restore' : 'Delete'" src/components/ItemRow.tsx && grep -q "'Restore' : 'Delete'" src/components/ListRow.tsx && grep -qF 'label={`Remove ${displayNameFor(member)}`}' src/screens/SharingScreen.tsx && grep -q 'onPress={() => setConfirmingRemoveUserId(member.userId)}' src/screens/SharingScreen.tsx && ! grep -q 'onPress={() => void run(() => removeMember(listId, member.userId))}' src/screens/SharingScreen.tsx && grep -q 'label="Leave list"' src/screens/SharingScreen.tsx && grep -q "'Confirm leave list'," src/screens/SharingScreen.tsx && grep -qF '`Confirm remove ${displayNameFor(member)}`,' src/screens/SharingScreen.tsx && grep -A1 '{selected ? (' src/screens/SharingScreen.tsx | grep -q 'styles.invitePicker' && grep -q 'buttonLabel="Share"' src/components/UserAutocomplete.tsx && grep -q 'canSubmit={canShare}' src/components/UserAutocomplete.tsx && grep -q 'accessibilityState={{ disabled: !canSubmit }}' src/components/AddBar.tsx && grep -q 'accessibilityLabel = placeholder' src/components/AddBar.tsx && grep -q 'label="Back"' src/screens/SharingScreen.tsx && ! grep -q 'Invite someone' src/screens/SharingScreen.tsx && grep -q '{member.role}</Text>' src/screens/SharingScreen.tsx && grep -q "textTransform: 'capitalize'" src/screens/SharingScreen.tsx && grep -q 'label="Edit name"' src/screens/AccountScreen.tsx && grep -q 'labelFor={appearanceLabel}' src/screens/AccountScreen.tsx && grep -q 'accessibilityLabel="Your name"' src/screens/SetNameScreen.tsx && grep -q 'accessibilityLabel="Name"' src/components/UserAutocomplete.tsx && grep -qF 'accessibilityLabel={`Share with ${user.name}`}' src/components/UserAutocomplete.tsx && grep -q 'accessibilityState={{ checked, disabled }}' src/components/SegmentedPicker.tsx && grep -q 'accessibilityState={{ disabled }}' src/components/PillButton.tsx && grep -q 'accessibilityState={{ disabled }}' src/components/IconButton.tsx && grep -q 'label="Back"' src/components/ScreenHeader.tsx && grep -q 'accessibilityRole="header"' src/components/ScreenHeader.tsx && grep -q 'accessibilityRole="header"' src/components/AuthFrame.tsx && grep -q 'accessibilityLabel="Loading more lists"' src/screens/ListsScreen.tsx && grep -q 'accessibilityLabel="Loading list"' src/screens/ListDetailScreen.tsx && grep -qF 'Show ${count}+ deleted' src/components/ShowDeletedToggle.tsx && grep -q 'lists. Delete one or hand one over to make room.' src/lib/limits.ts && grep -q 'lists. Delete or leave one to make room.' src/lib/limits.ts && grep -q 'items at most.' src/lib/limits.ts && grep -q 'You own 100 lists. Delete one or hand one over to make room.' src/lib/listsApi.test.ts
related: [rntl-14-api-changes, theme-tokens-only, first-fetch-replaces-list-state, screens-take-navigation-props, writes-retry-from-an-outbox, deletion-is-a-tombstone, sync-banner-mount-is-unconditional, maestro-drives-the-native-ui, recycled-text-input-keeps-letter-spacing]
---

Every **interactive** element is reached through its accessibility props, so those props are
load-bearing, not decoration. Since task 20 step 5 almost every control is a `PillButton`,
`IconButton`, `TextField` or `SegmentedPicker`, so a label usually appears in source as a `label=` or
`accessibilityLabel=` prop at the call site, not on a `Pressable`:

| component | props |
|---|---|
| [ListRow](../../../src/components/ListRow.tsx) | `accessibilityRole="button"`, label is `list.name` — plus `, shared with you` when `list.role !== 'owner'`; no count or summary text since step 11 stopped fetching items with lists |
| [ItemRow](../../../src/components/ItemRow.tsx) | `accessibilityRole="checkbox"`, `accessibilityState={{ checked: done, disabled: !editable \|\| deleted }}` where `done` is `item.doneAt !== null`, label is the item title; icon buttons `` `Rename ${item.title}` `` and the flipping delete/restore below; a binned row also shows a plain `Deleted` tag, asserted with `getByText('Deleted')` |
| [AddBar](../../../src/components/AddBar.tsx) | label on the input is its `placeholder` unless the caller passes `accessibilityLabel` (Sharing's `"Name"`); the button has `accessibilityRole="button"` and `accessibilityState={{ disabled: !canSubmit }}`; with `onCancel`, a `"Cancel"` button too — `ItemRow`'s rename editor is an `AddBar` labelled `"Item name"` / `"Save"` / `"Cancel"` |
| [TextField](../../../src/components/TextField.tsx) | passes `accessibilityLabel` straight through. Every form field but an `AddBar`'s is one, and its label is never its placeholder: `"Email address"` shows `you@example.com` |
| [SignInScreen](../../../src/screens/SignInScreen.tsx) | inputs `"Email address"` / `"Six-digit code"`; buttons `"Send code"`, `"Sign in"`, `"Resend code"`, `"Use a different email"`, `"Continue with Google"` (native only, hidden on web), each with `{ disabled }` where it can be disabled. Above the card, `ShoppingLoop` is a `header` ([AuthFrame](../../../src/components/AuthFrame.tsx), on Set name too): `getByRole('header', { name: 'ShoppingLoop' })` |
| [SetNameScreen](../../../src/screens/SetNameScreen.tsx) | input `"Your name"`; button `"Continue"`, `{ disabled }` until the trimmed name has 3 characters, the database's own floor — the blocking name gate, since step 17 |
| [AccountScreen](../../../src/screens/AccountScreen.tsx) | the drawn `"Back"` and an `"Account"` header ([ScreenHeader](../../../src/components/ScreenHeader.tsx)); `"Sign out"` with `{ disabled: pending }`; `"Sign out of all devices"` reveals a confirm row instead of firing — `"Cancel"` plus a fixed `"Confirm sign out of all devices"` label whose visible text toggles `"Yes, sign out everywhere"` / `"Signing out…"`; email is plain static text; `"Edit name"` (reads `Edit`), disabled until a name is confirmed, reveals a `"Your name"` input plus `"Save name"` / `"Cancel editing name"` (reads `Cancel`); the Appearance radios are `"Day"`, `"Night"`, `"Auto"`, and Auto's hint (`Night from 6:25 PM`) is plain text asserted by pattern — `/^Night from \d/` — because its time depends on the clock and the locale |
| [PillButton](../../../src/components/PillButton.tsx) | label passed in, `accessibilityState={{ disabled }}`; visible text is `visibleLabel`, defaulting to the label — `ListDetail`'s `"Rename list"` and `"Share list"` read `Rename`/`Share`, so `getByText('Share')` is not how to find them. `size`, `variant` (`outline`/`filled`/`danger`), `tone` and `icon` change looks only, never the name — the G is not part of `"Continue with Google"` |
| [IconButton](../../../src/components/IconButton.tsx) | label passed in, no text, `accessibilityState={{ disabled }}` — every drawn `"Back"` (List detail's and Sharing's own, `ScreenHeader`'s on Account), Sharing's trash, and the row actions |
| [SegmentedPicker](../../../src/components/SegmentedPicker.tsx) | one `accessibilityRole="radio"` pressable per option with `accessibilityState={{ checked, disabled }}`; the label comes from a `labelFor` prop so two pickers on one screen never collide. [RolePicker](../../../src/components/RolePicker.tsx) is a thin wrapper over it — `"Share as reader"` in Sharing's header, `"Set bob@example.com to writer"` on a member row; `AccountScreen`'s Appearance picker is the other user. `track`/`size` are looks only |
| [SharingScreen](../../../src/screens/SharingScreen.tsx) | the drawn `"Back"` and a `"Sharing"` header, on the `List not found` state too; header `People with access`; spinner `"Loading who has access"`. The invite bar (owners only) is a [UserAutocomplete](../../../src/components/UserAutocomplete.tsx) — an `AddBar` whose input is `"Name"` and button `"Share"`, each suggestion `` `Share with ${user.name}` ``. **`"Share"` is always there, `{ disabled }` until a suggestion is picked; the `Share as …` radios are absent until then** (since task 20 step 6 — before, typing was enough), so a test picks before looking for them; the picked role survives them hiding. An owner's rows carry a trash `IconButton` `` `Remove ${displayNameFor(member)}` `` (email pre-gate, since step 17), a reader/writer's own row an outlined `"Leave list"` pill; each opens a confirm row with a shared `"Cancel"` and a fixed `"Confirm leave list"` / `` `Confirm remove ${displayNameFor(member)}` `` label whose visible text toggles `Leave list`/`Leaving…` or `Remove`/`Removing…`. Only one confirm is open at a time. A role change stays a plain, unconfirmed tap |
| Sharing's role badge | what a non-owner sees on other members' rows: a `Text` holding the role **lowercase**, as the database names it, drawn capitalized by `textTransform`. RNTL reads the content, so `getByText('reader')` — `getByText('Reader')` finds nothing |
| [ListDetailScreen](../../../src/screens/ListDetailScreen.tsx) title and rename bar | the list name is a `Text` with `accessibilityRole="header"`, found by `getByRole('header', { name })`; the rename bar replaces it in place — an `AddBar` with placeholder/label `"List name"` and button `"Save"` |
| spinners | an `ActivityIndicator` has no text, so each carries a label to be assertable at all: [ListsScreen](../../../src/screens/ListsScreen.tsx)'s `"Loading your lists"`, and `"Loading more lists"` in its footer while a page is in flight; List detail's `"Loading list items"`, and `"Loading list"` while a list missing from state is read by id (task 23). List detail says `List not found` only after that read, so a test reaches it with `findByText` |
| [ShowDeletedToggle](../../../src/components/ShowDeletedToggle.tsx) | `accessibilityRole="switch"` since task 20 step 3 (was `"checkbox"`; `toBeChecked()` supports both) with `{ checked }`; the label **is** the visible text and counts — `"Show 1 deleted"`, `"Show 2 deleted"`, and `"Show 100+ deleted"` while that bin has pages not yet loaded (`more`) |
| [BlockedBanner](../../../src/components/BlockedBanner.tsx) | `accessibilityRole="alert"` on the view, plus two buttons labelled `"Restore and keep my change"` and `"Discard my change"` — note the second's label is not its visible text, which reads just `Discard` |
| the delete/restore action on a row | `` `${deleted ? 'Restore' : 'Delete'} ${item.title}` `` in `ItemRow`, the same over `list.name` in `ListRow` — so `"Delete Milk"` becomes `"Restore Milk"` when it is in the bin |

**Match the label the component renders today, not this entry's history.** `ListRow`'s label was
once composed with an item count (`"Groceries, 1 of 3 done"`) until step 11 dropped it. A query
against a stale string does not fail loudly: it just finds nothing.

**A label that names a row's subject is the escape hatch when one screen renders many of the same
control.** `RolePicker`'s `labelFor` exists because the sharing screen has one picker per member plus
the invite one, and `getByLabelText('Writer')` would match four things. Take the same route
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
`getByText('List not found')` — as they do `ListRow`'s `Shared with you · can edit` /
`Shared with you · view only` subtitle and the sign-in screen's `You were signed out on another
device.` So user-facing copy is load-bearing too: rewording it is a test change, not a cosmetic one.
Do not "fix" `EmptyState` by adding a label to it; nothing queries it that way.

**Step 7 added more sentences to that load-bearing set**, asserted verbatim by the screen suites:
`Read only — you can see this list but not change it.`, `Nobody has added anything yet.` (the empty
state's *hint* for a reader; its title stays `Nothing on this list`),
`Only an owner can change who has access.`, `A list must keep at least one owner.`,
`You need a connection to change who has access.`, and `You have read-only access to this list.`
The last-owner hint deliberately mirrors what the `keep_last_owner` trigger raises, so the disabled
control and the database's own refusal read as one rule rather than two; the read-only line and
`useListWrites`' `You have read-only access to this list.` guard are the same pairing. Change one
half and change the other.

**Step 9 added four more load-bearing sentences and one label that changes with state.** The banner
copy is asserted verbatim — `That list is in the bin. Restore it and keep your change?` and its item
twin, plus the binned-list screen's `This list is in the bin. Restoring it brings back everything
except the items you deleted separately…`, which exists because restoring a list does **not** restore
its items ([deletion-is-a-tombstone](deletion-is-a-tombstone.md)). `ShowDeletedToggle`'s label
carries the **count** — the opposite of the resend button's fixed label, and right for the same
reason: the number is the information. And the delete/restore action flips its whole label rather
than its state, so `queryByLabelText('Delete Milk')` returning nothing is a real assertion.

**Task 23 step 2 added the three limit sentences, and one bar that disappears.** At a list limit
`ListsScreen` renders no `"New list name"` bar at all: a plain `Text` in its place reads `You own 100
lists. Delete one or hand one over to make room.` or `You're on 1,000 lists. Delete or leave one to
make room.`, and a refused add banners `This list is full: 1,000 items at most.` Suites import them
from `src/lib/limits.ts`, never from the mocked `listsApi`
([supabase-client-module-boundary](supabase-client-module-boundary.md)); `listsApi.test.ts` and
`ListsScreen.test.tsx` also pin them word for word. Sharing shows the database's own words
(`they already own 100 lists`).

**In the browser, screen-level chrome appears twice.** React Navigation keeps the screen underneath
mounted, so a Playwright run on List detail finds *two* sync banners in the DOM — only one visible.
That is the navigator working: filter by visibility or take `.last()`. Maestro sees the same thing on
native ([maestro-drives-the-native-ui](maestro-drives-the-native-ui.md)); RNTL renders one screen.

**What to do:** give new interactive components a role, a label, and — if they have on/off state —
an `accessibilityState`. A control that is merely *unavailable* keeps its role and label and gains
`disabled` — `ItemRow` stays a labelled checkbox for a reader, because whether an item is done is
information they want.

**The `verify:` command sweeps rather than naming files.** It requires an `accessibilityRole` and an
`accessibilityLabel` in every non-test `.tsx` under `src/` containing a `<Pressable`. Beside the
sweep it pins the labels and copy named above, `PillButton`'s and `IconButton`'s disabled state, the
drawn headers' roles, Remove opening a confirm rather than firing, the invite radios' gate on a
pick with `Share` in the bar, the lowercase badge, task 23's two spinners and the toggle's `+`, and
the three limit sentences.
