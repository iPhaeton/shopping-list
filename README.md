# Shopping List

A simple shopping list app built with React Native and Expo.

- Create named lists ("Groceries", "Hardware", …)
- Add items to a list
- Tap an item to mark it done, tap again to unmark it

## Running

```bash
npm install
npm run ios       # boots an iOS simulator and opens the app in Expo Go
npm run web       # opens in a browser at http://localhost:8081
npm start         # dev server + QR code for Expo Go on a physical device
```

`npm run ios` needs Xcode plus an iOS simulator runtime, both installed on this machine
(Xcode 26.6, iOS 26.5). `npm run android` still needs the Android SDK, which is not installed.

A native dev build (`npx expo run:ios`) would additionally need CocoaPods and an
`ios.bundleIdentifier` in `app.json` — neither is set up, and nothing here calls for it: every
dependency ships inside the Expo Go runtime.

## Checks

```bash
npm test          # jest-expo + React Native Testing Library
npm run typecheck # tsc --noEmit
```

## Notes

State is held in memory only — **there is no persistence**, so everything resets on reload. That
is deliberate for this step, along with authentication and sharing being out of scope.

The state lives in [`src/state/`](src/state/): `listsReducer.ts` is a pure reducer (ids arrive on
the action, so it stays deterministic and easy to test) and `ListsContext.tsx` wraps it in a
provider exposing `useLists()`. Swapping in persistence later means changing only the provider.

Screens receive `navigation`/`route` as props rather than calling `useNavigation()`, which lets the
component tests render them with a small stub instead of a whole navigation container.
