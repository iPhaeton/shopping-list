---
id: screens-take-navigation-props
title: Screens take navigation/route as props, never useNavigation()
type: convention
status: current
tags: [navigation, screens, testing]
sources: [ai/tasks/1/implementation-log-step-1.md, ai/tasks/2/implementation-log-step-2.md, ai/tasks/3/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-2.md, 6ef87a2]
last_verified: 2026-09-09
verify: ! grep -rqE 'useNavigation\(|useRoute\(' src/screens --include='*.tsx' --exclude='*.test.tsx' && grep -q 'Sharing: { listId: string }' src/navigation/types.ts && grep -q 'headerRight' src/screens/ListDetailScreen.test.tsx
related: [rntl-14-api-changes, queries-go-through-a11y-labels]
---

Screens receive `navigation` and `route` as props and never call `useNavigation()` or
`useRoute()`. [src/navigation/types.ts](../../../src/navigation/types.ts) is the source of truth for
route params — `RootStackParamList` plus the per-screen prop types derived from it.

**Why it matters:** component tests render a screen with a stub
(`{ navigate: jest.fn(), setOptions: jest.fn() }`) instead of standing up a whole
`NavigationContainer`. See the header comment in
[src/screens/ListsScreen.test.tsx](../../../src/screens/ListsScreen.test.tsx). `SharingScreen`, added
in step 7, also takes `popToTop` — it bounces you back when you remove your own membership.

**The stub has one consequence that costs a cycle: a header button never mounts.** Anything handed to
`navigation.setOptions({ headerRight })` is rendered by the *navigator*, which is exactly the thing
these tests do not stand up, so `setOptions` being a `jest.fn()` means the button is created and
dropped. Calling the captured `headerRight()` and rendering it into a **second** tree does not fix
it: the returned element closes over the state of a different component instance, so pressing it
updates a screen nobody is looking at.

[src/screens/ListDetailScreen.test.tsx](../../../src/screens/ListDetailScreen.test.tsx) does the
thing that works — a small `Chrome` wrapper whose `setOptions` keeps the last options in `useState`
and renders `options.headerRight?.()` **in the same tree as the screen**, above it. That mirrors what
the navigator does and makes a header-driven control (the rename bar) assertable. Copy that wrapper
for the next screen with header buttons rather than reinventing the second-tree version.

**A related trap in the same file:** an assertion of the form
`expect(setOptions).toHaveBeenCalledWith({ title: 'Hardware' })` breaks the moment a screen adds
`headerRight`, because both travel in one call. Use `expect.objectContaining`.

**What to do:** a new screen adds its params to `RootStackParamList` and takes the generated props
type. If a deeply nested component needs navigation, thread a callback down rather than reaching
for the hook — that keeps the component testable without a navigator too.

`SignInScreen` follows the convention even though it never navigates (it takes `_props:
SignInScreenProps` and ignores them): which stack is mounted is decided by `RootNavigator` from the
session state, so signing in unmounts the screen rather than navigating away from it. Not every
screen in `RootStackParamList` is mounted at once — `SignIn` exists only while signed out.

The `verify:` command sweeps **all** of `src/screens/` — four screens now — and covers `useRoute()`
as well as `useNavigation()`, so a newly added screen cannot slip past it. Test files are excluded
because `ListsScreen.test.tsx` names `useNavigation()` in a header comment. It also pins the
`Sharing` route in `RootStackParamList` and the fact that the detail suite still renders a
`headerRight`, which is what would disappear if someone "simplified" the `Chrome` wrapper away.
