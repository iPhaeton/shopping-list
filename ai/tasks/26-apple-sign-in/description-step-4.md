# Step 4 — Keep Apple's refresh token, so a deletion on any device revokes it

The task's earlier requests and decisions are in [description-step-1.md](description-step-1.md).
This step comes from two later user requests (2026-10-06), verbatim:

6. "Web and Android deletes still don't revoke - can it be fixed?" The answer given in chat is the design below.
7. "Add a separate step to implement that"

**Step 3 must land first.** This step builds on what step 3 built:

- `supabase/functions/_shared/apple.ts`: the client secret, the code exchange (returning `sub` and `refresh_token`),
  and the revoke;
- the `delete-account` and `reset-apple-sign-in` functions;
- `deleteAccountWithApple` in `profileApi.ts`;
- the branch in `SessionContext.deleteAccount()`;
- the sign-in recovery in `appleSignIn.ts`.

Where step 3's log differs from step 3's description, the log wins.

**It moves one line out of "Out of this task"** in step 1: "Storing Apple refresh tokens so that any device can
revoke". Step 1 put it out of scope; request 6 brings it in.

## Why

- **Step 3 revokes only on an iOS deletion.** The token it revokes comes from a second Apple sheet that the deletion
  opens, and only iOS has the sheet.
- **A web or Android deletion of an Apple-linked account leaves Apple's authorization standing** (step 3's
  "decided in writing" exception). Two things follow:
  - The app stays listed under the user's Apple Account → Sign in with Apple, for an account that is gone.
  - The next Sign in with Apple hits the lock-out. Step 3's recovery clears it, but only after a failed first attempt
    and a second sheet.
- **The fix is Apple's own model.** Exchange the code at sign-in, keep the refresh token on the server, and revoke it
  when the account is deleted. The server then needs nothing from the device at deletion.

## The design

1. **Every Apple sign-in stores a token.**
   - After `signInWithIdToken` succeeds, the app sends the same credential's `authorizationCode` to a new function,
     `store-apple-token`.
   - The function exchanges the code, checks the Apple ID, and saves the `refresh_token` in a table only the server
     can read.
   - GoTrue's id-token path checks the identity token only and never spends the code, so the code is still fresh.
2. **`delete-account` revokes the stored token, then deletes,** on every platform. It needs no code and no sheet.
3. **iOS loses step 3's second sheet at deletion.** The token is already on the server.
   - `reauthorizeWithApple()`, the cancel result and AccountScreen's cancel handling go, unless something else uses
     them.
   - *(decided in writing)* No fallback sheet for an account with no stored token: it would add a Face ID prompt to
     every iOS deletion, for a case the recovery already covers.
4. **Step 3's recovery stays, unchanged, as the backstop.** It still covers:
   - an account whose last Apple sign-in predates this step, so has no stored token;
   - a store that failed;
   - a stored token that no longer revokes the live authorization.

## The table

A new migration after the latest one, e.g. `supabase/migrations/20261006000000_apple_tokens.sql`.

```sql
create table public.apple_tokens (
  apple_sub text primary key,
  user_id uuid not null references auth.users on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);
create index on public.apple_tokens (user_id);
alter table public.apple_tokens enable row level security;
revoke all on public.apple_tokens from anon, authenticated;
```

- **Keyed by the Apple `sub`, not the user.**
  - One row per Apple ID. A user with two Apple identities gets two rows, and the deletion revokes both.
  - A sign-in to an existing `sub` replaces its token and its `user_id`.
- **No policy, and no grant to `anon` or `authenticated`.** The app can never read it. Only the functions' service-role
  client reaches it, and that client bypasses RLS.
  - Supabase's default privileges grant new `public` tables to `anon` and `authenticated`, hence the explicit revoke.
    [list-data-scoped-by-rls](../../kb/entries/list-data-scoped-by-rls.md): grants are half the story.
  - Say so in a comment, in the migrations' style.
- **The token is stored as is, not encrypted** *(decided in writing)*.
  - It is useless without a client secret, and only the `.p8` can mint one. The `.p8` never enters the database.
  - Say this in the migration's comment.
- **`on delete cascade`** removes the rows with the account. `delete_account()` deletes `auth.users` last, and
  `delete-account` revokes before calling it.
- **Apply it with `npx supabase migration up --local`.** Never `db reset`
  ([supabase-local-stack](../../kb/entries/supabase-local-stack.md)).

## The functions

### The service-role client

- Both `store-apple-token` and `delete-account` need a client built with the service-role key, for the table only.
  Everything else keeps the caller's-token client, as in step 3.
- **Check which variable CLI 2.116.0's edge runtime injects**: `SUPABASE_SERVICE_ROLE_KEY`, or the newer secret key.
  Record it.
- **Put the client in `_shared/`**, beside `apple.ts`.
- **Never log** the code, the refresh token or the key, as in step 3.

### `supabase/functions/store-apple-token/index.ts` (new)

