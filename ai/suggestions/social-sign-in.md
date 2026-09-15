# Suggestion — social sign-in beside email OTP, Google first, through the system browser

**Status:** proposal, not an approved step. Adopting it needs a new
`ai/tasks/<n>/description-step-<n>.md` first, and
[scope-boundaries](../kb/entries/scope-boundaries.md) updated afterwards by the librarian.

**Date:** 2026-09-15

**Relationship to [otp-biometric-auth.md](otp-biometric-auth.md):** email OTP stays exactly as it
is — this adds a second door to the same account, it does not replace the first. The biometric
half of that document is untouched and still needs a dev build.
**Relationship to [production-supabase.md](production-supabase.md):** the config-push mechanics it
describes (whole root goes up, `env()` resolved at push time, no dry run) are what carry the provider
block to the cloud project; nothing there changes.

## The premise: a provider is a second identity on the same row, not a second account

Ownership in this app is `auth.users.id` → `public.users` → `list_members.user_id`, and RLS reads
`auth.uid()`. A social provider adds an **identity** (`auth.identities`) to an `auth.users` row; the
row, its id, its lists and its memberships are unchanged. Nothing in the schema, the policies, the
RPCs, the outbox, the cache (keyed by user id) or realtime (`user:<uid>` inbox) knows or cares how a
session was obtained.

The property that makes this cheap: **Supabase Auth links a new identity to an existing user with the
same email automatically, provided both sides have verified the address.** An OTP sign-in verifies it
(the code proves inbox control); Google reports `email_verified: true`. So a user who has signed in
with the code before and now taps "Continue with Google" with the same address lands in the same
account with the same lists — no migration, no re-sharing, nothing to write. A *different* address
is a different account, which is the existing rule ("the account is the email") and is what
`share_list`'s email lookup assumes.

What must not change: `public.users` visibility (own row only), `share_list` resolving by email
server-side, `handle_new_user`. All three already cover a provider-created user (an `insert` into
`auth.users`) and a linked identity (no insert, no email change — the trigger does not fire, and
need not).

## Verified platform constraints (checked 2026-09-15 against the v54 Expo docs and Supabase docs)

Each of these shaped a decision below; do not re-derive them from the unversioned docs.

1. **There is no native Google sign-in in Expo Go.** Supabase's Expo recipe for Google is
   `@react-native-google-signin/google-signin` + `signInWithIdToken`, and that library is a community
   native module: it needs a development build, which this project does not have and has decided not
   to buy ([native-build-toolchain](../kb/entries/native-build-toolchain.md)). The **browser-based
   flow** — `signInWithOAuth` + `expo-web-browser`'s `openAuthSessionAsync` — runs in Expo Go, in the
   simulator and in the browser from one code path, with two Expo SDK modules that ship inside Expo
   Go (`expo-web-browser`, `expo-linking`). That is the flow proposed. Native one-tap is the upgrade
   path once a dev build exists, not the starting point.
2. **In Expo Go the callback URL is `exp://<lan-ip>:8081/--/<path>`, not `shopping-list://<path>`.**
   `Linking.createURL('auth/callback')` returns the `exp://` form under Expo Go and the custom scheme
   only in a dev/standalone build (and `http://localhost:8081/auth/callback` on web). The `scheme` in
   `app.json` and production's `additional_redirect_urls = ["shopping-list://*"]` therefore do
   **nothing** for the phone today; the allow-list has to accept an `exp://` pattern for as long as
   Expo Go is the client. Expo also warns that `createURL` under Expo Go is undefined for *published
   updates* — irrelevant while the phone talks to a dev server, but it is the reason a store build
   will need a dev build and the custom scheme, not a reason to avoid Expo Go now.
3. **Google refuses OAuth inside an embedded WebView (`disallowed_useragent`).** `openAuthSessionAsync`
   uses `ASWebAuthenticationSession` / Chrome Custom Tabs, which Google treats as a real browser. Do
   not "simplify" this to `react-native-webview`; it will fail at Google's door.
4. **Apple is deferred, deliberately.** `expo-apple-authentication` does run in Expo Go, but the
   identity token it returns there is issued to Expo Go's bundle id and team, and Apple scopes the
   user identifier (`sub`) per team — an account minted that way is **not the same user** in a later
   build under this project's own team. The web-flow alternative (Services ID + a client-secret JWT
   that expires every six months and has to be regenerated and pushed) avoids that but, like the
   native one, needs a paid Apple Developer Program membership. And App Store Review Guideline 4.8
   requires Sign in with Apple the day an app offering Google login ships through the store — which
   binds a future dev-build step, not this one.
5. **`public.users.email` is `not null` and the trigger copies `auth.users.email`.** A provider that
   returns no email (X; Facebook for phone-only accounts) would fail *inside* the sign-up transaction
   with a 500 nobody can read. Keep `[auth.external.<provider>] email_optional = false` (the default)
   so GoTrue refuses such an identity at the door with a real error, and start with the one provider
   that always returns a verified email. Google is that provider; it is why it goes first.
