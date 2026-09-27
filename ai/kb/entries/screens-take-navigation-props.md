---
id: screens-take-navigation-props
title: Screens take navigation/route as props, never useNavigation()
type: convention
status: current
tags: [navigation, screens, testing]
sources: [ai/tasks/1/implementation-log-step-1.md, ai/tasks/2/implementation-log-step-2.md, ai/tasks/3/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-2.md, ai/tasks/14-account-screen/implementation-log-step-1.md, ai/tasks/17-user-names/implementation-log-step-1.md, ai/tasks/20-ux/implementation-log-step-3.md, ai/tasks/20-ux/implementation-log-step-4.md, 6ef87a2]
last_verified: 2026-09-27
verify: ! grep -rqE 'useNavigation\(|useRoute\(' src/screens --include='*.tsx' --exclude='*.test.tsx' && grep -q 'Sharing: { listId: string }' src/navigation/types.ts && grep -q 'SetName: undefined;' src/navigation/types.ts && grep -q "name=\"Lists\" component={ListsScreen} options={{ title: 'My Lists', headerShown: false }}" src/navigation/RootNavigator.tsx && grep -q 'name="ListDetail" component={ListDetailScreen} options={{ headerShown: false }}' src/navigation/RootNavigator.tsx && grep -q 'setOptions).toHaveBeenCalledWith(expect.objectContaining({ title:' src/screens/ListDetailScreen.test.tsx
related: [rntl-14-api-changes, queries-go-through-a11y-labels, react-native-screens-past-the-sdk-pin, phone-is-the-product]
---

Screens receive `navigation` and `route` as props and never call `useNavigation()` or
`useRoute()`. [src/navigation/types.ts](../../../src/navigation/types.ts) is the source of truth for
route params: `RootStackParamList`, plus the per-screen prop types derived from it.

**Why it matters:** a component test renders a screen with a stub
(`{ navigate: jest.fn(), setOptions: jest.fn(), goBack: jest.fn() }`) instead of standing up a
whole `NavigationContainer`. See the header comment in
[src/screens/ListsScreen.test.tsx](../../../src/screens/ListsScreen.test.tsx). `SharingScreen` also
takes `popToTop`, which sends you back when you remove your own membership.

**No screen hands a control to the navigator any more (since task 20 step 4).** In
[RootNavigator.tsx](../../../src/navigation/RootNavigator.tsx), `Lists` and `ListDetail` both
carry `headerShown: false`. Each draws its own header row inside its own scrolling tree: the
Account pill on Lists; Back, the Rename/Share pills and the serif title on List detail. Because
those controls live in the screen's tree, a suite presses them on the same screen instance with the
plain stub. `Sharing` and `Account` keep the native header with a static `title`.

`ListDetailScreen` still calls `navigation.setOptions({ title })`. Two things read that title: the
web tab, and the iOS back button of `Sharing` when it is pushed on top (Maestro's tour taps
`Groceries`). Assert it with `expect.objectContaining({ title })`, never an exact object. An exact
match breaks the moment another option travels in the same call.

**On a headerless screen, back belongs to the stack, not the header.** The drawn `Back` calls
`navigation.goBack()`. The Android hardware back (checked on `Pixel_10`) and the iOS edge swipe
keep working without a native header. The swipe was checked only in source: `RNSScreenStack` owns
the pop gesture, and nothing ties it to the header. Maestro cannot perform the swipe. Browser back
does nothing on web, by the user's choice ([phone-is-the-product](phone-is-the-product.md)).

A **non-root** screen with its header hidden is also what triggers the iOS 26 dead-back-button bug
in react-native-screens below 4.19
([react-native-screens-past-the-sdk-pin](react-native-screens-past-the-sdk-pin.md)). Keep that in
mind before hiding another header.

**If a screen ever puts a control in `setOptions({ headerRight })` again, the stub drops it.** The
navigator renders header options, and a `jest.fn()` `setOptions` renders nothing, so the button is
created and thrown away. Rendering the captured `headerRight()` into a **second** tree does not fix
this. The element closes over a different component instance, so pressing it updates a screen
nobody is looking at.

What worked, from task 20 step 3 until step 4 left it with nothing to render, was a small `Chrome`
wrapper in `ListDetailScreen.test.tsx`. Its `setOptions` kept the last options in `useState` and
rendered `options.headerRight?.()` in the **same** tree, above the screen. It is in git history.

Giving `options` as a function at the navigator is also valid, typed react-navigation API:
`options={({ navigation }) => ({ headerRight })}`. That keeps `navigation` out of the screen's
hooks.

**What to do:** a new screen adds its params to `RootStackParamList` and takes the generated props
type. If a deeply nested component needs navigation, thread a callback down to it rather than
reaching for the hook. That keeps the component testable without a navigator too.

`SignInScreen` and `SetNameScreen` take `_props` and ignore it. `RootNavigator` decides which stack
is mounted from the session state, so signing in, or setting a name, unmounts the screen instead of
navigating away from it. `SignIn` exists only while signed out. `SetName` exists only while
`AuthState` is `nameRequired`.

The `verify:` sweeps **all** of `src/screens/` for both hooks. Test files are excluded, because
`ListsScreen.test.tsx` names `useNavigation()` in a comment. It also pins the `Sharing` and
`SetName` routes, both headerless routes, and the `objectContaining` title assertion.