- **`verify_jwt` stays on**, the default, so it needs no `config.toml` entry.
- **Request:** `POST` with the body `{ "authorizationCode": string }`, and the caller's token in `Authorization`.
- **The steps:**
  1. **The caller:** `auth.getUser()` on the caller's-token client.
  2. **Their Apple identities:** the entries in `identities` with `provider === 'apple'`. None: 400 `apple_not_linked`.
  3. **Exchange the code** (shared).
  4. **Check the Apple ID.** The exchange's `sub` must equal one of the caller's Apple identities' `sub`. Use what
     step 3 found carries it, `provider_id` or `identity_data.sub`. Otherwise 403 `apple_account_mismatch`.
     - The code comes from the credential that just signed in, so this never fails for the app. It stops a caller
       from attaching another Apple ID's token to their account.
  5. **Upsert** `{ apple_sub, user_id, refresh_token, updated_at: now }` on `apple_sub`, with the service-role client.
  6. Answer 204.
- **Failures** use step 3's codes and statuses. Nobody sees them: the app ignores this call's result.
- **Every sign-in replaces the token, not only the first.** After `Stop Using` and a new consent, the old token is
  dead and only the newest revokes the live authorization.

### `delete-account` (changed)

- **Request:** `POST` with no body. The `authorizationCode` field goes.
- **The steps, in order.** Nothing is deleted unless every stored token revoked.
  1. **The caller** (as in step 3).
  2. **Their Apple identities** (as in step 3). None: 400 `apple_not_linked`.
  3. **Their stored tokens:** every row of `apple_tokens` with the caller's `user_id`, read with the service-role client.
  4. **Revoke each** (shared).
     - 200: revoked.
     - **A token Apple no longer honours:** RFC 7009 says the answer is still 200. If Apple answers 400
       `invalid_grant` instead, treat it as revoked: the authorization it belonged to is gone already. Record what
       Apple actually answers (Verification).
     - Apple unreachable, a 5xx, or any other 4xx: 424 `apple_unavailable`, and nothing is deleted.
  5. **No stored token:** go on and delete without a revoke. Step 3's recovery clears what this leaves.
  6. **Delete:** `rpc('delete_account')` on the caller's-token client, its result passed back unchanged, as in step 3.
- **Step 3's code exchange and `sub` check leave this function.** The `sub` check now lives in `store-apple-token`.
  `apple_code_rejected` and `apple_account_mismatch` stay in the table for `store-apple-token` and
  `reset-apple-sign-in`.
- **A misconfigured key on the server blocks Apple-linked deletions** (`invalid_client` gives 424) *(decided in
  writing)*. That is the price of "nothing is deleted unless Apple's revoke succeeded", which step 3 set. It shows at
  the first test, not silently.

### `reset-apple-sign-in`

Unchanged.

## The app

### `appleSignIn.ts`

- **After a successful `signInWithIdToken`,** call
  `supabase.functions.invoke('store-apple-token', { body: { authorizationCode } })` with the code of the credential
  that signed in.
  - **Don't wait for it.** Start it, and return without awaiting it, so the sign-in never waits on Apple or a function
    cold start.
  - **Ignore its result.** It must never reject unhandled. A failure leaves the account with no stored token, which
    the recovery covers.
  - **In the recovery,** store the second credential's code. The first credential's code was spent by
    `reset-apple-sign-in`.
- **A sign-in that fails, or is cancelled, stores nothing.**
- **`reauthorizeWithApple()`** goes if nothing else calls it.
- **Module boundary:** through `supabase` from `./supabase`, as step 3's call is.

### `profileApi.ts`

`deleteAccountWithApple()` takes no argument and invokes `delete-account` with no body. The error mapping is step 3's,
unchanged.

### `SessionContext`

`deleteAccount()` branches on Apple-linked alone, never on `Platform.OS`:

- **Apple-linked** (`app_metadata.providers` includes `'apple'`), on iOS, Android and web: call
  `deleteAccountWithApple()`, with no sheet.
- **Not Apple-linked:** the RPC, unchanged.
- **Everything after a success is unchanged:** `forgetAccount`, the local sign-out, and `deleted`.
- **Step 3's cancel result goes**, with nothing left to cancel.

### `AccountScreen`

- Step 3's cancel handling goes.
- **No change to the look.** The function's sentences still show in the `ErrorBanner` verbatim.

## Tests (jest)

Await `render` and `fireEvent` (RNTL 14).

- **appleSignIn:**
  - A successful sign-in invokes `store-apple-token` with the credential's `authorizationCode`.
  - It returns `{ error: null }` while that invoke is still pending (a promise that never settles), and when the
    invoke fails or rejects.
  - A cancelled sheet, a missing token, or a failed `signInWithIdToken` invokes nothing.
  - The recovery stores the second credential's code, never the first.
  - Step 3's recovery tests still pass. Update only the call counts the store adds.
- **profileApi:** `deleteAccountWithApple()` invokes `delete-account` with no body. Step 3's error-mapping tests stay.
- **SessionContext:**
  - Apple-linked on iOS, Android and web each call the function, open no sheet, and never call the RPC.
  - Not Apple-linked calls the RPC.
  - A failure from the function clears nothing.
