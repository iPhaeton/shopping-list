---
id: apple-refresh-token-revoked-before-account-deletion
title: Every Apple sign-in stores Apple's refresh token in a service-only `apple_tokens` table, and the `delete-account` Edge Function revokes it before deleting — on every platform, with no Apple sheet, and nothing deleted unless every revoke succeeded
type: decision
status: current
tags: [auth, apple, supabase, edge-functions, deletion, account, security]
sources: [ai/tasks/26-apple-sign-in/implementation-log-step-2.md, ai/tasks/26-apple-sign-in/implementation-log-step-3.md, ai/tasks/26-apple-sign-in/implementation-log-step-4.md, b15d384, 9421c3c, 42cd547]
last_verified: 2026-10-07
verify: M=supabase/migrations/20261007000000_apple_tokens.sql; F=supabase/functions/delete-account/index.ts; grep -q '^revoke all on public.apple_tokens from anon, authenticated;' "$M" && grep -q '^alter table public.apple_tokens enable row level security;' "$M" && ! grep -rqiE 'policy.*apple_tokens' supabase/migrations && grep -q 'references auth.users on delete cascade' "$M" && ! grep -q 'reauthorizeWithApple' src/lib/appleSignIn.ts && grep -q '^  storeAppleToken(credential.authorizationCode);' src/lib/appleSignIn.ts && grep -q "appleError === 'invalid_grant'" "$F" && LC_ALL=C awk '/await revoke\(/ && !r {r=NR} /rpc\(.delete_account.\)/ && !d {d=NR} END{exit !(r && d && r<d)}' "$F" && grep -q "providers?.includes('apple')" src/state/SessionContext.tsx
related: [apple-revoke-leaves-an-email-less-returning-sheet, edge-functions-local-dev-loop, delete-account-locks-then-removes-sole-owned-lists, supabase-default-grants-defeat-revokes, session-revoked-write-redirects, scope-boundaries]
---

Apple requires an app that offers Sign in with Apple to revoke the user's tokens when the account is
deleted. This app keeps the token on the server at every sign-in, so the revoke needs no Apple sheet
at deletion, and works from web and Android as well as iOS. Do not add a sheet to deletion.

**Stored at every sign-in.** After a successful `signInWithIdToken`, `signInWithApple()` in
[src/lib/appleSignIn.ts](../../../src/lib/appleSignIn.ts) calls
`storeAppleToken(credential.authorizationCode)`, which runs
`functions.invoke('store-apple-token', …).catch(() => undefined)` — **not awaited**, so a sign-in never
waits on Apple or a cold start, and a failure only leaves the account with no stored token.
[store-apple-token](../../../supabase/functions/store-apple-token/index.ts) (`verify_jwt` on) trades
the code with Apple for a refresh token, requires its `sub` to be one of the caller's Apple
identities (`identity_data?.sub ?? id`, else 403 `apple_account_mismatch`), and upserts on
`apple_sub`. GoTrue's id-token path never spends the code, which is why it is still good. Every
sign-in replaces the token, not only the first: after Stop Using and a new consent the old one is dead.

**Revoked at deletion.** `deleteOnServer` in
[src/state/SessionContext.tsx](../../../src/state/SessionContext.tsx) sends an account whose
`app_metadata.providers` includes `apple` to `deleteAccountWithApple()` → `delete-account`; every
other account calls the `delete_account` RPC directly.
[delete-account](../../../supabase/functions/delete-account/index.ts) takes no body:
`callerOf` → Apple-linked check → read the caller's `apple_tokens` rows with the service client (a
read error is 500) → revoke each → `rpc('delete_account')` as the caller, its status and words passed
back unchanged. Per revoke:

- an `AppleFailure` with `appleError === 'invalid_grant'` counts as revoked;
- `apple_not_configured` stays 500;
- any other failure is 424 `apple_unavailable`, and **nothing is deleted**.

No rows goes straight on to the RPC.

**Revoke first, then delete — never the reverse.** If the RPC fails after the revokes, the account is
intact and only the authorization is gone; the next Apple sign-in lands in the same account, since
the `sub` does not change. The reverse order could delete the account and leave the token standing.
The price: a server without a working key blocks every Apple-linked deletion — loudly, at the first
test.

**The `invalid_grant` rule stays although Apple never sent it.** Apple follows RFC 7009: a token
already revoked is revoked "successfully", 200 with an empty body. The rule is kept because a dead
token drawing `invalid_grant` would otherwise block that account's deletion for good. It is not dead
code.

**An account with no stored token is deleted unrevoked** — its last Apple sign-in predates the store,
or the store failed. That locks nothing out: the next Apple sign-in gets the returning sheet with the
email and makes a new account (measured).

**`apple_tokens` is service-only.**
[20261007000000_apple_tokens.sql](../../../supabase/migrations/20261007000000_apple_tokens.sql)
creates `public.apple_tokens(apple_sub text pk, user_id uuid not null → auth.users on delete cascade,
refresh_token text not null, updated_at)` with RLS on and **no policy**, plus
`revoke all … from anon, authenticated` — the default privileges grant every new `public` table to
both roles, and RLS alone would answer their reads with an empty set rather than a refusal
([supabase-default-grants-defeat-revokes](supabase-default-grants-defeat-revokes.md)). Measured: 403
`42501` through REST for both read and insert. Only the functions' service-role client reaches it. Its
header comment records why: keyed by `sub` (an account with two Apple identities has two rows, and
deletion revokes both), service-only, and **unencrypted, decided in writing** — a refresh token is
useless without a client secret, which only the `.p8` key mints, and the key never enters the
database. The rows cascade with `auth.users`, which `delete_account()` deletes last, after every
revoke ([delete-account-locks-then-removes-sole-owned-lists](delete-account-locks-then-removes-sole-owned-lists.md)).

**Only a device run proves the key.** Apple answers a made-up code with `invalid_grant` even when the
request is signed with an unknown throwaway key, so a hand-made request cannot tell a good key from a
bad one.

**Cloud status.** Apple is enabled in cloud's auth (`/auth/v1/settings` reports `external.apple:
true`), but the `apple_tokens` migration, the three functions (`store-apple-token`, `delete-account`,
`reset-apple-sign-in`) and their secrets are **not deployed there** — no `db push`, no deploy, no
`secrets set`. Running them locally: [edge-functions-local-dev-loop](edge-functions-local-dev-loop.md).

**A revoke has a side effect** — for a while the device's returning sheet carries no email and GoTrue
cannot create a user from it: [apple-revoke-leaves-an-email-less-returning-sheet](apple-revoke-leaves-an-email-less-returning-sheet.md).

The `verify:` asserts the table's revoke, RLS, no policy and cascade; no deletion-time
`reauthorizeWithApple`; the store call not awaited; the `invalid_grant` rule; the revoke loop ahead
of the RPC; and the Apple-linked routing in `SessionContext`.
