---
id: absolute-decoration-needs-pointer-events-on-its-wrapper
title: A decorative position:absolute layer needs pointerEvents="none" on its own outermost View, not just on an inner leaf
type: gotcha
status: current
tags: [ui, web, layout, accessibility]
sources: [ai/tasks/20-ux/implementation-log-step-3.md, src/screens/ListsScreen.tsx, src/components/Band.tsx, src/components/Horizon.tsx, src/components/SyncBanner.tsx]
last_verified: 2026-09-26
verify: test "$(grep -c 'pointerEvents="none"' src/screens/ListsScreen.tsx)" -ge 2 && grep -q "position: 'absolute'" src/screens/ListsScreen.tsx && for f in src/components/Band.tsx src/components/Horizon.tsx src/components/SyncBanner.tsx; do grep -q 'pointerEvents="none"' "$f" || exit 1; done
related: [phone-is-the-product, flatlist-footer-absent-when-list-is-empty, svg-percent-size-frozen-on-ios]
indexed: false
---

**The bug this fixed:** on web, `ListsScreen`'s full-bleed `Sky` layer — an absolutely positioned
`View` behind the `FlatList`, holding an `<Svg>` gradient — silently ate every tap on the header and
the first several rows. `<Svg pointerEvents="none">` was already set on the graphic itself; that was
not enough.

**Why:** an absolutely positioned sibling paints, and *receives touches*, above a
`position: static` sibling regardless of JSX/DOM order — a plain CSS stacking rule on web, not a
React Native quirk. `Sky`'s wrapping `View` was earlier in the JSX than the `FlatList`, which made no
difference: being `position: absolute` put it on top for hit-testing as well as paint. The `<Svg>`'s
own `pointerEvents="none"` only stopped the `Svg` itself from claiming a touch; the `View` wrapping
it still did.

**The fix, and the rule it generalises to:** add `pointerEvents="none"` to the outermost element
that *establishes* the absolute stacking context — the wrapper `View`, not the leaf graphic inside
it. Every other decorative absolute layer in this codebase (`Band`'s wave, `Horizon`'s sun/moon,
`SyncBanner`'s cloud puff) already had it on the right element, from being written with this bug in
mind; `Sky`'s wrapper, added last, was the one instance that got missed — costing a real debugging
cycle on an otherwise-working screen.

**Not every absolute layer wants `"none"`.** `ListRow`'s delete/restore `IconButton` is also
absolutely positioned (over a spacer reserved inside the row's flex layout), and it is meant to
receive touches — it carries `pointerEvents="box-none"` on its own wrapper instead, so the row
underneath stays tappable everywhere except where the button itself sits. The decision is not
"absolute layers get `pointerEvents`" but "pick the value — `none`, `box-none`, or default — for
what the layer should and shouldn't intercept, on the View that starts the absolute stacking, not a
descendant."

**What to do:** any new full-bleed or overlay decoration — a gradient, a highlight, a badge — gets
its `pointerEvents` value set on its own top-level wrapper, before it ships, not discovered by a tap
that mysteriously does nothing. Test this on **web**; RNTL and the simulators do not surface the CSS
stacking behavior that exposed it here.
