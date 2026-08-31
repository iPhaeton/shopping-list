# Shopping List

A simple shopping list app built with React Native and Expo.

- Sign in with a six-digit code emailed to you — no password
- Create named lists ("Groceries", "Hardware", …)
- Add items to a list
- Tap an item to mark it done, tap again to unmark it

## Running

Sign-in needs the local Supabase stack, so start Docker Desktop first:

```bash
npm install
cp .env.example .env       # local URL + anon key; both are safe to commit
npx supabase start         # Postgres, auth, and Mailpit in Docker
npm run web                # opens in a browser at http://localhost:8081
```

`npx supabase status` reprints the URLs and keys. The six-digit code is not sent anywhere real —
it lands in **Mailpit at http://127.0.0.1:54324**, which is where you read it during development.

```bash
npm run ios       # boots an iOS simulator and opens the app in Expo Go
npm start         # dev server + QR code for Expo Go on a physical device
```

A phone cannot reach this machine's `127.0.0.1:54321`, so Expo Go will not get past sign-in
against the local stack. The browser is the path that works end to end.

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

**Lists live in Postgres, one owner each.** They survive a reload, and row-level security — not a
filter in the app — is what keeps them private: every query runs under the signed-in user's token,
and the policies allow only rows whose `owner_id` is that user. Sharing a list with someone else
remains out of scope, so there is no membership table yet.

Writes are optimistic. The client mints a row's uuid, the screen updates immediately, and the
insert follows; if it fails, the message appears at the top of the screen and the lists are
re-fetched, so what you see is what the database holds. Items store `done_at` rather than a
boolean, and the app sends an absolute value rather than "flip it", so a retry cannot double-apply.

Auth lives in [`src/state/SessionContext.tsx`](src/state/SessionContext.tsx), which models the
session as a union (`loading` / `signedOut` / `signedIn`) that
[`RootNavigator`](src/navigation/RootNavigator.tsx) switches on to pick a stack. `users` in the
database mirrors `auth.users`, populated by a trigger rather than by the client, and row-level
security limits each account to its own row.

List state lives in [`src/state/`](src/state/): `listsReducer.ts` is a pure reducer (ids arrive on
the action, so it stays deterministic and easy to test) and `ListsContext.tsx` wraps it in a
provider exposing `useLists()`. Swapping in persistence later means changing only the provider.

Screens receive `navigation`/`route` as props rather than calling `useNavigation()`, which lets the
component tests render them with a small stub instead of a whole navigation container.
