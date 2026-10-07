# Step 3 — implementation log (2026-10-06)

Revoking Apple's token on an iOS deletion, and recovering the email-less sign-in, against the local stack. Nothing is
on cloud. Nothing is committed. No `/librarian deposit` (step 1's request 5).

**Where this log and the description differ, this log wins.** The description's account of the lock-out and its
recovery (a second Apple sheet opened at once) were disproved on devices. The recovery was redesigned with the user
(below).

## What the user did

- **The key.** They created a Sign in with Apple key for the primary App ID `com.shoppingloop.app`, and added
  `APPLE_SIGN_IN_KEY_ID` (10 chars) and `APPLE_SIGN_IN_PRIVATE_KEY` (344 chars, the `.p8` in base64 on one line) to
  `.env`. The agent read only names and lengths.
- **The App ID rename.** They set the App ID's description to `ShoppingLoop`, and the app already authorized on the
  simulator is now listed as "ShoppingLoop" in Settings → Sign in with Apple. **The listing follows the rename for an
  existing authorization.**
- **The device steps:** Apple's sheets, typing the Apple Account password, the Settings checks (2FA), every step on the
  iPhone 13.
- **They chose the recovery redesign:** "Revoke, then ask to wait (Recommended)" (AskUserQuestion, below).

## What was built

| file | change |
|---|---|
| `supabase/functions/_shared/apple.ts` (new) | the ES256 client secret, minted per request through WebCrypto (`importKey('pkcs8')`, ECDSA P-256: the signature is already r‖s, so no `jose`); `exchangeCode` returns `{ sub, refreshToken }`, with `sub` read from the unverified `id_token` payload; `revoke`; `readCode`; `fail`; the failure table; a 10 s timeout on each Apple call |
| `supabase/functions/delete-account/index.ts` (new) | `verify_jwt` on. The steps: read the code, then `getUser(token)` on an anon client carrying the caller's `Authorization`, then the Apple identity, then exchange, then the `sub` check, then revoke, then `rpc('delete_account')`, then 204 |
| `supabase/functions/reset-apple-sign-in/index.ts` (new) | `verify_jwt = false`: exchange, revoke, 204 |
| `supabase/config.toml` | `[edge_runtime.secrets]` maps both variables with `env()`, and `[functions.reset-apple-sign-in] verify_jwt = false`. The Apple block's `email_optional` comment is corrected (the cause below) |
| `.env.example` | both secrets documented, with no `KEY=` lines; the `base64 -i … \| tr -d '\n'` recipe |
| `tsconfig.json` | `exclude` restates the base's list plus `supabase/functions` (Deno: `npm:` imports, `Deno` global) |
| `src/lib/appleSignIn.ts` | `reauthorizeWithApple()` (`requestedScopes: []`, giving `{ code }`, `{ cancelled: true }` or `{ error }`). The recovery in `signInWithApple()`, redesigned (below) |
| `src/lib/profileApi.ts` | `deleteAccountWithApple(code)` → `functions.invoke('delete-account')`. A `FunctionsHttpError` is told apart by `error.name`, since the module boundary allows only type imports of supabase-js, and its `context` `Response` body/status go to `resultFor`. A fetch or relay error is status 0, so `retryable`; a non-JSON body keeps `error.message` |
| `src/state/SessionContext.tsx` | `deleteOnServer(session)`: on iOS with `app_metadata.providers` including `'apple'`, it calls `reauthorizeWithApple()`, then `deleteAccountWithApple`; everything else uses the RPC. A sheet error becomes `{ error, verdict: 'permanent' }`. New `export type DeletionCancelled = { cancelled: true }`, so `deleteAccount` returns `ApiResult \| DeletionCancelled` |
| `src/screens/AccountScreen.tsx` | `'cancelled' in result` → `setPendingDelete(false)`; the confirm stays open, with no banner. The look is unchanged |

### Decisions beyond the description

- **The cancel shape** is a separate union member with no `error` field, so typecheck forces every caller to handle it
  (only AccountScreen calls `deleteAccount`).
- **Answers the table lacked:**

  | code | status | message | when |
  |---|---|---|---|
  | `invalid_request` | 400 | `Apple's sign-in code is missing. Try again.` | the body has no `authorizationCode` |
  | `apple_not_configured` | 500 | `Sign in with Apple isn't set up on the server.` | either secret is unset (verified before the key existed) |

  `apple_not_configured` is deliberately not a 4xx: it is the operator's mistake.
- **Any 4xx from Apple, on either endpoint, is `apple_code_rejected`.** No answer, a timeout or a 5xx is
  `apple_unavailable`, which answers 424. Apple's `error` field (`invalid_grant`, …) and the status are logged; the
  code, the tokens and the key never are.
- **A revoked session.** GoTrue answers `getUser` for a token whose session is gone with `session_not_found`, which
  auth-js 2.112.4 throws as `AuthSessionMissingError`: 400 "Auth session missing!", with no `code`. The function maps
  it (`isAuthSessionMissingError`) to 403 `{ code: '42501', message: 'this device has been signed out' }`, the words
  of `session_still_valid()`, so the app's `sessionRevoked` still signs the device out. Measured: before the mapping
  the function answered 400; the RPC directly answered 403 42501.
- **The `sub` check** compares with `identity.identity_data?.sub ?? identity.id`. In the DB,
  `provider_id = identity_data->>'sub'`. Every real deletion passed it.
- **supabase-js in Deno:** `npm:@supabase/supabase-js@2.112.4` loads with no `package.json` or `deno.json`
  (edge-runtime 1.74.3, Deno 2.1.4).

## The recovery, redesigned

**The description's design:** on a 500 for an email-less token, revoke through `reset-apple-sign-in`, then open
Apple's sheet again at once, expecting Apple's consent sheet with the email.

**What the devices did.** All times UTC, local stack. Device "S" is the iPhone 18 Pro simulator; device "P" is the
iPhone 13 over the LAN.

| time | device | what | result |
|---|---|---|---|
| (start) | — | the authorization was the cloud Hide My Email one from 17:19; local had no Apple identity | — |
| 20:49:28 | S | Apple sign-in (returning sheet) | **200, new user with the relay email.** The returning token *carried* `email` and `is_private_email: true` |
| ~20:56 | S | delete → cancel the sheet | confirm stays open, no banner, nothing deleted |
| 20:57:02 | S | delete → password | `delete-account` 204; the user and its list are gone; Settings no longer lists ShoppingLoop |
| 21:00:46 | S | Apple sign-in (returning sheet) | 500, `null value in column "email"` → reset (revoke OK) → second sheet, still the returning one |
| 21:01:10 | S | the second sheet | 500 → the sentence |
| 21:10:36 / 21:10:51 | P | the same pair | 500 → reset → returning sheet → 500 → the sentence. Settings still listed the app afterwards: **a returning sheet after a revoke authorizes the app again, with no email** |
| 21:16:56 / 21:17:16 | P | the same pair | the same |
| 21:21:03 | P | 500 → reset → **the second sheet cancelled**; Settings: the app is gone | — |
| 21:24:37 | P | after about 3½ min: **the Share / Hide sheet**; Share | 200; GoTrue auto-linked to the local Google account with the same address (`providers` `["google","apple"]`) |

**The cause, corrected.** A device keeps showing its returning-user sheet for a short time after the app's
authorization is revoked. That sheet's token has no `email`, because the consent that shared it is gone, and the sheet
authorizes the app again without it. With no account for the `sub`, GoTrue 2.196 inserts an `auth.users` row with no
email (it ignores `email_optional` on this path), and `handle_new_user()` fails on `public.users.email not null`: a
500.

**A deletion without a revoke does not cause it.** At 20:49 the authorization was standing, the account was gone, and
the token carried the email. That was only seen for a Hide My Email authorization. Step 2's iPhone 13 lock-out
followed the simulator's `Stop Using`, which is a revoke, so it fits the corrected cause.

**The recovery as built**, the user's choice ("Revoke, then ask to wait"):

- On a 500 for an email-less token, `signInWithApple()` sends that sheet's code to `reset-apple-sign-in`, which
  revokes the authorization the sheet just made. It opens no second sheet, and returns:
  - on success: `Sign in with Apple needs a few minutes to reset. Try again in 5 minutes.` (the user's copy);
  - on any `functions.invoke` error, or when there is no `authorizationCode`: `Apple sign-in couldn't finish. Try
    again in a minute.` (the agent's copy: the next tap runs the reset again).
- The name is saved only on a successful sign-in.
- The description's 5xx/email/status-0/4xx rules for when to reset are unchanged.

**How quickly a phone catches up** (P, after the redesign; deletion revoke → next Apple sign-in):

| deletion | next sign-in | result |
|---|---|---|
| 21:32:05 | 21:32:26 (21 s) | 200, `user_signedup`, the name sent again: a first-time consent |
| 21:32:51 | 21:33:10 (19 s) | the same |
| 21:33:26 | 21:33:39 (13 s) | the same |

- **Sheets opened 6–10 s after the reset's revoke were still returning ones.** So a real phone catches up within
  roughly 10–15 s. Timing alone explains the data; two factors went untested: whether the revoked authorization had
  consent, and whether the code came from a sign-in sheet or from `reauthorizeWithApple`.
- **On a real iPhone, deleting and then signing up again works** unless the second sign-in comes within seconds.
- **The simulator never caught up** (3½ min after the 20:57 revoke, still returning), as with `Stop Using` in step 2.

**The new message, verified on S:**

| time | what | result |
|---|---|---|
| 21:39:48 | Apple sign-in | 200, logged in to P's account: a standing consent, and the token carried the email |
| 21:40:36 | delete | 204 |
| 21:41:00 | Apple sign-in | 500 → reset (no Apple error) → the user saw the new sentence, verbatim |

## Verification

**Commands:**
- `npm test`: 32 suites, **865 passed** (836 at step 2, +29 new).
- `npm run typecheck`: clean.
- `npm run kb:audit`: 2 errors, 17 warnings (below).

**Jest:**
- **profileApi (7):**
  - the function name and body;
  - a 424 sentence is `permanent`, verbatim;
  - a 403 42501 sets `sessionRevoked`;
  - a 5xx is `retryable`;
  - a non-JSON body keeps `error.message`;
  - a fetch or relay error is `retryable`.
- **appleSignIn (10):**
  - `reauthorizeWithApple`: the code with `requestedScopes: []`, a cancel, a sheet error, no code;
  - the recovery: reset with the sheet's code, then the wait sentence, with no second sheet and no name saved;
  - a failed reset, and no code: the couldn't-finish sentence;
  - no reset for a token with an email, for status 0, or for a 4xx.
- The fixtures are real three-segment JWTs, whose base64url payload contains `-` and `_`.
- **SessionContext (7):**
  - Apple-linked on iOS: sheet → function, never the RPC;
  - a cancel returns `{"cancelled":true}`, clears nothing and stays signed in;
  - a sheet error comes back `permanent`;
  - a function failure clears nothing;
  - on web or Android: the RPC with no sheet;
  - not Apple-linked on iOS: the RPC.
- The probe now shows the resolved deletion result.
- **AccountScreen (5):** a cancel keeps the confirm open, enabled, with no `alert`; each of the four table sentences
  shows verbatim.
- **Deno tests:** none. `deno` is not on PATH, so the shared module was verified by request (below).

**Requests (curl, local):**
- `delete-account` with no token: 401 `UNAUTHORIZED_NO_AUTH_HEADER`.
- `delete-account` with the anon key: 403 `bad_jwt` ("missing sub claim").
- `reset-apple-sign-in` with no token and a made-up code reaches the function:
  - 500 `apple_not_configured` before the key;
  - 400 `apple_code_rejected` after it.
- A non-Apple account gets 400 `apple_not_linked`, and the account stays intact.
- A globally signed-out session's token gets 403 `42501` (above).
- **Apple answers a made-up code with `invalid_grant` even when signed with an unknown throwaway key.** So this check
  cannot prove the key: only the device runs did.

**The secrets reach both functions.** CLI 2.116.0 resolves `[edge_runtime.secrets]` at `supabase start` from `.env`
(or the shell, which wins) and puts them in the **edge-runtime container's environment**, not in
`SUPABASE_INTERNAL_FUNCTIONS_CONFIG`'s per-function `env`. The router hands `Deno.env` to every worker. Checked by name
and length inside the container: 10 and 344, matching `.env`. Unset, they are absent, and both functions answer
`apple_not_configured`.

**`verify_jwt` is honoured locally:** `SUPABASE_INTERNAL_FUNCTIONS_CONFIG` has `delete-account` `verifyJWT: true` and
`reset-apple-sign-in` `false`, and the requests above match.

**Device checks** (beyond the tables above):
- **Every Apple-linked deletion ended correctly:** the deleted notice, then `psql` showed the user, its profile and its
  lists gone, with no list left without members. Four on P, two on S.
- **An account without Apple, on S through Maestro:** `step3-plain@example.com` was named through `set_name` and given
  a list through the REST insert. The flow ran sign-in → Account → Delete → Confirm, and "Your account was deleted."
  appeared with no Apple sheet. The user and the list are gone, and no function request was made.
- **Not tested:** `apple_account_mismatch` (403) on a device, which needs a second Apple Account. It is covered by the
  `sub` comparison only.
- **No screenshots:** no screen's look changed.

## Problems hit

- **A new function needs a full stack restart.** The router builds its function list from
  `SUPABASE_INTERNAL_FUNCTIONS_CONFIG` at `supabase start`; an unknown name gets 404.
- **A code edit needs `docker restart supabase_edge_runtime_shopping-list`.** Under `supabase start` the worker is
  reused, so an edit to a function was not picked up until then.
- **A `supabase start` straight after `stop` once came back with no containers.** A second `start` worked.
- **Maestro's iOS driver timed out on its first start.** The second attempt worked, as the KB says.
- **Xcode 27's simulator UI lives at `/Applications/Xcode.app/Contents/Applications/DeviceHub.app`.** `open -a
  Simulator` finds nothing.
- **`killall DeviceHub` came before the Maestro typing run** (KB).
- **Metro.** The user's `expo run:ios` Metro (pid 74854, no overrides) was stopped. Metro was restarted with
  `EXPO_PUBLIC_SUPABASE_TARGET=local EXPO_PUBLIC_SUPABASE_URL_LOCAL=http://192.168.99.195:54321` so that the iPhone 13
  used the local stack: shell variables, `.env` untouched. The local auth log confirms the phone's requests (user agent
  `ShoppingLoop/1 CFNetwork/… Darwin/27.0.0`).
- **GoTrue's 500 message names the second error,** "failed to close prepared statement: … transaction is aborted".
  The first is in the Postgres log: `null value in column "email"`.
- **`identity_data` now holds `email`, `email_verified`, `custom_claims.{auth_time,is_private_email}`,
  `provider_id` and `sub`.** Step 2's log said it keeps no `email`/`is_private_email`. That differs, and the cause was
  not investigated.

## For step 4 (its description predates these findings)

- **The recovery has no second credential any more.** Step 4's "the recovery stores the second credential's code" no
  longer applies: a recovery ends the tap with the wait sentence.
- **Its proof (verification 5) expects the consent sheet at once on the simulator after a web deletion.** With step 4
  revoking on every deletion, the simulator will hit the reset and the wait sentence instead. Use the iPhone 13 with
  ≥15 s between the deletion and the sign-in, or treat the simulator's sentence as the expected result.
- **CORS.** Step 4 calls `delete-account` from the web. The functions answer no `OPTIONS` preflight and send no CORS
  headers, so a browser call will fail until they do. Step 3 never calls them from the web.
- **The case for step 4 changes.** By the corrected cause, a deletion on web or Android without a revoke does not lock
  out (seen for Hide My Email). Step 4 still serves Apple's rule and the Settings listing, but the lock-out is not
  its reason.

## KB audit

- **Errors:**
  - `account-deletion-forces-signed-out-and-clears-twice`. Its `verify:` greps `if (result.error) return result;` in
    `deleteAccount`, which is now `if ('cancelled' in result || result.error) return result;`. The order it guards
    is unchanged. The step leaves it stale for step 5; the code was not bent to the check.
  - `ios-device-build-skips-provisioning-flags`: pre-existing, named in step 2's log.
- **Warnings (ground moved):**
  - from this step: `account-deletion-forces-signed-out-and-clears-twice`, `queries-go-through-a11y-labels`,
    `restored-session-state-waits-for-evidence`, `signed-in-event-fires-on-restore-too`,
    `supabase-client-module-boundary`, `supabase-local-stack`, `theme-provider-suites-fake-the-clock`,
    `tsconfig-explicit-types-array`;
  - from steps 1–2 and task 27: the rest.

## KB candidates

| entry | change |
|---|---|
| scope-boundaries | Deleting an Apple-linked account on iOS revokes Apple's token first (`delete-account`). On web and Android it is not revoked (decided in writing), which by the corrected cause locks nothing out. The project's first Edge Functions. Still nothing on cloud. Step 4's row replaces the revoke part of this one |
| delete-account-removes-sole-owned-lists | The function calls `delete_account()` with the caller's token after the revoke, and passes PostgREST's status and `{ code, message }` back unchanged. A session already gone fails at `getUser`, and is mapped to the RPC's 403 42501 words |
| account-deletion-forces-signed-out-and-clears-twice | `deleteAccount` returns `ApiResult \| DeletionCancelled`, and a cancel returns before the clearing. Fix the `verify:` grep |
| supabase-client-module-boundary | The functions import supabase-js (`npm:`) outside `src/`; the boundary covers the app only. `profileApi` tells `FunctionsHttpError` apart by `error.name`, because of the boundary |
| a new entry: how revocation works | `reauthorizeWithApple()` (`requestedScopes: []`) → code → exchange → `sub` check (`identity_data.sub` = `provider_id`) → revoke → RPC. Revoke before delete. 424 for an unreachable Apple. The `.p8` in `.env` as one-line base64, passed by `[edge_runtime.secrets]` as container env. "No longer listed under Sign in with Apple" is the check, and the listing shows the App ID's description, renamed to ShoppingLoop. A made-up code gets `invalid_grant` even with a bad key, so only a real sheet proves the key |
| the same new entry, or the Apple sign-in entry | **The corrected lock-out:** for a short time after a revoke (≈10–15 s on an iPhone 13; never caught up on the simulator), the device shows the returning sheet; its token has no `email`, and it re-authorizes the app without consent. With no account for the `sub`, GoTrue inserts a no-email user (ignores `email_optional` in the id-token path), so `handle_new_user` fails with 500. A standing authorization's returning token does carry `email` (seen for Hide My Email). **The recovery:** on a 500 for an email-less token, `reset-apple-sign-in` (`verify_jwt = false`) revokes, and the app asks the user to wait 5 minutes; reopening the sheet at once was tried and failed. Device checks of the consent sheet need the iPhone, not the simulator |
| supabase-local-stack, or native-build-toolchain | Edge Functions locally: a new function needs `supabase stop && start`; a code edit needs `docker restart supabase_edge_runtime_shopping-list`; `npm:` imports work with no `package.json`; `tsconfig.json` excludes `supabase/functions`; `deno` is not installed. Xcode 27's simulator UI is `Xcode.app/Contents/Applications/DeviceHub.app` |
| tsconfig-explicit-types-array | `tsconfig.json` now has an `exclude` that restates the base's list plus `supabase/functions` (`exclude` replaces, not extends) |
