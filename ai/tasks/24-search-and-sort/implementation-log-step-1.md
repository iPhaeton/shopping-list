# Step 1 — implementation log: mockups for the bin view and the search panel

2026-10-02. Scope: `description-step-1.md`. Design only; no app code changed.

**Sign-off: SIGNED OFF by the user, 2026-10-02**, after five review rounds. Every answer below is the user's except
where a row says otherwise. Steps 2 and 3 may start. `description-step-2.md` and `description-step-3.md` were updated
to match, at the user's request.

## Second round (user, 2026-10-02) — supersedes the first round's Q1, Q2 and the picker of Q3

User's words, condensed:
1. Search bar on → the header button shows **Plus**. Create input on → it shows the **magnifier**.
2. **The search bar is on by default.** The button opens the create input, and pressing it again returns to search.
3. Lists has 4 sorts on **2 buttons**: date added (asc = arrow up, desc = arrow down) and A–Z (asc `A–Z`, desc `Z–A`).
   Pressing a button again flips its direction.
4. Items have 6 on **3 buttons**: the same two, plus To Do (asc `To Do First`, desc `To Do Last`).
5. More than one sort can be on at once (e.g. by date and by name).

AskUserQuestion, answered "To Do, A–Z, then date (Recommended)":
- **Priority is fixed: To Do, then A–Z, then date.**
- **Date is always on**, as the last tie-break. Its button only flips ↑/↓.
- A–Z and To Do each cycle off → on → reversed → off.
- Why: no two rows share an added time, so any key placed after date would never change the order. No database rule
  makes list names or item titles unique (only `users.name` is unique), so date does break A–Z ties.

**Consequences for step 3's description:**
- Its sort table (`oldest`/`newest`/`az`, `added`/`az`/`todo`, one value per screen) and its stored shape
  (`lists?: 'newest' | 'az'`, `items?: { [listId]: 'az' | 'todo' }`) no longer fit. The model below replaces them. The
  rules there still hold: only non-default values are stored, and the read never rejects.
- "The panel opens from the magnifier" and "`Cancel` closes the panel" are replaced by the header button below.

## Third round (user, 2026-10-02)

1. "Leaving search shouldn't clear search input or the sort. The search input should have a cross button to clear it."
   - Proposed on top: the kept query filters only while search mode shows. **Overruled in the fifth round:** the
     query filters in both modes.
2. Sort buttons reordered, accepted: **left to right in priority order**, so the leftmost lit button decides first.
   - Lists: `A–Z` · `Date`.
   - List detail: `To Do` · `A–Z` · `Date`.

## Fourth round (user, 2026-10-02)

