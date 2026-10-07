import { resultFor, type Result } from './listsApi';
import { supabase } from './supabase';

type ProfileRow = { name: string | null };

/**
 * The signed-in account's own name. A plain read, not an RPC: the "read own row" policy on
 * `public.users` already scopes it, and there is no business logic here the way there is for
 * `set_name`'s uniqueness check. `name: null` means "not chosen yet" — the fact the gate exists to
 * close.
 */
export async function fetchProfile(
  userId: string
): Promise<{ name: string | null; error: string | null }> {
  const { data, error } = await supabase.from('users').select('name').eq('id', userId).maybeSingle();
  if (error) return { name: null, error: error.message };
  return { name: (data as ProfileRow | null)?.name ?? null, error: null };
}

/**
 * `set_name` is `security definer`, not a plain `.update()`: only the database can catch a
 * uniqueness collision and re-raise it as `'that name is taken'`. Answered synchronously, like the
 * membership RPCs in `membersApi.ts` — the caller is still looking at the screen that caused this
 * call, so the database's own words are kept rather than rewritten.
 */
export async function setName(name: string): Promise<Result> {
  const { error, status } = await supabase.rpc('set_name', { p_name: name.trim() });
  return resultFor(error, status);
}

/**
 * Deletes every list the caller is the only owner of, then the account itself, in one transaction
 * (`20261005000000_delete_account.sql`). Answered synchronously and never queued: there would be no
 * account left to replay a queued delete into, and the caller is still on the Account screen that
 * asked. So, like `setName`, it keeps the database's own words.
 */
export async function deleteAccount(): Promise<Result> {
  const { error, status } = await supabase.rpc('delete_account');
  return resultFor(error, status);
}

/**
 * `deleteAccount` for an Apple-linked account on iOS: the `delete-account` Edge Function trades the
 * code from Apple's sheet for Apple's token, revokes it, then runs the same `delete_account()` with
 * this caller's token. Apple requires the revoke, and a deletion without it locks the next Sign in
 * with Apple out (`appleSignIn.ts`).
 *
 * Its failures come back in the shape `resultFor` reads: the function's own are 4xx with the
 * sentence to show, so they are `permanent`; the RPC's status and words are passed back unchanged,
 * so a revoked session still sets `sessionRevoked`. A request that never got an answer is status 0,
 * so `retryable`, the same as an offline RPC.
 */
export async function deleteAccountWithApple(authorizationCode: string): Promise<Result> {
  const { error } = await supabase.functions.invoke('delete-account', {
    body: { authorizationCode },
  });
  if (!error) return resultFor(null, 204);

  // Told apart by name, since only `supabase.ts` may import supabase-js's classes at runtime. Only an
  // HTTP error carries the function's answer, as a `Response`; a fetch or relay error has none.
  if (error.name !== 'FunctionsHttpError') return resultFor({ message: error.message }, 0);
  const response = error.context as Response;
  const body = await response.json().catch(() => ({}));
  return resultFor(
    {
      message: typeof body.message === 'string' ? body.message : error.message,
      code: typeof body.code === 'string' ? body.code : null,
    },
    response.status
  );
}
