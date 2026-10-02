---
id: list-headers-are-pinned-and-opaque
title: Lists, List detail and Sharing pin their whole header inside their scroll view, so each header must be opaque — and List detail's and Sharing's status-bar strips hide an unexplained iOS blur, not scrolling rows
type: decision
status: current
tags: [ui, layout, flatlist, scrollview, ios, design, sharing]
sources: [ai/tasks/22-sticky-headers/description-step-1.md, ai/tasks/22-sticky-headers/implementation-log-step-1.md, ai/tasks/22-sticky-headers/implementation-log-step-2.md, ai/tasks/20-ux/description-step-6.md, ai/tasks/20-ux/implementation-log-step-6.md, ai/tasks/23-list-limits/implementation-log-step-1.md, ai/tasks/24-search-and-sort/implementation-log-step-2.md]
last_verified: 2026-10-02
verify: grep -q 'stickyHeaderIndices={\[0\]}' src/screens/ListsScreen.tsx && grep -q 'stickyHeaderIndices={\[0\]}' src/screens/ListDetailScreen.tsx && grep -q 'ListHeaderComponent={header}' src/screens/ListsScreen.tsx && grep -q 'ListHeaderComponent={header}' src/screens/ListDetailScreen.tsx && grep -q 'style={styles.headerSky}' src/screens/ListsScreen.tsx && test "$(grep -c '<Sky height={SKY_HEIGHT} />' src/screens/ListsScreen.tsx)" = 2 && ! grep -q statusBarSky src/screens/ListsScreen.tsx && grep -q 'styles.statusBarSky, { height: insets.top }' src/screens/ListDetailScreen.tsx && grep -q '<View style={styles.header}>' src/screens/ListDetailScreen.tsx && grep -A1 '^  header: {' src/screens/ListDetailScreen.tsx | grep -q 'backgroundColor: colors.skyHorizon' && grep -q 'stickyHeaderIndices={\[0\]}' src/screens/SharingScreen.tsx && grep -q 'styles.statusBarSky, { height: insets.top }' src/screens/SharingScreen.tsx && grep -A1 '^  header: {' src/screens/SharingScreen.tsx | grep -q 'backgroundColor: colors.skyHorizon'
related: [phone-is-the-product, screens-take-navigation-props, maestro-drives-the-native-ui, svg-percent-size-frozen-on-ios, absolute-decoration-needs-pointer-events-on-its-wrapper]
indexed: false
---

**The user's requirement (task 22, 2026-09-28): on Lists and List detail the header, Create or Add
bar included, is always on top.** "Header" is each screen's whole `ListHeaderComponent`: the title
row, the sync banner, the bar (or the `BarSentence` holding its slot), and the
`Horizon`/`Hillside` strip with Show deleted. Both
`FlatList`s pin it with `stickyHeaderIndices={[0]}`. With a `ListHeaderComponent`, index 0 is the
header cell.

