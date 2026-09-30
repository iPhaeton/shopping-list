---
id: svg-percent-size-frozen-on-ios
title: On iOS, a react-native-svg drawing sized "100%" keeps its first-layout size when its parent grows — measure with onLayout and pass numbers
type: gotcha
status: current
tags: [ui, svg, ios, layout, react-native-svg]
sources: [ai/tasks/20-ux/implementation-log-step-4.md, ai/tasks/20-ux/implementation-log-step-5.md, ai/tasks/20-ux/implementation-log-step-6.md, src/components/Sky.tsx, a7416fd]
last_verified: 2026-09-30
verify: grep -q 'onLayout=' src/components/Sky.tsx && grep -q '<Svg width={size.width} height={size.height}' src/components/Sky.tsx && ! grep -rqE '^ +height="100%"|<Svg[^>]*height="100%"' src --include='*.tsx'
related: [absolute-decoration-needs-pointer-events-on-its-wrapper, phone-is-the-product]
indexed: false
---

**The bug:** on iOS, an `<Svg width="100%" height="100%">` is laid out once, and it keeps that size
when the `View` holding it grows later. Its gradient was sized to the drawing's bounding box, so it
stayed short too.

`SkyFill` ([Sky.tsx](../../../src/components/Sky.tsx)) is the sky behind List detail's header, and
since task 20 step 6 Sharing's, whose status-bar strip draws it at the height `onLayout` measured.
List detail's header first renders while the items are still loading, before the Add bar exists.
When the bar arrived, the region grew, but the sky stayed at its first height. The screen-fixed ground
showed through behind the Add bar. Web and RNTL showed nothing wrong, so this was found only on the
simulator. It cost a round trip in task 20 step 4.

**The fix:** measure the box with `onLayout`, and give the `Svg` and its shapes numbers
(`width={size.width} height={size.height}`). Draw at an `initialHeight` until the first layout
arrives, so the first frame of a pushed screen is already filled. Anything placed inside the
drawing then has to be positioned in points, not as a fraction of the height. `SkyFill`'s night
stars are placed from the top in points (`FILL_STARS`). If they were placed by fraction, they would
jump every time the region grew, for example when a sync banner appeared.

**When percent is still fine:** for a width that never changes after mount, beside a numeric
height. `Sky`'s own drawing, `Band`'s wave and `Horizon`'s hill are `width="100%"` with a fixed
height and a `viewBox`; the app is portrait-only, so a row's or a screen's width does not move. No
drawing is sized by a percent **height** any more — `Ground`, the last, went in `a7416fd` — and
task 20 step 5's full-screen art (`Landscape`, `ScreenSky`, `HorizonFooter`) takes numbers from
`useWindowDimensions`. The `verify:` keeps a percent height out of `src/`.

**What to do:** give any new SVG background numeric sizes from `onLayout` if its region can
change height after first paint: loading states, banners that come and go, an editor that opens.
Check it on the iOS simulator, where the bug shows.
