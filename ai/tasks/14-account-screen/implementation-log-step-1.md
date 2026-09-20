# Step 1 implementation log — Account screen

## What changed

- `src/navigation/types.ts`: added `Account: undefined` to `RootStackParamList` and
  `AccountScreenProps`.
- `src/navigation/RootNavigator.tsx`: `Lists`'s `options` changed from a static object to the
  function form `({ navigation }) => ({ ... })` (confirmed supported by the installed
  `@react-navigation/core` types) so `headerRight` can call `navigation.navigate('Account')`. Its
  `headerRight` is now `<HeaderButton label="Account" onPress={...} />` instead of
  `<SignOutButton />`. Registered a new `Account` screen (title `"Account"`) alongside
  `ListDetail`/`Sharing`.
- `src/state/SessionContext.tsx`: `signOut`'s body was extracted into `performSignOut(scope: 'local'
  | 'global')`; `signOut` and the new `signOutEverywhere` are both one-line callbacks over it.
  `signOutEverywhere` is a new member of `SessionContextValue`, included in the provider's `useMemo`.
  The comment that previously justified pinning `'local'` and gestured at a future action now
  explains both scopes and names `signOutEverywhere`.
- `src/screens/AccountScreen.tsx` (new): two actions. "Sign out" is `SignOutButton`'s old behavior
  verbatim (immediate, `pending` disables it, re-enables only on failure). "Sign out of all devices"
  is a `confirming` boolean gate: the initial `Pressable` reveals a row with "Cancel" and a confirm
  button whose `accessibilityLabel` (`"Confirm sign out of all devices"`) stays fixed while its
  visible text toggles `"Yes, sign out everywhere"` / `"Signing out…"` — same fixed-label-under-
  dynamic-text convention as `SignInScreen`'s resend countdown. Failure drops back out of
  `confirming` and clears `pending`/`pendingEverywhere`; an `ErrorBanner` renders the message, same
  as `SharingScreen`. Success unmounts the screen via `RootNavigator`'s stack swap, same as
  `SignOutButton` before it.
- `src/components/SignOutButton.tsx`: deleted. Grepped first — `RootNavigator.tsx` was its only
  importer, and `AccountScreen`'s "Sign out" button reimplements its exact behavior, so nothing was
  left referencing it once the header wiring changed.
- `src/components/HeaderButton.tsx`: doc comment rewritten — it referenced `SignOutButton` by name to
  explain a duplication that `queries-go-through-a11y-labels.md` said was now a "free refactor"; since
  `SignOutButton` no longer exists, the comment now just names its two call sites
  (`ListDetailScreen`'s Rename/Share, `RootNavigator`'s Account entry point).
- Tests: `SessionContext.test.tsx`'s `Probe` gained a `signOutEverywhere`-wired button (label "Sign
  out everywhere") and a test asserting `{ scope: 'global' }`, mirroring the existing `{ scope:
  'local' }` test. New `src/screens/AccountScreen.test.tsx` mocks `../lib/supabase` (and
  `../lib/googleSignIn`, required because `SessionProvider` imports it unconditionally and the real
  module crashes under Jest reaching for an unregistered native module) and covers: plain sign-out's
  scope, the confirm step appearing/not appearing, cancel leaving `signOut` uncalled, confirm calling
  it with `{ scope: 'global' }`, and a rejected sign-out rendering the error and re-enabling the
  button.

## Decisions worth flagging

**No confirmation-UI precedent existed anywhere in `src/`.** Every existing destructive action
(delete a list/item, remove a member) fires immediately; the app leans on tombstone-reversibility
instead, and `deletion-is-a-tombstone.md` rules out `Alert.alert` for "any future destructive
confirm" (a no-op under react-native-web). A global sign-out isn't reversible the same way, and the
task explicitly called for it to be "separately confirmed," so this step built the first in-app
confirm pattern: a plain inline reveal-and-confirm (`confirming` state swaps one `Pressable` for a
two-button row), no `Alert`, no modal. Worth curating as a reusable pattern if a next destructive,
non-reversible action shows up.

**The header-button wiring pattern changes for `Lists`.** Every other screen either wires
`headerRight` statically as a plain object (`Sharing`) or via `navigation.setOptions` from inside the
screen (`ListDetailScreen`). `Lists` now uses a third shape — `options` as a function returning the
object, read directly off `RootNavigator`'s own `Stack.Screen`, needed because `SignOutButton`'s old
static-object slot had no way to reach `navigation` to call `.navigate('Account')`. This is a
legitimate, typed react-navigation API (confirmed against the installed `@react-navigation/core`
types before using it), not a workaround.

## Problem hit during verification

Driving the app through the browser against the local Supabase stack initially hit the **cloud**
project instead (`500` on `/auth/v1/otp`), because `.env` had `EXPO_PUBLIC_SUPABASE_TARGET=cloud` set
(left over from Google sign-in work, which needs cloud). `src/lib/supabaseTarget.ts`'s doc comment
describes a shell-prefix override as the "escape hatch" for exactly this (`EXPO_PUBLIC_SUPABASE_TARGET=local
npm run web`) — **that prefix did not work**: `EXPO_PUBLIC_SUPABASE_TARGET=local npm run web -- --clear`
still baked `"cloud"` into the served bundle (confirmed by grepping the bundle text for the literal
inlined value). Editing `.env` directly (then restoring it after) was the only way to get `local`
into the bundle. Not yet root-caused — plausibly Metro's env loader reloading `.env` inside a worker
process after the parent's override — but the documented escape hatch does not currently work as
described, which affects anyone trying a two-target test locally.

## Verification

- `npm run typecheck` — clean.
- `npm test` — full suite green (added tests included).
- `npm run kb:audit` — 0 errors; both `queries-go-through-a11y-labels.md` and
  `screens-take-navigation-props.md`'s mechanical `verify:` greps pass against the new files.
- Manual, end to end against the local Supabase/Mailpit stack via Playwright MCP (browser): signed in
  with a fresh OTP; confirmed the `Lists` header now shows "Account" (not "Sign out"); opened it and
  saw both actions; "Sign out of all devices" → confirm row appears → "Cancel" returns to the initial
  state with no request sent → pressed again → confirmed → `supabase.auth.signOut` fired with
  `scope: 'global'` and landed back on the sign-in screen; signed in again and used the plain "Sign
  out" button, which fired with `scope: 'local'` and also landed back on the sign-in screen. Zero
  console errors throughout.
