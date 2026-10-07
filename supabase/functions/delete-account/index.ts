import { corsHeaders } from 'npm:@supabase/supabase-js@2.112.4/cors';

import { AppleFailure, fail, revoke } from '../_shared/apple.ts';
import { callerOf, serviceClient } from '../_shared/supabase.ts';

/**
 * Deletes an Apple-linked account on any platform: revokes every Apple refresh token
 * `store-apple-token` kept for it, as Apple requires, then runs the same `delete_account()` the app
 * calls for every other account (task 25), with the caller's own token.
 *
 * `verify_jwt` is on, the default, so only a signed-in caller gets here. The request has no body:
 * the tokens are already on the server, so a deletion needs no Apple sheet.
 *
 * **Revoke first, then delete. Nothing is deleted unless every stored token was revoked.** If the RPC
 * fails after the revokes, the account is intact and only Apple's authorization is gone: the next
 * Sign in with Apple lands in the same account, since the `sub` does not change. The reverse order
 * could delete the account and leave the token standing, which Apple's rule does not allow. That
 * makes a server without a working key (`invalid_client`) block every Apple-linked deletion, which
 * shows at the first test rather than silently.
 *
 * **An account with no stored token** (its last Apple sign-in predates the store, or the store
 * failed) is deleted with nothing revoked. Its authorization stands, and the next Sign in with Apple
 * makes a new account from a token that still carries the email.
 *
 * **CORS.** The web app calls this one function from a browser. The local stack's Kong answers the
 * preflight and adds the headers itself, but the hosted gateway does neither, so the function does.
 */
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const response = await deleteAccount(request);
  for (const [name, value] of Object.entries(corsHeaders)) response.headers.set(name, value);
  return response;
});

async function deleteAccount(request: Request): Promise<Response> {
  const caller = await callerOf(request);
  if (caller instanceof Response) return caller;
  const { supabase, user } = caller;

  if (!user.identities?.some(({ provider }) => provider === 'apple')) return fail('apple_not_linked');

  const { data: rows, error: unread } = await serviceClient()
    .from('apple_tokens')
    .select('refresh_token')
    .eq('user_id', user.id);
  if (unread) {
    console.error(`apple_tokens read: ${unread.code}`);
    return Response.json({ code: unread.code, message: unread.message }, { status: 500 });
  }

  for (const { refresh_token: refreshToken } of rows) {
    try {
      await revoke(refreshToken);
    } catch (failure) {
      if (!(failure instanceof AppleFailure)) throw failure;
      // Apple answers a token already revoked with 200 (`revoke`). Should one it no longer honours
      // ever draw `invalid_grant` instead, its authorization is gone already, and refusing would
      // block this deletion for good.
      if (failure.appleError === 'invalid_grant') {
        console.log('apple /auth/revoke: invalid_grant taken as revoked');
        continue;
      }
      if (failure.code === 'apple_not_configured') return fail(failure.code);
      // Apple unreachable, or refusing for any other reason: the account stays.
      return fail('apple_unavailable');
    }
  }

  const { error: refused, status } = await supabase.rpc('delete_account');
  console.log(`delete_account: ${status}`);
  // PostgREST's own status and words, unchanged, so the app reads them as it reads the RPC's.
  if (refused) return Response.json({ code: refused.code, message: refused.message }, { status });
  return new Response(null, { status: 204 });
}
