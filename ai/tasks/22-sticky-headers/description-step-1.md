# Step 1 — Pin the Lists and List detail headers

User request (2026-09-28), verbatim: "On the Lists Screen and Items Screen the headers (including
the creation input) should be always on top."

"Items Screen" is `ListDetailScreen`. "Header" is the whole `ListHeaderComponent` of each screen's
`FlatList`:
- **Lists:** title row with the Account pill, the sync banner, the Create bar, and the `Horizon`
  strip with Show deleted.
- **List detail:** Back, Rename and Share, the title or rename bar, the sync banner, the Add bar or
  read-only/binned notice, and the `Hillside` strip with Show deleted.

## Approach (plan approved by the user)

- `stickyHeaderIndices={[0]}` on both `FlatList`s. With a `ListHeaderComponent`, index 0 is the
  header cell.
  - RN 0.86 wraps it in `ScrollViewStickyHeader` (native-driver translateY, `zIndex: 10`).
  - react-native-web 0.21 wraps it in a `position: sticky; top: 0; zIndex: 10` View.
- The rows now scroll up behind the header, so every header must be opaque top to bottom.
  - List detail's already is: `SkyFill`, `Hillside`'s own sky rect, and `overscrollSky`.
  - Lists' was transparent over the screen-wide `Sky` layer, and `Horizon` is transparent above the
    hill's curve. It gets its own clipped `<Sky height={SKY_HEIGHT} />` backdrop: the same drawing
    from the same top, so nothing changes at rest.
- A pull-down still carries the header down and shows sky above it, since the sticky header does
  not translate at a negative offset. So the existing overscroll sky on both screens stays.
- The status-bar sky strips existed so that rows scrolling under the status bar stayed on sky. With
  a pinned header, remove them.

## Constraints

- The phone is the product: sign off on the iPhone 17e simulator, and at rest it should look as it
  did. Web only has to work.
- No new unit test: this is a layout prop plus decoration, verified on device.
