# Step 3 — Revoke Apple's token when an Apple-linked account is deleted

The user's requests and the decisions they settled are in
[description-step-1.md](description-step-1.md).

**Step 2 must land first.**

**Why.** Apple requires apps that offer Sign in with Apple to revoke the user's tokens through its
REST API when the account is deleted. Until the token is revoked, ShoppingLoop stays listed under
the user's Apple Account → Sign in with Apple, and their next sign-in skips the consent sheet.

Task 25 built deletion as the RPC `delete_account()`, which cannot call Apple. Task 25 step 1 settled
how to close the gap: a function revokes the token, then calls the same RPC with the user's token.

## Apple Developer (human)

- Create the key: Certificates, IDs & Profiles → Keys → "+" → enable Sign in with Apple →
  Configure → primary App ID `com.shoppingloop.app`.
- Download the `.p8` file, which is shown once, and note its Key ID.
- **The `.p8` goes only into `.env`.** Never paste it into chat or a commit; `RESEND_API_KEY` is
  handled the same way. The Key ID is not secret, so hand it back.
- The team ID is `YZ75T58P4Z`.

## Secrets

- **`.env`** gets two variables:
  - `APPLE_SIGN_IN_KEY_ID`.
  - `APPLE_SIGN_IN_PRIVATE_KEY`, the `.p8`'s contents. Use base64 if a multi-line value doesn't
    survive the env loading, and check which works.
- **[config.toml](../../../supabase/config.toml)'s `[edge_runtime.secrets]`** (commented out today)
  maps them with `env()`.
  - Confirm that CLI 2.116.0 passes them to the locally served function.
  - `supabase/functions/.env` is the alternative.
- **Document both in `.env.example`** as the other secrets are: what each is and where it comes
  from, with no `KEY=` line.
- The team ID and the bundle id are not secret, so they are constants in the function.

## The function

`supabase/functions/delete-account/index.ts` is the project's first function. It runs on Deno, served
by the local stack's edge runtime (`[edge_runtime] enabled = true`).

- **`verify_jwt` stays on**, the default, so only a signed-in caller reaches the function.
- **Request:** `POST` with the body `{ "authorizationCode": string }`. The caller's access token
  rides in `Authorization`, which `supabase.functions.invoke` adds.
- **The steps, in order.** Nothing is deleted unless Apple's revoke succeeded.
  1. **The caller.** Call `auth.getUser()` on a client built with the anon key and the caller's
     `Authorization` header.
  2. **Their Apple identity:** the entry in `identities` with `provider === 'apple'`. If there is
     none, answer 400.
  3. **A client secret.** Mint an ES256 JWT for each request and never store it:
     - header `kid`: the Key ID;
     - `iss`: the team ID;
     - `sub`: the bundle id;
     - `aud`: `https://appleid.apple.com`;
     - `iat`: now, and `exp` a few minutes later.

     `jose`, from npm or JSR, can sign it.
  4. **Exchange the code.** `POST https://appleid.apple.com/auth/token` with
     `grant_type=authorization_code`, the code, `client_id` set to the bundle id, and the secret.
     The code lives five minutes and works once.
  5. **Check the Apple ID.** The `sub` of the returned `id_token` must equal the identity's Apple
     `sub`. Check whether `provider_id` or `identity_data.sub` carries it. If they differ, answer 403:
     the phone signed in to a different Apple ID, and that ID's token must not be revoked for this
     account.
  6. **Revoke.** `POST https://appleid.apple.com/auth/revoke` with the `refresh_token` and
     `token_type_hint=refresh_token`.
  7. **Delete.** Call `rpc('delete_account')` on step 1's client, which carries the caller's own
     token, so that `auth.uid()` and `session_still_valid()` behave exactly as they do for the app.
     - Pass the RPC's HTTP status and PostgREST's `{ code, message }` back unchanged.
     - Answer a success with 204.
- **Revoke first, then delete.**
  - If the RPC fails after the revoke, the account is intact. Only the Apple authorization is gone,
    and the next Sign in with Apple asks for consent again and lands in the same account, because
    the `sub` does not change. That is harmless.
  - The reverse order could delete the account and leave the token.
