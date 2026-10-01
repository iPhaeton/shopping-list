# Step 1 — Mockups for the bin view and the search panel

User requests (2026-10-01), verbatim. This whole task comes from them:

1. "Create the tasks to impleent this suggestion" — the suggestion is
   [ai/suggestions/search-and-sort.md](../../suggestions/search-and-sort.md), sourced from backlog items
   17 ("Search lists / items") and 19 ("Sorting").
2. Its §7 open decisions, answered:
   - Cross-list item search: "Out of this task (Recommended)"
   - Sort memory: "Remember per device (Recommended)"
   - Item sort: "One per list. The value should be stored only if it is not default."
   - Create / Add bar in bin mode: "Hide it (Recommended)"

Decision 5 (control placement) is this step.

| step | delivers |
|---|---|
| 1 (this) | mockups in `ai/ux/primary/`, signed off by the user. No code |
| 2 | "Show deleted" becomes a separate bin view, paged by `deleted_at` descending, on both screens |
| 3 | search and sort over the live rows, on both screens |

The suggestion is the rationale. These descriptions are the scope. Where they differ, the
description wins: decision 3 above replaces the suggestion's "one item sort covers every list".

## Why first

[phone-is-the-product](../../kb/entries/phone-is-the-product.md): the mockups in `ai/ux/primary/` are
the design, and the suggestion's §4 asks for them before code. Steps 2 and 3 build to these images.

## How to draw them

- Draw them the way task 20 step 6 drew Sharing's: HTML rendered with the app's own tokens
  (`src/theme.ts`, both palettes) and fonts (Nunito Sans, Source Serif 4), exported at **1170×2532,
  390×844 pt @3x**. That is the size of the existing set, even though sign-off now happens on the
  iPhone 18 Pro (402×874 pt), which is compared by measure.
- Build on `lists-screen-quiet-horizon[-moonlit].png` and `list-detail-screen-quiet-horizon[-moonlit].png`.
  Only the header controls and the rows change. Sky, sun or moon, birds, bands and hill stay as drawn.
- **Do not redraw or overwrite the four existing resting mockups.** The new images' title rows are
  the design for the magnifier at rest too.
- Use components that exist: `IconButton` (round, as `Back`), `PillButton`, `SegmentedPicker`,
  `ShowDeletedToggle`, `EmptyState`, and the `AddBar` surface (outline, shadow, 20 pt inset) for
  anything that takes the bar's place. The magnifier is a new glyph for `src/components/icons.tsx`,
  drawn in the style of `PencilIcon`/`TrashIcon`.

## The images

Each in day (`-quiet-horizon.png`) and night (`-quiet-horizon-moonlit.png`), so ten files:

| file stem | state |
|---|---|
| `lists-screen-bin` | Show deleted on. Binned lists only, most recently deleted first. No Create bar |
| `list-detail-screen-bin` | Show deleted on, on a live list you can edit. Binned items only, most recently deleted first. No Add bar |
| `lists-screen-search` | Panel open. Query `gro`, sort `A–Z`, a few matching rows, and the `running` coverage line |
| `list-detail-screen-search` | Panel open. Query `mi`, sort `To do first`, matches with one done row last, and the `failed` coverage line with `Try again` |
| `list-detail-screen-search-sorted` | Panel closed, sort `To do first` still applied, no query. Shows how a non-default sort reads at rest |

## What the images must settle

Record each answer in the log, with the user's sign-off.

1. **Where the magnifier goes.** Proposed: a round `IconButton`, labelled `Search and sort`, left of
   `Account` on Lists, and between `Back` and the `Rename`/`Share` pills on List detail.
2. **The search panel.** Proposed: tapping the magnifier swaps the Create / Add bar (or the limit
   sentence, or List detail's read-only / binned notice) for a search field with `Cancel`. This is
   the same in-place swap the rename bar and the limit sentence already make. `Cancel` clears the
   query and closes the panel. The sort stays.
3. **Where the sort picker sits.** Either below the field, which makes the panel taller than the
   bar, or in the horizon strip where `Show deleted` sits. Sharing's role picker uses that strip
   (`Hillside`'s children slot). Either way, **`Show deleted` stays reachable while the panel is
   open.** Options, default first:
   - Lists: `Oldest first` · `Newest first` · `A–Z`
   - List detail: `Added` · `A–Z` · `To do first`
4. **Where the coverage line goes, and `Try again`.** It must be visible whenever rows are filtered
   or sorted over an incomplete stream, **with the panel closed too** (a non-default sort with no
   query still completes the stream). Copy is in step 3; draw it at its longest:
   `Searched the 400 loaded items. The rest need a connection.`
5. **A non-default sort at rest.** Decide whether the closed state shows that a sort is applied, for
   example a dot on the magnifier or the sort's name in the strip. The user may otherwise forget a
   list is sorted A–Z.
6. **What holds the bar's slot in bin mode.** The user chose to hide the bar. Two ways to do it:
   - **Recommended:** a same-height sentence on the bar's surface, the way the limit sentence holds
     the Create bar's place on Lists. Collapsing the slot moves `Show deleted` up by the bar's
     height right under the finger that just tapped it. Proposed copy: Lists `Deleted lists, newest
     first. Restore one to bring it back.`; List detail `Deleted items, newest first.`
   - The slot collapses and the hill follows the title, as on Sharing's member view.
7. **The toggle when the bin is empty.** In bin mode it stays rendered after the last row is
   restored, so it can say `0`. Proposed label: `Show deleted`, with no number. The empty bin reads
   `The bin is empty`. Proposed hint: `Deleted lists wait here for 30 days.` / `Deleted items wait
   here for 30 days.`

## Constraints

- Phone first: portrait, both themes. Web is not drawn.
- Every interactive element has to be reachable through an a11y label
  ([queries-go-through-a11y-labels](../../kb/entries/queries-go-through-a11y-labels.md)). Name each
  label next to its control in the log.
- The sticky header stays opaque top to bottom, since rows scroll under it
  ([list-headers-are-pinned-and-opaque](../../kb/entries/list-headers-are-pinned-and-opaque.md)).
- Segment titles must fit at 390 pt without truncation. At 402 pt they fit by construction.
- Colour pairs on bands meet AA. Take `ink` from `bandAt`, as Sharing's hints did.

## Done when

- The ten PNGs are in `ai/ux/primary/`.
- The log records, for each question above, the answer and that the user accepted it, plus the
  final copy table that step 3 asserts verbatim.
- The user has signed off. Steps 2 and 3 do not start before that.

## KB impact (for the librarian)

| entry | change |
|---|---|
| phone-is-the-product | the new mockups are part of the design: which files, and which state each shows |
| scope-boundaries | nothing yet. Steps 2 and 3 bring the scope change |
