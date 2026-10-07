# Step 2 — Mockups for invitations, notifications and blocking

The user's requests and the settled decisions D1–D8 are in
[description-step-1.md](description-step-1.md). Read that first.

**This step does not depend on step 1** and may land first. It changes no app code. Steps 3 and 4
build to its images, and take every visible string and a11y label from its log.

## Why first

[phone-is-the-product](../../kb/entries/phone-is-the-product.md): the mockups in `ai/ux/primary/` are
the design, rendered by [ai/ux/source/](../../ux/source/README.md) and never hand-edited. This task
adds two screens, a header, an Account card and a Sharing section.

## Harness work

[mock.js](../../ux/source/mock.js) draws Lists, List detail, Account and Sign in. Add the rest, and
update the harness README's component list and scene keys as you go.

- **Glyphs.** Add `bell` and `person` to `ICON`, drawn in the existing style: 24 viewBox, stroke 2,
  round caps and joins. Step 3 copies these exact paths into
  [icons.tsx](../../../src/components/icons.tsx) as `BellIcon` and `PersonIcon`.
- **The Lists header (D7).** `ListsScreen(s)` today ends its header row with
  `headerButton(s) + PillButton({ label: 'Account' })`. Make it three round `IconButton`s, 12 apart:
  `headerButton(s)`, the bell, the person.
  - The bell takes `IconButton`'s existing `dot` while the scene says something is unread.
  - **`calib-lists` keeps the pill.** It reproduces task 20 step 5's shots. Put the header behind a
    scene key that defaults to round and is set to `pill` only in `calib-lists`.
- **Notifications and Blocked people.** Two new screens on Account's frame: `ScreenHeader` with Back,
  cards on the land, the same landscape at the end. Notifications is a paged list (D8), so draw it as
  Lists draws its rows' land, with the spinner for the next page under the last card.
  - Use components that exist: `Card`, `PillButton` (outline, filled, `tone: 'danger'`, `variant:
    'danger'`), `IconButton`, `EmptyState`, `ErrorBanner`.
  - The avatar is Sharing's `Avatar`. Port it from [Avatar.tsx](../../../src/components/Avatar.tsx)
    if the harness lacks it.
- **Sharing.** The Sharing harness was lost (README). Port `SharingScreen` from
  [SharingScreen.tsx](../../../src/screens/SharingScreen.tsx) and its components, then calibrate it
  the way `calib-lists` and `calib-account` were calibrated:
  - Add `calib-sharing` and `calib-sharing-member` scenes reproducing
    `ai/tasks/20-ux/screenshots/step-6/sharing-{day,night}.png` and `sharing-member-{day,night}.png`.
  - Those shots are 1206×2622, so render at `w=402 h=874`. Take the inset from the shot.
  - Run `offsets.py` against them, and record the per-region offsets in the log and the README's
    Calibration section.
- **Account.** Add the new card to `AccountScreen(s)` behind a scene key, so the existing Account
  scenes render unchanged unless the user asks otherwise.

## The images

Each in day (`-quiet-horizon.png`) and night (`-quiet-horizon-moonlit.png`).

| file stem | state |
|---|---|
| `lists-screen-bin`, `lists-screen-search`, `lists-screen-bin-empty`, `lists-screen-search-resting` | **re-rendered** with the three round buttons and no dot. Request 2 asked for this header, so overwriting these eight files is asked for |
| `lists-screen-unread` | Lists at rest with the bell's dot |
| `notifications-screen` | a mix, newest first: an unread pending invitation; a read pending one; one accepted (`You joined`); one declined; one pending but unavailable; an `accepted your invitation` answer; a `declined your invitation` answer. Two or three unread |
| `notifications-screen-more` | scrolled to the end of the loaded page, with the next page's spinner under the last card (D8) |
| `notifications-screen-block-confirm` | the Block confirm open on a pending invitation |
| `notifications-screen-empty` | no notifications |
| `blocked-people-screen` | three blocked people |
| `blocked-people-screen-more` | scrolled to the end of the loaded page, with the next page's spinner under the last card (D8) |
| `blocked-people-screen-empty` | nobody blocked |
| `account-screen-blocked` | resting Account with the new card |
| `sharing-screen-invited` | an owner's Sharing: two members, then the Invited section with two pending invitations |

**Do not redraw or overwrite** any other mockup:

- the four oldest Lists/List detail records and the pre-deletion Account ones, which the KB lists as
  stale;
- the `account-screen-delete*` and `account-screen-hidden-email` scenes;
- the `sharing-screen-*` images drawn by the lost harness.

Whether the new images supersede any of them is the user's call. Ask.

## What the images must settle

Record each answer in the log, with the user's sign-off.

- **The header fits.** Measure the gap between the title's end and the first button at 390×844, at
  402×874 (iPhone 18 Pro), and at 375×667 (SE). The suggestion estimated ~69 pt at 390.
- **The notification card.**
  - Where the unread dot sits, and that the unread sentence is weight 600.
  - Where the age goes.
  - Decline (outline) and Accept (filled), half-width each, as Sharing's confirm row is.
  - `Block Maya` (`tone: 'danger'`) under them.
  - How a resolved or unavailable card reads: muted, no actions.
  - The answer cards' chevron.
- **Long text.** Use the longest name `set_name` allows and a long list name. The sentence wraps;
  nothing truncates the list name.
- **Where `Blocked people` sits on Notifications.**
  - The screen is paged (D8), so a pill after the last card would be out of reach until every page
    had loaded.
  - Recommended: a small outline pill in the header row, opposite Back. It is there on the empty
    state too.
