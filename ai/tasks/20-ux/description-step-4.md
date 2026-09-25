# Step 4 — The List detail screen

Build `ListDetailScreen` to match `ai/ux/primary/list-detail-screen-quiet-horizon.png` (day) and
`…-moonlit.png` (night). Palette, all design images, task plan, and phone-first rules: `description-step-1.md`; the
item-ground, hill, done-text, checkbox, icon-fill, and divider colors there are the exact values
these two images were drawn with.

The images show one state: an owner's `Groceries`, editable, ten items (three done), one item in the
bin with the bin hidden, nothing pending. Every other state below is yours to draw, in the same
language.

Exact geometry of the drawing, in points: the header row at y 60 (a 36 pt round back button, 36 pt
pills); the title at y 104, serif 40 pt; the add bar at y 172, 52 tall; the toggle at y 240; the hill
crest around y 283–300; rows 60 pt tall from y 306. In each row: the checkbox is 26 pt at x 24; the
title starts at x 64 (sans 19 pt, weight 500; done: weight 400, struck through); and the icon buttons
are 36 pt at x 280 and x 328, with 16 pt glyphs.

## What changes

- **Header, as drawn.**
  - A round, outlined back button with a chevron on the left. Outlined `Rename` and `Share` pills on
    the right. The list name below, in the serif display face.
  - The pills' visible text is `Rename` / `Share`, but their a11y labels stay `Rename list` /
    `Share list`. A visible text shorter than the label already has precedent: `BlockedBanner`'s
    `Discard`.
  - Back must keep working everywhere: the native back swipe on iOS, browser back on web, and the
    hardware back on Android. The drawn back button needs a role and a label.
- **Horizon, then ground, as drawn.** Below the Show deleted row, the sun (day, with birds) or moon
  (night) sits behind a far hill and the front of the land. The items sit on one continuous ground,
  never a band per item, since a list can hold hundreds of paged items.
  - Hairline wave dividers separate the rows, their swell alternating in phase from row to row.
  - The ground's gradient belongs to the screen, not the content: a 200-item list must not stretch
    it into a flat color.
  - Scrolling must never show a seam where the hill meets the ground.
- **`ItemRow`, as drawn.**
  - A round checkbox: outlined when open; primary fill with a primary-label tick when done.
  - The title in the sans. A done item is struck through and uses the done-text color.
  - `Rename` and `Delete` become the pencil and trash icon buttons, keeping their labels.
- **`ItemRow`, not drawn.**
  - A binned item gets a restore icon (label `Restore <title>`) in place of the trash, keeps a
    visible "Deleted" tag, and its checkbox looks disabled.
  - A reader's rows have no icon buttons, and their checkboxes look disabled.
  - The inline rename editor takes the add bar's pill look.
- **Notices (not drawn).** Restyle these in the pill/card language, with every word of copy kept:
  - the read-only line
  - the binned-list notice and its Restore button
  - `BlockedBanner`
  - `ErrorBanner`
  - `SyncBanner`
- The "Loading list items" and "Loading more items" spinners and the `List not found` empty state
  sit on the theme.
- `AddBar` (add item, rename list) and the Show deleted switch were restyled in step 3. Check them
  here, in this layout.

## Constraints

- `ItemRow` stays `accessibilityRole="checkbox"` with
  `{ checked: done, disabled: !editable || deleted }`, and every label stays as it is. The `verify:`
  in `ai/kb/entries/queries-go-through-a11y-labels.md` pins them.
- The header buttons still come from `navigation.setOptions`, or an equivalent that
  `ListDetailScreen.test.tsx`'s `Chrome` wrapper can render in the same tree. Assertions on
  `setOptions` keep using `expect.objectContaining` (`ai/kb/entries/screens-take-navigation-props.md`).
- Any new header or scroll structure keeps paging (`onEndReached`) and `KeyboardAvoidingView`
  working. On iOS, the add bar stays visible above an open keyboard.

## Done when

- An iPhone 17e simulator screenshot, side by side with each List detail image, reads as the same
  design: same composition, same colors, same type. Use the drawn state: the same ten items, with
  the same three done and one in the bin.
- Checked on the simulator in both themes, in each of these states, then once on the iPhone 17 Pro
  Max and the Android emulator. On web every state must work; its looks may differ.
  - an empty list, 3 items, and 60+ items (scroll into page 2)
  - done items
  - a binned list, seen by its owner and by a non-owner
  - a reader, who sees it read-only
  - the rename editor open, and the keyboard open
  - the bin shown
- `npm test`, `npm run typecheck`, and `npm run kb:audit` pass.
- Day and night screenshots of those states are in `ai/tasks/20-ux/screenshots/step-4/`.
