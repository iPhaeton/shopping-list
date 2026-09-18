# Task 13, step 2 — implementation log

Phase 2 ("Client") of [ai/suggestions/social-sign-in.md](../../suggestions/social-sign-in.md),
executed per [plan-step-1.md](plan-step-1.md)'s successor plan (no separate plan file was written
for step 2; the suggestion doc's own "Client" design section served as the plan, adjusted below
against facts only available once the library was actually installed and run).

## The one iOS client id needed a human lookup

`supabase/config.toml`'s `additional_client_ids` has two values and the repo has no record of which
is iOS vs Android. Asked the user to check Google Cloud Console → Credentials:
`857897394234-7k91redv8k4nfiqbm40m2ln2333btlli.apps.googleusercontent.com` is the iOS client.
Reversed form used in `app.json`'s `iosUrlScheme`:
`com.googleusercontent.apps.857897394234-7k91redv8k4nfiqbm40m2ln2333btlli`.

## Nonce handling (constraint 6) resolved: Branch B, `skip_nonce_check = true`

Installed `@react-native-google-signin/google-signin@16.1.5` and read its actual shipped source
(the README itself is a 30-line stub pointing at external docs, so the answer came from
`node_modules/@react-native-google-signin/google-signin/src/types.ts` and
`src/signIn/GoogleSignin.ts` directly). Two decisive facts:

- `SignInParams` (the options object `GoogleSignin.signIn()` takes) has exactly one field,
  `loginHint`. No nonce option exists anywhere in the free module's API surface.
- The package's own README explicitly markets "Custom nonce support" as a feature exclusive to
  **Universal Sign In**, a paid fork — confirming this isn't an oversight to work around but a
  deliberate feature gate.

`supabase/config.toml`'s `[auth.external.google]` block: `skip_nonce_check` flipped from `false` to
`true`, with a comment recording why. Ran `npx supabase stop && npx supabase start` (config is read
at container start only, same as step 1) and confirmed `GET /auth/v1/settings` still reads
`external.google: true` afterward.

`googleSignIn.ts` carries no nonce code at all — Branch B needed none.

## A design correction found while reading the installed source, not guessed

The suggestion doc's draft for `SessionContext.tsx` assumed a plain top-level
`import { signInWithGoogle } from '../lib/googleSignIn'` was safe on every platform including web.
Before writing that import, checked whether it actually is: the package ships a parallel
`GoogleSignin.web.ts` (and `errorCodes.web.ts`), and `src/index.ts` imports `GoogleSignin` from
`'./signIn/GoogleSignin'` with no explicit extension — standard React Native/Metro platform-extension
resolution, so a web bundle picks up `GoogleSignin.web.ts` automatically. That web variant's
`configure()` only logs a warning; only `signIn()`/`signInSilently()`/`getTokens()` throw, and only
when actually *called*. The one thing that does throw at import time is
`spec/NativeGoogleSignin.ts`'s `TurboModuleRegistry.getEnforcing('RNGoogleSignin')` — but that file is
only reachable through the *native* `GoogleSignin.ts`, which Metro never selects for a web bundle.
Conclusion: a static top-level import in `SessionContext.tsx` is genuinely safe on web for this
package, so it was implemented exactly as the suggestion doc drafted it — no dynamic `import()`
workaround, no extra `Platform.OS` guard inside the context member. The button being hidden on web
(`SignInScreen.tsx`) remains the only gate, and it's for product reasons (web is out of scope
entirely), not to dodge a crash that doesn't exist for this library version.

Under jest, the native `GoogleSignin.ts` — and its eager, throwing `TurboModuleRegistry.getEnforcing`
call — is never reached either, but for a different reason: every suite whose code path touches
`googleSignIn.ts` mocks it (or the native package directly) at the `jest.mock` level, which intercepts
before either platform variant loads.

## A real runtime bug, found only by actually building for iOS

