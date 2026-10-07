# Step 4 — implementation log (2026-10-07)

Every Apple sign-in now stores Apple's refresh token on the server, and `delete-account` revokes it before deleting, on
every platform, with no Apple sheet. Local stack only: nothing on cloud (no `db push`, no deploy, no `secrets set`, no
`config push`). Nothing committed. No `/librarian deposit` (step 1's request 5).

**Where this log and the description differ, this log wins.** The description predates step 3's findings; the
deviations are listed below.

## Deviations from the description

- **The recovery stores nothing.** Step 3's recovery opens no second sheet, so "store the second credential's code" has
  no credential to act on. `signInWithApple()` stores only after a successful `signInWithIdToken`.
- **Device proofs ran on the iPhone 13 ("P") over the LAN, not the simulator,** which never catches up after a revoke
  (step 3). Each consent-sheet check came ≥30 s after its revoke.
- **CORS added to `delete-account`** (not in the description; step 3's log asked for it). See "CORS" below: step 3's
  "a browser call will fail" was wrong for the local stack.
- **Verification 7's expectation was wrong.** A deletion with no stored token did not need step 3's recovery: the next
  sign-in went straight through (below), as step 3's corrected cause predicts.
- **The `invalid_grant` rule is kept, though Apple never sent it** for a revoked token (verification 8): it answers 200.
  Kept because a dead token drawing `invalid_grant` would otherwise block that account's deletion for good.

## What was built

| file | change |
|---|---|
| `supabase/migrations/20261007000000_apple_tokens.sql` (new) | `public.apple_tokens(apple_sub text pk, user_id uuid not null → auth.users on delete cascade, refresh_token text not null, updated_at timestamptz not null default now())`, an index on `user_id`, RLS on with no policy, `revoke all … from anon, authenticated`. Header comment: why keyed by `sub`, why service-only, why unencrypted (decided in writing), the cascade order |
| `supabase/functions/_shared/supabase.ts` (new) | `callerOf(request)` → `{ supabase, user }` or a refusal `Response` (step 3's caller's-token client and `refusedSession` mapping, moved out of `delete-account`); `serviceClient()` from `SUPABASE_SERVICE_ROLE_KEY`, for `apple_tokens` only |
| `supabase/functions/store-apple-token/index.ts` (new) | `verify_jwt` default (on). `readCode` → `callerOf` → the caller's Apple identities (none: 400 `apple_not_linked`) → `exchangeCode` → `sub` ∈ `identity_data?.sub ?? id` (else 403 `apple_account_mismatch`) → upsert on `apple_sub` with the service client → 204. A failed upsert is 500 `{ code, message }`, logging the code only |
| `supabase/functions/delete-account/index.ts` | No body. `callerOf` → Apple-linked check → read the caller's `apple_tokens` rows (service client; read error 500) → revoke each (an `AppleFailure` with `appleError === 'invalid_grant'` counts as revoked; `apple_not_configured` stays 500; any other failure is 424 `apple_unavailable` and nothing is deleted) → no rows goes straight on → `rpc('delete_account')` as the caller, logging `delete_account: <status>`. `OPTIONS` answers `corsHeaders`, and every response carries them |
| `supabase/functions/_shared/apple.ts` | `AppleFailure(code, appleError?)` carries Apple's `error` field; `post()` logs successes too (`apple <path>: <status>`); the header names the three functions; `revoke`'s docblock records Apple's answers and the 13 s catch-up |
| `supabase/config.toml`, `.env.example` | comments only: three functions, and `store-apple-token` keeps `verify_jwt = true` |
| `src/lib/appleSignIn.ts` | after a successful `signInWithIdToken`, `storeAppleToken(credential.authorizationCode)` runs `functions.invoke('store-apple-token', { body: { authorizationCode } }).catch(() => undefined)`, not awaited, before the name is saved; no code means no call. `reauthorizeWithApple()` removed |
| `src/lib/profileApi.ts` | `deleteAccountWithApple()` takes no argument: `invoke('delete-account')`. Error mapping unchanged |
| `src/state/SessionContext.tsx` | `deleteOnServer` = Apple-linked (`app_metadata.providers` includes `'apple'`) ? `deleteAccountWithApple()` : the RPC, never reading `Platform.OS`. `DeletionCancelled` removed; `deleteAccount` is `() => Promise<ApiResult>` again, with `if (result.error) return result;` |
| `src/screens/AccountScreen.tsx` | step 3's cancel branch removed: the file is byte-identical to before step 3 |

`reset-apple-sign-in` is unchanged.

### Decisions beyond the description

- **The service-role variable.** CLI 2.116.0's edge runtime injects `SUPABASE_SERVICE_ROLE_KEY`, a legacy JWT (`eyJ…`).
  Workers also get `SUPABASE_SECRET_KEYS` and `SUPABASE_PUBLISHABLE_KEYS` (JSON, `{ default: … }`), which the router
  builds from its internal keys. The functions use `SUPABASE_SERVICE_ROLE_KEY`. The cloud project's variable is not
  checked (nothing on cloud).
- **CORS on `delete-account` only.** It is the only function a browser calls; `store-apple-token` and
  `reset-apple-sign-in` run only after Apple's native sheet. The headers come from
  `npm:@supabase/supabase-js@2.112.4/cors` (`corsHeaders`: allow-origin `*`, the SDK's eight headers, six methods),
  which supabase-js keeps in step with the headers it sends.
- **The store runs before `saveSuggestedName`,** so it starts at once; the name save is still awaited as before.

## CORS

- **Locally, Kong answers the preflight itself.** The `functions-v1` service in the stack's `kong.yml` has the `cors`
  plugin. Before this step, `OPTIONS /functions/v1/delete-account` already got 200 with `Access-Control-Allow-Origin: *`,
  `Server: kong/2.8.1`. So a web call worked locally with or without the function's headers.
- **The local router lets `OPTIONS` through without a JWT:** `/root/index.ts` in the edge-runtime container checks the
  JWT only `if (t.method !== "OPTIONS" && verifyJWT)`.
- **The function's own answers, bypassing Kong** (Node `fetch` from inside `supabase_studio_shopping-list` to
  `http://supabase_edge_runtime_shopping-list:8081/delete-account`): `OPTIONS` 200 with the three `corsHeaders`, and a
  `POST` (400 `apple_not_linked`) carrying them too.
- **Through Kong, a `POST` with `Origin` returns exactly one `Access-Control-Allow-Origin`.** Kong replaces, rather
  than duplicates, the function's header.
- **Cloud is unverified.** The function's headers are what the hosted gateway needs; no deploy was made.

## Verification

### The table
- `\dp public.apple_tokens`: `postgres=arwdDxtm`, `service_role=arwdDxtm`, nothing else.
- `psql`: `set role authenticated; select … from public.apple_tokens` and the same for `anon`: `ERROR: permission
  denied for table apple_tokens`. `service_role` reads it.
- REST with a signed-in user's token: `GET /rest/v1/apple_tokens` → 403 `42501` "permission denied for table
  apple_tokens"; `POST` → 403 `42501` (INSERT).

### Requests (curl, local)
- `store-apple-token` with no token: 401 `UNAUTHORIZED_NO_AUTH_HEADER`.
- An account without Apple (`step4-plain@example.com`): `store-apple-token` → 400 `apple_not_linked`; with no body → 400
  `invalid_request`; `delete-account` → 400 `apple_not_linked`.
- The Apple-linked account, made-up code: 400 `apple_code_rejected` (Apple: `invalid_grant`), and its row unchanged
  (`updated_at` still that of the last sign-in).
- `SUPABASE_INTERNAL_FUNCTIONS_CONFIG` after `supabase stop && start`: `delete-account` and `store-apple-token`
  `verifyJWT: true`, `reset-apple-sign-in` `false`. The two secrets reached the container (10 and 344 chars).

### Devices: timeline (UTC, P, the local stack)

Rows were watched by polling `apple_tokens` every 2 s; the `sub` appears only as an md5 prefix, the token only as a
length (64).

| time | where | what | result |
|---|---|---|---|
| 10:46:08 | P | Apple sign-in (start: no local Apple identity) | **Share / Hide**; Hide My Email; a new relay-email account, `providers ["apple"]`. **Row stored 10:46:10**; `apple_sub` = the identity's `provider_id`, `user_id` = the user |
| 10:46:42 | P | sign out, Apple sign-in | the short (returning) sheet; same row, `updated_at` 10:46:43. Neither sign-in felt slower than step 3's |
| 10:48:52 | web (Playwright) | OTP sign-in with the relay address, the code from Mailpit | lands on Lists with P's list |
| 10:49:05 | web | Delete account | **`apple /auth/revoke: 200`, then `delete_account: 204`**; the user, profile, list and row gone, no list without members; "Your account was deleted." The browser's one console error is `/logout` 403 (the session went with the account; auth-js ignores it) |
| ~10:50 | P | Settings → Sign in with Apple | **ShoppingLoop gone** |
| 11:02:36 | P | the app still held the deleted account's session: it opened on Choose your name; Continue → `set_name` refused → Sign in | pre-existing behaviour (below) |
| 11:03:12 | P | Apple sign-in | **Share / Hide**, no 500: the web deletion's revoke reached the device. Row stored 11:03:14 |
| 11:03:28 | P | Delete account | **no Apple sheet**; revoke 200, `delete_account` 204; the account and row gone |
| (after ≥30 s) | P | Settings | ShoppingLoop gone |
| 11:04:31 | P | Apple sign-in, 62 s after the revoke | **Share / Hide**. Row stored 11:04:32 |
| 11:05:00 | Mac | scratch script on that row (verification 8) | below |
| 11:09:47 | P | Delete account (its token already revoked) | revoke **200**, `delete_account` 204 |
| 11:10:24 | P | Apple sign-in | Share / Hide; row stored 11:10:25 and deleted by a background job within the second |
| 11:11:03 | P | Delete account (no row) | **no revoke in the log**, `delete_account` 204 |
| right after | P | Settings | **ShoppingLoop still listed** |
| 11:11:52 | P | Apple sign-in, 48 s later | **the short sheet, 200**, a new relay-email account straight away: no 500, no recovery. Row stored 11:11:53 |

The `sub` was the same for every authorization (one Apple ID). The account from 11:11:52 (`7569053c…`) is left in place,
signed in on P with a stored token.

### Apple's answer to a token already revoked (verification 8)

Scratch script (scratchpad, not in the repo): loads `.env` in memory, mints the ES256 secret with `node:crypto`
(`dsaEncoding: 'ieee-p1363'`), reads the token through `docker exec … psql`, prints only statuses, Apple's `error` and
the revoke bodies.

| time | call | answer |
|---|---|---|
| 11:05:00 | `/auth/token`, `grant_type=refresh_token` | 200 |
| 11:05:01 | `/auth/revoke` | **200, empty body** |
| 11:05:01 | `/auth/token`, `grant_type=refresh_token` | **400 `invalid_grant`** |
| 11:05:01 | `/auth/revoke` again | **200, empty body** |

So Apple follows RFC 7009: a dead token is revoked "successfully". `delete-account` needs no special case for it, and
the device deletion at 11:09:47 proved it end to end. The `invalid_grant` branch is kept as a safeguard (above).

### An account without Apple
`step4-plain@example.com`, named through `set_name` and given a list through the REST insert, signed in on web by OTP
and deleted there at 11:13:04: "Your account was deleted.", the user and the list gone, **no `delete-account` request**
in the edge log.

### Commands
- `npm test`: 32 suites, **865 passed**. Same total as step 3: appleSignIn +4 (−4 `reauthorizeWithApple`, +8 storing),
  SessionContext −1 (7 → 6), AccountScreen −3 (5 → 2), profileApi ±0.
- `npm run typecheck`: clean.
- `npm run kb:audit`: 1 error, 17 warnings (below).

### Jest
- **appleSignIn, "storing Apple's token" (8):** the success invokes `('store-apple-token', { body: { authorizationCode:
  'a-code' } })` and nothing else; `{ error: null }` while the invoke never settles, when it answers an error, and when
  it rejects; no code invokes nothing; a cancel, a missing token or a refused token invokes nothing. **The reject test
  was mutation-checked:** without the `.catch`, it fails. Step 3's recovery tests pass unchanged: the recovery path never
  reaches the store.
- **profileApi:** `invoke.mock.calls` is `[['delete-account']]`; step 3's mapping tests unchanged.
- **SessionContext (6):** Apple-linked on iOS, Android and web: the function with no arguments, never the RPC, signed out
  `deleted`, caches cleared; a function failure clears nothing and passes its result back; not Apple-linked on iOS and
  web: the RPC.
- **AccountScreen (2):** the two sentences `delete-account` can still answer ("This account doesn't sign in with
  Apple.", "Apple couldn't be reached. Try again in a minute.") show verbatim; the function is called with no arguments.
- **Deno tests: none.** `deno` is not on PATH, so the functions were verified by request and on the device.

**No screenshots:** no screen's look changed.

## Problems hit

- **macOS `awk` has no `strftime`.** The first row watcher died; a plain shell loop replaced it.
- **The phone kept the deleted account's session.** After the web deletion, P reopened on Choose your name: its access
  token was still valid, the profile read found no row (reads are unguarded,
  [session-still-valid-guards-writes](../../kb/entries/session-still-valid-guards-writes.md)), and `set_name` then
  refused and sent it to Sign in (`/logout` 403 "User from sub claim in JWT does not exist" at 11:02:36). The same
  happens after any deletion on another device; not this step's doing, and not changed.
- **Playwright's snapshot files under `.playwright-mcp/` (gitignored) captured the relay address.** This step's three were
  deleted. Four from 2026-10-06 (`page-2026-10-06T13-1*.yml`) still hold one; they predate this step and were left.
- **Edge-runtime noise:** "wall clock duration warning … early termination" lines are idle workers being reaped, not
  failures.

## State left

- The local stack is running, with the key, the new migration applied and the three functions served.
- Metro (mine, with the LAN override) is stopped; a plain `npm start` sends a physical phone to cloud again.
- Local data left: the Apple-linked account `7569053c…` with its stored row (P is signed in to it), and step 3's
  `step3-revoked@example.com`.

## KB audit

- **Error:** `ios-device-build-skips-provisioning-flags`, pre-existing (step 2's log).
- **Fixed by this step:** `account-deletion-forces-signed-out-and-clears-twice`, which step 3 left failing, passes
  again: `deleteAccount` is back to `if (result.error) return result;`.
- **Warnings (ground moved):** 17, from this step (`SessionContext.tsx`, `profileApi.ts`, `AccountScreen.tsx` and its
  test, `config.toml`, `.env.example`) and from steps 1–3 and task 27.

## KB candidates

| entry | change |
|---|---|
| scope-boundaries | Replaces step 3's row. Every Apple sign-in stores Apple's refresh token server-side (`store-apple-token`, not awaited). Deleting an Apple-linked account revokes it first, on every platform, with no sheet (`delete-account`). An account with no stored token is deleted unrevoked, which locks nothing out: the next Apple sign-in gets the returning sheet with the email and makes a new account (measured). Still nothing on cloud |
| delete-account-removes-sole-owned-lists | `delete-account` (no body) revokes every stored token of the caller, then calls `delete_account()` with the caller's token; nothing is deleted unless every revoke succeeded. The `apple_tokens` rows cascade with `auth.users` |
| list-data-scoped-by-rls, or the revocation entry | `apple_tokens` is service-only: RLS with no policy plus `revoke all from anon, authenticated`, because the default privileges grant new `public` tables (RLS alone answers an empty set). Measured: 403 `42501` through REST for read and insert |
| the revocation entry (step 3's new one) | The stored token replaces step 3's second sheet (`reauthorizeWithApple` is gone). `store-apple-token` runs after every Apple sign-in and holds the `sub` check (`identity_data.sub` = `provider_id`). The token is stored unencrypted: only the `.p8` makes it usable. **Apple answers a revoke of a dead token with 200 and an empty body**; a `refresh_token` grant with it gets 400 `invalid_grant`. `delete-account` also takes `invalid_grant` on revoke as revoked, as a safeguard. The functions read `SUPABASE_SERVICE_ROLE_KEY` (CLI 2.116.0 injects it as a legacy JWT; workers also get `SUPABASE_SECRET_KEYS`/`SUPABASE_PUBLISHABLE_KEYS` JSON). A web deletion's revoke reaches the iPhone: Settings drops the app, and the next sign-in gets Share / Hide |
| supabase-local-stack, or the Edge Functions entry | **CORS:** local Kong's `cors` plugin on `/functions/v1/` answers preflights and sets the headers itself, so a browser call works locally even without them; the hosted gateway does not, so `delete-account` answers `OPTIONS` and adds `corsHeaders` from `npm:@supabase/supabase-js@<v>/cors`. The local router skips the JWT check for `OPTIONS`. Through Kong the allow-origin header is not duplicated. To test a function without Kong: Node `fetch` from inside `supabase_studio_shopping-list` to `http://supabase_edge_runtime_shopping-list:8081/<name>` |
| the Apple sign-in entry | A device whose account was deleted elsewhere keeps its session until the access token expires and opens on Choose your name; `set_name` then sends it to Sign in. Unchanged behaviour, seen on P |
