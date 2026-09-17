# Task 13, step 1 — Google sign-in, phase 1: server side only

## Context

[ai/suggestions/social-sign-in.md](../../suggestions/social-sign-in.md) proposes native Google
sign-in (`@react-native-google-signin/google-signin` + `supabase.auth.signInWithIdToken`), staged
into three phases under "## Staging". This plan covers **phase 1 only** — the doc's own words:

> **Server side only.** Three Google Cloud clients, root config block (`client_id`,
> `additional_client_ids`, `skip_nonce_check`), `.env` secret, `npx supabase stop && npx supabase
> start` (auth config is read at start). … The nearest equivalent [to a browser-redirect check] is a
> `curl -X POST '.../auth/v1/token?grant_type=id_token'` with a deliberately invalid token and
> checking the error is a token-validation failure rather than "provider not enabled" — confirm the
> exact response shape against the running GoTrue version before relying on it as a signal.

Phases 2 (client: the library, `googleSignIn.ts`, the button, `prebuild --clean`) and 3 (push the
block to production, verify on a device) are **not** this step. **No file under `src/` changes in
this phase**, `.env` gains one line, `.env.example` and `supabase/config.toml` are the only
committed files touched, and nothing is pushed to the cloud project — phase 3 owns
`npx supabase config push`.

The premise this phase leans on without re-litigating: a Google identity auto-links to an existing
`auth.users` row by verified email (suggestion doc, "The premise"); nothing in the schema, RLS, or
the client changes because of *how* a session was obtained. That's why phase 1 has no migration.

## Division of labor

Two tracks. The Google Cloud Console work needs an interactive browser session against a Google
account — nothing here is scriptable from this machine without one — so it's entirely human. Editing
`config.toml`/`.env.example`, restarting the local stack, and running the verification curl are
plain filesystem/shell operations any agent can do once the human hands back three values.

### Human — Google Cloud Console

Do these in order. Steps 5–7 each end with "copy down" — keep a scratch note, you'll need all of
it in step 8.

1. Go to https://console.cloud.google.com with the Google account that should own this project.
2. Create a new project (or pick an existing one if this app already has one — nothing about Resend
   or the `shopping-loop.com` DNS setup created a GCP project, so it's most likely a fresh one).
   Name suggestion: "ShoppingLoop" — matches the visible app name
   ([shoppingloop-is-the-visible-name-only](../../kb/entries/shoppingloop-is-the-visible-name-only.md)).
3. **APIs & Services → OAuth consent screen.** User type: **External**. App name: "ShoppingLoop".
   Support email: your own. Leave scopes at the default (`openid`, `email`, `profile`) — these are
   non-sensitive, so nothing here needs Google review. Fill in whatever else the console marks as
   required as you go (it may ask for a logo or contact email; these are cosmetic); skip anything
   marked optional.
4. **Publishing status → Publish app**, so it reads **In production**, not *Testing*. This matters:
   the suggestion doc originally treated *Testing* (capped at 100 named users) as acceptable because
   the app's mail was itself single-user at the time. That restriction is gone
   ([cloud-auth-mail-goes-through-resend](../../kb/entries/cloud-auth-mail-goes-through-resend.md)) —
   leaving this in Testing would make Google sign-in the more restrictive door of the two.
5. **Credentials → Create Credentials → OAuth client ID → Application type: Web application.**
   Name it something like "ShoppingLoop – token audience" (this client is never opened in a browser;
   it exists only as the audience Google stamps into the ID token and as the `webClientId` both
   native platforms configure against — every device's token gets checked against this one client).
   Create it, then **copy the Client ID and the Client Secret immediately** — the secret is shown
   once and can't be retrieved again later, only rotated.
6. **Create Credentials → OAuth client ID → Application type: Android.** Package name:
   `com.shoppingloop.app`. SHA-1 certificate fingerprint — use this one, already pulled from the
   debug keystore that's actually on this machine (`android/app/debug.keystore`, the one
   `expo run:android` used for the end-to-end build recorded in
   [native-build-toolchain](../../kb/entries/native-build-toolchain.md)):
   ```
   5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25
   ```
   Create it, copy the Client ID down (Android OAuth clients have no separate secret). **Read the
   "debug keystore may not survive phase 2" risk below before treating this as done for good** — a
   later step regenerates `android/`, which can invalidate this exact fingerprint. A release-keystore
   fingerprint isn't needed yet (no release keystore exists — `eas`/store distribution is still
   deferred per that same KB entry); add it as a second fingerprint on this same client whenever that
   keystore is created, no need to revisit this step for it.
7. **Create Credentials → OAuth client ID → Application type: iOS.** Bundle ID:
   `com.shoppingloop.app`. Create it, copy the Client ID down. Nothing else uses this in phase 1 —
   phase 2 needs its *reversed* form (e.g. `com.googleusercontent.apps.<id>`) for `app.json`'s
   `iosUrlScheme`, but that's a client-step task, not this one.
8. Hand back what you collected: the **three Client IDs** (Web, Android, iOS — none of these three
   are secret; Google designs them to be public, same as any OAuth client id) can go straight into
   chat or directly into `supabase/config.toml` yourself, either works. The **Web client's secret**
   is the one piece that must never be pasted into chat, a commit, or anywhere other than `.env` —
   add it there yourself:
   ```
   SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=<the Web application client's secret from step 5>
   ```
   `.env` is gitignored already; this follows the same handling `RESEND_API_KEY` got.

