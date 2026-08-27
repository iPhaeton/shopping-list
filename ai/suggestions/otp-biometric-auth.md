# Suggestion — email OTP sign-in with a biometric unlock layer

**Status:** proposal, not an approved step. Auth and persistence are out of scope per
[scope-boundaries](../kb/entries/scope-boundaries.md); adopting this needs a new
`ai/tasks/<n>/description-step-<n>.md` first, and that entry updated afterwards by the librarian.

**Date:** 2026-08-27

**Relationship to [supabase-persistence.md](supabase-persistence.md):** this plan replaces that
document's email/password `SignInScreen` with email OTP and adds the biometric layer. Everything
else there — schema, RLS, the `security definer` helper, UUID ids, `done_at`, realtime — stands
unchanged and is not repeated here. **It also lifts one of that plan's stated premises:** it assumed
anything requiring a dev build was blocked. A dev build is now on the table (below), so that
constraint no longer binds.

## The premise: biometrics is not the identity

Ownership of a list comes from the identity layer and never from the biometric. The server issues a
session to a `users` row; `lists.owner_id` points at it; RLS enforces it in Postgres. The biometric
is a **local unlock gate** on the device, and the server neither sees nor trusts it.

That distinction drives the whole design. `expo-local-authentication`'s `authenticateAsync()`
resolves to `{ success: true }` in JavaScript — gating a screen on that boolean is theater, since
anyone able to modify the bundle flips it and the session token sits in storage regardless. **The
biometric has to gate access to the secret material itself**, enforced by the OS keystore. That is
what `expo-secure-store`'s `requireAuthentication` does.

Hence two packages with strictly separate jobs:

| Package | Job |
|---|---|
| `expo-secure-store` | **enforcement** — holds the unlock key behind a Keychain/Keystore biometric ACL; the OS refuses the bytes without a successful biometric |
| `expo-local-authentication` | **capability detection only** — `hasHardwareAsync`, `isEnrolledAsync`, `supportedAuthenticationTypesAsync`, to decide whether to offer the feature and to label the button "Face ID" vs "Touch ID" vs "Fingerprint" |

## Verified platform constraints

Checked against the v54 docs on 2026-08-27, because three of these change the design:

1. **`requireAuthentication` does not work in Expo Go.** The docs state it is unsupported there when
   biometric authentication is available, due to a missing `NSFaceIDUsageDescription`. Face ID via
   `expo-local-authentication` is likewise Expo-Go-blocked. **A development build is mandatory for
   the biometric half of this plan.**
2. **Android prompts on every operation** (API 23+), reads *and writes*. iOS prompts only when
   reading or updating an existing value, never when creating a new one. This is the constraint that
   shapes the storage design below.
3. **Changing biometric enrollment destroys the data.** Adding a fingerprint makes anything stored
   under `requireAuthentication` permanently unreadable. An OTP fallback is not optional.
4. **No web support** in either package. Web degrades to plain OTP.
5. **Values above ~2048 bytes have historically been rejected on iOS.** A JWT pair can approach
   that; a 32-byte key cannot.

## The storage design

The obvious approach — put the Supabase session in SecureStore under `requireAuthentication` — fails
on constraint 2. Supabase rotates the refresh token on every refresh, so each rotation is a write,
and each write is an Android biometric prompt. The app would prompt continuously.

**Instead, gate a key that never changes, and let the rotating secret live in ordinary storage
encrypted under it:**

```
SecureStore (requireAuthentication: true)   →  unlock key, 32 random bytes, written once at sign-in
AsyncStorage / SecureStore (no auth)        →  session JSON, encrypted under that key, rewritten freely
```

- **At sign-in:** generate the key, write it. Creation does not prompt on iOS; one prompt on Android,
  once, immediately after the user authenticated anyway.
- **At cold start:** one biometric prompt reads the key, decrypts the session, `supabase.auth.setSession(...)`.
- **During use:** token refreshes rewrite only the encrypted blob in ordinary storage. The gated item
  is untouched, so **zero further prompts**.
- **At sign-out:** delete the key. The blob becomes undecryptable regardless of what else survives.

The property that makes this worth the indirection: the encrypted blob is useless without the key,
and the key is only obtainable through the OS biometric check. The gate is enforced by the keystore,
not by a JavaScript branch.

**One open implementation question.** This needs a symmetric cipher, and `expo-crypto` provides
random bytes and digests but not AES. Settle at implementation time between `crypto.subtle` (verify
availability under RN 0.81 / Expo 54 before committing — do not assume) and a dedicated library such
as `react-native-quick-crypto`. **Fallback if neither is palatable:** store the refresh token
directly under `requireAuthentication` and rewrite it only on app background rather than on every
rotation. Simpler, no cipher, but it costs an extra Android prompt per cold start and risks the
stored token being invalidated by Supabase's refresh-token reuse detection — which lands the user in
the OTP fallback path that exists anyway.