- **AccountScreen:** remove the cancel tests with the cancel path. The function's messages still show verbatim.
- **The functions:** if `deno` is on PATH, `deno test` the pure parts:
  - the `sub` check against a list of identities;
  - the revoke loop: 200 and `invalid_grant` go on to the RPC, 5xx and other 4xx stop with 424, and no rows go
    straight to the RPC.

  Otherwise verify them by request (below), and say so in the log, as step 3 does.

## Verification

**Local stack only, as in step 3.** Nothing goes to cloud: no `db push`, no function deploy, no `secrets set`, no
`config push`.

**Never write the Apple Account's address, real or relay, into the log or a screenshot.** Say "the relay address".

1. **The table.**
   - Apply it with `migration up --local`.
   - **The app can't read it.** In `psql`, `set role authenticated; select * from public.apple_tokens;` is refused.
     So is `GET /rest/v1/apple_tokens` with a signed-in user's token. Record both answers.
2. **The functions are served.** With no token, `store-apple-token` gets 401.
3. **At request level,** with `curl` and a throwaway account's token:
   - an account that is not Apple-linked gets 400 `apple_not_linked` from `store-apple-token`;
   - a made-up code to an Apple-linked account gets 400 `apple_code_rejected`, and no row is written.
4. **Storing.**
   - Sign in with Apple on the simulator. `psql` shows one row:
     - its `user_id` is the user;
     - its `apple_sub` equals the Apple identity's;
     - print `length(refresh_token)`, never the token.
   - Sign out and sign in with Apple again: the same row, with a later `updated_at`.
   - Time the sign-in against step 3's, by eye. It must not wait on the store.
5. **The proof: a web deletion revokes.** Use a throwaway Apple-linked account with Hide My Email that solely owns a
   list.
   1. In Playwright on `npm run web`, sign in with the relay address and the code from Mailpit.
   2. Delete the account there.
   3. Expect:
      - `psql` shows the user, its list and its `apple_tokens` row gone;
      - the function's log shows the revoke answered, then the RPC.
   4. **Then Sign in with Apple on the simulator.** The consent sheet (`Share My Email` / `Hide My Email`) comes at
      once, and the local auth log shows no 500. This shows the recovery never ran.
   5. Note whether the simulator's Settings → Apple Account → Sign in with Apple still lists the app. Step 3 found
      whether it reflects a server revoke.
   - **If the simulator can't show it,** repeat on the iPhone 13 over the LAN, with step 2's Metro override. Record
     which device showed it.
6. **An iOS deletion opens no Apple sheet.** The account and its row go, and the next Apple sign-in gets the consent
   sheet at once.
7. **An account with no stored row still deletes.**
   - Delete its row with `psql`, then delete the account.
   - It goes without a revoke. The next Apple sign-in runs step 3's recovery and succeeds.
8. **Apple's answer to a token already revoked.**
   - With a throwaway account's stored token, revoke it twice through the shared module.
   - Use a scratch script in the scratchpad that reads the token from the database and never prints it.
   - Record both statuses and bodies, and make `delete-account` match what Apple actually sends.
9. **An account without Apple** still deletes through the RPC.
10. **No screenshots:** no screen's look changed.
11. **Commands:** `npm test`, `npm run typecheck`, `npm run kb:audit`.

## Out of this step

- **Anything on cloud,** as in step 3. Rolling out takes:
  - pushing the migration;
  - deploying three functions;
  - setting the `.p8` secrets.

  That goes with Apple's cloud release, and the user runs it.
- Apple's server-to-server notifications (step 1's out-of-scope list keeps them).
- Encrypting the stored token, for example with Vault.
- A fallback sheet for an iOS account with no stored token (see The design, 3).

## After this step

- **Do not run `/librarian deposit`**, whatever CLAUDE.md's working rules say (step 1's request 5). Step 5 deposits
  the whole task once.
- **Write `implementation-log-step-4.md`** as usual. End it with a **KB candidates** section: the table below,
  corrected to what was actually built, plus anything the step taught that the table misses. That section is how this
  step reaches step 5.
- **Never edit `ai/kb/`.** If `npm run kb:audit` fails on an entry this step made stale, that is expected until step 5:
  name it in the log. Never change code to make a check pass.

## KB impact (for step 5's deposit)

| entry | change |
|---|---|
| scope-boundaries | replaces step 3's row. Every Apple sign-in stores Apple's refresh token server-side. Deleting an Apple-linked account revokes it first, on every platform, with no sheet. An account with no stored token is deleted unrevoked, and step 3's recovery clears that at the next Apple sign-in. Still nothing on cloud |
| delete-account-removes-sole-owned-lists | `delete-account` revokes every stored token for the caller, then calls `delete_account()` with the caller's token. The row cascades with `auth.users` |
| list-data-scoped-by-rls, or the revocation entry | `apple_tokens` is service-only: RLS with no policy, plus `revoke all from anon, authenticated`, because the default privileges grant new `public` tables |
| the revocation entry (step 3's new entry) | the stored token replaces step 3's second sheet. `store-apple-token` runs after every Apple sign-in, without being awaited, and holds the `sub` check. The token is stored unencrypted, because only the `.p8` makes it usable. What Apple answers for a token already revoked. Which service-role variable the edge runtime injects |