6. **supabase-js defaults to the implicit flow, and Supabase's Expo deep-linking guide uses it**
   (`access_token`/`refresh_token` in the callback URL, then `setSession`). This plan uses **PKCE**
   instead: `flowType: 'pkce'` on `createClient`, and the callback carries a one-time `code` that
   only the client holding the verifier (in `sessionStorage` → AsyncStorage) can exchange. A logged
   or leaked callback URL is then worthless, where under implicit it is a refresh token. It is one
   line of config; the cost is that `exchangeCodeForSession` replaces `setSession` in the module
   below, and that the existing OTP path must be re-run under it (it should be unaffected — PKCE
   changes magic *links*, which this app does not send; `verifyOtp` with a token is not a link).
7. **One Google OAuth client serves both environments.** Google accepts
   `http://127.0.0.1:54321/auth/v1/callback` as an authorized redirect URI on a "Web application"
   client alongside `https://gvosanjceygakbubjfkv.supabase.co/auth/v1/callback`, and the `client_id`
   is public by design. So the block lives at the root of `config.toml` and inherits into
   production, which is exactly what
   [supabase-config-push-sends-the-whole-root](../kb/entries/supabase-config-push-sends-the-whole-root.md)
   says a root key does. The secret goes through `env()` and **must be present at push time** or
   production's secret is pushed blank — the same trap `RESEND_API_KEY` already documents.
8. **Playwright cannot drive a real Google login** (bot detection, 2FA). The module gets a jest suite;
   the round trip is verified by a human in the browser against the local stack, which *can* do a
   real Google sign-in because of constraint 7. This is the first auth path whose end-to-end check is
   not automatable, and the step's log should say so rather than claim a Playwright run.

## The design

### Client

**`src/lib/supabase.ts`** — add `flowType: 'pkce'` to the `auth` options. Config that is only *set*
belongs here ([supabase-client-module-boundary](../kb/entries/supabase-client-module-boundary.md)).
`detectSessionInUrl: Platform.OS === 'web'` stays: on web it is what finishes the flow.

**New `src/lib/oauth.ts`** — the whole browser dance, below the provider and beside `listsChannel.ts`
(a flow with a lifetime, not a query). One importer of `./supabase`, one exported function, so the
auth suites mock this module the way the list suites mock `listsChannel`:

```ts
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { supabase } from './supabase';

export type Provider = 'google';
export type Result = { error: string | null };

/**
 * Opens the provider's consent page in the system browser and turns the callback into a session.
 * Success is reported through `onAuthStateChange` like every other sign-in; the returned Result
 * only carries failure. A closed sheet is not a failure.
 */
export async function signInWithProvider(provider: Provider): Promise<Result> {
  // exp://<ip>:8081/--/auth/callback in Expo Go, shopping-list://auth/callback in a dev build,
  // http://localhost:8081/auth/callback on web. Every one must be on Supabase's allow-list.
  const redirectTo = Linking.createURL('auth/callback');

  if (Platform.OS === 'web') {
    // Same-tab redirect. detectSessionInUrl exchanges the code on the way back in.
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
    return { error: error?.message ?? null };
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) return { error: error.message };

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return { error: null };

  const { queryParams } = Linking.parse(result.url);
  const code = queryParams?.code;
  if (typeof code !== 'string') {
    // GoTrue reports a refused identity here, e.g. a provider that returned no email.
    const reason = queryParams?.error_description;
    return { error: typeof reason === 'string' ? reason : 'Sign-in did not complete' };
  }

  const { error: exchange } = await supabase.auth.exchangeCodeForSession(code);
  return { error: exchange?.message ?? null };
}
```

`exchangeCodeForSession` fires `SIGNED_IN` through the listener `SessionProvider` already owns, so
the navigator swaps stacks exactly as it does after `verifyCode`. No new `AuthState` case: the
session is a session.

**`src/state/SessionContext.tsx`** — one new member on the context value, `signInWithProvider`,
delegating to the module above. `requestCode`/`verifyCode`/`signOut` are untouched.

**`src/screens/SignInScreen.tsx`** — one button on the email phase, `accessibilityLabel="Continue
with Google"`, sharing the existing `pending`/`error` state. Unlike `verify`, it **always** clears
`pending` after the promise resolves: a closed sheet returns `{ error: null }` with no state change,
and on success the screen is already unmounted, where the reset is a harmless no-op. Web never
resolves the same-tab branch at all — the page navigates away — so `pending` staying set there is
the correct picture.