- **The function's own failures** answer with a 4xx status and `{ code, message }`, where `message`
  is the sentence the banner shows:
  - `resultFor` classifies a 4xx as `permanent`, so AccountScreen shows these words verbatim.
  - A 5xx would read as `retryable` and show the offline sentence, which would be wrong here. That
    is why an unreachable Apple answers 424, not 502.

  | case | status | code | message |
  |---|---|---|---|
  | no Apple identity | 400 | `apple_not_linked` | `This account doesn't sign in with Apple.` |
  | Apple refused the code | 400 | `apple_code_rejected` | `Apple didn't confirm it's you. Try again.` |
  | a different Apple ID | 403 | `apple_account_mismatch` | `That Apple ID isn't the one this account signs in with.` |
  | Apple unreachable, or a 5xx from Apple | 424 | `apple_unavailable` | `Apple couldn't be reached. Try again in a minute.` |
- **Never log** the code, the tokens or the key.

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

Add `reauthorizeWithApple(): Promise<{ code: string } | { cancelled: true } | { error: string }>`.

- It calls `signInAsync({ requestedScopes: [] })` and returns the `authorizationCode`.
- It makes no Supabase call.
- A cancel is detected as in step 2.

## SessionContext

`deleteAccount()` in [SessionContext.tsx](../../../src/state/SessionContext.tsx) branches:

- **Apple-linked and on iOS:** call `reauthorizeWithApple()` first, then
  `deleteAccountWithApple(code)` instead of the RPC.
  - An account is Apple-linked when `session.user.app_metadata.providers` includes `'apple'`.
    Confirm that against a real session; `identities` is the alternative.
  - Everything after a success is unchanged: `forgetAccount`, the local sign-out, and `deleted`.
- **A cancelled sheet:** nothing is deleted and nothing is cleared. The result must tell
  AccountScreen it was a cancel, in a shape it can tell apart from both success and failure. Pick
  the shape; `Result.outcome` is the precedent.
- **Apple-linked on web or Android** *(decided in writing)*: there is no Apple sheet there, so the
  account is deleted through the RPC with the token left unrevoked. Apple's rule binds the iOS app,
  and the user can still remove ShoppingLoop in their Apple Account settings.
- **Not Apple-linked:** unchanged.

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
- **appleSignIn:** `reauthorizeWithApple` returns the code, reports a cancel, and returns an error
  when there is no code.
- **SessionContext:**
  - Apple-linked on iOS shows the sheet, then calls the function and never the RPC.
  - A cancel clears nothing and stays signed in.
  - A failure from the function clears nothing.
  - Not Apple-linked calls the RPC, with no sheet.
  - Apple-linked on web or Android calls the RPC, with no sheet.
- **AccountScreen:**
  - A cancel keeps the confirm open, with the buttons enabled and no banner.
  - Each of the function's messages shows verbatim.
- **The function itself:** if `deno` is on PATH, `deno test` its pure parts (the client secret's
  claims and the `sub` comparison). Otherwise verify it by request (below), and say so in the log.

## Verification

1. **Local stack only**, with step 2's preconditions.
   - Restart the stack if the secrets or the config changed.
   - Check that the function is served: a `curl` with no token gets 401.
2. **Request level.** Use `curl` with a throwaway account's token:
   - an account that is not Apple-linked gets 400 `apple_not_linked`, and the account is intact;
   - a made-up code gets 400 `apple_code_rejected`, and the account is intact.
3. **Simulator**, or step 2's fallback, with a throwaway Apple-linked account that solely owns a
   list:
   - **Delete it.** Apple's sheet opens, then Sign in shows the deleted notice, and `psql` shows the
     list is gone.
   - **The proof of the revoke:** ShoppingLoop is no longer listed in the simulator's Settings →
     Apple Account → Sign in with Apple. Record what was seen.
   - **Cancel the Apple sheet:** nothing is deleted, and the confirm stays open.
   - **An account without Apple** still deletes, with no Apple sheet.
4. **No screenshots:** no screen's look changed.
5. **Commands:** `npm test`, `npm run typecheck`, `npm run kb:audit`.

## KB impact (for the librarian)

| entry | change |
|---|---|
| scope-boundaries | deleting an Apple-linked account on iOS revokes Apple's token first. On web and Android it is not revoked (decided in writing). The project's first Edge Function. Still nothing on cloud |
| delete-account-removes-sole-owned-lists | the function calls `delete_account()` with the caller's token after the revoke, and passes its result back unchanged |
| supabase-client-module-boundary | the function imports supabase-js outside `src/`. The boundary covers the app only |
| a new entry | how revocation works: the second sheet, the code exchange, the `sub` check, revoke before delete, the 424 for an unreachable Apple; where the `.p8` lives locally; "no longer listed under Sign in with Apple" as the check |
