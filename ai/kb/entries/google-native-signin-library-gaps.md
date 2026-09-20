---
id: google-native-signin-library-gaps
title: The free @react-native-google-signin/google-signin module has no nonce option, and iOS additionally needs an iosClientId
type: gotcha
status: current
tags: [auth, google-sign-in, ios, android]
sources: [ai/tasks/13-google-sign-in/implementation-log-step-2.md, ai/tasks/15-session-revocation/implementation-log-step-2.md, src/lib/googleSignIn.ts, supabase/config.toml]
last_verified: 2026-09-20
verify: grep -q "skip_nonce_check = true" supabase/config.toml && grep -q "iosClientId:" src/lib/googleSignIn.ts && for f in $(grep -rl 'SessionProvider' src --include='*.test.tsx'); do grep -q "jest.mock('../lib/googleSignIn'" "$f" || exit 1; done
related: [supabase-client-module-boundary, native-build-toolchain, scope-boundaries]
---

`@react-native-google-signin/google-signin@16.1.5` ([src/lib/googleSignIn.ts](../../../src/lib/googleSignIn.ts))
is the free "Original" edition of that library. Two gaps in it only surfaced by reading the installed
source directly (its README is a 30-line stub) and by actually building for each platform — not from
any doc:

**No nonce option exists anywhere in its API.** `GoogleSignin.signIn()`'s options type carries exactly
one field, `loginHint`; wiring a client nonce through to the ID token is a feature the library's own
README markets as exclusive to **Universal Sign In**, a paid fork. GoTrue's `signInWithIdToken`
normally wants a SHA-256 digest of a nonce echoed back in the token, and with no way to produce a
matching pair, `supabase/config.toml`'s `[auth.external.google]` turns that check off outright
(`skip_nonce_check = true`, commented in place) rather than `googleSignIn.ts` pretending to satisfy it.
This is a deliberate security trade-off forced by the free library, not an oversight — do not "fix" it
by re-enabling the check without first switching libraries, and carry the same setting into
`[remotes.production]` when phase 3 pushes this config.

**iOS additionally refuses to `configure()` without an explicit `iosClientId`.** This project has no
Firebase, so there is no `GoogleService-Info.plist`; without one, `webClientId` alone (sufficient as
the ID-token audience on both platforms) is not enough to satisfy iOS's own native configuration
requirement. Omitting it is a launch-time crash, not a sign-in-time error: *"RNGoogleSignin: failed to
determine clientID — GoogleService-Info.plist was not found and iosClientId was not provided."* Found
only by running `npm run ios` to a booted simulator — nothing in the JS types catches it, and Android
needs no such thing.

**Under jest, the module has no stand-in and throws at import time.** `TurboModuleRegistry.getEnforcing`
fires the instant anything requires `@react-native-google-signin/google-signin`, and `SessionContext.tsx`
imports `googleSignIn.ts` unconditionally — so every suite that renders `SessionProvider`, directly or
via a screen that calls `useSession()`, needs
`jest.mock('../lib/googleSignIn', () => ({ signInWithGoogle: jest.fn() }))` beside its
`jest.mock('../lib/supabase', ...)`. Giving an existing screen a new `useSession()` call breaks every
render call site in that screen's own suite the same way — reading the diff does not show it, only
running the suite does (`SharingScreen.test.tsx`, step 15).

**What to do:** `GoogleSignin.configure()` in `googleSignIn.ts` must always carry both `webClientId`
and `iosClientId`, and `skip_nonce_check` must stay `true` for as long as this library is installed.
The three Google Cloud client ids live in `supabase/config.toml`'s `client_id` /
`additional_client_ids`; which of the two `additional_client_ids` values is iOS is on record now —
the one also passed as `iosClientId` here and reversed into `app.json`'s `iosUrlScheme` plugin option
— so it never again needs a human to check Google Cloud Console. A screen or provider gaining
`useSession()` needs both jest mocks added to its suite in the same change.
