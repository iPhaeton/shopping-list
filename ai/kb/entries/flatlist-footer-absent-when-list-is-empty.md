---
id: flatlist-footer-absent-when-list-is-empty
title: FlatList's ListFooterComponent does not render when ListEmptyComponent is showing — a guaranteed minimum height has to be set on both, separately
type: gotcha
status: current
tags: [ui, flatlist, react-native]
sources: [ai/tasks/20-ux/implementation-log-step-3.md, src/screens/ListsScreen.tsx]
last_verified: 2026-09-26
verify: grep -q 'ListFooterComponent={loading || visible.length === 0 ? null' src/screens/ListsScreen.tsx && grep -q 'minHeight: SKY_HEIGHT' src/screens/ListsScreen.tsx && grep -q 'Band index={0} style={styles.footer}' src/screens/ListsScreen.tsx
related: [absolute-decoration-needs-pointer-events-on-its-wrapper]
indexed: false
---

**The bug this fixed:** `ListsScreen`'s bounded `Sky` layer (a fixed-height absolute background
behind the `FlatList`) showed through below a short or empty list — its stars visible mid-screen, a
real seam, not a rendering glitch. `flexGrow: 1` on `contentContainerStyle` and on
`ListEmptyComponent` both measured `flexGrow: 0` at runtime instead (confirmed by inspecting the
actual DOM on web, not assumed from the docs) — `flexGrow` does not propagate through `FlatList`'s
content container the way it might elsewhere, so it was never going to close the gap.

**The actual fix needed two separate guarantees, not one, because of a second undocumented
behavior: `ListFooterComponent` does not render at all while `ListEmptyComponent` is showing**
(confirmed by inspection; React Native's docs don't say so explicitly). A `visible.length > 0` guard
around `ListFooterComponent` is therefore not an optimization, it is load-bearing — without it the
footer would still never appear for an empty list regardless, since `FlatList` already suppresses it
there, but leaving the guard out is what makes that fact easy to miss.

**What to do:** anything that needs guaranteed trailing content or background height, "empty" and
"short but non-empty" are two different render paths and each needs its own fix:
- `ListEmptyComponent` gets a concrete `minHeight` directly (here, wrapped in a `Band` with
  `style={styles.footer}`, `minHeight: SKY_HEIGHT`).
- `ListFooterComponent`, rendered only when the list is non-empty, gets the *same* `minHeight` on its
  own element, for the short-but-not-empty case.

Do not reach for `flexGrow` on `FlatList`'s content container or on `ListEmptyComponent` to solve
this — it does not propagate the way it does in a plain flex layout, verified empirically both ways.
A stale Metro/Fast-Refresh state can also make this look unfixed after a real fix lands: a full
process restart (kill + restart, not just a page reload) was needed once during this investigation
before a `minHeight` change actually took effect on web.
