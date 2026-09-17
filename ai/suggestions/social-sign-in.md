# Suggestion — social sign-in beside email OTP, Google first, native sign-in only, not on web

**Status:** proposal, not an approved step. Adopting it needs a new
`ai/tasks/<n>/description-step-<n>.md` first, and
[scope-boundaries](../kb/entries/scope-boundaries.md) updated afterwards by the librarian.

**Date:** 2026-09-15

**Revised 2026-09-17 — the toolchain premise changed, the design did not.** This document was
written when a native dev build was treated as something the project had decided not to have. On
2026-09-17 the user directed that community native modules and a dev build may be used whenever a
feature needs them, and that a paid Apple Developer account will be made available when something
needs one ([native-build-toolchain](../kb/entries/native-build-toolchain.md)). What that changed
here: native Google one-tap (`signInWithIdToken`) and Sign in with Apple were no longer excluded by
policy, only by setup cost — a dev build was still not set up at the time.

**Revised 2026-09-17, again — the design decision itself changed, not just the premise.** The user
directed two things: (1) no social sign-in on web at all, email OTP remains the only web path, and
(2) Google sign-in is `@react-native-google-signin/google-signin` + `supabase.auth.signInWithIdToken`
— the native flow — not the browser-based `signInWithOAuth` + `expo-web-browser` flow this document
originally proposed as the first step. That earlier design (a `src/lib/oauth.ts` browser dance,
`flowType: 'pkce'` on the Supabase client, `additional_redirect_urls` entries for `exp://` and
`localhost`) is fully superseded and removed below, not kept as a fallback. The reason it existed —
one code path across web, Expo Go and a dev build with no native setup — stops mattering once web is
out of scope and a dev build is the only target: native sign-in is now the base, not the upgrade.
Everything below reflects only the native design; PKCE and the redirect allow-list are not part of
it.

**Relationship to [otp-biometric-auth.md](otp-biometric-auth.md):** email OTP stays exactly as it
is — this adds a second door to the same account, it does not replace the first, and it now only
opens that second door on native. The biometric half of that document is untouched and still needs
a dev build.
**Relationship to [production-supabase.md](production-supabase.md):** the config-push mechanics it
describes (whole root goes up, `env()` resolved at push time, no dry run) are what carry the
provider block to the cloud project; nothing there changes.

## The premise: a provider is a second identity on the same row, not a second account

Ownership in this app is `auth.users.id` → `public.users` → `list_members.user_id`, and RLS reads
`auth.uid()`. A social provider adds an **identity** (`auth.identities`) to an `auth.users` row; the
row, its id, its lists and its memberships are unchanged. Nothing in the schema, the policies, the
RPCs, the outbox, the cache (keyed by user id) or realtime (`user:<uid>` inbox) knows or cares how a
session was obtained — this holds regardless of which transport produced the session, so it is
unaffected by the native-vs-browser decision below.

The property that makes this cheap: **Supabase Auth links a new identity to an existing user with the
same email automatically, provided both sides have verified the address.** An OTP sign-in verifies it
(the code proves inbox control); Google reports `email_verified: true`. So a user who has signed in
with the code before and now taps "Continue with Google" on their phone with the same address lands
in the same account with the same lists — no migration, no re-sharing, nothing to write. A
*different* address is a different account, which is the existing rule ("the account is the email")
and is what `share_list`'s email lookup assumes.

What must not change: `public.users` visibility (own row only), `share_list` resolving by email
server-side, `handle_new_user`. All three already cover a provider-created user (an `insert` into
`auth.users`) and a linked identity (no insert, no email change — the trigger does not fire, and
need not).

## Verified platform constraints (checked 2026-09-17 against Supabase's and react-native-google-signin's current docs)

Each of these shaped a decision below; do not re-derive them from the unversioned docs, and re-check
the ones marked unresolved before writing code — `@react-native-google-signin`'s API surface has
moved between an "Original" Play-Services module and a newer Credential-Manager/"One Tap" module, and
this document does not pin which one the installed version exposes.

1. **No native Google sign-in in Expo Go, and no web implementation at all.** Both Supabase's React
   Native guide and the library's own Expo setup docs confirm `@react-native-google-signin/google-signin`
   needs a development build; there is no web target to fall back to. Because web is now out of scope
   for this feature entirely (see Deliberately out), there is no fallback path left to reach for —
   using or testing this feature means a dev build, on both iOS and Android, no exceptions.
