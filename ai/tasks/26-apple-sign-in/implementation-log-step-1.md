# Step 1 — implementation log: mockups for Sign in with Apple

2026-10-06. Scope: `description-step-1.md`. Design only; no app code changed. No `/librarian deposit` (request 5).

**Sign-off: SIGNED OFF by the user, 2026-10-06**, through two rounds of questions on the reviewed renders. The four
committed PNGs are byte-identical to the renders the user reviewed (`cmp`). Every answer below is the user's unless a
row says otherwise. Where this log and `description-step-2.md` differ, this log wins (step 2's own rule).

## Answers

| # | question | answer | who |
|---|---|---|---|
| 1 | order | **Apple first**: `Send code`, then Apple, then Google, each 14 pt below the one above. Apple below Google was drawn and rejected | user |
| 2 | type | **`CONTINUE`** (`Continue with Apple`) | user, with 1 |
| 3 | style per theme | **`BLACK` in Day, `WHITE` in Night**, from the app's resolved theme (Day, Night or Auto), not the system appearance. `WHITE_OUTLINE` in both themes was drawn and rejected | user, with 1 |
| 4 | size and corners | **52 pt tall** (the `lg` pill), **`cornerRadius` 26**, full card width, lined up with the Google pill | user, with 1 |
| 5 | the fold | **Accepted as drawn.** Sign in fits on the 17e and the 18 Pro. On the 13 mini, the card's bottom padding sits 7 pt into the home-indicator strip, with every button above it, and the page does not scroll. With the revoked/deleted notice, the page now scrolls: 18 pt on the 17e, 3 on the 18 Pro, 53 on the 13 mini (none scrolled with the notice before Apple). The card ends 28 pt past the 17e's safe bottom, but `AuthFrame`'s scroll view spans the whole screen and pads its content 24 at the bottom, so the scroll is card bottom + 24 − screen height. Account for a relay address: the delete card ends 18 pt past the safe area at rest on the 17e. Both screens already scroll | user |
| 6 | the resting design | **`sign-in-screen-apple*` is the current iOS Sign in. `sign-in-screen-quiet-horizon*` stays current for Android**, which has no Apple button. Neither file was overwritten. `sign-in-screen-deleted*` gets no Apple version, because it differs only by the notice | user |
| 7 | a relay address too long for its line | **Wrap between letters** (the description's recommendation). The agent recommended shrinking to one line at the sign-off, with images (below), and the user declined | user |
| 8 | getting the address off the phone | **A `Share` pill** beside the address, not `selectable`. The agent recommended `selectable`, and the user chose `Share` | user |
| 9 | copy and a11y labels | **Accepted** (table below). The two `Share` rows were the agent's proposal | user |
| 10 | Apple's words in the device's language | **Acceptable.** The agent's reading, unverified: the app ships no localization besides the development region (`CFBundleDevelopmentRegion` `$(DEVELOPMENT_LANGUAGE)`, no `.lproj`, no `CFBundleAllowMixedLocalizations`), so iOS most likely draws the in-process button in English on every device. Apple's sheet runs out of process and follows the device's language. Step 2 confirms | user; the reading is the agent's |
| 11 | AA contrast | Passes (table below) | agent, measured |
| 12 | where the sentence sits | 8 pt under the address, before the divider, in `confirmText`'s type (15/21 sans, `textSecondary`). Drawn so, and not asked separately | agent; accepted with the images |
| 13 | when `Share` shows | **Only for a relay address**, together with the sentence. An ordinary Account (`account-screen-delete*`) has no `Share`. Drawn so, and not asked separately | agent; accepted with the images |

## Files

`ai/ux/primary/`: four new PNGs (two stems), 1170×2532 (390×844 pt @3x, insets 47/34). Nothing was overwritten.

| stem (`-quiet-horizon.png` / `-quiet-horizon-moonlit.png`) | state |
|---|---|
| `sign-in-screen-apple` | Sign in, email phase: the field, `Send code` (disabled), `Continue with Apple` (black in Day, white in Night), then `Continue with Google` |
| `account-screen-hidden-email` | `account-screen-delete`'s resting Account (Auto, `Night from 7:48 PM` / `Day from 6:52 AM`, the delete card), for `k2x9dqvmp7@privaterelay.appleid.com`. The address wraps to two lines beside a `Share` pill, with the sentence under it in four lines |

**Harness** (`ai/ux/source/mock.js`):

- New `AppleButton({ buttonType, buttonStyle, cornerRadius, height, style })`.
- `SignInScreen` takes `s.apple` (`type`, `order`, `day`, `night`).
- `AccountScreen` takes `relayNote` and `share`. The address now has `overflowWrap: 'anywhere'`.
- `measure=1` adds `apple`, plus `email` and `note`, each `{ rect, lines, need (widest line), room }`.
- Two scenes: `sign-in-screen-apple` and `account-screen-hidden-email`. The rejected drafts were rendered to the
  scratchpad only and removed from `SCENES`, as task 25 did.
- `README.md` was updated, including a note that `AppleButton` is uncalibrated.

## Copy and a11y labels, verbatim for step 2

| element | a11y label | visible text |
|---|---|---|
| Apple button | `Continue with Apple` | Apple's own: `Continue with Apple` |
| Share pill | `Share email address` | `Share` |
| what Share sends | — | the address alone |
| hidden-email sentence | — | `This address hides your real email. On another iPhone, use Sign in with Apple. On Android or the web, sign in with this address, and Apple forwards the code to your inbox.` |

- `Share`: `PillButton` `sm` outline with `label="Share email address"` and `visibleLabel="Share"` (the precedent is
  List detail's `Rename`/`Rename list`). The row copies the name row's `nameRow`/`nameText` (`row`, `center`, gap 12,
  text `flex: 1`), as `Edit` sits beside the name.
- `Share` measures 44 of 44 pt, exactly filling its pill (sides 16), as `Edit` does (30 of 30).
- The relay test is the domain `privaterelay.appleid.com`, after `@`, case-insensitive (description, step 2).

## Geometry, for compare-by-measure (pt, y top–bottom)

| | 390×844, inset 47 (canvas) | 402×874, inset 62 (18 Pro) |
|---|---|---|
| Sign in card | 372–782 | 387–797 |
| `Send code` / Apple / Google | 573–625 / 639–691 / 705–757 | 588–640 / 654–706 / 720–772 |
| Account cards (profile, Appearance, sign-out, delete) | 172–434, 444–560, 570–726, 736–828 | 187–449, 459–575, 585–741, 751–843 |
| address (2 lines, column room) | 208–254, room 218 | 223–269, room 230 |
| sentence (4 lines, room) | 262–346, room 308 | 277–361, room 320 |
| Account content height | 1062: scrolls 218 (`account-screen-delete` rested at 947) | 1077 |

**By phone** (`measure=1`, `w h inset insetBottom`):

| phone | Sign in card bottom vs safe bottom | scroll at rest (before Apple) | with a notice | scroll with a notice (before Apple) | address lines | sentence lines |
|---|---|---|---|---|---|---|
| SE 375×667, 20/0 | 755 vs 667 | 112 (46) | 811 | 168 (102) | 2 | 5 |
| 13 mini 375×812, 50/34 | 785 vs 778 (7 over; Google ends 760) | 0 (0) | 841 | 53 (0) | 2 | 5 |
| 17e 390×844, 47/34 | 782 vs 810 | 0 (0) | 838 (28 over) | 18 (0) | 2 | 4 |
| 18 Pro 402×874, 62/34 | 797 vs 840 | 0 (0) | 853 (13 over) | 3 (0) | 2 | 4 |

Scroll = max(0, card bottom + 24 − h): `AuthFrame`'s `ScrollView` spans the whole screen, and its content is
padded 24 at the bottom (the harness's `content` measure agrees: 812, 844 and 874 at rest, so no scroll). The
keyboard-up state is not measured: `useKeyboardReveal` lifts the whole card above the keyboard, now 66 pt higher
than before.

**Where the address breaks** (the harness, CSS's break-anywhere fallback):

- 390: `k2x9dqvmp7@privaterelay.` | `appleid.com`. Breaking after the dot is chance: the first line is 210.4 of 218 pt, too little room for the next
  `a`.
- 402: `…privaterelay.ap` | `pleid.com`.
- 375: `…privaterela` | `y.appleid.com`.

An address has no break opportunity inside it. iOS falls back to breaking between characters, but its exact break
point is step 2's to measure. **A zero-width space after `@` is ruled out:** Share and copy would carry it, and
`String.prototype.trim` does not strip U+200B, so a pasted address would fail to sign in.

**Address width without Share** (for the record behind answers 7 and 8):

- The address alone needs 302.2 pt: one line with 5.8 to spare at 390 (room 308), and two lines at 375 (room 293).
- The widest relay address (`wmwmwmwmwm@…`) wraps even at 390.
- Shrinking to one line would have needed a scale of at least 0.847 (14.4 pt, at 375).

## Contrast (`contrastRatio`, `src/state/bands.ts`)

The figure is the worse of `cardFill` composited over each surface behind the card: on Account, `skyTop` and
`skyHorizon`; on Sign in, also `bands[0..2]`. This follows `src/theme.test.ts`'s `surfaces()`.

| pair | day | night |
|---|---|---|
| sentence `textSecondary` / Account card | **5.53** | 6.52 |
| address `text` / Account card | 11.52 | 12.55 |
| Apple's fill / Sign in card: `BLACK` in Day, `WHITE` in Night (non-text, needs 3:1) | 16.44 | 10.84 |
| `WHITE_OUTLINE`'s fill / card (rejected; it would have relied on its black ring) | 1.12 | 10.84 |

## How they were drawn

- **`AppleButton`:** the frame is design, and the inside is an approximation.
  - The logo is `-apple-system`'s U+F8FF, which the headless shell draws as Apple's logo (probed first).
  - The title is SF Pro Medium at 43% of the height: 22.4 pt at 52, against Google's 17 pt label. Apple's button
    sizes its title to its height, which is why the two labels differ.
  - The gap between logo and title is 4 pt.
  - **Step 2 recalibrates all three** from the simulator shot. Only the frame (52 / 26 / full width / 14 pt rhythm)
    is binding.
- **Regression:**
  - Before any change, all 26 committed PNGs the harness draws re-rendered byte-identical.
  - After the last change, all 36 renders of the 18 pre-existing scenes (13 committed stems and 5 calibration scenes,
    day and night) are byte-identical to that baseline.
  - `clipped` is empty for every scene.
- **Not calibrated against a simulator**, by design: step 2's shots are the first of the Apple button and of a relay
  address.

## Problems

- The description's wrap recommendation leaves fragments (`m`, `d.com`, `y.appleid.com`) on the second line. Shown to
  the user with a side-by-side of wrap and shrink, and accepted as wrap.
- The first measuring probe (an iframe page reading the address's characters' rects) returned nothing under
  `--virtual-time-budget`. Break points were read off cropped renders instead.
- `npm run kb:audit`: 0 errors, 1 warning. `phone-is-the-product`'s ground moved since 2026-10-05, because
  `ai/ux/source/README.md` changed. **Expected until step 4.** Not fixed here: only the librarian writes `ai/kb/`.

## Notes for step 2

- `AppleAuthenticationButton`:
  - `buttonType` `CONTINUE`;
  - `buttonStyle` `BLACK` when the resolved theme is Day, `WHITE` when Night;
  - `cornerRadius={26}`;
  - `style={{ height: 52, marginTop: 14 }}`, with no `backgroundColor` or `borderRadius`;
  - between `Send code` and `Continue with Google`, in the email phase, on iOS only.
- On iOS the notice variant of Sign in shows Apple too. It was not drawn (answer 6).
- Account, only for a relay address:
  - the name row's layout with the address and `Share` (`PillButton` `sm`, labels above);
  - the sentence 8 pt under it;
  - the address with no `numberOfLines`, so it wraps;
  - `Share` calls `Share.share({ message: <address> })`;
  - not `selectable` (answer 8).
- Step 2's tests: "If step 1 chose Share, pressing it shares the address": it did.
- Shoot Sign in and relay Account, day and night, on the 18 Pro, and compare against the 402-wide column above. Record
  where iOS breaks the address and what the Apple button's inside measures, then recalibrate `AppleButton` if it
  differs.
- Confirm answer 10: the button's language on a simulator set to another language.

## KB candidates (for step 4's deposit)

- **phone-is-the-product:**
  - The two new stems (four files) and what each shows (table above).
  - `sign-in-screen-apple*` is the current iOS Sign in. `sign-in-screen-quiet-horizon*` stays current for Android,
    and web has neither social button. `sign-in-screen-deleted*` has no Apple version, and on iOS the notice screen
    shows Apple too.
  - `account-screen-hidden-email*` is a state of Account beside `account-screen-delete*`, not a replacement.
  - The harness now draws Apple's button, uncalibrated until step 2's shot.
  - The audit's ground-moved warning (README) clears with this deposit.
- **scope-boundaries:** nothing yet. Steps 2 and 3 bring the scope change.
- **Maybe, once step 2 confirms on a device:**
  - An email address has no line-break opportunity, so iOS breaks it between characters, and a zero-width space is
    no fix (it is copied, and `trim` keeps it).
  - The app's single localization keeps in-process system controls (the Apple button) in English.