## Auth state machine

Four states, owned by `SessionContext`:

```
loading  → checking for a stored session
signedOut → SignInScreen        (no session, or user signed out)
locked    → UnlockScreen        (encrypted session present, key not yet unlocked)
signedIn  → the app             (live Supabase session)
```

Transitions worth naming:

- `locked → signedIn` on a successful biometric read.
- `locked → signedOut` when the user picks "use a code instead", or when the gated read fails
  because enrollment changed (constraint 3). **`UnlockScreen` must always offer this escape** — it
  is the sole recovery from a destroyed key, and without it the account is unreachable on that
  device.
- `signedIn → locked` when the app returns from background after a timeout. Start at 5 minutes.
  [supabase-persistence.md](supabase-persistence.md) already adds an `AppState` listener for
  `startAutoRefresh`/`stopAutoRefresh`; the same listener does this, and should not be duplicated.
- Biometrics is **offered, never required**. If `hasHardwareAsync()` or `isEnrolledAsync()` is false,
  or the platform is web, the app skips `locked` entirely and behaves as OTP-only.

## The OTP flow

```ts
await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
await supabase.auth.verifyOtp({ email, token, type: 'email' });
```

Two-phase screen: email field → six-digit code field. `shouldCreateUser: true` means sign-in and
sign-up are the same path, so there is no separate registration screen.

**Setup gotcha that costs a debugging cycle:** Supabase's default email template sends a **magic
link**, not a code. `verifyOtp` will have nothing to accept until the template is edited to include
`{{ .Token }}` in place of `{{ .ConfirmationURL }}`. This is a dashboard change, not a code change.

Documented limits: one request per 60 seconds per user, codes expire after 1 hour. The 60-second
floor needs a visible cooldown on the resend button or users will hammer it. Verify the built-in
email sender's throughput before relying on it beyond development; custom SMTP is the usual answer.

## Code changes

| File | Change |
|---|---|
| `src/lib/supabase.ts` | new — client; storage adapter branches on `Platform.OS` |
| `src/lib/secureSession.ts` | new — the key/blob scheme above; the only module touching `expo-secure-store` |
| `src/lib/biometrics.ts` | new — capability detection and the display label |
| `src/state/SessionContext.tsx` | new — the state machine; `requestOtp`, `verifyOtp`, `unlock`, `signOut`; wraps `ListsProvider` |
| `src/screens/SignInScreen.tsx` | new — two-phase email → code |
| `src/screens/UnlockScreen.tsx` | new — biometric prompt plus the "use a code instead" escape |
| `src/navigation/RootNavigator.tsx` | switch stacks on session state |
| `src/navigation/types.ts` | new routes in `RootStackParamList` |
| [app.json](../../app.json) | add `plugins` (currently absent) and a `scheme` |
| `src/state/ListsContext.tsx` | per [supabase-persistence.md](supabase-persistence.md) — list data scoped to the session user |

`app.json` needs a `plugins` array it does not currently have:

```json
"plugins": [
  ["expo-secure-store", { "faceIDPermission": "Unlock your shopping lists with Face ID." }],
  ["expo-local-authentication", { "faceIDPermission": "Unlock your shopping lists with Face ID." }]
]
```

Without `NSFaceIDUsageDescription`, iOS silently falls back to the device passcode instead of Face ID
— it does not error, so this misconfiguration is easy to ship without noticing.

### Two existing conventions this must not break

**`SessionContext` must not call `useReducer`.** The `verify:` command on
[persistence-isolated-to-provider](../kb/entries/persistence-isolated-to-provider.md) asserts that
[ListsContext.tsx](../../src/state/ListsContext.tsx) is the *only* file under `src/` calling it — a
second one turns `npm run kb:audit` red. Use `useState`. If a reducer genuinely becomes warranted,
that is a librarian revision to the entry, made deliberately, not a silently broken audit.

**Screens take navigation props.** `SignInScreen` and `UnlockScreen` follow
[screens-take-navigation-props](../kb/entries/screens-take-navigation-props.md) — never
`useNavigation()` — and use theme tokens only, per
[theme-tokens-only](../kb/entries/theme-tokens-only.md).

## Staging

Ordered so that real progress lands before the toolchain install finishes:

1. **OTP sign-in, web only.** Schema, RLS, `SessionContext`, `SignInScreen`, lists scoped to the
   owner. No biometrics. Fully verifiable with `npm run web` and the allowlisted Playwright MCP —
   **this delivers accounts and ownership with zero native tooling.**
2. **Dev build + biometric unlock.** `secureSession`, `UnlockScreen`, the `locked` state, the
   background timer. Verified by hand on a device.
3. **Sharing, then realtime** — unchanged from [supabase-persistence.md](supabase-persistence.md).

