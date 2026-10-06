# Step 3 — Revoke Apple's token on deletion, and recover a sign-in Apple left behind

The user's requests and the decisions they settled are in
[description-step-1.md](description-step-1.md).

**Step 2 must land first.**

**Why.** Apple requires apps that offer Sign in with Apple to revoke the user's tokens through its
REST API when the account is deleted. Until the token is revoked, ShoppingLoop stays listed under
the user's Apple Account → Sign in with Apple, and their next sign-in skips the consent sheet.

Task 25 built deletion as the RPC `delete_account()`, which cannot call Apple. Task 25 step 1 settled
how to close the gap: a function revokes the token, then calls the same RPC with the user's token.

**The lock-out.** It was found 2026-10-06 on the iPhone 13; see [step 2's log](implementation-log-step-2.md),
"The iPhone 13 sign-ins".

- **How it happens:**
  - Apple puts `email` in the identity token on the first authorization only.
  - When an Apple-linked account is deleted and Apple's authorization is not revoked, Apple still treats the app as
    authorized. The next sign-in's token has no email.
  - GoTrue finds no identity for its `sub`, so it creates a user with no email. `handle_new_user()` then fails the
    insert on `public.users.email not null`.
  - GoTrue answers 500, and the banner shows its raw database error. `email_optional = false` does not stop this in
    the id-token path.
  - With no email, GoTrue cannot link to another account with the same address either. Every later Apple sign-in
    fails the same way.
- **Settings clears it on a real device, not on the simulator, and only for a user who knows to do it.**
  - On the simulator, `Stop Using` in Settings did not clear it (step 2).
  - On the iPhone 13 it did. On 2026-10-06, after the user removed the app in Settings, Apple asked Share/Hide again,
    and a cloud account was made with a relay address and the name.
- **What leads to it:**
  - a deletion on web or Android, which does not revoke (decided in writing, below);
  - any deletion made before this step;
  - a revoke that never reached Apple.
- **This step fixes it twice:**
  - the revoke on iOS deletion stops it from arising there;
  - a recovery at sign-in clears it, whatever caused it. That is the `reset-apple-sign-in` function and
    `signInWithApple()`'s retry, below.
- **Not in this step:** "Storing Apple refresh tokens so that any device can revoke". Step 4 does that, and with it
  web and Android deletions revoke too. Build this step as written: step 4 builds on its shared module, its functions
  and its recovery, and replaces only the deletion's second sheet. The recovery needs no stored token, because the
  sign-in itself hands over a fresh `authorizationCode`.

## Apple Developer (human)

- Create the key: Certificates, IDs & Profiles → Keys → "+" → enable Sign in with Apple →
  Configure → primary App ID `com.shoppingloop.app`.
- Download the `.p8` file, which is shown once, and note its Key ID.
- **The `.p8` goes only into `.env`.** Never paste it into chat or a commit; `RESEND_API_KEY` is
  handled the same way. The Key ID is not secret, so hand it back.
- The team ID is `YZ75T58P4Z`.
- **Rename the App ID:** Identifiers → `com.shoppingloop.app` → Description → `ShoppingLoop`.
  - Settings lists the app under that description, "XC com shoppingloop app" today, and the recovery's sentence
    tells the user to find "ShoppingLoop".
  - Record whether the listing follows the rename for an app that is already authorized.

## Secrets and config

- **`.env`** gets two variables:
  - `APPLE_SIGN_IN_KEY_ID`.
  - `APPLE_SIGN_IN_PRIVATE_KEY`, the `.p8`'s contents. Use base64 if a multi-line value doesn't
    survive the env loading, and check which works.
- **[config.toml](../../../supabase/config.toml)'s `[edge_runtime.secrets]`** (commented out today)
  maps them with `env()`.
  - Confirm that CLI 2.116.0 passes them to both locally served functions.
  - `supabase/functions/.env` is the alternative.
- **`[functions.reset-apple-sign-in]` sets `verify_jwt = false`.** Its caller has no session, because the sign-in
  just failed. Confirm that CLI 2.116.0 honours the setting locally. `delete-account` keeps the default.
- **Document both secrets in `.env.example`** as the other secrets are: what each is and where it comes
  from, with no `KEY=` line.
- The team ID and the bundle id are not secret, so they are constants in the shared module.

## The functions

These are the project's first functions. They run on Deno, served by the local stack's edge runtime
(`[edge_runtime] enabled = true`).

### `supabase/functions/_shared/apple.ts`

The Apple half that both functions share.

1. **A client secret.** Mint an ES256 JWT for each request and never store it:
   - header `kid`: the Key ID;
   - `iss`: the team ID;
   - `sub`: the bundle id;
   - `aud`: `https://appleid.apple.com`;
   - `iat`: now, and `exp` a few minutes later.

   `jose`, from npm or JSR, can sign it.
2. **Exchange the code.** `POST https://appleid.apple.com/auth/token` with
   `grant_type=authorization_code`, the code, `client_id` set to the bundle id, and the secret.
   - The code lives five minutes and works once.
   - Return the `sub` of the returned `id_token`, and the `refresh_token`.
3. **Revoke.** `POST https://appleid.apple.com/auth/revoke` with the `refresh_token` and
   `token_type_hint=refresh_token`.
4. **Failures** become the 4xx rows of the table below: Apple refusing the code is `apple_code_rejected`, and Apple
   unreachable or a 5xx from Apple is `apple_unavailable`.

- **Never log** the code, the tokens or the key, in either function.

### `supabase/functions/delete-account/index.ts`

- **`verify_jwt` stays on**, the default, so only a signed-in caller reaches the function.
- **Request:** `POST` with the body `{ "authorizationCode": string }`. The caller's access token
  rides in `Authorization`, which `supabase.functions.invoke` adds.
- **The steps, in order.** Nothing is deleted unless Apple's revoke succeeded.
  1. **The caller.** Call `auth.getUser()` on a client built with the anon key and the caller's
     `Authorization` header.
  2. **Their Apple identity:** the entry in `identities` with `provider === 'apple'`. If there is
     none, answer 400.
  3. **Exchange the code** (shared).
  4. **Check the Apple ID.** The exchange's `sub` must equal the identity's Apple `sub`. Check
     whether `provider_id` or `identity_data.sub` carries it. If they differ, answer 403: the phone
     signed in to a different Apple ID, and that ID's token must not be revoked for this account.
  5. **Revoke** (shared).
  6. **Delete.** Call `rpc('delete_account')` on step 1's client, which carries the caller's own
     token, so that `auth.uid()` and `session_still_valid()` behave exactly as they do for the app.
     - Pass the RPC's HTTP status and PostgREST's `{ code, message }` back unchanged.
     - Answer a success with 204.
- **Revoke first, then delete.**
  - If the RPC fails after the revoke, the account is intact. Only the Apple authorization is gone,
    and the next Sign in with Apple asks for consent again and lands in the same account, because
    the `sub` does not change. That is harmless.
  - The reverse order could delete the account and leave the token. That is the lock-out.

### `supabase/functions/reset-apple-sign-in/index.ts`

- **What it's for:** it clears the lock-out. It revokes the authorization Apple still holds for an account that is
  gone, so that Apple's next sheet asks for consent and puts the email back in the token.
- **Request:** `POST` with the body `{ "authorizationCode": string }`, with no session (`verify_jwt = false`).
- **The steps:**
  1. exchange the code (shared);
  2. revoke (shared);
  3. answer 204.

  It checks no account and deletes nothing.
- **Why it is safe without a session:**
  - Only Apple's sheet on the user's own device issues a code. The code is bound to the bundle id, lives five
    minutes, and works once.
  - A revoke only makes Apple ask for consent again. If an account still has that `sub`, the next sign-in lands in
    it.
- **The function's own failures** answer with a 4xx status and `{ code, message }`, where `message`
  is the sentence the banner shows:
  - `resultFor` classifies a 4xx as `permanent`, so AccountScreen shows these words verbatim.
  - A 5xx would read as `retryable` and show the offline sentence, which would be wrong here. That
    is why an unreachable Apple answers 424, not 502.

  The sign-in recovery shows its own sentence instead (below).

  | case | function | status | code | message |
  |---|---|---|---|---|
  | no Apple identity | delete | 400 | `apple_not_linked` | `This account doesn't sign in with Apple.` |
  | Apple refused the code | both | 400 | `apple_code_rejected` | `Apple didn't confirm it's you. Try again.` |
  | a different Apple ID | delete | 403 | `apple_account_mismatch` | `That Apple ID isn't the one this account signs in with.` |
  | Apple unreachable, or a 5xx from Apple | both | 424 | `apple_unavailable` | `Apple couldn't be reached. Try again in a minute.` |

## API

[profileApi.ts](../../../src/lib/profileApi.ts): add
`deleteAccountWithApple(authorizationCode): Promise<Result>` beside `deleteAccount`.

- It calls `supabase.functions.invoke('delete-account', { body: { authorizationCode } })`.
- **How each outcome maps:**
  - **`FunctionsHttpError`:** read the body and status from `error.context` (a `Response`), then
    return `resultFor({ code, message }, status)`.
  - **`FunctionsFetchError` or `FunctionsRelayError`:** status 0, so the verdict is `retryable` and
    the screen shows the offline sentence.
  - **Success:** `resultFor(null, 204)`.

  Check the class names and `context` against supabase-js 2.112.4.
- **`sessionRevoked` keeps working:** the RPC's 42501 for a revoked session comes back unchanged.

## appleSignIn.ts

### `reauthorizeWithApple()`

Add `reauthorizeWithApple(): Promise<{ code: string } | { cancelled: true } | { error: string }>`.

- It calls `signInAsync({ requestedScopes: [] })` and returns the `authorizationCode`.
- It makes no Supabase call.
- A cancel is detected as in step 2.

### The recovery in `signInWithApple()`

- **When:** `signInWithIdToken` fails, the error's `status` is 500, and the identity token's payload has no `email`
  claim.
  - auth-js 2.112.4 turns GoTrue's 500 into an `AuthRetryableFetchError` with `status` 500. A network failure has
    `status` 0 and is not this case: it shows Supabase's message, as today.
  - The payload is the token's middle segment, in base64url. Decoding it needs no verification: it is only a hint,
    and GoTrue has already checked the token.
  - A token that carries an email failed for another reason, so its message shows, as today.
- **Then:**
  1. Call `supabase.functions.invoke('reset-apple-sign-in', { body: { authorizationCode } })` with the first
     credential's code.
  2. On success, open the sheet again, with a fresh nonce pair. Then continue as a normal sign-in: the token goes to
     Supabase, and the name is saved.
  3. Reset at most once per tap. A second failure is never reset again.
- **The outcomes:**
  - A cancelled second sheet gives `{ error: null }`. The reset stands, so the next tap gets the consent sheet.
  - A failed reset (any `functions.invoke` error), or a second sign-in that fails the same way, gives the sentence
    `Apple sign-in couldn't finish. Try again in a minute. If it still fails, remove ShoppingLoop in Settings → Apple
    Account → Sign in with Apple.`
  - Any other failure of the second sign-in gives its message, as today.
- **What the user sees:** two Apple sheets. First the returning one, then the consent sheet with `Share My Email` /
  `Hide My Email`.
  - Share links to an existing account with the same verified address, through GoTrue's automatic link.
  - Hide makes a new account.
  - The consent sheet sends the name again, so step 2's `saveSuggestedName` prefills the name gate.
- **Module boundary:** it calls the function through `supabase` from `./supabase`, as it already calls
  `supabase.auth`. It never imports supabase-js.

## SessionContext

`deleteAccount()` in [SessionContext.tsx](../../../src/state/SessionContext.tsx) branches:

- **Apple-linked and on iOS:** call `reauthorizeWithApple()` first, then
  `deleteAccountWithApple(code)` instead of the RPC.
  - An account is Apple-linked when `session.user.app_metadata.providers` includes `'apple'`.
    Step 2 confirmed this against a real session: it includes `'apple'`, and still does after an email-code sign-in.
  - Everything after a success is unchanged: `forgetAccount`, the local sign-out, and `deleted`.
- **A cancelled sheet:** nothing is deleted and nothing is cleared. The result must tell
  AccountScreen it was a cancel, in a shape it can tell apart from both success and failure. Pick
  the shape; `Result.outcome` is the precedent.
- **Apple-linked on web or Android** *(decided in writing)*: there is no Apple sheet there, so the
  account is deleted through the RPC with the token left unrevoked. Apple's rule binds the iOS app,
  and the next Sign in with Apple on iOS clears the lock-out this leaves, through the recovery above.
  Step 4 closes this exception.
- **Not Apple-linked:** unchanged.
- **`signInWithApple`** is unchanged: the recovery lives entirely in `appleSignIn.ts`.

## AccountScreen

- **On a cancel:** re-enable the buttons and keep the confirm open, with no banner.
- **The function's sentences** show in the `ErrorBanner` verbatim. That is already the path for a
  `permanent` failure.
- **No change to the look.** The warning copy stays, and there is no new image.

## Tests (jest)

Await `render` and `fireEvent` (RNTL 14).

- **profileApi:**
  - The function name and body are right.
  - An HTTP error's body and status go through `resultFor`.
  - A fetch error is `retryable`.
  - A revoked session's 42501 sets `sessionRevoked`.
- **appleSignIn:**
  - **`reauthorizeWithApple`:** it returns the code, reports a cancel, and returns an error when there is no code.
  - **The recovery:**
    - A 500 with an email-less token calls `reset-apple-sign-in` with the first credential's code, opens the sheet
      a second time with a new nonce pair, and signs in with the second token.
    - The name from the second credential is saved.
    - No reset on a 500 when the token carries `email`, on a `status` 0 failure, or on a 4xx: each shows its
      message.
    - A failed reset shows the sentence, and opens no second sheet.
    - A cancelled second sheet gives `{ error: null }`.
    - A second 500 shows the sentence, and resets no second time.
  - The token fixtures are real three-segment JWT strings, with base64url payloads with and without `email`.
- **SessionContext:**
  - Apple-linked on iOS shows the sheet, then calls the function and never the RPC.
  - A cancel clears nothing and stays signed in.
  - A failure from the function clears nothing.
  - Not Apple-linked calls the RPC, with no sheet.
  - Apple-linked on web or Android calls the RPC, with no sheet.
- **AccountScreen:**
  - A cancel keeps the confirm open, with the buttons enabled and no banner.
  - Each of the function's messages shows verbatim.
- **The functions themselves:** if `deno` is on PATH, `deno test` the shared module's pure parts (the client
  secret's claims, and reading `sub` from the exchange) and the `sub` comparison. Otherwise verify them by request
  (below), and say so in the log.

## Verification

1. **Local stack only**, with step 2's preconditions.
   - Restart the stack if the secrets or the config changed.
   - Check that both functions are served:
     - `delete-account` with no token gets 401;
     - `reset-apple-sign-in` with no token reaches the function: a made-up code gets 400 `apple_code_rejected`,
       not 401.
2. **Request level.** Use `curl` with a throwaway account's token:
   - an account that is not Apple-linked gets 400 `apple_not_linked`, and the account is intact;
   - a made-up code gets 400 `apple_code_rejected`, and the account is intact.
3. **The lock-out, reproduced and recovered.** This comes first, before any deletion with a revoke.
   - **The user's Apple Account is in this state on the local stack already.** Its account was deleted at
     16:51 UTC with no revoke (step 2's log), and the simulator shares that Apple Account. Ask the user whether
     they have removed ShoppingLoop in Settings since. If they have, recreate the state:
     1. Sign in with Apple on the simulator.
     2. In Playwright on `npm run web`, sign in with the email code to the same address, read from Mailpit.
     3. Delete the account there. That is the RPC, so there is no revoke: the web exception.
   - **Then Sign in with Apple on the simulator.** Expect:
     - two sheets, the second offering `Share My Email` / `Hide My Email`;
     - Share signs in;
     - `psql` shows the user with an email and an `apple` identity;
     - the local auth log shows the 500, then the reset's 204, then a 200.
   - **If the simulator's second sheet still behaves as a returning user**, as after `Stop Using` in step 2:
     - repeat on the iPhone 13 over the LAN, with step 2's Metro override;
     - record which device recovered;
     - and if neither did, record what Apple sent the second time. The sentence must show, not the database error.
4. **Simulator**, or step 2's fallback, with a throwaway Apple-linked account that solely owns a
   list:
   - **Delete it.** Apple's sheet opens, then Sign in shows the deleted notice, and `psql` shows the
     list is gone.
   - **The proof of the revoke:** the app is no longer listed in the simulator's Settings → Apple Account → Sign in
     with Apple, as "ShoppingLoop" after the rename or "XC com shoppingloop app" without it. Record what was seen.
   - **Sign in with Apple again.** Record whether the consent sheet came at once, or the recovery ran first. Either
     way, it must not fail.
   - **Cancel the Apple sheet:** nothing is deleted, and the confirm stays open.
   - **An account without Apple** still deletes, with no Apple sheet.
5. **No screenshots:** no screen's look changed.
6. **Commands:** `npm test`, `npm run typecheck`, `npm run kb:audit`.

## After this step

- **Do not run `/librarian deposit`**, whatever CLAUDE.md's working rules say (step 1's request 5).
  Step 5 deposits the whole task once.
- Write `implementation-log-step-3.md` as usual. End it with a **KB candidates** section: the table
  below, corrected to what was actually built, plus anything the step taught that the table misses.
  That section is how this step reaches step 5.
- Never edit `ai/kb/`. If `npm run kb:audit` fails on an entry this step made stale, that is
  expected until step 5: name it in the log. Never change code to make a check pass.

## KB impact (for step 5's deposit)

| entry | change |
|---|---|
| scope-boundaries | deleting an Apple-linked account on iOS revokes Apple's token first. On web and Android it is not revoked (decided in writing), and the next Apple sign-in on iOS recovers by revoking and asking for consent again. The project's first Edge Functions. Still nothing on cloud. Step 4's row replaces the revoke part of this one |
| delete-account-removes-sole-owned-lists | the function calls `delete_account()` with the caller's token after the revoke, and passes its result back unchanged |
| supabase-client-module-boundary | the functions import supabase-js outside `src/`. The boundary covers the app only |
| a new entry | how revocation works: the second sheet, the code exchange, the `sub` check, revoke before delete, the 424 for an unreachable Apple; where the `.p8` lives locally; "no longer listed under Sign in with Apple" as the check |
| the same new entry, or the Apple sign-in entry | the lock-out: Apple's token carries `email` on the first authorization only, so an unrevoked authorization whose account is gone fails GoTrue's user insert (500, `handle_new_user`, `email not null`), and `email_optional = false` does not stop it in the id-token path. The recovery: a 500 with an email-less token calls `reset-apple-sign-in` (`verify_jwt = false`, code exchange + revoke), then reopens the sheet once. `Stop Using` in Settings clears it on the iPhone 13, not on the simulator |
