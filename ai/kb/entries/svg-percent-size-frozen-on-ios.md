---
id: svg-percent-size-frozen-on-ios
title: On iOS, a react-native-svg drawing sized "100%" keeps its first-layout size when its parent grows — measure with onLayout and pass numbers
type: gotcha
status: current
tags: [ui, svg, ios, layout, react-native-svg]
sources: [ai/tasks/20-ux/implementation-log-step-4.md, src/components/Sky.tsx, src/components/Ground.tsx]
last_verified: 2026-09-27
verify: grep -q 'onLayout=' src/components/Sky.tsx && grep -q '<Svg width={size.width} height={size.height}' src/components/Sky.tsx
related: [absolute-decoration-needs-pointer-events-on-its-wrapper, phone-is-the-product]
indexed: false
---

**The bug:** on iOS, an `<Svg width="100%" height="100%">` is laid out once, and it keeps that size
when the `View` holding it grows later. Its gradient was sized to the drawing's bounding box, so it
stayed short too.

`SkyFill` ([Sky.tsx](../../../src/components/Sky.tsx)) is the sky behind List detail's header. The
header's first render happens while the items are still loading, before the Add bar exists. When
the bar arrived, the region grew, but the sky stayed at its first height. The screen-fixed ground
showed through behind the Add bar. Web and RNTL showed nothing wrong, so this was found only on the
simulator. It cost a round trip in task 20 step 4.

**The fix:** measure the box with `onLayout`, and give the `Svg` and its shapes numbers
(`width={size.width} height={size.height}`). Draw at an `initialHeight` until the first layout
arrives, so the first frame of a pushed screen is already filled. Anything placed inside the
drawing then has to be positioned in points, not as a fraction of the height. `SkyFill`'s night
stars are placed from the top in points (`FILL_STARS`). If they were placed by fraction, they would
jump every time the region grew, for example when a sync banner appeared.

**When percent is still fine:** when the box never changes size after mount. `Ground`
([Ground.tsx](../../../src/components/Ground.tsx)) keeps `width="100%" height="100%"`. It is an
absolute, full-screen layer, so nothing it holds can grow. The `ItemRow` divider uses
`width="100%"` with a fixed numeric height, and a row's width never changes.

**What to do:** give any new SVG background numeric sizes from `onLayout` if its region can
change height after first paint: loading states, banners that come and go, an editor that opens.
Check it on the iOS simulator, where the bug shows.
