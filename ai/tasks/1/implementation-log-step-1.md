# Implementation Log — Task 1, Step 1

**Date:** 2026-08-25
**Task:** [description-step-1.md](description-step-1.md) — initialize a React Native shopping list app
**Status:** Complete, verified

## What was delivered

A working Expo/React Native app with two screens covering all three required capabilities:
create a list, add items, mark/unmark items as done.

| | |
|---|---|
| Expo SDK | 57.0.16 |
| React Native | 0.86.2 |
| React | 19.2.3 |
| TypeScript | 6.0.3 (`strict: true`) |
| Navigation | `@react-navigation/native-stack` 7.18.9 |
| Tests | `jest-expo` 57.0.4 + `@testing-library/react-native` 14.0.1 |

## Decisions

### Expo over the bare React Native CLI

The machine has only Xcode Command Line Tools (no full Xcode, no `simctl`), no Android SDK
(`ANDROID_HOME` unset), and no CocoaPods. A bare RN CLI project could be scaffolded but never
built or run here. Expo gives a runnable, verifiable app today via `expo start --web` and Expo Go,
and remains a real React Native app that can be ejected later. Confirmed with the user before starting.

### Multiple named lists, not a single list

"The user can create a list" was ambiguous — one list, or many? Confirmed with the user: **many**.
This drove the two-screen structure (`Lists` → `ListDetail`) and the navigation dependency.

### IDs are minted outside the reducer

`listsReducer` receives the new id on the action rather than generating one internally. This keeps
it pure and deterministic, so its tests need no mocking of `Date.now`/`crypto.randomUUID`.
`ListsContext` mints ids in its action creators.

### Screens take `navigation`/`route` as props

Rather than calling `useNavigation()` internally. This lets component tests render a screen with a
small stub (`{ navigate: jest.fn(), setOptions: jest.fn() }`) instead of standing up a whole
`NavigationContainer`.

### Scope held to the description

Deleting lists and items was deliberately **not** built — the description lists only create/add/toggle.
No persistence, auth, or sharing, as specified. State is in memory and resets on reload.

## Files created

```
App.tsx                              SafeAreaProvider > ListsProvider > RootNavigator
src/state/types.ts                   Item, List, State, Action
src/state/listsReducer.ts            pure reducer + countDone helper
src/state/ListsContext.tsx           provider + useLists() hook
src/navigation/types.ts              RootStackParamList + screen prop types
src/navigation/RootNavigator.tsx     native stack
src/screens/ListsScreen.tsx          list of lists, create
src/screens/ListDetailScreen.tsx     items, add, toggle
src/components/AddBar.tsx            shared text input + submit button
src/components/ListRow.tsx           list row with "n of m done" summary
src/components/ItemRow.tsx           checkbox row, strikethrough when done
src/components/EmptyState.tsx        shared empty state
src/theme.ts                         colors / spacing / radius
README.md                            run + check instructions
```

Tests: `src/state/listsReducer.test.ts`, `src/screens/ListsScreen.test.tsx`,
`src/screens/ListDetailScreen.test.tsx`.

## Problems hit and how they were resolved

### RNTL 14 made `render` and `fireEvent` async

The first test run failed across both component suites with a misleading error:

```
`render` function has not been called
```

`render()` had in fact been called — but in React Native Testing Library 14 it is `async` and
returns a Promise, so the `screen` singleton was still unpopulated when assertions ran. Probing
`String(render).slice(0,40)` in a throwaway test showed `async function render(element, options =`.
`fireEvent.press` and `fireEvent.changeText` are async too.

**Fix:** every `render`/`fireEvent` call is awaited, and both test files carry a comment noting this
so it doesn't recur.

### `toHaveAccessibilityState` was removed in RNTL 14

Replaced with the modern `toBeChecked()` / `not.toBeChecked()`.

### Jest globals unresolved under `expo/tsconfig.base`

`tsc --noEmit` reported `Cannot find name 'describe' / 'it' / 'expect'` and
`Cannot use namespace 'jest' as a value` despite `@types/jest` being installed.

**Fix:** added an explicit `"types": ["jest", "react", "node"]` to `tsconfig.json`.

### `create-expo-app` into a non-empty directory

The repo root already held `ai/` and `.git`. Scaffolded into a temp directory instead, then
`rsync`'d in excluding `.git` (and the template's `LICENSE`).

## Verification performed

1. `npm run typecheck` — clean under `strict: true`.
2. `npm test` — **27 tests across 3 suites, all passing.**
3. `npx expo start --web` — driven end to end in a real browser via Playwright:
   - empty state shown; "Create" disabled while the input is blank
   - created "Groceries" and "Hardware"; input cleared after each; Enter-to-submit works
   - opened Groceries — header title picked up the list name
   - added Milk, Bread, Eggs — three unchecked rows in insertion order
   - tapped Bread — checkbox filled, title struck through
   - navigated back — row updated to "1 of 3 done"
   - opened Hardware — still empty, confirming lists are independent
   - **0 console errors.** One warning, `props.pointerEvents is deprecated`, originates in React
     Navigation's web internals, not app code.

Native simulators were not exercised — no Xcode or Android SDK on this machine. The app can also be
opened on a physical device through Expo Go via the QR code from `expo start`.

## Follow-ups / notes for later steps

- Nothing is committed yet — the repo still has zero commits and all files are untracked.
- Persistence, when it arrives, should only need to change `ListsContext.tsx`; the reducer and
  screens are already isolated from storage concerns.
- `npm run ios` / `npm run android` will not work until Xcode or the Android SDK is installed.
- The scaffold brought in `AGENTS.md` / `CLAUDE.md` from the official Expo template, pointing at the
  versioned docs at https://docs.expo.dev/versions/v57.0.0/. Kept as-is.