- **The next page's spinner**, as Lists draws its own: centred under the last card, on the land.
- **The Account card's placement.** Recommended: its own card between Appearance and the sign-out
  card, holding one outline pill. Check the delete confirm's `reveal` still lands with one more card
  above it.
- **The Invited section.**
  - A heading under *People with access*'s cards.
  - Each card: `Avatar`, name, a role badge, the sub-line, and a withdraw `IconButton`
    (`CloseIcon` on `controlFill`, like Remove's trash).
  - The withdraw confirm reuses the remove confirm's form. Confirm with the user that it needs no
    image.
- **AA contrast** in both palettes, against the card fill: the muted states, the meta line, and the
  unread dot.
- **Copy and a11y labels.** The starting table is below. The final one goes in the log, and steps 3
  and 4 assert it verbatim. `Maya` and `Weekend BBQ` stand for any name and list.

  | element | a11y label | visible text |
  |---|---|---|
  | Lists: bell | `Notifications`; value `2 unread` while any are unread, none otherwise | glyph |
  | Lists: account | `Account` (unchanged, so tests and Maestro still find it) | glyph |
  | Notifications title | header role | `Notifications` |
  | pending invitation | — | `Maya invited you to Weekend BBQ` (both names at 600), then `as a writer · 2 h ago` |
  | decline | `Decline invitation to Weekend BBQ` | `Decline`, then `Declining…` |
  | accept | `Accept invitation to Weekend BBQ` | `Accept`, then `Accepting…` |
  | block | `Block Maya` | `Block Maya` |
  | block warning | — | `Maya will be told you declined, and you won't see invitations from them any more. Unblock them any time under Blocked people.` |
  | block cancel / confirm | `Cancel blocking Maya` / `Confirm block Maya` | `Cancel` / `Block`, then `Blocking…` |
  | accepted (to invitee) | `Open Weekend BBQ` | `You joined` and a chevron |
  | declined (to invitee) | — | `Declined` |
  | unavailable | — | `No longer available` |
  | answer: accepted | `Open Weekend BBQ`, only while the list is held | `Maya accepted your invitation to Weekend BBQ` |
  | answer: declined | — | `Maya declined your invitation to Weekend BBQ` |
  | unread marker | settle how a screen reader hears it (e.g. the dot labelled `Unread`) | the dot |
  | age | — | `just now` under 1 min, `5 min ago` under 1 h, `2 h ago` under 24 h, `3 d ago` |
  | header entry to Blocked people | `Blocked people` | `Blocked people` |
  | next page's spinner | `Loading more notifications` | — |
  | empty | — | `No notifications yet`, hint `Invitations to shared lists show up here.` |
  | offline load / action | — | `You need a connection to see your notifications.` / `You need a connection to answer an invitation.` |
  | limit refusal at accept | — | `OWNED_LISTS_FULL` / `LISTS_FULL` from [limits.ts](../../../src/lib/limits.ts), never the database's "they …" |
  | Blocked people title | header role | `Blocked people` |
  | Blocked people: next page's spinner | `Loading more blocked people` | — |
  | unblock | `Unblock Maya` | `Unblock`, then `Unblocking…` |
  | Blocked people empty | — | `You haven't blocked anyone`, hint `People you block from Notifications show up here.` |
  | offline load / unblock | — | `You need a connection to see who you've blocked.` / `You need a connection to unblock someone.` |
  | Account card | `Blocked people` | `Blocked people` |
  | Sharing: bar button | `Invite` | `Invite` (was `Share`) |
  | Sharing: suggestion row | `Invite Maya` (was `Share with Maya`) | the name |
  | Sharing: role picker | `Invite as writer` (was `Share as writer`) | the role |
  | Invited heading | header role | `Invited` |
  | invited card | — | name, role badge, `Invited 2 d ago` |
  | withdraw | `Withdraw Maya's invitation` | glyph |
  | withdraw warning | — | `Maya's invitation will be withdrawn.` |
  | withdraw cancel / confirm | `Cancel` / `Confirm withdraw Maya's invitation` | `Cancel` / `Withdraw`, then `Withdrawing…` |
  | remove member warning | — | `Maya will lose access to this list until someone invites them again.` (was `…shares it with them again.`) |
  | remove self / leave warning | — | `You'll lose access to this list until someone invites you again.` (was `…shares it with you again.`) |

  - The block warning says the decline is told (D2), so nobody blocks thinking it is silent.
  - Labels follow the existing patterns, such as `Cancel deleting account` and
    `Confirm delete account` ([queries-go-through-a11y-labels](../../kb/entries/queries-go-through-a11y-labels.md)).

## Done when

- The PNGs above are in `ai/ux/primary/`, rendered by the harness, and `"clipped"` is empty for every
  scene.
- The new scenes, the calibration scenes and the README are updated in `ai/ux/source/`.
- The log records each answer above, the calibration offsets, the user's acceptance, and the final
  copy table.
- The user has signed off. Steps 3 and 4 do not start before that.

## After this step

- **Do not run `/librarian deposit`**, whatever CLAUDE.md's working rules say (step 1's request 9).
  Step 5 deposits the whole task once.
- Write `implementation-log-step-2.md` as usual. End it with a **KB candidates** section: the table
  below, corrected to what was actually done, plus anything the step taught that the table misses.
  That section is how this step reaches step 5.
- Never edit `ai/kb/`. If `npm run kb:audit` fails on an entry this step made stale, that is
  expected until step 5: name it in the log. Never change code to make a check pass.

## KB impact (for step 5's deposit)

| entry | change |
|---|---|
| phone-is-the-product | the new mockups and the states each shows. The four `lists-screen-*` scenes now show the round header. The harness draws Sharing again, calibrated, and Notifications and Blocked people. Note any image the user said is superseded |