## Deferring the biometric half

Steps 1 and 2 are genuinely separable, and shipping 1 alone is a coherent product rather than a
half-built one.

**The biometric layer is entirely client-side.** It touches no schema, no RLS policy, no column, and
needs no migration. `users`, `lists.owner_id`, and the policies written in step 1 are byte-for-byte
what they would be if biometrics shipped the same day; `secureSession.ts`, `biometrics.ts`, and
`UnlockScreen.tsx` are new files rather than edits.

**The order is actively better, not merely tolerable.** Step 2's hardest safety requirement is the
recovery path for a key destroyed by an enrollment change (constraint 3 above), and that path *is*
OTP. Building OTP first means the fallback is already in place and exercised before anything can
depend on it.

### Four seams to build into step 1

Cheap to include now, irritating to retrofit. Only the first is genuinely painful if skipped.

**1. Model auth state as a discriminated union, not a boolean.** A `session ? app : signIn` branch
scattered across the navigator means a third state later touches every branch point.

```ts
type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; session: Session };
// step 2 adds: | { status: 'locked' }
```

`RootNavigator` switches on `status` from the start, so `locked` becomes one new case in one
`switch`. This also keeps `SessionContext` on `useState` rather than tempting a reducer — see the
`kb:audit` constraint above.

**2. Name the storage adapter rather than inlining it.** Passing `storage: AsyncStorage` directly
into `createClient` has to be unpicked in step 2. Export a `sessionStorage` object from
`src/lib/supabase.ts` whose step-1 body is a thin AsyncStorage passthrough — that object is precisely
the seam the encrypted-blob scheme slots into, at a cost of about ten lines today.

**3. Set `scheme` in [app.json](../../app.json) during step 1.** Code-based OTP does not need deep
links, but `scheme` is part of the app's native identity; setting it before the first dev build
avoids a rebuild later.

**4. Decide now that biometrics will be opt-in**, per "offered, never required" above. It is a
product decision, not a technical one, and it needs making early: users grow accustomed to the app
opening instantly, so a Face ID prompt arriving in an update reads as new friction unless they asked
for it. A settings toggle is the natural home.

### No migration for existing sessions

Step 1 stores the session unencrypted in ordinary storage. When a user later opts into biometrics,
generate the key and encrypt the session they already hold, at that moment. Sessions predating the
feature simply remain as they are until the user opts in or signs out — there is no backfill and no
version check.

### What deferring costs

Device-level protection on a lost or borrowed phone, and nothing else. Account security is unchanged,
because biometrics adds nothing server-side: an attacker with access to the email inbox is equally
able to sign in with or without step 2. Nothing about the security posture is waiting on it.

## Verification

`npm test` and `npm run typecheck` throughout.

- **Step 1** on web, driven by Playwright MCP.
- **Step 2 cannot be verified on web or in Expo Go** — neither package works there. It needs the dev
  build on a real device or simulator. This is the first feature in the project that web verification
  cannot cover, and the reason the toolchain install is a prerequisite rather than a convenience.
- Manual cases worth running deliberately, since none are reachable from a unit test: cold start with
  biometric, cold start with biometric *cancelled*, background past the timeout, and **enrollment
  changed after sign-in** (add a fingerprint, confirm the app lands in `signedOut` with a usable OTP
  path rather than a crash).

Unit tests mock `expo-secure-store` and `expo-local-authentication` at the module boundary — which is
why `secureSession.ts` and `biometrics.ts` are separate files rather than inlined into the context.
Reducer tests are untouched and stay pure. New screen tests query through a11y labels per
[queries-go-through-a11y-labels](../kb/entries/queries-go-through-a11y-labels.md), and `await`
`render`/`fireEvent` per [rntl-14-api-changes](../kb/entries/rntl-14-api-changes.md).

## Risks

- **A dev build is now required**, which
  [no-native-build-toolchain](../kb/entries/no-native-build-toolchain.md) currently says is
  unavailable. That entry becomes stale the moment Xcode is installed and needs a librarian pass —
  *after* the install, not in anticipation of it.
- **Biometric enrollment changes destroy the stored key.** Handled by design via the OTP fallback,
  but it will happen to real users and must be tested, not reasoned about.
- **The cipher choice is unsettled** (above). It is the one part of this plan not yet grounded in a
  verified API.
- **Web is permanently second-class** for this feature. Two auth paths now exist; both need testing.
- **Biometrics protects the device, not the account.** Someone with the password to the email inbox
  can still receive an OTP and sign in elsewhere. Biometrics raises the bar for a stolen phone and
  does nothing about a compromised mailbox — passkeys are the answer to that, and this design leaves
  room for them as an additional credential on the same `users` row.
- **Manual setup only you can do:** create the Supabase project, edit the OTP email template, and
  install Xcode/Android Studio for the dev build.