2. **The config plugin needs an iOS URL scheme, not a Supabase redirect URL.** Without Firebase (this
   project has none), `app.json`'s `expo.plugins` gets
   `["@react-native-google-signin/google-signin", { "iosUrlScheme": "<reversed iOS client id>" }]`.
   That changes native code, so it needs `npx expo prebuild --clean` before the next `npm run
   ios`/`npm run android` — the existing gitignored `ios/`/`android/` dirs
   ([native-build-toolchain](../kb/entries/native-build-toolchain.md)) regenerate to pick it up; that
   is the reason to regenerate them, not a reason to eject. Because there is no redirect leg at all in
   this flow, `supabase/config.toml`'s `additional_redirect_urls` needs no new entries — a
   simplification against the browser design, which needed `exp://**` on both the root and the
   production override because an override replaces rather than extends.
3. **Apple is deferred, deliberately.** `expo-apple-authentication` does run in Expo Go, but the
   identity token it returns there is issued to Expo Go's bundle id and team, and Apple scopes the
   user identifier (`sub`) per team — an account minted that way is **not the same user** in a later
   build under this project's own team. The web-flow alternative (Services ID + a client-secret JWT
   that expires every six months and has to be regenerated and pushed) avoids that but, like the
   native one, needs a paid Apple Developer Program membership (available on request, so this is a
   sequencing choice, not a blocker). App Store Review Guideline 4.8 requires Sign in with Apple the
   day an app offering Google login ships through the store — which binds a future step, not this one.
4. **`public.users.email` is `not null` and the trigger copies `auth.users.email`.** A provider that
   returns no email (X; Facebook for phone-only accounts) would fail *inside* the sign-up transaction
   with a 500 nobody can read. Keep `[auth.external.google] email_optional = false` (the default) so
   GoTrue refuses such an identity at the door with a real error, and start with the one provider that
   always returns a verified email. Google is that provider; it is why it goes first.
5. **Three Google Cloud OAuth clients, not one.** The native flow needs a "Web application" client
   (used only as the audience for ID-token verification and as the `webClientId` passed to
   `GoogleSignin.configure` on *both* platforms — Supabase's guide is explicit that the Android build
   also configures the web client id, not an Android one), an "Android" client (needs the app's
   package name, `com.shoppingloop.app`, and the SHA-1 fingerprints of **both** the debug keystore and
   the eventual release keystore — a different fingerprint per keystore, both registered), and an
   "iOS" client (needs the bundle id, also `com.shoppingloop.app`). All three client ids go on the
   Supabase side: the web one as `client_id`, the other two as `additional_client_ids` (comma-separated,
   web first). This replaces the browser design's single shared "Web application" client
   (`supabase-config-push-sends-the-whole-root` still governs how the block reaches production, but
   there is more in the block now).
6. **Nonce verification is a known integration trap on this exact pairing**, documented in the
   library's own security guide and in open issues against it: GoTrue expects a SHA-256 digest of a
   client-generated nonce to appear in the Google ID token's `nonce` claim, matching a raw nonce
   handed to `signInWithIdToken` separately, and getting both ends to agree needs the nonce wired
   through `GoogleSignin`'s sign-in call explicitly — it does not happen automatically. Reports of
   `"Passed nonce and nonce in id_token should either both exist or not"` against this exact pairing
   are common enough to be worth planning for rather than debugging cold. **Unresolved, check at
   implementation time:** whether the installed version's sign-in call accepts a `nonce` option (the
   library's docs show a `getUrlSafeNonce()` → SHA-256 digest → pass to sign-in → pass the raw nonce to
   `signInWithIdToken` pattern), or whether the version in use forces `skip_nonce_check = true` in
   `config.toml` and the Supabase dashboard instead. Do not guess which branch applies; the library's
   README for the installed version is the source of truth, per `AGENTS.md`'s "read the exact versioned
   docs" rule.
7. **Playwright cannot drive a real Google login** (bot detection, 2FA), and it is even less able to
   now — the sign-in surface is a native Play-Services/iOS sheet, not a browser page at all. The
   module gets a jest suite with the native module mocked; the round trip is verified by a human on a
   dev build against the local stack. This remains the first auth path whose end-to-end check is not
   automatable, and the step's log should say so rather than claim a Playwright run.
8. **The web exclusion has to be enforced in code, not just left unbuilt.** The native module has no
   web implementation, so `SignInScreen` cannot import it unconditionally — bundling or evaluating it
   under `Platform.OS === 'web'` would fail, not just render nothing. The button and its import must
   both be gated behind a native check.