- "Shorter sentence is fine": `Deleted lists, newest first.` (Q6's copy).
- Empty-bin copy "Approved" (Q7).
- "Remove the tag": bin rows lose the `Deleted` tag. `ListRow` and `ItemRow` are changed in step 2, which now says so.
- "Keep it": the harness moved to `ai/ux/source/` (see "How they were drawn").
- Unprompted: **"the "Show deleted" text should not show the number of deleted items."** The label is always
  `Show deleted`. `ShowDeletedToggle`'s `count`/`more` props go in step 2, which now says so.
- All ten images re-rendered from `ai/ux/source/` for the last two. A pixel diff against the previous renders is
  confined to the toggle label, and on the bin images to the tags, so moving the harness changed nothing else.

## Fifth round (user, 2026-10-02): the last open questions, then sign-off

| # | question | answer |
|---|---|---|
| 1 | header button left of `Account` / of `Rename`·`Share` | yes |
| 2 | sort button look (lit `primary`, off `surface`, equal widths) | yes |
| 3 | 44 pt of sky under the bin sentence, entered from search mode | yes |
| 4 | the query in create mode | **"Search text filters in the creation mode. The new item may disappear."** |
| 5 | Plus focuses the Create / Add input | yes |
| 6 | an empty, complete live stream opens in create mode; the header button appears with the first row | yes |
| 7 | the a11y labels (table below) | yes |
| 8 | commit the resting and empty-bin drafts as mockups | yes: four new stems, eight files |

Consequence of 4, decided by the agent and written into step 3's description:
- The magnifier's dot lights for a non-empty query too, not only for a non-default sort.
- Its `accessibilityValue.text` names the query first.
- Why: in create mode the field is hidden, and a filter you can't see is the very thing the dot exists to flag (Q5).

### Sort model (for step 3)

Rows are in button order, left to right:

| key | screens | states, in tap order | default | face (on) |
|---|---|---|---|---|
| todo | List detail | off → first → last → off | off | `To Do First` / `To Do Last` |
| az | both | off → asc → desc → off | off | `A–Z` / `Z–A` |
| date | both | ↑ ↔ ↓, never off | ↑ | `Date` + `ArrowUpIcon` / `ArrowDownIcon` |

- Order: todo (if on), then az (if on), then date, then `id`, through `byStamp`.
- Lists' date is `joinedAt`, as `inJoinOrder` uses today. Items' date is `createdAt` (`inCreationOrder`).
- Date ↑ alone is today's order on both screens, so default = date ↑, az off, todo off.
- Unstamped rows (optimistic, stamp `null`) are the newest. They go last under date ↑ and first under date ↓, within
  whatever group todo and az leave them in. This is step 3's `newest` rule restated per key.
- Az uses step 3's collator. Todo groups undone before done (`first`) or after (`last`).
- Non-default means any key differs from the default. That decides three things: the magnifier's dot (as a non-empty
  query also does), whether the sort is stored, and whether the stream needs completing.
- **The stream needs completing** when the query is non-empty or the sort is non-default, in either mode.

## Files

`ai/ux/primary/`, eighteen new PNGs (nine stems), 1170×2532 (390×844 pt @3x, top inset 47, bottom 34). The four
resting mockups were never touched. The harness that draws them is `ai/ux/source/`.

| stem (`-quiet-horizon.png` / `-quiet-horizon-moonlit.png`) | state |
|---|---|
| `lists-screen-bin` | Bin mode entered from search mode. Sentence in the field's place. The sort row's 44 pt stays as sky, so `Show deleted` does not move. No header button. Christmas dinner, Ski trip (shared · can edit, no Restore), Moving house, Old groceries |
| `list-detail-screen-bin` | Same, on Groceries (editable): `Deleted items, newest first.`, `Show deleted`, Paper towels, Coffee (done), Butter, Rice |
| `lists-screen-search` | Search mode: Plus button. Query `gro` with the clear ×. Sort `A–Z` + `Date ↑` (both lit). Running line `Searching 100 of 240 lists · loading the rest…`. Big grocery run, Groceries, Grove Street party, Weekend groceries (shared · can edit) |
| `list-detail-screen-search` | Search mode: Plus button. `mi`. `To Do First` + `A–Z` + `Date ↑`, all lit (the multi-key case). Failed line + `Try again`. Jasmine rice, Mince, Mint, Miso paste, Salami, then Oat milk (done) |
| `lists-screen-search-resting` | **The resting state**: search mode, empty field (`Search lists`), `Date ↑` lit, `A–Z` off, Plus button. Groceries, Hardware store, Pharmacy, Weekend BBQ (can edit), Birthday party (view only), Camping trip |
| `list-detail-screen-search-resting` | The resting state on Groceries: `Search items`, `Date ↑` lit, `To Do`/`A–Z` off. Milk, Bread (done), Eggs, Apples, Coffee beans, Bananas |
| `lists-screen-bin-empty` | Bin on and empty: `Show deleted`, `The bin is empty` + `Deleted lists wait here for 30 days.`, sentence + 44 pt sky |
| `list-detail-screen-bin-empty` | The same on Groceries: `Deleted items wait here for 30 days.` |
| `list-detail-screen-search-sorted` | Create mode: the Add bar, and the magnifier with the dot. `To Do First` applied, empty query, stream complete (no line). 5 to-do rows in added order, then Sourdough bread, Olive oil, Bananas (done) |

