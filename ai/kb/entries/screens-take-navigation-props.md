---
id: screens-take-navigation-props
title: Screens take navigation/route as props, never useNavigation()
type: convention
status: current
tags: [navigation, screens, testing]
sources: [ai/tasks/1/implementation-log-step-1.md, 6ef87a2]
last_verified: 2026-08-26
verify: ! grep -rqE 'useNavigation\(|useRoute\(' src/screens --include='*.tsx' --exclude='*.test.tsx'
related: [rntl-14-api-changes]
---

Screens receive `navigation` and `route` as props and never call `useNavigation()` or
`useRoute()`. [src/navigation/types.ts](../../../src/navigation/types.ts) is the source of truth for
route params — `RootStackParamList` plus the per-screen prop types derived from it.

**Why it matters:** component tests render a screen with a stub
(`{ navigate: jest.fn(), setOptions: jest.fn() }`) instead of standing up a whole
`NavigationContainer`. See the header comment in
[src/screens/ListsScreen.test.tsx](../../../src/screens/ListsScreen.test.tsx).

**What to do:** a new screen adds its params to `RootStackParamList` and takes the generated props
type. If a deeply nested component needs navigation, thread a callback down rather than reaching
for the hook — that keeps the component testable without a navigator too.

The `verify:` command sweeps **all** of `src/screens/`, not just today's two files, and covers
`useRoute()` as well as `useNavigation()`, so a newly added screen cannot slip past it. Test files
are excluded because `ListsScreen.test.tsx` names `useNavigation()` in a header comment.
