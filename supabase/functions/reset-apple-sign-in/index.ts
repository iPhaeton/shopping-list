import { AppleFailure, exchangeCode, fail, readCode, revoke } from '../_shared/apple.ts';

/**
 * Clears the lock-out a revoke leaves for a few minutes. A device still showing its returning-user
 * sheet re-authorizes the app with no email, and GoTrue cannot create a user from that token. The
 * app calls this from `signInWithApple()` when GoTrue answered 500 to a token with no email: it
 * revokes that authorization, so that once the device catches up, Apple's next sheet asks for
 * consent and puts the email back.
 *
 * `verify_jwt = false` in `config.toml`: the caller has no session, because that sign-in just failed.
 * That is safe because only Apple's sheet on the user's own device issues a code, bound to this
 * app's bundle id, alive for five minutes and good once, and because a revoke only makes Apple ask
 * for consent again. It checks no account and deletes nothing: if an account still has this `sub`,
 * the next sign-in lands in it.
 */
Deno.serve(async (request) => {
  const code = await readCode(request);
  if (!code) return fail('invalid_request');

  try {
    const { refreshToken } = await exchangeCode(code);
    await revoke(refreshToken);
  } catch (failure) {
    if (failure instanceof AppleFailure) return fail(failure.code);
    throw failure;
  }

  return new Response(null, { status: 204 });
});
