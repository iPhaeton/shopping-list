# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run web                       # Expo dev server in a browser at http://localhost:8081
npm start                         # dev server + QR code for Expo Go on a physical device
npm test                          # jest (jest-expo preset)
npm run typecheck                 # tsc --noEmit
npx jest src/state/listsReducer.test.ts        # one suite
npx jest -t 'trims the name'                   # one test by name
```

`npm run ios` / `npm run android` do **not** work on this machine — there is no full Xcode
(only Command Line Tools, no `simctl`), no Android SDK, no CocoaPods. Verify changes with
`npm run web` (Playwright MCP is allowlisted for driving it) or Expo Go.

## Scope

The task description (`ai/tasks/1/description-step-1.md`) puts **persistence, authentication, and
sharing out of scope**, and lists only create-list / add-item / toggle-item as functionality.
Deleting lists or items was deliberately not built. State is in memory and resets on reload.
Do not add these speculatively.

## Architecture

`App.tsx`: `SafeAreaProvider` → `ListsProvider` → `RootNavigator`. Two screens in a native stack:
`Lists` → `ListDetail { listId }` ([src/navigation/types.ts](src/navigation/types.ts) is the source
of truth for route params).

Two conventions carry most of the design and should be preserved:

- **Ids are minted outside the reducer.** [listsReducer.ts](src/state/listsReducer.ts) receives the
  new id on the action, so it is pure and its tests need no clock/uuid mocking.
  [ListsContext.tsx](src/state/ListsContext.tsx) mints them in its action creators and exposes
  `useLists()`. Persistence, if it is ever in scope, should only touch the provider — the reducer
  and screens are already isolated from storage.
- **Screens take `navigation`/`route` as props**, never `useNavigation()`. That lets component tests
  render a screen with `{ navigate: jest.fn(), setOptions: jest.fn() }` instead of standing up a
  `NavigationContainer`.

`updateList` in the reducer returns the *original* state object when a list is unknown or nothing
changed — keep that identity-preserving behavior when adding cases.

Styling goes through [src/theme.ts](src/theme.ts) (`colors` / `spacing` / `radius`); there are no
hardcoded colors or magic paddings in components.

## Testing

React Native Testing Library 14 gotchas that already cost a debugging cycle:

- `render`, `fireEvent.press`, and `fireEvent.changeText` are **async** and must be awaited.
  Forgetting to gives the misleading error `` `render` function has not been called ``.
- `toHaveAccessibilityState` was removed; use `toBeChecked()` / `not.toBeChecked()`.

Queries go through accessibility labels, so components must keep their `accessibilityLabel` /
`accessibilityRole` / `accessibilityState` props — `ListRow`'s label is the composed
`` `${name}, ${summary}` ``.

`tsconfig.json` needs its explicit `"types": ["jest", "react", "node"]`; without it
`expo/tsconfig.base` leaves the jest globals unresolved under `tsc --noEmit`.

## Task logs

Work is organized as `ai/tasks/<n>/description-step-<n>.md`. After finishing a step, write
`implementation-log-step-<n>.md` beside it covering decisions, problems hit, and how the result was
verified.
