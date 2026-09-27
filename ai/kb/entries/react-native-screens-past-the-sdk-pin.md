---
id: react-native-screens-past-the-sdk-pin
title: react-native-screens is ~4.19, past Expo 54's ~4.16 pin — on iOS 26, 4.16 leaves the native back button dead after a pop onto a headerless screen
type: decision
status: superseded
superseded_by: [expo-sdk-version]
tags: [expo, versions, navigation, ios, react-native-screens]
sources: [ai/tasks/20-ux/implementation-log-step-4.md, package.json, src/navigation/RootNavigator.tsx]
last_verified: 2026-09-27
verify: grep -q '"react-native-screens": "~4.19' package.json && grep -q '"react-native-screens": "~4.16' node_modules/expo/bundledNativeModules.json && node -p "require('react-native-screens/package.json').version" | grep -qE '^4\.(19|[2-9][0-9])\.' && grep -q 'name="ListDetail" component={ListDetailScreen} options={{ headerShown: false }}' src/navigation/RootNavigator.tsx
related: [expo-sdk-version, screens-take-navigation-props, expo-sdk-54-pinned, native-build-toolchain, maestro-drives-the-native-ui]
---

> **Superseded in task 21 by [expo-sdk-version](expo-sdk-version.md).** SDK 57 pins
> `react-native-screens` ~4.26, past 4.19, so the deviation below is over and
> `npx expo install --fix` is safe again. Both repros below popped every time on 4.26 on iOS 27.
> The iOS 26 runtime is gone from this Mac, so iOS 26 itself was not re-run. The bug description
> stays as history, in case the package ever drops below 4.19.

**`package.json` asks for `react-native-screens` `~4.19.0`; Expo SDK 54 pins `~4.16.0`**
(`node_modules/expo/bundledNativeModules.json`). The mismatch is deliberate. The user chose it in
task 20 step 4 over two alternatives: a patch-package fix on 4.16, or a drawn `headerLeft` on
`Sharing`. Do not "fix" it back.

**The bug 4.16 has:** [react-native-screens#3294](https://github.com/software-mansion/react-native-screens/issues/3294).
On iOS 26, if the native back button pops onto a **non-root screen whose header is hidden**, the
*next* native back button is dead. It stays stuck in its pressed glow, and only a restart clears it.
`ListDetail` became such a screen when it got `headerShown: false`
([screens-take-navigation-props](screens-take-navigation-props.md)). Reproduced on the iPhone 17e
(iOS 26.5):

- Lists → Groceries → Share list → back → Share list → back: the second back does nothing.
- Lists → Groceries → Share list → back → drawn Back → Account → back: also dead.
- Round trips into `ListDetail` alone, or Lists ↔ Account alone, are fine. `Lists` is the root.

**The cause, as far as it was traced.** In 4.16's `ios/RNSScreenStack.mm`,
`navigationBar:shouldPopItem:` turns off `userInteractionEnabled` on the back button's wrapper.
Only `navigationBar:didPopItem:` turns it back on, and it has to find the back button in the bar to
do that. When the destination hides the bar, that lookup evidently misses. This is inferred from
the code and the symptoms; nobody stepped through it. 4.19.0 ships "delay setting navigation bar
visibility to mitigate bar button bug on iOS 26". On 4.19.0, both repros pop every time. 4.19 also
drops React Native ≤ 0.79 (we are on 0.81.5) and removes the old v5 native-stack code, which this
project does not use (it is on `@react-navigation/native-stack` 7).

**How it was installed, and how it gets undone:**

- It was installed with `npm install react-native-screens@~4.19.0`, then `cd ios && pod install`,
  then a rebuild of both dev clients ([native-build-toolchain](native-build-toolchain.md)).
  `npx expo install react-native-screens` would have re-pinned 4.16.
- It is **not** listed in `expo.install.exclude` in `package.json`. So `npx expo install --check`
  and `expo-doctor` flag it, and `npx expo install --fix` downgrades it back to 4.16.
- `expo start` does **not** warn about it here. Expo CLI skips dependency validation when a dev
  client is installed, and on web-only runs (`startAsync.js`). Nothing nags about the mismatch
  during normal work, so the danger is one explicit `--fix`, or an SDK upgrade that runs one.

**What to do:** keep 4.19 or later while any non-root screen hides its native header. Before
running `npx expo install --fix`, add `react-native-screens` to `expo.install.exclude`, or restore
4.19 afterwards. On an SDK upgrade whose own pin reaches 4.19, this entry stops being a deviation.
The `verify:` fails at that point, and the entry should be retired. After any version change to
this package, run `pod install` and rebuild the iOS dev client. JS reload alone does not pick up
native code. Maestro cannot drive the iOS edge swipe, so the swipe on a headerless screen has only
been checked from source ([maestro-drives-the-native-ui](maestro-drives-the-native-ui.md)).
