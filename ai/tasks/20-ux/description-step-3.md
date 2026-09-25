# Step 3 — The Lists screen, built to the mockup

Build `ListsScreen` to match `ai/ux/primary/lists-screen-quiet-horizon.png` (day) and
`…-moonlit.png` (night). Palette, all design images, task plan, and phone-first rules: `description-step-1.md`.
`AddBar` and the Show deleted switch also appear in the List detail mockups; check your restyle
against those too, since step 4 reuses both.
Measure the images in points (px ÷ 3). Build both themes; Auto (step 2) just picks one of them.

## Composition, top to bottom

1. **Sky.** A full-bleed background: a pale vertical gradient by day, deep navy by night. At night,
   add small stars at fixed positions (deterministic, not re-randomized on each render). The status
   bar sits over the sky.
2. **Title row.** "My Lists" in the serif display face (~40 pt) on the left, and an outlined pill
   "Account" on the right, on one line. It replaces the native header on this screen: either hide the
   header and render the row in the screen (mind the safe-area inset), or use a custom header
   component.
3. **Sync banner.** A pill with a cloud-outline icon and the sentence unchanged. A decorative cloud
   puff rises from its top-left edge. The fill is lighter than the sky by day, and a lighter navy by
   night.
4. **Add bar.** One pill container, holding a borderless input and, at its right, a filled pill
   `Create` button. `AddBar` is shared with List detail (add item, rename list): restyle the
   component itself, not a Lists-only copy.
5. **Show deleted** becomes an on/off switch (track + knob). The label is unchanged (`Show 2 deleted`).
6. **Horizon.** Behind the toggle row, on the right, the sun or moon sits half-sunk behind the first
   band. The day sun has a warm glow, with three small birds to its left. The night moon has a soft
   halo.
7. **Rows are horizon bands.** Each list is a full-width band: no card, border, or radius. Its top
   edge is a gentle wave that overlaps the band above. Colors step from light at the top to dark at
   the bottom, using the step-1 ramp.
   - A row's color depends on its **index, not the list count**, so creating a list never recolors
     the others. Past the ramp's last step, hold the color or keep darkening subtly (your call), but
     adjacent rows must stay distinguishable; the wave edge can carry that.
   - Pick each band's text color **by contrast** (WCAG AA, 4.5:1, for both name and subtitle), never
     by a hardcoded index. By day that gives dark ink on the top three bands and white on the rest.
   - The last band runs to the bottom of the screen, under the home indicator, so a short list never
     shows sky beneath it. Overscroll shows sky above and ground below, never a seam.
   - The header block (items 2–6) scrolls with the bands as one composition, e.g. as the `FlatList`'s
     `ListHeaderComponent`.
8. **Row content.**
   - The name, in the sans (~22 pt, medium).
   - For a list shared with you, the subtitle from the mockup: `Shared with you · can edit` for a
     `writer`, `Shared with you · view only` for a `reader`. An owner's rows have no subtitle.
   - On the right, a circular icon button (translucent white over the band — stronger by day, fainter
     by night), then a chevron. The button shows a trash icon, or a restore icon on a binned row.
   - A binned row keeps a visible "Deleted" tag.
9. **Empty and loading states.** Both sit on the sky with the sun or moon. The empty state shows one
   empty band and the existing copy, word for word.

Shapes and icons (waves, sun/moon, birds, stars, cloud, trash, restore, chevron): the expected route
is `react-native-svg` via `npx expo install`. Web and Expo Go ship it; the dev client needs a rebuild
(`ai/kb/entries/native-build-toolchain.md`). Every fill comes from theme tokens. Hide all decoration
from screen readers.

## Constraints

- **Labels.** `ListRow`'s a11y label stays `name` / `name, shared with you`, and the `Restore` /
  `Delete` label flip stays. The `verify:` in `ai/kb/entries/queries-go-through-a11y-labels.md` pins
  both. The *visible* subtitle does change: update `getByText('Shared with you')` in
  `ListsScreen.test.tsx`, and add a reader case and a writer case.
- **The switch** gets `accessibilityRole="switch"` with `{ checked }`, since a switch announced as a
  checkbox is wrong. `toBeChecked` works on switches. The `itemLabels()` helper in
  `ListDetailScreen.test.tsx` filters the toggle out of `getAllByRole('checkbox')`; that filter
  becomes redundant. The KB table still says `checkbox`: record the change in the log.
- **The Account button.** If it leaves `RootNavigator`'s `options={({ navigation }) => …}`, one
  `verify:` clause in `ai/kb/entries/screens-take-navigation-props.md` stops matching. That is a
  changed fact, not a broken build. The screen still takes `navigation` as a prop and calls
  `navigation.navigate('Account')`, never a hook. Say so in the log so the librarian updates the
  entry. The button also becomes testable in `ListsScreen.test.tsx`; add that test.
- Lists are capped, not paged: every band up to `MAX_ROWS` must scroll smoothly.

## Done when

- An iPhone 17e simulator screenshot, side by side with each Lists image, reads as the same design:
  same composition, colors within a few shades, same type hierarchy. Use the mockup's own state: the
  same six lists with the same roles, two in the bin, and two pending changes (to raise the banner,
  cut the app off from the local stack, e.g. stop the stack briefly).
- Also checked on the simulator: 0, 1, and 15 lists; the bin shown; a long list name, which wraps or
  truncates cleanly; the sync banner appearing and leaving. Do one pass each on the iPhone 17 Pro Max
  and the Android emulator. On web every state must work; its looks may differ.
- `npm test`, `npm run typecheck`, and `npm run kb:audit` pass. The one exception is the
  screens-take-navigation-props clause, if changed deliberately — name it in the log.
- Day and night screenshots of the mockup state and the edge cases are in
  `ai/tasks/20-ux/screenshots/step-3/`.