The resting mockups `lists-screen-quiet-horizon*` and `list-detail-screen-quiet-horizon*` now show **create mode
without its magnifier**, not the resting state. Their toggles also still carry a count (`Show 2 deleted` / `Show 1
deleted`). `*-search-resting` replaces them as the design for rest; the four files stay, untouched.

## Answers

| # | question | answer | status |
|---|---|---|---|
| — | item rows | **One flat band per row** (`ItemRow` → `bandAt(index)`), as the app draws since `a7416fd` "Fix list item colours". The resting `list-detail-screen-quiet-horizon*.png` predates that commit: one pale ground with hairlines, stale | user, 2026-10-02 |
| 1 | header button (was "magnifier") | Round `IconButton`, 36, 1 pt ring `outline`, glyph `text` @18 (as `Back`). Lists: left of `Account`, gap 12. List detail: left of `Rename`/`Share`, gap 12. **Glyph names the other mode:** `PlusIcon` in search mode, `SearchIcon` in create mode. Live mode only; hidden in bin mode | user, 2026-10-02 |
| 2 | search panel | **Holds the slot by default**, every time the screen opens. Mode is screen-local state, kept across a trip into the bin and back, never stored. Field on the `AddBar` surface: leading `SearchIcon` `textMuted` @18, query 17 sans `text`, then a clear × (`CloseIcon` `textMuted` @18 in a 44 pt target) only while the query is non-empty. No `Cancel`: there is no panel to close. **Switching to create mode keeps the query and the sort.** **The query filters in both modes** (fifth round): an item added that doesn't match drops out of view. Tapping Plus focuses the Create/Add input | user, 2026-10-02 |
| 3 | sort controls | Below the field, 8 pt gap, 20 pt sides: **a row of equal-width toggle buttons in priority order** (Lists `A–Z` · `Date`, List detail `To Do` · `A–Z` · `Date`), gap 8, 36 tall, radius full. On = `primary` fill, `onPrimary` 15.5 NS500. Off = `surface` fill, `surfaceOutline` 1 pt border, `text` 15.5 NS400. Equal widths, so a changing face never moves its neighbours. Panel = 52 + 8 + 36 = 96 pt | user, 2026-10-02 |
| 4 | coverage line | **Under the slot**, same place in either mode: 10 pt below the slot, 24 pt left, 20 pt right; 15/20 sans `textSecondary`, flex, wraps to 2 lines; `Try again` = outline `PillButton` sm at its right, 12 pt gap | user, 2026-10-02 |
| 5 | non-default sort, out of sight | **Dot on the magnifier**, which now shows only in create mode (the sort row is hidden there). It also lights for a non-empty query, which filters create mode too (fifth round's consequence). 8 pt `primary` disc in a 2 pt `skyTop` ring (12 pt overall), box at top −2, right −2. No dot in search mode: the lit buttons say it | user, 2026-10-02 |
| 6 | bar's slot in bin mode | The bin sentence takes the place of the field or bar, in `ListsScreen`'s `full` style (min 52, radius 20, padding 16/8, 15/20 sans `text`). **Entered from search mode, the sort row's 44 pt stays as empty sky**, so `Show deleted` stays under the finger (measured: Lists toggle row 237.5 pt, List detail 276, in both). Entered from create mode, the slot is the bar's 52. Lists copy shortened from the description's proposal, which wrapped to two lines (56 pt): `Deleted lists, newest first.`, mirroring `Deleted items, newest first.` | user, 2026-10-02 |
| 7 | toggle and empty bin | Label `Show deleted`, no number, **always** (fourth round), not only at zero. Empty: `The bin is empty` + `Deleted lists wait here for 30 days.` / `Deleted items wait here for 30 days.`, in `bandAt(0).ink` | user, 2026-10-02 |

Not drawn, for the cases the slot held before. **Agreed by the user, 2026-10-02:**
- **List detail, reader:** no create mode, so no header button; the search panel holds the slot. The read-only
  sentence moves under the panel, in the coverage line's style. If both lines show, the coverage line comes first.
- **List detail, binned list:** the binned notice (with `Restore <name>`) keeps the slot. No search and no header button,
  as in bin mode: it is a tombstone.
- **Lists at a list limit:** Plus still shows. Create mode shows the limit sentence in the bar's place, as today.

Drawn choices, accepted with the images:
- Bin rows have no `Deleted` tag (fourth round). A binned row keeps `Restore` for whoever may restore it.
- The empty Add bar's button is in `primaryDisabled`, as the app renders it.
- No sync banner and no keyboard.

## A11y labels

| control | role | label | state / value |
|---|---|---|---|
| header button, search mode | button | `New list` / `New item` | — |
| header button, create mode | button | `Search and sort` | `accessibilityValue.text` = the query, then the active sort when not default in priority order, e.g. `Searching mi, to do first, then A to Z, oldest first` |
| search field | (text input) | `Search lists` / `Search items` (= placeholder) | — |
| clear × | button | `Clear search` | — |
| To Do button | button | `Sort by to do` | value `Off` / `To do first` / `To do last` |
| A–Z button | button | `Sort by name` | value `Off` / `A to Z` / `Z to A` |
| date button | button | `Sort by date added` | value `Oldest first` / `Newest first` |
| retry | button | `Try again` | — |
| Show deleted | switch | `Show deleted`, always, no count | `checked` |
| bin sentence, coverage line | text | — | — |

These clash with nothing in use: `AddBar`'s input is labelled `New list name` / `Add an item`, its button `Create` /
`Add`, and its rename `Cancel` is unchanged.

## Copy, verbatim for steps 2 and 3

| where | Lists | List detail |
|---|---|---|
| bin sentence | `Deleted lists, newest first.` | `Deleted items, newest first.` |
| empty bin title | `The bin is empty` | `The bin is empty` |
| empty bin hint | `Deleted lists wait here for 30 days.` | `Deleted items wait here for 30 days.` |
| toggle, always | `Show deleted` | `Show deleted` |
| field placeholder | `Search lists` | `Search items` |
| sort faces, left to right | `A–Z` / `Z–A` · `Date` + arrow | `To Do First` / `To Do Last` · `A–Z` / `Z–A` · `Date` + arrow |
| running | `Searching 300 of 1,000 lists · loading the rest…` | `Searching 400 loaded items · loading the rest…` |
| failed | `Searched 300 of 1,000 lists. The rest need a connection.` + `Try again` | `Searched the 400 loaded items. The rest need a connection.` + `Try again` |
| capped | `Searched the first 2,000 lists.` | `Searched the first 2,000 items.` |
| no matches, complete stream | `No matches for "<query>"` | `No matches for "<query>"` |
| no matches, partial stream | `No matches in the 300 loaded lists` | `No matches in the 400 loaded items` |
| no-match hint (both forms) | `Check the spelling, or try fewer letters.` | `Check the spelling, or try fewer letters.` |

- Faces are the user's casing (`To Do First`) and the app's en dash (`A–Z`, as the description writes it). The user wrote
  `A - Z`.
- The coverage lines are step 3's table, unchanged. "Searching"/"Searched" become "Sorting"/"Sorted" when the query is
  empty.
- Lists names the total only when `listCounts.total` exceeds the rows held. Without it: `Searching 300 loaded lists ·
  loading the rest…` / `Searched the 300 loaded lists. The rest need a connection.`
- Numbers go through `limits.ts`'s `grouped`.

## Geometry at 390×844 (inset 47), for compare-by-measure

| | search mode, no line | search, 1-line line | search, 2-line line | create mode | bin (from search) |
|---|---|---|---|---|---|
| List detail slot | field 172–224, sorts 232–268 | same | same | bar 172–224 | sentence 172–224, sky to 268 |
| List detail coverage line | — | 278–298 | 278–318 | 234–254 / 234–274 | — |
| List detail strip / first row | 268 / 350 | 298 / 380 | 318 / 400 | 224 / 306 | 268 / 350 |
| Lists slot | field 129.8–181.8, sorts 189.8–225.8 | same | — | bar 129.8–181.8 | sentence 129.8–181.8, sky to 225.8 |
| Lists coverage line | — | 235.8–255.8 | — | 191.8–211.8 | — |
| Lists strip / first row | 225.8 / 297.8 | 255.8 / 327.8 | — | 181.8 / 253.8 | 225.8 / 297.8 |

Create mode is the resting mockups' geometry, plus the header button.

## How they were drawn

- **The harness is in the repo: `ai/ux/source/`** (user, fourth round). Its README says how to render and what was
  calibrated. Task 20 step 6's Sharing harness no longer exists (not in the repo or in any session scratchpad), so this
  one was rebuilt: `mock.html` + `mock.js`, vanilla DOM + inline SVG. It ports each component's geometry:
  - `Sky` `STARS`, `Horizon` `HILL_EDGE` and its 170×72 celestial box, `Hillside`, `SkyFill` `FILL_STARS`, `Band`
    `WAVES`;
  - `ListRow`, `ItemRow`, `AddBar`, `PillButton`, `IconButton`, `SegmentedPicker`, `ShowDeletedToggle`, `EmptyState`;
  - both screens' paddings.
- New glyphs, all in the 24 box, stroke 2, round caps, in `PencilIcon`'s style:
  - `SearchIcon`: circle (10.5, 10.5) r 6.5, plus `M15.5 15.5L20 20`.
  - `PlusIcon`: `M12 5v14M5 12h14`.
  - `CloseIcon`: `M6.5 6.5l11 11M17.5 6.5l-11 11`.
  - `ArrowUpIcon`: `M12 19V5M6.5 10.5L12 5l5.5 5.5`, round joins. `ArrowDownIcon` mirrors it.
- Tokens: `tokens.mjs` runs on Node 24 and imports `src/theme.ts` and `src/state/bands.ts` directly (type stripping).
  It writes `tokens.json`, regenerated on every render and git-ignored. The palettes and `bandAt(…, 0..63)` are the
  real ones, not a copy.
- Fonts: the app's own TTFs, loaded from `node_modules/@expo-google-fonts` (`render.sh` serves the repo root). Nunito Sans hhea = typo, 1011/−353, a 1.364 em line.
  Source Serif 4 is 1036/−335, a 1.371 em line. CSS `line-height: normal` therefore matches iOS's natural line height.
- Rim gradients use white at `stop-opacity` 0.2 → 0, because react-native-svg replaces the token's own alpha
  (KB phone-is-the-product).
- Export: `render.sh` runs Playwright's `chrome-headless-shell` (`~/Library/Caches/ms-playwright/chromium_headless_shell-1223`)
  against a `python3 -m http.server` on the repo root, with flags `--force-device-scale-factor=3 --window-size=390,844 --virtual-time-budget=4000 --screenshot`.
- **Calibration** against task 20 step 5's 17e shots (`lists-day.png`, `list-detail-bin-shown-{day,night}.png`), on the
  same canvas: per-region best offsets, found by search at ±4 pt.
  - Lists title, Account, bar, toggle, sun, rows and trash: all within 0.67 pt (−0.33 pt dy throughout, sub-pixel).
  - List detail Back, pills, bar, toggle, moon and rows: 0.00–0.33 pt.
  - **The List detail title was 1.33 pt low.** iOS sets a 40 pt glyph in a 52 pt `lineHeight` higher than CSS
    half-leading does. Corrected with `top: −1.33` and re-measured at 0.00 pt.
- Measured: every sort face fits, arrow included (20 pt for glyph + gap). At 390 pt, `To Do First` needs 76 pt in a
  97 pt room (101 at 402), `Date ↑` 54 in 97 (157 on Lists), `A–Z` 28.
- Contrast (`contrastRatio`). Against the sky, the figure is the worse of `skyTop` and `skyHorizon`.

  | pair | day | night | floor |
  |---|---|---|---|
  | coverage line `textSecondary`/sky | **4.93** | 7.61 | 4.5 |
  | `Try again`, toggle label `text`/sky | 10.27 | 14.65 | 4.5 |
  | bin sentence, query, off sort buttons `text`/`surface` | 12.00 | 11.74 | 4.5 |
  | on sort buttons `onPrimary`/`primary` | 10.86 | 12.60 | 4.5 |
  | field glyph, clear × `textMuted`/`surface` | 4.07 | 6.10 | 3.0 |
  | header glyph (Plus, magnifier) `text`/sky | 10.27 | 14.65 | 3.0 |
  | dot `primary`/sky | 9.39 | 13.18 | 3.0 |
  | empty bin `bandAt(0).ink`/band 0 | 9.43 | 5.27 | 4.5 |

## Problems

- Desktop Chrome `--headless=new --screenshot` hung after the first image and left four processes behind (they were found
  by PID; the PID counter had wrapped past 99999). Switched to `chrome-headless-shell`, which exits after each shot, ~2 s.
- The Lists bin sentence wrapped (Q6 above). The sorted image first pushed `Bananas` off the bottom, so two to-do rows were
  dropped to keep all three done rows in view.
- The first round was drawn, reviewed and replaced by the second round the same day: a single-choice `SegmentedPicker`,
  and a magnifier opening a panel with `Cancel`. Nothing of it remains in `ai/ux/primary/`.
- The second round was committed as `3ccf224` "25 mockups" (amended by the user to include the fourth round). The third round re-rendered only `lists-screen-search` and
  `list-detail-screen-search` (button order). The bin and sorted images did not change.

## Notes for steps 2 and 3

- **List detail's status-bar strip uses the constant `DRAWN_SKY_H` (224)**, the resting header's height. Search mode,
  now the default, makes the header 268–318 pt, so the strip's gradient slice no longer lines up with the sky under it.
  Sharing measures `skyHeight` by `onLayout` for the same reason (task 20 step 6). Step 3 should do the same.
- The magnifier's dot ring is `skyTop`. At y 60–96 the sky is between `skyTop` and `skyHorizon`, which differ by a few
  levels, so the ring reads as a cut-out.
- Step 2 lands before search exists. Its bin sentence takes the bar's 52 pt. The 44 pt sky under it arrives with step 3's
  search mode.
- Step 2: the slot holds the bin sentence only for an editor. A reader keeps the read-only notice, and a binned list
  keeps its notice (step 2's description).

## KB candidates (for the librarian, after sign-off)

- phone-is-the-product: the eighteen new mockups and the state each shows (table above). The resting
  `lists-screen-quiet-horizon*` / `list-detail-screen-quiet-horizon*` now picture create mode, not rest; rest is search
  mode. `list-detail-screen-quiet-horizon*.png`'s rows also predate `a7416fd`: the app draws a band per item row, and so
  do the new List detail mockups.
- phone-is-the-product, or a new entry: mockups are drawn by `ai/ux/source/` (`render.sh <out> <scene>...`), an HTML
  harness calibrated to within 0.67 pt of the 17e simulator. iOS sits a `lineHeight`-constrained serif title 1.33 pt
  higher than CSS does. A mockup change is a scene edit plus a render; never hand-edit a PNG.
- phone-is-the-product: the four resting mockups are stale in three ways the app must not follow:
  - they show create mode, not rest;
  - their toggles carry a count (`Show 2 deleted`, `Show 1 deleted`);
  - the List detail one has one pale ground with hairlines, not a band per row.
- Sort model (fixed priority todo → az → date, date always on) is a decision step 3 implements; the librarian should
  record it once step 3 lands, not now.

## Step 3's description, rewritten (user's request, 2026-10-02)

`description-step-3.md` now carries every change above. It replaces:
- the sort table and the stored shape;
- "The query" (now "The query and the mode");
- the magnifier and panel bullets in "Screens";
- the matching tests and verification.

The rule, completing the stream, retrying, the coverage copy and "Accepted, do not fix" are unchanged. It adds one rule,
accepted in the fifth round: **a screen whose live stream is empty and complete opens in create mode**, since there is
nothing to search. That is today's first screen for a new account. The header button stays hidden there until the first
row. This carries over the old description's "magnifier hidden while the live stream is empty and complete".
