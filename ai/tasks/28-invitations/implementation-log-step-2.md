# Step 2 — implementation log: mockups for invitations, notifications and blocking

Done 2026-10-08. Harness work in `ai/ux/source/`, 28 PNGs in `ai/ux/primary/`. No app code, no migration, no `ai/kb/`
edit, no `/librarian` (request 9). Signed off by the user the same day (**User sign-off**, at the end).

## What changed

| file | change |
|---|---|
| `ai/ux/source/mock.js` | `ICON.bell`, `ICON.person`; `Avatar` (ported, hash included) with the unread dot; `Spinner` (iOS medium `ActivityIndicator`); `PillButton` `ellipsis`; `IconButton` `disabled`; `ScreenHeader(title, right)`; `Framed` (Account's frame, factored out of `AccountScreen`); `NotificationsScreen`, `NotificationCard`, `BlockedPeopleScreen`, `BlockedCard`; `SharingScreen` ported from `SharingScreen.tsx` (`Badge`, member/invited cards, the half-width confirm); Lists header → three round buttons behind `header`; Account's `blocked` card; status bar and home indicator at `zIndex` 5; boot: `end` scroll, `ellipsized` report, new measures; 15 scenes |
| `ai/ux/source/tokens.mjs` | adds `landHint` per palette (`contrastRatio(textSecondary, band 0) >= 4.5 ? textSecondary : band0.ink`, SharingScreen's rule, computed by the app's own `contrastRatio`) |
| `ai/ux/source/render.sh` | prints `"ellipsized":[…]` beside `"clipped":[…]` |
| `ai/ux/source/README.md` | components, scene keys, measures, Sharing calibration, 18 Pro inset re-measured |

`tokens.json` stays git-ignored.

### Glyphs (step 3 copies these paths into `icons.tsx` as `BellIcon`, `PersonIcon`)

24 viewBox, stroke 2, round caps and joins, drawn at 18 in the 36 header buttons like `ModeButton`'s:

```
bell:   <path d="M6.5 10.5a5.5 5.5 0 0 1 11 0c0 4 1 6 2.5 7H4c1.5-1 2.5-3 2.5-7z"/>
        <path d="M10 20.5a2 2 0 0 0 4 0"/>
person: <circle cx="12" cy="7.5" r="3.5"/>
        <path d="M5 20.5c0-3.6 3.1-6 7-6s7 2.4 7 6"/>
```

## Images

All 1170×2532 (390×844 pt @3x), day `-quiet-horizon.png`, night `-quiet-horizon-moonlit.png`. `"clipped":[]` for every
scene in `SCENES` (33), day and night. `"ellipsized"` is non-empty only for `notifications-screen-more`
(`Block Maximilian Alexander Fitzgerald-Montgomery`, on purpose: see Long text).

| stem | state | |
|---|---|---|
| `lists-screen-bin`, `-search`, `-bin-empty`, `-search-resting` | the round header (bin mode: bell + person, no mode button, as `ListsScreen` drops `modeButton` while `showDeleted`); no dot | overwritten, as request 2 asks. Diffed against the pre-change render: only x 230–373, y 72–108 pt changed |
| `lists-screen-unread` | `-search-resting` + the bell's dot | new |
| `notifications-screen` | newest first: Maya invited you (pending, **unread**, 2 min) · Sam accepted your invitation (**unread**, chevron, 1 h) · Alex invited you (`You joined`, chevron, 5 h) · Jordan declined your invitation (1 d) · Sam invited you (`Declined`, 2 d) · Priya invited you (`No longer available`, 3 d) · Priya invited you (pending, read, 4 d — only its top shows, under the home indicator) | new |
| `notifications-screen-more` | scrolled to the end of the loaded page (`end`): older cards incl. an accepted answer for a list no longer held (no chevron), the long name and list on a read pending invitation, then the spinner, then the landscape | new |
| `notifications-screen-block-confirm` | `notifications-screen` with the Block confirm open on Maya's card | new |
| `notifications-screen-empty` | `No notifications yet` + hint; `Blocked people` pill still in the header | new |
| `blocked-people-screen` | Maya, Jordan, Alex | new |
| `blocked-people-screen-more` | end of the loaded page, the long name wrapping to 4 lines, spinner, landscape | new |
| `blocked-people-screen-empty` | `You haven't blocked anyone` + hint | new |
| `account-screen-blocked` | resting Account (`AUTO`, `del: 'rest'`) with the Blocked people card | new |
| `sharing-screen-invited` | owner's Sharing, bar button `Invite`; Maya (you, sole owner: trash and picker disabled), Sam writer; the last-owner hint; `Invited`: Priya reader `Invited 5 h ago`, Jordan writer `Invited 2 d ago` | new |

Every other committed scene re-renders **pixel-identical** (max channel diff 0): `calib-*`, `list-detail-*`,
`account-screen-delete*`, `account-screen-hidden-email`, `sign-in-*`. Not redrawn or touched: the four oldest
Lists/List detail records, the pre-deletion Account ones, the `account-screen-delete*` and `account-screen-hidden-email`
scenes, and the lost harness's `sharing-screen-*` images.

Scenes added but not copied to `ai/ux/primary/`: `calib-sharing`, `calib-sharing-member` (calibration),
`check-account-blocked-delete-confirm` (a measurement).

Notifications cannot show all seven states in full on one 390×844 screen: two pending cards with actions take 185 pt
each. The order puts the compact states before the read pending one, so six show in full. The read pending card shows
in full in `-more` (the long-name card).

## Calibration: Sharing (task 20 step 6's 18 Pro shots)

`calib-sharing` / `calib-sharing-member` vs `ai/tasks/20-ux/screenshots/step-6/sharing-{day,night}.png` and
`sharing-member-{day,night}.png`, rendered `W=402 H=874 INSET=62`. Inset from the shot: Back's ring top at 225 px =
75 pt = inset + `HEADER_GAP` 13 → **62**, the KB's figure. `offsets.py` (±4 pt search), dx/dy in pt, ours vs shot:

| region | owner day | owner night | member day | member night |
|---|---|---|---|---|
| Back | 0, 0 | 0, 0 | 0, 0 | 0, 0 |
| title `Sharing` | 0, 0 | 0, 0 | 0, 0 | 0, 0 |
| invite bar / placeholder / `Share` | +0.33,0 / +0.33,0 / 0,0 | same | — | — |
| sun / land edge | 0, 0 / 0, 0 | 0, 0 / 0, 0 | 0, 0 / 0, 0 | 0, 0 / 0, 0 |
| `People with access` | +0.33, +0.33 | +0.33, +0.33 | +0.33, +0.33 | +0.33, +0.33 |
| cards 1–3 | 0, 0 | 0, 0 | 0/+0.33, 0 | 0/+0.33, 0 |
| avatars | ≤ +0.33, 0 | ≤ +0.33, 0 | 0, 0 | 0, 0 |
| names | 0, 0 | 0, 0 | 0, 0 | 0, 0 |
| trash / picker | 0,0 / ≤ +0.33,0 | 0,0 / ≤ +0.33,0 | — | — |
| badges / `Leave list` | — | — | +0.33, 0 | +0.33, 0 |
| hint | 0, −0.33 | 0, −0.33 | +0.33, −0.33 | +0.33, −0.33 |

Every region within 0.33 pt (1 device px). The 24/32 serif heading sits 0.33 pt lower than iOS's; left uncorrected
at the noise floor. Colour patches (ours / shot): band 0, sky, Sam's avatar, the checked segment exact; card interior
day `241,238,246` / `242,239,246`, night `52,59,89` / `51,57,85` (within 4, as Account's). Avatar bands in the shots:
Priya 0, Maya 1, Sam 2 — pinned by name in `PEOPLE_BAND` so those three keep their colour on every screen; anyone else
is hashed by name.

## What the images settle

### The header fits (D7)

Three 36 pt outline `IconButton`s, 12 apart, 132 pt, ending 16 from the right edge. Gap = the group's left edge minus the
right edge of `My Lists`' last glyph (title glyphs x 16–174.4 at every width):

| phone (w×h, inset) | group x | gap, 3 buttons (search mode) | gap, 2 buttons (bin) |
|---|---|---|---|
| 390×844 (canvas) | 242–374 | **67.6** (suggestion: ~69) | 115.6 |
| 402×874 (18 Pro) | 254–386 | **79.6** | 127.6 |
| 375×667 (SE), 375×812 (13 mini) | 227–359 | **52.6** | 100.6 |

The bell's dot: `ModeButton`'s, 12 pt `primary`, 2 pt `skyTop` ring, top −2 right −2.

### The notification card

Cards on Account's frame: x 20–370, 10 apart, the first at y 172 (12 under the title), padded 14 h / 13 v as Sharing's
member cards are. Content x 35–355.

- **Avatar** 36 (the actor's), `marginTop` 2; the text column 13 after it: x 84, 271 pt wide (242 with a chevron).
- **Sentence** 16/22 Nunito Sans: names at 600, the rest 400. **Unread: the whole sentence at 600.**
- **Unread dot**: on the avatar's top right, as on the bell: 12 pt `primary`, 2 pt ring in `surface` (the card's base
  under `cardFill`), top −2, right −2. Card geometry is the same read or unread, so nothing shifts when the dots go.
- **Meta line** 14/19 `textSecondary`, 2 under the sentence — where the age goes:
  - pending: `as a writer · 2 h ago` (`as a reader`, `as a writer`, **`as an owner`**);
  - an answer: the age alone;
  - resolved: the outcome takes the role's place: `You joined · 5 h ago` (`You joined` at 600 in `text`),
    `Declined · 2 d ago`, `No longer available · 3 d ago` (all `textSecondary`). One line shorter than a separate status
    line; this is what fits six cards on one screen.
- **Actions** (pending and available only), full content width under the text block: `Decline` (outline md) and `Accept`
  (filled md), `flex: 1` each, 11 apart, 12 under the meta line — Sharing's confirm row; then `Block Maya` (outline md,
  `tone: 'danger'`, full width) 10 under them. Pending card with a one-line sentence: 185 pt.
- **Block confirm** replaces the three pills: the warning (15/21 `textSecondary`, 10 under the meta line), then `Cancel`
  (outline md) and `Block` (danger md), half each, 11 apart, 10 under it — Sharing's confirm. 200 pt; 3 lines at 390, 4
  at 375.
- **Resolved or unavailable**: sentence in `textSecondary` (names still 600), no actions. `You joined` keeps the chevron.
- **Chevron** (`ChevronIcon` right, 16, `text`): centred vertically on the card's right edge, 13 after the text; the
  whole card is the button. On `You joined`, and on `accepted your invitation` only while the list is held — the scene's
  `held: false` card shows the other case.
- Heights at 390: answer, two lines 93; resolved, one line 71 / two lines 93.

### Long text

`set_name` has **no upper bound** (only `char_length(trimmed) < 3`), and list names none either, so "the longest name
`set_name` allows" is unbounded. Used: `Maximilian Alexander Fitzgerald-Montgomery` (42 chars) and
`Grandma's 90th birthday garden party supplies`.

- The sentence wraps (4 lines at both 390 and 375); nothing truncates the list name, nor the actor's.
- `Block <name>` is the one place a name meets a fixed-height pill: it ends in `…` (`Block Maximilian Alexander
  Fitzger…`), as `PillButton`'s existing `numberOfLines={1}` already cuts it on iOS. The a11y label keeps the full name.
  The harness reports it under `ellipsized`, not `clipped`.
- Blocked people: the name wraps (4 lines for the long one) beside `Unblock`; never cut.
- Sharing's member and invited names stay one line, cut with `…`, as `SharingScreen` does today (`numberOfLines={1}`).
- Narrowest check, 375: `Maya invited you to Weekend BBQ` needs 253.8 of 256 pt, one line.

### `Blocked people` on Notifications

As recommended: a small outline pill (`sm`, 36) in the header row, opposite Back (`ScreenHeader`'s new `right`). There
on every page and on the empty state.

### The next page's spinner

`ActivityIndicator` (20 pt), centred under the last card with 12 above and below — Lists' `loadingMore` padding — in
`text` on the sky, where Lists uses its band's ink on the band. After it, the frame's spacer (≥ 64) and `HorizonFooter`.
So at the end of a loaded page the landscape shows under the spinner and moves down as the next page lands. Same on
Blocked people.

### The Account card

As recommended: its own card between Appearance and the sign-out card, holding one outline `lg` pill `Blocked people`,
the action cards' padding (18 top, 20 bottom). 92 pt + the 10 gap.

- `reveal` still lands: `check-account-blocked-delete-confirm` scrolls 102 pt more than `account-screen-delete-confirm`
  and the open delete card ends exactly at the safe area's bottom — 390: 810 (scroll 114), 402: 840 (scroll 99),
  SE: 667 (scroll 230).
- At rest the delete card now ends at 815 on 390 (5 pt into the home indicator's 34) and below the fold on the SE
  (696–788 of 667); it scrolls into view.

### The Invited section

- `Invited` heading (serif 24/32, header role), 24 under the hint (or under the cards with no hint): at 390, y 653.
- Each card: the member card's frame (14/13), `Avatar`, the name (17, one line) over `Invited 2 d ago` (14/19
  `textSecondary`), the role badge (Sharing's: 28 tall, `outline` ring, 15 sans), and the withdraw `IconButton`
  (`CloseIcon` 16 in `text` on `controlFill`, as Remove's trash). 70 pt.
- The withdraw confirm reuses the remove confirm's form (the sentence and Cancel / Withdraw under the row, the
  button hidden). No image drawn; see User sign-off.

### AA contrast (both palettes, against the card fill)

Card fill = `cardFill` over what it blurs. Notifications, Blocked people, Account: the sky (`skyTop`…`skyHorizon`); Sharing:
band 0. Computed from the tokens; the rendered fills agree: day exact `#f2f1f7`, night within 2 levels.

| element | colour | day: sky top / horizon / band 0 | night: sky top / horizon / band 0 | need |
|---|---|---|---|---|
| meta line, muted sentence, `Declined`/`No longer available`, confirm, `Invited …` | `textSecondary` | 5.54 / 5.53 / 5.41 | 6.63 / 6.52 / 4.96 | 4.5 |
| sentence, `You joined` | `text` | 11.55 / 11.52 / 11.27 | 12.76 / 12.55 / 9.54 | 4.5 |
| `Block …` label | `error` | 5.84 / 5.82 / 5.70 | 7.14 / 7.03 / 5.34 | 4.5 |
| unread dot vs card | `primary` | 10.56 / 10.53 / — | 11.48 / 11.29 / — | 3 |
| unread dot vs avatar bands 0 / 1 / 2 | `primary` | 8.62 / 7.12 / 5.31 | 4.74 / 6.09 / 7.80 | 3 |
| chevron | `text` | 11.55 / 11.52 | 12.76 / 12.55 | 3 |
| spinner, empty state | `text` on the sky | 10.27 / 10.30 | 15.71 / 14.65 | 4.5 |
| Sharing hint | `landHint` on band 0 | 4.52 (`textSecondary`) | 5.27 (band 0's ink) | 4.5 |

All pass. The dot's centre lies just outside the disc (19.8 from its centre, radius 18), so it is read against both.

## Final copy and a11y labels

`Maya` and `Weekend BBQ` stand for any name and list. Steps 3 and 4 assert these verbatim.

| element | a11y label | visible text |
|---|---|---|
| Lists: bell | `Notifications`; `accessibilityValue` `2 unread` while any are unread, none otherwise | glyph, + dot while unread |
| Lists: account | `Account` (unchanged) | glyph |
| Notifications title | header role | `Notifications` |
| header entry to Blocked people | `Blocked people` | `Blocked people` (outline `sm` pill opposite Back) |
| pending invitation | — | `Maya invited you to Weekend BBQ` (both names at 600; all of it while unread), then `as a writer · 2 h ago` (`as a reader`, `as an owner`) |
| decline | `Decline invitation to Weekend BBQ` | `Decline`, then `Declining…` |
| accept | `Accept invitation to Weekend BBQ` | `Accept`, then `Accepting…` |
| block | `Block Maya` | `Block Maya` (cut with `…` when it does not fit) |
| block warning | — | `Maya will be told you declined, and you won't see invitations from them any more. Unblock them any time under Blocked people.` |
| block cancel / confirm | `Cancel blocking Maya` / `Confirm block Maya` | `Cancel` / `Block`, then `Blocking…` |
| accepted (to invitee) | the card: `Open Weekend BBQ` | sentence muted, then `You joined · 2 h ago`, chevron |
| declined (to invitee) | — | sentence muted, then `Declined · 2 h ago` |
| unavailable | — | sentence muted, then `No longer available · 2 h ago` |
| answer: accepted | the card: `Open Weekend BBQ`, only while the list is held | `Maya accepted your invitation to Weekend BBQ`, then `2 h ago`, chevron while held |
| answer: declined | — | `Maya declined your invitation to Weekend BBQ`, then `2 h ago` |
| a card that is a button (`Open …`) | its `accessibilityValue` carries what the label hides: the sentence and the meta line, e.g. `Sam accepted your invitation to Camping trip, 1 h ago` | — |
| unread marker | the dot is its own element labelled `Unread`, read before the sentence; on a button card, where the label swallows it, `Unread, ` leads the value | the dot |
| age | — | `just now` under 1 min, `5 min ago` under 1 h, `2 h ago` under 24 h, `3 d ago` (so 24–48 h is `1 d ago`) |
| next page's spinner | `Loading more notifications` | — |
| empty | — | `No notifications yet`, hint `Invitations to shared lists show up here.` |
| offline load / action | — | `You need a connection to see your notifications.` / `You need a connection to answer an invitation.` |
| limit refusal at accept | — | `OWNED_LISTS_FULL` / `LISTS_FULL` from `limits.ts`, never the database's "they …" |
| Blocked people title | header role | `Blocked people` |
| Blocked people: next page's spinner | `Loading more blocked people` | — |
| unblock | `Unblock Maya` | `Unblock`, then `Unblocking…` (outline `sm`, no confirm) |
| Blocked people empty | — | `You haven't blocked anyone`, hint `People you block from Notifications show up here.` |
| offline load / unblock | — | `You need a connection to see who you've blocked.` / `You need a connection to unblock someone.` |
| Account card | `Blocked people` | `Blocked people` (outline `lg` pill in its own card) |
| Sharing: bar button | `Invite` | `Invite` (was `Share`) |
| Sharing: suggestion row | `Invite Maya` (was `Share with Maya`) | the name |
| Sharing: role picker | `Invite as writer` (was `Share as writer`) | the role |
| Invited heading | header role | `Invited` |
| invited card | — | name, role badge (`Reader`/`Writer`/`Owner`), `Invited 2 d ago` |
| withdraw | `Withdraw Maya's invitation` | glyph (`CloseIcon`) |
| withdraw warning | — | `Maya's invitation will be withdrawn.` |
| withdraw cancel / confirm | `Cancel` / `Confirm withdraw Maya's invitation` | `Cancel` / `Withdraw`, then `Withdrawing…` |
| remove member warning | — | `Maya will lose access to this list until someone invites them again.` |
| remove self / leave warning | — | `You'll lose access to this list until someone invites you again.` |

Changes from the description's starting table: the resolved states' text sits on the meta line with the age
(`You joined · 2 h ago`); `as an owner` for the owner role; the button cards' `accessibilityValue`; the `Unread` element;
`Block …` may be cut with `…`.

## Verification

- `render.sh` over all 33 scenes: `"clipped":[]` for each; `ellipsized` only for `notifications-screen-more`.
- Pre-change baseline (all 20 committed scenes, rendered before any edit) was pixel-identical to `ai/ux/primary/`. After:
  only the eight `lists-screen-*` files differ, only in x 230–373, y 72–108 pt.
- Measured at 390×844, 402×874 and 375×667 (and 375×812 for the header) with `measure=1`: the numbers above.
- Contrast: computed from `tokens.json`, cross-checked against rendered pixels.
- `npm run typecheck`: clean. No file under `src/` or `supabase/` changed.
- `npm run kb:audit`: `73 entries, 66 mechanically checked, 1 error(s), 1 warning(s)`. The error is step 1's expected
  `session-still-valid-guards-writes` (19 guarded RPCs, not 12). The warning: `phone-is-the-product`'s ground moved
  (`ai/ux/source/README.md`), which this step made stale and step 5 updates. Its `verify:` still passes
  (`tokens.mjs` still imports `src/theme.ts`).

## Problems hit

- **A `flex: 1` text in a column collapses to height 0** (the invited card's name vanished): `flex: '1 1 0'` sets the
  main-axis basis, which is height in a column. The name there has no `flex`.
- **Raising Sharing's header block (`zIndex: 1`, as the app's `top` style) hid the status bar** at night: a positioned
  element with a z-index paints over later `position: absolute` siblings with `z-index: auto`. The status bar and home
  indicator now carry `zIndex: 5`; every other scene stays pixel-identical.
- Without the raise, the invite bar's shadow was cut off at the header block's bottom by `Hillside`, a later sibling.
- First draft had a separate status line under the meta line and the unread dot not wired (`Avatar` got no `dot`): only
  4½ cards fitted the screen. Fixed as described above.

## User sign-off

2026-10-08, the user's answers:

- **Signed off**: the images and the design calls, put to them as: the unread dot on the avatar's top right like the
  bell's; a resolved invitation's outcome in the role's place (`You joined · 5 h ago`); `Block Maya` a full-width
  red-outline pill under Decline/Accept; the next page's spinner under the last card with Account's landscape below;
  `Blocked people` a small header pill opposite Back. Steps 3 and 4 may start.
- **Superseded** (not redrawn or deleted; the files stay as records):
  - the lost harness's `sharing-screen-invite-header*`, `-invite-header-scrolled*`, `-invite-header-suggestions*`
    (`Share`, no Invited section) → `sharing-screen-invited` is the owner's Sharing. `sharing-screen-member*` stays
    current;
  - `account-screen-delete*` and `account-screen-hidden-email*` → their states stay valid, but their layout lacks the
    Blocked people card; `account-screen-blocked` is the resting Account.
- **Withdraw confirm: no image.** It reuses the remove confirm's form; the copy table above fixes its text.

## KB candidates

For step 5's deposit. The description's table, corrected to what was done, then what it misses.

| entry | change |
|---|---|
| phone-is-the-product | New mockups and their states (the Images table above): `lists-screen-unread`, `notifications-screen` (+`-more`, `-block-confirm`, `-empty`), `blocked-people-screen` (+`-more`, `-empty`), `account-screen-blocked`, `sharing-screen-invited`. The four `lists-screen-bin`, `-search`, `-bin-empty`, `-search-resting` scenes now show the round header (no dot). The harness draws Sharing again, calibrated to task 20 step 6's 18 Pro shots within 0.33 pt, and Notifications and Blocked people; it draws seven screens, not four. **Superseded** (user, 2026-10-08), kept as records: the lost harness's three `sharing-screen-invite-header*` stems (→ `sharing-screen-invited`; `sharing-screen-member*` stays current), and `account-screen-delete*` / `account-screen-hidden-email*` as layouts (their states stay valid; the resting Account is `account-screen-blocked`). The withdraw confirm has no image, by the user's call |

Also learned:

- **Harness facts** (README already holds them; the KB needs only the pointer): Sharing calibrated at `W=402 H=874
  INSET=62`; inset 62 re-measured off task 20 step 6's shots (Back's top at 75 pt); `check-*` scenes are measurements,
  never mockups; `"ellipsized"` lists labels cut to `…` on purpose; Maya/Sam/Priya's avatar bands are pinned
  (`PEOPLE_BAND`), everyone else hashed by name.
- **`set_name` has no upper length bound**, and list names none: any fixed-height control holding a name (`Block
  <name>`) must cut with `…` and keep the full name in its a11y label; sentences holding names wrap.
- **Design decisions steps 3–4 build to** (if not recorded elsewhere): the unread dot on the avatar's top right
  (`ModeButton`'s dot, `surface` ring); a resolved invitation's outcome on the meta line in the role's place; `Block`
  full-width outline `md` under Decline/Accept; the next page's spinner in `text` on the sky, the landscape after it;
  `Blocked people` as a header pill opposite Back; `as an owner`; a button card's sentence carried in its
  `accessibilityValue`.
- **A harness gotcha**: a z-indexed block hides absolutely positioned overlays drawn after it unless they carry a
  z-index too (the status bar, the home indicator).
