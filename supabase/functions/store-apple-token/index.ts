import { AppleFailure, exchangeCode, fail, readCode } from '../_shared/apple.ts';
import { callerOf, serviceClient } from '../_shared/supabase.ts';

/**
 * Keeps Apple's refresh token for the Apple ID that just signed in, so that `delete-account` can
 * revoke it when the account is deleted, on any device and with no Apple sheet. The app calls this
 * after every successful Sign in with Apple, with the `authorizationCode` of the credential that
 * signed in: GoTrue's id-token path checks the identity token only and never spends the code.
 *
 * `verify_jwt` is on, the default: the caller has the session that sign-in just made. The body is
 * `{ "authorizationCode": string }`. The app does not wait for the answer and ignores it, so a
 * failure only leaves the account with no stored token, which `delete-account` deletes unrevoked.
 *
 * **Every sign-in replaces the token, not only the first.** After Stop Using and a new consent, the
 * old token is dead, and only the newest revokes the live authorization.
 *
 * **The `sub` check.** The code comes from the credential that just signed in, so it never fails
 * for the app. It stops a caller from attaching another Apple ID's token to their own account.
 */
Deno.serve(async (request) => {
  const code = await readCode(request);
  if (!code) return fail('invalid_request');

  const caller = await callerOf(request);
  if (caller instanceof Response) return caller;

  const subs = (caller.user.identities ?? [])
    .filter(({ provider }) => provider === 'apple')
    .map((identity) => identity.identity_data?.sub ?? identity.id);
  if (subs.length === 0) return fail('apple_not_linked');

  let exchanged: { sub: string; refreshToken: string };
  try {
    exchanged = await exchangeCode(code);
  } catch (failure) {
    if (failure instanceof AppleFailure) return fail(failure.code);
    throw failure;
  }
  if (!subs.includes(exchanged.sub)) return fail('apple_account_mismatch');

  const { error } = await serviceClient().from('apple_tokens').upsert(
    {
      apple_sub: exchanged.sub,
      user_id: caller.user.id,
      refresh_token: exchanged.refreshToken,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'apple_sub' }
  );
  if (error) {
    console.error(`apple_tokens upsert: ${error.code}`);
    return Response.json({ code: error.code, message: error.message }, { status: 500 });
  }
  return new Response(null, { status: 204 });
});