### Agent — once the three Client IDs are known

1. **`.env.example`** — add a doc block for `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`, same shape as
   the existing `RESEND_API_KEY` block (what it is, where it comes from, no `KEY=` line — a copied
   empty line would resolve to an empty string and push a blank secret over a working one, same
   reasoning already there for Resend).
2. **`supabase/config.toml`** — insert a new `[auth.external.google]` block right after
   `[auth.external.apple]` (currently lines 328–341), before the Solana section. Exact shape, from
   the suggestion doc's own design section:
   ```toml
   [auth.external.google]
   enabled = true
   client_id = "<the Web application client's id>"                 # public by design, safe to commit
   additional_client_ids = "<iOS client id>,<Android client id>"
   secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"
   skip_nonce_check = false
   email_optional = false
   ```
   `email_optional` stays `false` (the default, stated explicitly here the same way the `apple` block
   already states it) — constraint 4 in the suggestion doc: `public.users.email` is `not null`, and a
   provider identity with no email must be refused at the door with a real error rather than crash
   `handle_new_user`. `skip_nonce_check` stays `false` too; flipping it is a phase-2 decision gated on
   which `@react-native-google-signin` API surface the installed version exposes (constraint 6,
   explicitly unresolved) — nothing to resolve here, since phase 1 has no client library installed to
   check against yet. No `[remotes.production.auth]` override — this whole block is the same in both
   environments, so it inherits untouched (relevant once phase 3 pushes it; not an action now).
3. **`npx supabase stop && npx supabase start`** — auth config is read at container start, not
   hot-reloaded; a `db reset` is not needed, nothing in the schema changed.
4. **Verify, two checks:**
   - Cheap smoke test: `curl -s http://127.0.0.1:54321/auth/v1/settings | jq .external.google` should
     read `true`.
   - The check the suggestion doc actually asks for — proof GoTrue is doing real token validation,
     not just reporting "enabled":
     ```
     curl -s -X POST 'http://127.0.0.1:54321/auth/v1/token?grant_type=id_token' \
       -H "apikey: <EXPO_PUBLIC_SUPABASE_ANON_KEY_LOCAL from .env.example>" \
       -H "Content-Type: application/json" \
       -d '{"provider":"google","id_token":"not-a-real-token"}'
     ```
     Record the exact response body and status in the implementation log. Pass: an error that names
     token/JWT validation (e.g. malformed JWT, signature/audience failure). Fail: anything saying the
     provider itself is unsupported or disabled — that would mean step 2 didn't take effect, most
     likely because step 3's restart didn't happen or read a different `config.toml` than expected.
5. **`npm run kb:audit`** — no code changed, but this is the cheap regression check this project runs
   after any `config.toml`/`.env.example` edit (precedent: task 6 step 2's log). Expect it clean;
   anything new is worth chasing before calling the step done.

## Risk to flag now, not rediscover in phase 2

**The registered Android SHA-1 may not survive `prebuild --clean`.** `android/app/build.gradle`'s
debug `signingConfigs` points at `file('debug.keystore')` — a path relative to `android/app/`, i.e.
the project-local file this plan pulled the fingerprint from, not `~/.android/debug.keystore` (which
doesn't exist on this machine). `android/` is gitignored and explicitly regenerable
([native-build-toolchain](../../kb/entries/native-build-toolchain.md)), and the suggestion doc's
phase 2 requires exactly that regeneration (`npx expo prebuild --clean`, to pick up the
`iosUrlScheme` config plugin — constraint 2). A `--clean` prebuild deletes `android/` outright; the
next `expo run:android` then has no existing keystore to sign with and Gradle mints a brand new one,
with a different, effectively random SHA-1 — silently invalidating the Android OAuth client
registered in step 6 above.

Two ways to handle it, either is fine, neither is this phase's job to execute:
- Before running `prebuild --clean` in phase 2, copy `android/app/debug.keystore` aside and restore
  it afterward, so the same debug key — and the same fingerprint already registered — survives.
- Or just re-run the `keytool -list -v -keystore android/app/debug.keystore -alias androiddebugkey
  -storepass android -keypass android` command this plan used, after phase 2's prebuild, and update
  the Android OAuth client's fingerprint in the Google Cloud Console if it changed.

Leaving this unmentioned would mean phase 2 quietly breaks a credential phase 1 just finished
registering — worth a line in phase 2's own plan when that step is written.

## Afterwards

- Write `ai/tasks/13-google-sign-in/implementation-log-step-1.md`: the three Client IDs used (not the
  secret), the exact verification curl responses seen, and whether `email_optional`/`skip_nonce_check`
  needed to differ from the defaults above.
- Run `/librarian deposit 13`. Likely candidate facts: a new KB entry or an addition to
  [native-build-toolchain](../../kb/entries/native-build-toolchain.md) about the debug keystore's
  actual location and the `prebuild --clean` fragility above — that risk applies to any future config
  plugin, not just this one.
- Phases 2 (client) and 3 (production push) stay unplanned until this phase is verified working
  locally — write their own `plan-step-*.md` when picked up, rather than extending this one.