**Tests** — `SessionContext.test.tsx` and `SignInScreen.test.tsx` add `jest.mock('../lib/oauth')`
next to the `../lib/supabase` mock, so neither Expo module loads under jest. New `src/lib/oauth.test.ts`
mocks `./supabase`, `expo-web-browser` and `expo-linking` and covers: success → `exchangeCodeForSession`
called with the code from the URL; `cancel`/`dismiss` → no exchange, `error: null`; a callback carrying
`error_description` → surfaced; the web branch → no `openAuthSessionAsync`, no `skipBrowserRedirect`.
`transformIgnorePatterns` already covers `expo*`.

**Dependencies** — `npx expo install expo-web-browser expo-linking`. Both are Expo SDK modules present
in Expo Go; the managed workflow is intact and `native-build-toolchain` stays true. No
`expo-auth-session`: `Linking.parse` reads a `?code=` query string, which is all PKCE hands back.

### Server and config

**No migration.** See the premise: the trigger, the policies and `share_list` already cover it.

**`supabase/config.toml`, root:**

```toml
[auth.external.google]
enabled = true
client_id = "<the one Web-application client's id>"       # public by design, safe to commit
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"
# skip_nonce_check stays false: it is for the native id-token flow, which this plan does not use.
# email_optional stays false: constraint 5.
```

and, at the root, `additional_redirect_urls` gains `"http://localhost:8081/**"` (web dev) and
`"exp://**"` (Expo Go on the simulator and a phone). The `exp://` pattern is loose on purpose: it only
says where GoTrue may send a one-time code that is useless without the verifier on the device that
started the flow, and it is deleted the day a dev build makes `shopping-list://` real.

**`[remotes.production.auth]`** — its `additional_redirect_urls` override must gain `"exp://**"` too,
because an override replaces the root value rather than extending it; `http://localhost:8081/**` is
deliberately *not* restated there, so it stays local-only — the same shape the block already has for
`site_url`. `[auth.external.google]` is **not** restated: it inherits, which is the point.

**`.env.example`** — document `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` exactly as `RESEND_API_KEY` is
documented: where to get it, and *no* empty `KEY=` line, for the same reason (an empty line resolves
to an empty string and pushes a blank secret over a working one).

**Google Cloud console** — one OAuth client of type *Web application*. Authorized redirect URIs:
`http://127.0.0.1:54321/auth/v1/callback` and `https://gvosanjceygakbubjfkv.supabase.co/auth/v1/callback`.
Consent screen: External; *Testing* publishing status is enough — it caps at 100 named test users,
which matches an app whose mail is still single-user until SMTP phase 2. `email`/`profile` are not
sensitive scopes, so no brand verification is needed to leave Testing later.

## Staging

1. **Server side only.** Google client, root config block, `.env` secret, `npx supabase stop && npx
   supabase start` (auth config is read at start). Verify: `curl -sI
   'http://127.0.0.1:54321/auth/v1/authorize?provider=google&redirect_to=http://localhost:8081/'`
   answers `302` to `accounts.google.com` — a disabled or misconfigured provider answers `400`.
2. **Client.** `flowType`, `oauth.ts` + suite, context member, button, suite updates. Verify: the
   button in the browser at `localhost:8081` completes a real Google sign-in against the local stack
   and the lists load; the simulator does the same through an `exp://` callback; then sign out and
   sign back in with the **code** to the same address and confirm the same lists — that is the
   auto-link, and it is the assertion that matters most. Re-run the existing Playwright OTP path
   under PKCE (constraint 6).
3. **Production.** `npx supabase config push` from a checkout whose `.env` holds *both* secrets, without
   `--yes`, and read the printed diff: the google block, the `exp://**` addition, and a non-empty
   secret. Then a phone in Expo Go, cloud target. This is the first physical-device sign-in the
   project will have run at all — [supabase-local-stack](../kb/entries/supabase-local-stack.md)
   records that none has — so the log should say what was actually seen.
4. **Later, with a dev build:** Apple (constraint 4), native Google one-tap via `signInWithIdToken`,
   and `exp://**` removed from both allow-lists as `shopping-list://` takes over.

## Deliberately out

- **Apple, Facebook, X** — constraints 4 and 5. Facebook additionally needs Meta app review before
  anyone outside the developer's own account can use it.
- **Native `signInWithIdToken` for Google** — needs a dev build; it is the upgrade, not the base.
- **Identity management** — no "linked accounts" screen, no `unlinkIdentity`, no manual linking
  (`enable_manual_linking` stays `false`). Auto-link covers the one case the product has.
- **What the sharing roster shows** — still the email. A `display_name` column on `public.users`
  filled by `handle_new_user` from `raw_user_meta_data->>'full_name'` is the obvious follow-up once a
  provider supplies one, and would also be what makes an Apple private-relay address bearable in the
  roster. Not this step: it is a migration and a UI change with no bearing on sign-in.
- **A second `AuthState` case.** Nothing about a provider session is different from an OTP session
  once it exists.