## The design

### Client

**`app.json`** — add the config plugin, non-Firebase form:
```json
{
  "expo": {
    "plugins": [
      ["@react-native-google-signin/google-signin", { "iosUrlScheme": "<reversed iOS client id>" }]
    ]
  }
}
```
Then `npx expo prebuild --clean` before the next native build (constraint 2). No change to
`src/lib/supabase.ts` at all — no `flowType`, no `detectSessionInUrl` change; those were only ever
needed for the browser-redirect design this document no longer proposes.

**New `src/lib/googleSignIn.ts`** — the whole native round trip, one importer of `./supabase`, one
exported function, the same module-boundary shape as `listsChannel.ts`
([supabase-client-module-boundary](../kb/entries/supabase-client-module-boundary.md)):

```ts
import { GoogleSignin } from '@react-native-google-signin/google-signin';

import { supabase } from './supabase';

export type Result = { error: string | null };

GoogleSignin.configure({ webClientId: '<the Web application client id>' });

/**
 * Runs the native Google sign-in sheet and turns the resulting ID token into a Supabase session.
 * Success is reported through onAuthStateChange like every other sign-in; the returned Result only
 * carries failure. A cancelled sheet is not a failure.
 *
 * Nonce handling is deliberately left as a TODO marker here: constraint 6 is unresolved against the
 * installed library version. Wire a matching nonce through GoogleSignin's sign-in call and
 * signInWithIdToken's `nonce` option, or set `skip_nonce_check` in config.toml, per whichever the
 * installed version's README calls for — do not guess.
 */
export async function signInWithGoogle(): Promise<Result> {
  await GoogleSignin.hasPlayServices(); // no-op on iOS, required check on Android
  const result = await GoogleSignin.signIn();
  if (result.type === 'cancelled') return { error: null };

  const idToken = result.data?.idToken;
  if (!idToken) return { error: 'Sign-in did not return an identity token' };

  const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
  return { error: error?.message ?? null };
}
```

`signInWithIdToken` fires `SIGNED_IN` through the listener `SessionProvider` already owns, so the
navigator swaps stacks exactly as it does after `verifyCode`. No new `AuthState` case: the session is
a session.

**`src/state/SessionContext.tsx`** — one new member on the context value, `signInWithGoogle`,
delegating to the module above. `requestCode`/`verifyCode`/`signOut` are untouched.

**`src/screens/SignInScreen.tsx`** — one button, rendered only when `Platform.OS !== 'web'`
(constraint 8), `accessibilityLabel="Continue with Google"`, sharing the existing `pending`/`error`
state. Unlike `verify`, it always clears `pending` after the promise resolves: a cancelled sheet
returns `{ error: null }` with no state change, and on success the screen is already unmounted, where
the reset is a harmless no-op.

**Tests** — `SessionContext.test.tsx` and `SignInScreen.test.tsx` add `jest.mock('../lib/googleSignIn')`
next to the `../lib/supabase` mock, so the native module never loads under jest. `SignInScreen.test.tsx`
adds a case asserting the button does not render when `Platform.OS` is `'web'`. New
`src/lib/googleSignIn.test.ts` mocks `@react-native-google-signin/google-signin` and `./supabase` and
covers: success → `signInWithIdToken` called with the returned token; `cancelled` → no call,
`error: null`; a missing `idToken` on the result → surfaced as an error.

**Dependencies** — `npx expo install @react-native-google-signin/google-signin`, plus the config
plugin and a `prebuild --clean` (constraint 2). No `expo-web-browser`, no `expo-linking`: nothing
here is a deep link.

### Server and config

**No migration.** See the premise: the trigger, the policies and `share_list` already cover it,
regardless of transport.

