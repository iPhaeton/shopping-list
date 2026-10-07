-- Apple's refresh token for each Apple ID that signs in (task 26 step 4). Apple requires an app that
-- offers Sign in with Apple to revoke the user's tokens when the account is deleted. The
-- `store-apple-token` Edge Function writes a row after every Apple sign-in, and `delete-account`
-- revokes every row of the caller before it calls `delete_account()`, so a deletion on web or Android
-- revokes as well as one on iOS, with no Apple sheet at deletion.
--
-- **Keyed by the Apple `sub`, not the user.** One row per Apple ID: an account with two Apple
-- identities has two rows, and its deletion revokes both. A sign-in to a `sub` that already has a row
-- replaces its token and its `user_id`. Every sign-in replaces it, not only the first: after Stop Using
-- and a new consent the old token is dead, and only the newest revokes the live authorization.
--
-- **Service-only.** Row-level security with no policy, and no grant to `anon` or `authenticated`: the
-- app can never read or write it. Supabase's default privileges grant every new `public` table to both
-- roles, and RLS alone would answer their reads with an empty set rather than a refusal, so the grants
-- are revoked explicitly. Only the functions' service-role client reaches the table, and that client
-- bypasses RLS.
--
-- **Stored as is, not encrypted** (decided in writing). A refresh token is useless without a client
-- secret, which only the Sign in with Apple key (`.p8`) can mint, and the key never enters the
-- database: it lives in the functions' secrets.
--
-- **`on delete cascade`** removes the rows with the account. `delete_account()` deletes `auth.users`
-- last, and `delete-account` revokes before calling it, so a row is never gone before its revoke.

create table public.apple_tokens (
  apple_sub text primary key,
  user_id uuid not null references auth.users on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);

-- `delete-account` reads a user's rows, and the cascade from `auth.users` finds them, by `user_id`.
create index on public.apple_tokens (user_id);

alter table public.apple_tokens enable row level security;
revoke all on public.apple_tokens from anon, authenticated;
