# Step 1 — implementation log: mockups for deleting an account

2026-10-05. Scope: `description-step-1.md`. Design only; no app code changed.

**Sign-off: SIGNED OFF by the user, 2026-10-05**, on the eight files below. Every answer here is the user's unless a row
says otherwise. Step 3 may start once step 2 has landed. Where this log and `description-step-3.md` differ, this log wins
(step 3's own rule).

## Answers

| # | question | answer | who |
|---|---|---|---|
| 1 | placement | **A card of its own**, the 4th, under the sign-out card: one `PillButton` `size="lg"` `tone="danger"`, `Delete account`. Its confirm replaces the pill inside that card, as `Sign out of all devices` opens inside the card above. The alternative, a third row of the sign-out card, was drawn and rejected | user |
| 2 | the fold | **The description's 5-line warning, and opening the confirm scrolls it into view.** The user first asked "Which options will work on smaller phones?". Measured (table below): at 375 pt wide even a tighter 4-line wording wraps to 5 lines, and the open card overshoots the safe area on the SE and the 13 mini whatever the copy, so only scrolling works everywhere. The tighter wording (`…will be deleted, also for anyone you shared them with. Lists with another owner stay with their members.`) was proposed for the 17e and declined | user |
| 3 | both confirms open at once | **"One closes the other."** Opening the delete confirm closes `Sign out of all devices`' confirm, and the reverse. This is step 3's "unless step 1 settled otherwise". The name editor stays independent of both, as today (not asked; unchanged) | user; the editor note is the agent's |
| 4 | where the offline failure shows (the description left it open) | **Inside the delete card, above the `Delete account` pill**, as the name error sits inside its card: `ErrorBanner` with `marginHorizontal: 0, marginTop: 0`, 12 above the pill (the card's `gap`). The confirm has closed by then (step 3: "close the confirm, as `pressConfirmEverywhere` does"). A page-top banner would push the card down and out of view | user |
| 4a | the "any other failure" banner (the database's words) | The same in-card banner, so it is one piece of state (`deleteError`), not the page-level `error` the two sign-outs share. Clear it when the confirm is pressed, as `pressConfirmEverywhere` clears `error` | agent, from 4 |
| 5 | resting design | **The new images replace `account-screen-quiet-horizon*` and `account-screen-editing-*` as the current Account design.** The old four stay untouched, as records. They lack the delete card, and their stars are hand-placed, not `STARS` | user |
| 6 | Sign in notice image | **"Draw it too"**, overruling the description's "no image": `sign-in-screen-deleted` | user |
| 7 | copy and a11y labels | **Accepted** as the description's starting table, unchanged (below) | user |
| 8 | the offline state as a mockup | **"Commit it"**: `account-screen-delete-offline` | user |

## Files

`ai/ux/primary/`, eight new PNGs (four stems), 1170×2532 (390×844 pt @3x, insets 47/34). Nothing was overwritten.

| stem (`-quiet-horizon.png` / `-quiet-horizon-moonlit.png`) | state |
|---|---|
| `account-screen-delete` | Account at rest: the Email/Name card, Appearance (Auto, `Night from 7:48 PM` / `Day from 6:52 AM`, as the old mockups draw it), the sign-out card, then the delete card with `Delete account` |
| `account-screen-delete-confirm` | The delete confirm open: the warning, then `Cancel` and `Yes, delete my account`. **Scrolled 12 pt**, which is how far the reveal moves on the 17e, so the card ends at the safe area's bottom (810) |
| `account-screen-delete-offline` | After a failed delete: the confirm closed, `You need a connection to delete your account.` in an `ErrorBanner` above `Delete account` |
| `sign-in-screen-deleted` | Sign in, email phase, with `Your account was deleted.` in `SignInScreen`'s `notice` style, in place of the revoked notice |

Harness: `ai/ux/source/mock.js` (scenes `account-screen-delete`, `-confirm`, `-offline`, `sign-in-screen-deleted`, and
calibration scenes `calib-account`, `calib-account-editing`, `calib-sign-in`). Its README was updated.

## Copy and a11y labels, verbatim for step 3

| element | a11y label | visible text |
|---|---|---|
| control | `Delete account` | `Delete account` |
| warning | — | `Deleting your account can't be undone. Lists you're the only owner of will be deleted, including for anyone you shared them with. Lists that have another owner will stay with their members.` |
| cancel | `Cancel deleting account` | `Cancel` |
| confirm | `Confirm delete account` | `Yes, delete my account`, then `Deleting…` while the request runs |
| offline failure (`ErrorBanner`, in the delete card) | — | `You need a connection to delete your account.` |
| Sign in notice | — | `Your account was deleted.` |

- Straight apostrophes (`can't`, `you're`), as the app's other copy (`We'll email you…`).
- The warning uses `confirmText`'s style (15/21 sans, `textSecondary`). The two confirm pills copy sign-out-everywhere's:
  - `Cancel`: `md`, sides 18 (`snug`);
  - `Yes, delete my account`: `variant="danger"`, `md`, `flex: 1`, sides 12 (`rest`).
- Measured fit (`measure=1`): `Yes, delete my account` needs 165 pt.
  - The room is 183 pt at 390 and 195 at 402.
  - At 375 (SE, 13 mini) it is 168, so it fits with **3 pt to spare**. iOS set the sign-out label slightly narrower
    than the harness (calibration), so it should hold. If a font or padding change ever widens it, it truncates there
    first.
  - `Cancel` fills its `snug` pill exactly (49 of 49 pt), as it does in the sign-out confirm today.

## Geometry, for compare-by-measure (pt, y top–bottom)

| | 390×844, inset 47 (canvas) | 402×874, inset 62 (18 Pro) |
|---|---|---|
| cards 1–3, unchanged | 172–319, 329–445, 455–611 | 187–334, 344–460, 470–626 |
| delete card at rest | 621–713, pill 640–692 | 636–728, pill 655–707 |
| delete card open, before the reveal | 621–822: warning 640–745 (5 lines), pills 755–801 | 636–837: warning 655–760 (5 lines), pills 770–816. Fits: no scroll |
| after the reveal (the mockup) | scroll 12: card 609–810, warning 628–733, pills 743–789 | — |
| offline | 621–791: banner 640–706 (2 lines), pill 718–770 | 636–806: banner 655–721, pill 733–785 |
| Sign in card | 372–772 (716 without the notice): notice 397–437.5, then 16 to `Sign in` | 387–787 |
| content height at rest | 947, so the page scrolls 103 | 962 |

**The reveal, by phone.** These are the overshoots, measured with the harness (`measure=1`, `w h inset insetBottom`):

| phone | at rest | open: card bottom vs safe bottom | reveal scroll |
|---|---|---|---|
| SE 375×667, 20/0 | card 594–686: already 19 past the fold | 795 vs 667 | 128 |
| 13 mini 375×812, 50/34 | fits | 825 vs 778 | 47 |
| 17e 390×844, 47/34 | fits | 822 vs 810 | 12 |
| 18 Pro 402×874, 62/34 | fits | 837 vs 840 | 0 |

**The rule step 3 builds.** When the delete confirm opens and the card's bottom (in content coordinates) lies below
`scroll offset + viewport height − insets.bottom`, scroll up by the difference, animated. The gap is zero: the mockup
puts the card's bottom edge exactly on the safe area's bottom. A card already in view is left alone.
[useKeyboardReveal.ts](../../../src/components/useKeyboardReveal.ts) already computes this overflow for the keyboard
(`target + GAP − (offset + visible)`), so generalise it or write a sibling.

**Accepted as drawn: the resting page no longer fits 390×844.** The fourth card pushes `HorizonFooter` down. At rest
only the birds and the top of the sun show at the bottom edge, and the page scrolls 103 pt.

## Contrast (`contrastRatio`, `src/state/bands.ts`)

The card is `cardFill` composited over `skyTop` and over `skyHorizon`, as `src/theme.test.ts` does, and the figure is
the worse of the two. All pass AA (4.5).

| pair | day | night |
|---|---|---|
| warning `textSecondary` / card | **5.53** | 6.52 |
| `Delete account` `error` / card | 5.82 | 7.03 |
| `Yes, delete my account` `onError` / `error` | 6.54 | 7.84 |
| `Cancel` `text` / card | 11.52 | 12.55 |
| offline banner `error` / `bannerSurface` | 6.17 | 5.19 |
| Sign in notice `text` / `bannerSurface` | 12.21 | 9.28 |

## How they were drawn

The harness `ai/ux/source/` now draws Account and Sign in, ported from each component's geometry.

- **`PillButton`** is generalised: `size` sm/md/lg (36/46/52, sides 16/22/22), `variant` `danger`, `tone` `danger`,
  `disabled`, `icon`, and a layout `style`.
  - The label fonts follow `PillButton.tsx`'s cascade: sm 17 NS400, md 16 NS500, lg 17 NS500; filled and danger NS600,
    at 16 (17 on lg).
- **`SegmentedPicker`** gains the `regular` size on the `card` track. Nothing used the old small-only version.
- **New:**
  - `Card`: a `backdrop-filter: blur(15px)` layer under `cardFill`, a 1 pt `surfaceOutline` rim, and a `0 4 18`
    shadow;
  - `TextField`, `ScreenHeader`, `ScreenSky` (round stars, star y in percent of the screen), and `ErrorBanner`;
  - `HorizonFooter` and `Landscape`, with their traced edges and `smooth()` (Catmull-Rom) ported verbatim;
  - the Google G.
- **The two screens:**
  - `AccountScreen` follows its `useStyles`. `scroll` and `reveal` offset the content, and the sky's top slice is
    redrawn over the status bar, as `Backdrop` does.
  - `SignInScreen` is `AuthFrame` plus the email phase.
- **`clipped`** now also reports pill labels that do not fit. `measure=1` reports cards, confirm line counts, pill fit,
  content height and scroll for these screens.
- **Regression:**
  - Before any change, every existing scene re-rendered pixel-identical to its committed PNG (18 files), so the renders
    are deterministic.
  - After all changes, all 22 renders (the 9 stems plus `calib-lists`/`calib-detail`, day and night) are pixel-identical
    to that baseline. Zero changed pixels.
- **Calibration.** Against task 20 step 5's 17e shots, with `offsets.py` per region and the status bar left out:
  - `calib-account` reproduces `account-{day,night}`: Back, title, the card edges, labels and values, the divider, Edit,
    the picker, both lg pills, the sun, the hill and the front land. All 0.00–0.33 pt.
  - `calib-account-editing` reproduces `account-editing-{day,night}`, the geometry the delete confirm copies: the name
    field, Cancel/Save, the confirm text, Cancel md and the danger md. All ≤ 0.33 pt, except the `Yes, sign out
    everywhere` label at −0.67 pt dx. Its pill's caps are at −0.33 and 0.00, so iOS sets that string slightly
    narrower; accepted.
  - `calib-sign-in` reproduces `sign-in-email-{day,night}`: after the two serif fixes below, the name, card edges,
    title, hint, field, both pills, sun and three land edges are all 0.00–0.33 pt.
  - **Serif lift.** iOS sets a serif glyph higher in a `lineHeight` shorter than its natural line than CSS half-leading
    does:
    - `ShoppingLoop` (43/54) measured +2.33 pt low and got `top: -2.33`;
    - `Sign in` (30/38) measured +1.33 and got `top: -1.33`;
    - Account's title (40/52) takes List detail's existing `top: -1.33` and measures 0.00.
  - **Card fill vs the simulator:** within 1 level by day and 3 by night on Account, and within 4 on Sign in (where it
    is blurred over the bands). For example, Account by night is ours `#232842` against the simulator's `#252b43`.
- **18 Pro inset:** 62, measured from `Back`'s ring top (75 pt) in task 24 step 3's
  `list-detail-search-resting-day-ios.png`. The same measure on the 17e gives 47.

## Problems

- The tighter warning was meant to fix the fold and doesn't on 375-wide phones, where it still wraps to 5 lines. That
  measurement is what decided answer 2.
- The first render of Sign in put both serif lines low (2.33 and 1.33 pt). Fixed by the lifts above, then re-measured.
- None in the harness itself: the headless shell honours `backdrop-filter`, so the Sign in card smears the band edges as
  iOS's material does.

## Notes for step 3

- `confirming` and `confirmingDelete` are mutually exclusive: setting either true sets the other false (answer 3).
- The delete failure banner is the card's own state, not the page-level `error` (answers 4 and 4a).
- The reveal (above) runs on open. The SE needs 128 pt, and its resting delete card is already below the fold, so the
  user reaches it by scrolling.
- Compare by measure against the table above. On the 18 Pro the open confirm fits with no scroll (card bottom 837 vs
  840).
- Device checks run on the iPhone simulator only, never `Pixel_10` (request 5).

## KB candidates (for the librarian)

- **phone-is-the-product:**
  - The four new stems (eight files) and the state each shows (table above).
  - The current Account design is now `account-screen-delete*`. `account-screen-quiet-horizon*` and
    `account-screen-editing-*` stay as records and are stale: no delete card. `sign-in-screen-deleted*` is the first Sign
    in mockup drawn by the harness.
  - The harness now draws Account and Sign in, calibrated to ≤ 0.33 pt against the 17e (one label at 0.67). The 18 Pro's
    inset is 62.
  - Small phones (SE, 13 mini) need the open confirm scrolled into view.
- **scope-boundaries:** nothing yet. Steps 2 and 3 bring the scope change.
- **Not yet:** the mutual-exclusion and reveal rules are decisions step 3 implements. Record them when step 3 lands, not
  now.