**Google Cloud console** — three OAuth clients under one project (constraint 5): "Web application"
(the audience client — also the one `GoogleSignin.configure`'s `webClientId` uses on both platforms),
"Android" (package `com.shoppingloop.app`, debug **and** release SHA-1 fingerprints), "iOS" (bundle id
`com.shoppingloop.app`). Consent screen: External. **Publishing status needs a real decision here
(corrected 2026-09-17)** — the original draft called *Testing* "enough" because it caps at 100 named
test users and the app's mail was *itself* single-user until SMTP phase 2, two independent
restrictions that happened to coincide. Phase 2 landed the same day
([cloud-auth-mail-goes-through-resend](../kb/entries/cloud-auth-mail-goes-through-resend.md)): email
OTP already reaches any address, so leaving Google's consent screen in Testing would now make Google
sign-in *more* restrictive than the door beside it — only up to 100 manually-added test users could
complete it, everyone else hits Google's own "app not verified" refusal before this app ever sees
them. Move to **In production** publishing status instead; `email`/`profile` are not sensitive
scopes, so that move needs no Google review, just the switch in the console.

**`supabase/config.toml`, root:**

```toml
[auth.external.google]
enabled = true
client_id = "<the Web application client's id>"                 # public by design, safe to commit
additional_client_ids = "<iOS client id>,<Android client id>"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"
skip_nonce_check = false   # flip only if constraint 6 resolves that way for the installed version
# email_optional stays false: constraint 4.
```

Nothing else in `config.toml` changes — no `additional_redirect_urls` entries, because this flow has
no redirect leg (constraint 2). `[remotes.production.auth]` needs no override at all for this block:
unlike the browser design, there is no per-environment value here that differs, so the whole thing
inherits to production untouched.

**`.env.example`** — document `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` exactly as `RESEND_API_KEY` is
documented: where to get it, and *no* empty `KEY=` line, for the same reason (an empty line resolves
to an empty string and pushes a blank secret over a working one).

## Staging

1. **Server side only.** Three Google Cloud clients, root config block (`client_id`,
   `additional_client_ids`, `skip_nonce_check`), `.env` secret, `npx supabase stop && npx supabase
   start` (auth config is read at start). There is no cheap `curl`-and-expect-a-302 proxy this time —
   that check exercised the `/authorize` endpoint, which belongs to the code-exchange flow this
   document no longer uses. The nearest equivalent is a `curl -X POST
   '.../auth/v1/token?grant_type=id_token'` with a deliberately invalid token and checking the error
   is a token-validation failure rather than "provider not enabled" — confirm the exact response shape
   against the running GoTrue version before relying on it as a signal.
2. **Client.** Config plugin, `prebuild --clean`, `googleSignIn.ts` + suite, context member, button
   (native-only, hidden on web), suite updates including the "no button on web" case. Verify: sign-in
   completes on both an Android emulator dev build and an iOS simulator dev build against the local
   stack and the lists load on each — this is the first feature to require a *booted* iOS dev build,
   which [native-build-toolchain](../kb/entries/native-build-toolchain.md) records has not happened
   yet (only Android has end-to-end proof so far); then sign out and sign back in with the **OTP code**
   to the same address and confirm the same lists — that is the auto-link, and it is the assertion
   that matters most.
3. **Production.** `npx supabase config push` from a checkout whose `.env` holds both secrets, without
   `--yes`, and read the printed diff: the google block and a non-empty secret (no redirect-URL diff
   to check this time). Then a native dev build — never Expo Go, which cannot run this module at all
   — pointed at the cloud target. This is the first physical-device or native-simulator sign-in the
   project will have run at all against production — [supabase-local-stack](../kb/entries/supabase-local-stack.md)
   records that none has — so the log should say what was actually seen.
4. **Later:** Apple (constraint 3).

## Deliberately out

- **Web.** By product decision, not a technical stopgap: email OTP remains the only sign-in path on
  web, permanently for this feature, not just until a browser-based flow is built later. There is no
  staged web rollout in this plan and none is intended.
- **The browser-based `signInWithOAuth` + `expo-web-browser` flow.** This was the base design in the
  2026-09-15 and first 2026-09-17 drafts of this document, chosen for running one code path across
  web, Expo Go and a dev build with no native setup. Superseded now that web is out of scope and a dev
  build is the only target — that reason no longer applies, and the `oauth.ts`/PKCE/redirect-allow-list
  design it required is removed above, not kept as a fallback.
- **Apple, Facebook, X** — constraints 3 and 4. Facebook additionally needs Meta app review before
  anyone outside the developer's own account can use it.
- **Identity management** — no "linked accounts" screen, no `unlinkIdentity`, no manual linking
  (`enable_manual_linking` stays `false`). Auto-link covers the one case the product has.
- **What the sharing roster shows** — still the email. A `display_name` column on `public.users`
  filled by `handle_new_user` from `raw_user_meta_data->>'full_name'` is the obvious follow-up once a
  provider supplies one, and would also be what makes an Apple private-relay address bearable in the
  roster. Not this step: it is a migration and a UI change with no bearing on sign-in.
- **A second `AuthState` case.** Nothing about a provider session is different from an OTP session
  once it exists.
