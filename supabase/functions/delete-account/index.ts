import { createClient, isAuthSessionMissingError } from 'npm:@supabase/supabase-js@2.112.4';

import { AppleFailure, exchangeCode, fail, readCode, revoke } from '../_shared/apple.ts';

/**
 * Deletes an Apple-linked account from iOS: revokes Apple's token, as Apple requires, then runs the
 * same `delete_account()` the app calls for every other account (task 25), with the caller's own
 * token.
 *
 * `verify_jwt` is on, the default, so only a signed-in caller gets here. The body is
 * `{ "authorizationCode": string }`, from the Apple sheet the app opened just before.
 *
 * **Revoke first, then delete.** If the RPC fails after the revoke, the account is intact and only
 * Apple's authorization is gone: the next Sign in with Apple lands in the same account, since the
 * `sub` does not change. The reverse order could delete the account and leave the token standing,
 * which Apple's rule does not allow.
 */
Deno.serve(async (request) => {
  const code = await readCode(request);
  if (!code) return fail('invalid_request');

  // The anon key and the caller's own token, so that `auth.uid()` and `session_still_valid()` see
  // exactly what they see when the app calls the RPC itself.
  const authorization = request.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getUser(authorization.replace(/^Bearer /, ''));
  if (error || !data.user) return refusedSession(error);

  const identity = data.user.identities?.find(({ provider }) => provider === 'apple');
  if (!identity) return fail('apple_not_linked');

  try {
    const { sub, refreshToken } = await exchangeCode(code);
    // The phone may be signed in to a different Apple ID than the one this account was made with.
    // That ID's authorization is not this account's to revoke.
    if (sub !== (identity.identity_data?.sub ?? identity.id)) return fail('apple_account_mismatch');
    await revoke(refreshToken);
  } catch (failure) {
    if (failure instanceof AppleFailure) return fail(failure.code);
    throw failure;
  }

  const { error: refused, status } = await supabase.rpc('delete_account');
  // PostgREST's own status and words, unchanged, so the app reads them as it reads the RPC's.
  if (refused) return Response.json({ code: refused.code, message: refused.message }, { status });
  return new Response(null, { status: 204 });
});

/**
 * GoTrue refuses a token whose session is gone (`session_not_found`, which auth-js turns into an
 * `AuthSessionMissingError`) before `delete_account()` could. Answered in the words
 * `session_still_valid()` raises, so the app's `sessionRevoked` sends it to Sign in as it does when
 * the RPC refuses. Anything else is GoTrue's own answer.
 */
function refusedSession(error: { status?: number; code?: string; message: string } | null) {
  if (isAuthSessionMissingError(error)) {
    return Response.json({ code: '42501', message: 'this device has been signed out' }, { status: 403 });
  }
  return Response.json(
    { code: error?.code ?? 'unauthorized', message: error?.message ?? 'Not signed in.' },
    { status: error?.status ?? 401 }
  );
}