**Sharing joined them in task 20 step 6**, by the user's request that its header be sticky and
drawn like the other two. It is a `ScrollView`, not a `FlatList`: `stickyHeaderIndices={[0]}` with
the header as child 0 (Back, title, an owner's invite bar, `Hillside` with the invite role picker
in Show deleted's slot), and List detail's layers copied — the `skyHorizon` fill, `overscrollSky`,
`SkyFill` — for the reasons below. The invite suggestions hang out of the pinned header over the
cards; rows below the header's own edge still take taps on iOS and web, for the reason
`UserAutocomplete`'s doc comment gives, and that is unverified on Android.

**The header stays inside the list on purpose.** Moving it above the `FlatList` was rejected. It
would stop riding a pull-down bounce, and a top overscroll would open a gap between the hill and
row 0 that needs its own band-0 cover. A sticky header does not translate at a negative offset, so
it bounces down with the content, and the overscroll sky already there (Lists' screen-wide `Sky`
layer, List detail's `overscrollSky`) fills the space above it unchanged.

**Every header must be opaque top to bottom, because rows now scroll up behind it.**

- [ListsScreen](../../../src/screens/ListsScreen.tsx)'s header carries its own clipped
  `<Sky height={SKY_HEIGHT} />` (`styles.headerSky`). It is the same drawing from the same top as
  the screen-wide `Sky` layer, so at rest it matches pixel for pixel and **looks redundant. It is
  not**: without it the rows show through, above the hill's curve most of all, where `Horizon` is
  transparent. Its height is a number because of
  [svg-percent-size-frozen-on-ios](svg-percent-size-frozen-on-ios.md), and its wrapper carries
  `pointerEvents="none"` per
  [absolute-decoration-needs-pointer-events-on-its-wrapper](absolute-decoration-needs-pointer-events-on-its-wrapper.md).
- [ListDetailScreen](../../../src/screens/ListDetailScreen.tsx)'s header has three layers:
  `SkyFill` behind the padded block, `Hillside`'s own sky rect under the hill, and a
  `skyHorizon` fill on the outer `View` (`styles.header`) under both. **The fill also looks
  redundant, and iOS proves it invisible: a HEAD-vs-fix relaunch on the iPhone 17e was
  pixel-identical. It is not redundant.** On Android at 2.625× (`Pixel_10`), the two drawings
  leave one pixel row uncovered where they meet. That row shows the root View's colour, the band
  of the last visible row, as a light line across the screen under the Add bar (pixel row 606 on
  the seeded Groceries). `skyHorizon` is the colour on both sides of that seam, so the gap reads as sky.
  Which drawing leaves the row was never pinned down, and the fill makes it moot. Lists has no
  such seam, because its header sky is one clipped drawing.
- Anything added to any of these headers has to keep it that way. A transparent gap is a window onto the
  rows.

**Status-bar strips: gone on Lists, kept on List detail for a different reason.** Both screens had
a strip over the status bar so that rows scrolling up there stayed on sky. A pinned header ends
that job. Lists' strip went; it had also squeezed the whole 520 pt gradient and its stars into
~47 pt, which left a faint seam. **List detail's strip stays, because without it iOS shows a light
blur over the top ~47 pt of that screen**: (45,54,84) against the sky's (16,22,46), with the stars
blurred. It shows pinned or not, and never over Lists. **It is not `FlatList`'s**: Sharing's
header, a plain `ScrollView`, showed the same blur by night the moment it left `Backdrop` (whose own
status-bar slice had sat above the old scroll view), and the same strip cured it. It predates task 22: the commit before it,
with only the strip zeroed, shows it identically, so the strip had been hiding it all along. These
were tried and changed no pixel, so do not retry them:

- react-native-screens `scrollEdgeEffects` with `top: 'hidden'` and with `'hard'`, both as a static
  option in `RootNavigator` and as a post-mount `navigation.setOptions`. RNS 4.26 applies the
  option when it changes, to the scroll view it finds in the first-child chain at that moment.
- Breaking that first-child chain with a non-collapsible empty first child.

A sibling drawn above the `KeyboardAvoidingView` covers the blur, so its source is in the scroll
view's subtree or below. The source is still unidentified. Removing the strip brings the blur back.

**One consequence still waits on the user's sign-off.** Below its curve, the hill (at most
`HILL_H` = 20 pt) stays band 0's colour whatever row scrolls beneath it, and meets that row along a
straight edge. It shows most in Day, where band 0 is the lightest lavender. It follows from pinning
a header whose bottom edge is row 0's top edge. The step-22 log flags it for the user. Do not
"fix" it unasked; update this entry once the user decides.

**Nothing in jest covers any of this.** The `ScrollView` mock ignores sticky indices, so it was
verified on the iPhone 17e, on `Pixel_10`, and on web, where react-native-web 0.21 renders the
header cell as `position: sticky`; Sharing on the iPhone 18 Pro and web only. Lists' own paging
(`onEndReached`, task 23) under its pinned header was exercised on web and the iPhone 18 Pro, the
spinner sitting at the top of the ground-coloured footer; List detail's items paging under its pinned
header only on web (task 24 step 2, a 500-row bin), never on a phone. For Maestro, rows behind the
header are still in the hierarchy at their real coordinates: see [maestro-drives-the-native-ui](maestro-drives-the-native-ui.md).

The `verify:` asserts both lists pin index 0 of their `ListHeaderComponent`, Lists' header draws its
own `Sky` beside the screen-wide one, Lists has no status-bar strip, List detail and Sharing still
have one, and both of their header `View`s still carry the `skyHorizon` fill; Sharing pins child 0.