Android (`npm run android`, Pixel_10 AVD) built, installed, and ran on the first real device test
with no changes needed — tapping "Continue with Google" launched genuine Play Services activities
(`SignInHubActivity` → `GoogleApiActivity` → `signin.activity.SignInActivity`), confirmed via
`adb logcat`, and landed on Google's real "Sign in with ease" account-setup screen (the emulator has
no Google account configured, so full completion wasn't attempted — backing out and relaunching the
app showed no crash and no stuck `pending` state).

iOS (`npm run ios`, iPhone 17 Pro simulator — the **first iOS dev build this project has ever
booted to a running app**) built and linked cleanly, including the `ExpoAdapterGoogleSignIn` pod, but
crashed on launch with a red screen: *"RNGoogleSignin: failed to determine clientID —
GoogleService-Info.plist was not found and iosClientId was not provided."* The suggestion doc's
draft only ever configured `webClientId`, on the (reasonable-sounding, but iOS-specific-wrong)
assumption that one client id serves as the audience on both platforms. In fact iOS's native side
additionally requires either a `GoogleService-Info.plist` (Firebase, which this project doesn't use)
or an explicit `iosClientId` passed to `configure()` — `webClientId` alone satisfies the ID-token
audience check but not iOS's own configuration requirement. Fixed by adding
`iosClientId: '857897394234-7k91redv8k4nfiqbm40m2ln2333btlli.apps.googleusercontent.com'` (the same
client id used for `iosUrlScheme`, unreversed) to the `GoogleSignin.configure()` call in
`src/lib/googleSignIn.ts`. Reloading the app (no native rebuild needed — JS-only change) showed the
sign-in screen with no error. Driving an actual tap on the iOS simulator to trigger the sheet itself
wasn't possible from this session — no `idb`/`cliclick` tool available and `osascript`/System Events
has no assistive-access permission here — so the iOS sheet opening was not directly observed the way
Android's was; only the fix for the launch-time crash is confirmed.

## What changed

- `app.json` — `expo.plugins` added: `["@react-native-google-signin/google-signin", { "iosUrlScheme": "com.googleusercontent.apps.857897394234-7k91redv8k4nfiqbm40m2ln2333btlli" }]`.
- `package.json`/`package-lock.json` — `@react-native-google-signin/google-signin@16.1.5` added via `npx expo install`.
- `supabase/config.toml` — `[auth.external.google]`'s `skip_nonce_check` set to `true`, with a comment explaining why.
- `android/`, `ios/` — regenerated via `npx expo prebuild --clean` to pick up the config plugin.
- New `src/lib/googleSignIn.ts` — the native round trip, one importer of `./supabase`, matching `listsChannel.ts`'s module shape.
- `src/state/SessionContext.tsx` — new `signInWithGoogle` member, plain delegate to the lib module.
- `src/screens/SignInScreen.tsx` — new "Continue with Google" button, native-only (`Platform.OS !== 'web'`), email phase only.
- New `src/lib/googleSignIn.test.ts`; `src/state/SessionContext.test.tsx` and `src/screens/SignInScreen.test.tsx` updated with `googleSignIn` mocks and new cases (web-hides-button, delegates-on-press, shows-failure).

## The debug keystore survived `prebuild --clean` — contradicts the risk `native-build-toolchain.md` documented

Backed up `android/app/debug.keystore` before running `npx expo prebuild --clean`, expecting to need
to restore it per the documented risk. It wasn't necessary: the file after prebuild was byte-identical
(same MD5, `4d3dbe5438b4d52b2707d5c039d09afb`) to the one before, and `keytool` confirmed the SHA-1
was unchanged (`5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`) — the Android OAuth
client registration is still valid, no Google Cloud Console update needed. Whatever mechanism
`expo prebuild --clean` uses to regenerate `android/`, it does not touch (or it explicitly preserves)
an existing debug keystore in this Expo SDK 54 version — the risk `native-build-toolchain.md`
documented from reading `build.gradle` was a reasonable prediction that didn't hold up against an
actual run. Worth a librarian correction so a future step doesn't redo the backup dance expecting to
need it.

## Verification

1. `npm run typecheck` — clean, both before and after the `iosClientId` fix.
2. `npm test` — 334/334 passing, both before and after the `iosClientId` fix.
3. `npm run kb:audit` — 0 errors, 13 warnings, all "ground moved" against files this step (or step 1)
   touched — same shape as step 1's precedent.
4. `npm run android` — built, installed, and ran on the Pixel_10 emulator. Screenshots confirmed the
   sign-in screen renders both buttons correctly. Tapping "Continue with Google" produced real
   Play-Services sign-in activity (confirmed via `adb logcat`), reaching Google's real account-setup
   UI; backed out without creating an account (none exists on this emulator and creating one wasn't
   this step's job), then relaunched the app and confirmed no crash, no stuck `pending` state, no
   leftover error banner.
5. `npm run ios` — built, installed, and ran on the iPhone 17 Pro simulator (first time ever for this
   project). Caught and fixed the `iosClientId` crash described above; after the fix, the app reloads
   to a clean sign-in screen with both buttons rendered. The sheet itself was not tapped-through on
   iOS (no UI-automation tool available in this session); that and the full account-linking check
   below are left to the user.

## A second real bug, found only once a real Google account was in the loop

After the verification above, the user configured a real Google account on the `Pixel_10` emulator
and hit "Continue with Google" themselves: Google's own sheet completed (an idToken came back — this
step's code never touches that path), but the app then showed **"Network request failed"**. That
error is `supabase.auth.signInWithIdToken`'s fetch failing, not anything Google-side.

Root cause: [supabaseTarget.ts](../../../src/lib/supabaseTarget.ts)'s `pickTarget()` sends every
non-physical-device target — web, iOS Simulator, **and Android emulator** — to the `local` target,
whose URL is `EXPO_PUBLIC_SUPABASE_URL_LOCAL=http://127.0.0.1:54321`. That comment's premise ("a
simulator shares the host's loopback") is true for the iOS Simulator but false for the Android
emulator, which runs its own separate network stack — confirmed directly with `adb shell`: a raw TCP
connect to `127.0.0.1:54321` from inside the emulator gets "connection refused" (nothing is
listening on the emulator's own loopback), while `10.0.2.2:54321` — the emulator's fixed alias back
to the host's loopback — connects. This bug predates this step: `supabase-target-picked-at-runtime`
and `native-build-toolchain` already flagged that *no* target had been driven through sign-in on
Android before (only "the app opens" was verified); this step's Google button is what finally
exercised a real network call from the emulator and surfaced it.

Fixed in `supabaseTarget.ts` with a `localUrl()` helper: on Android when `Device.isDevice` is
false, it rewrites `127.0.0.1`/`localhost` in `EXPO_PUBLIC_SUPABASE_URL_LOCAL` to `10.0.2.2` before
handing it to `targets.local.url`; every other platform/target combination is untouched. Added two
`supabaseTarget.test.ts` cases covering the rewrite and its absence on a real Android device, plus
one confirming `pickTarget()` still returns `'local'` for the emulator. Full suite: 337/337 passing,
`npm run typecheck` clean.

Re-verified live on the same emulator after reloading the JS bundle (this is a plain module-level
change, not a native one — no rebuild needed): `adb logcat`'s `TcpMetricsLogger` lines showed the
outgoing connection now going to `10.0.2.2:54321` with `err=0`, and the app went straight from
"Continue with Google" to the "My Lists" screen with the account's real list ("Ilya 1") loaded —
the first real, complete, real-account Google sign-in this project has completed end to end, on
either platform.

## Not done here — needs a human with a real Google account

Per the suggestion doc's own "Staging" step 2 and constraint 7 (Playwright cannot drive a native
Google sheet, and this session has no other UI-automation path into either simulator/emulator that
can complete a real OAuth grant): the iOS half of this (a real Google account is configured on
Android now, per above, but not on the iPhone 17 Pro simulator), and — on both platforms — signing
out and back in with the **OTP code** to the same address to confirm the same lists load (the
auto-link assertion, the one that matters most). This remains open before step 13's phase 2 can be
called fully verified.

## Not done here — by design

Phase 3 (pushing `[auth.external.google]` to the production Supabase project via
`npx supabase config push`, and a first physical-device/production sign-in) stays out of scope for
this step, per the suggestion doc's staging plan.
