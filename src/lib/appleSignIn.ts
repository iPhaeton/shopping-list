import {
  AppleAuthenticationScope,
  formatFullName,
  signInAsync,
  type AppleAuthenticationCredential,
} from 'expo-apple-authentication';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';

import { supabase } from './supabase';

/**
 * This file is the one importer of `expo-apple-authentication`, as `googleSignIn.ts` is of Google's
 * module, so `SignInScreen` takes the native button from here. Importing it is safe on every
 * platform: the module loads with `requireOptionalNativeModule`, and the button renders nothing off
 * iOS.
 */
export {
  AppleAuthenticationButton,
  AppleAuthenticationButtonStyle,
  AppleAuthenticationButtonType,
} from 'expo-apple-authentication';

export type Result = { error: string | null };

/** The recovery below revoked the authorization, and the device needs a few minutes to notice. */
const RESET_STARTED = 'Sign in with Apple needs a few minutes to reset. Try again in 5 minutes.';
/** The recovery could not revoke. The next tap runs it again. */
const RESET_FAILED = "Apple sign-in couldn't finish. Try again in a minute.";

/**
 * The whole native round trip, iOS only: Apple's sheet, then handing the identity token it returns
 * to Supabase. Success is reported through `onAuthStateChange`, which `SessionProvider` already
 * owns, exactly as for Google; the returned `Result` only ever carries failure, and a cancelled
 * sheet is not one.
 *
 * **Who gets which nonce.** Apple copies the value it is given into the identity token's `nonce`
 * claim verbatim. GoTrue hashes the raw nonce it is given and compares the result with that claim.
 * So Apple gets the SHA-256 hex and Supabase the raw value; swapped, every sign-in fails with a
 * nonce mismatch. `supabase/config.toml` keeps `skip_nonce_check = false` for Apple because this
 * pair can be produced, unlike with Google's free module.
 *
 * **The sign-in a revoke leaves behind.** A device keeps showing Apple's returning-user sheet for a
 * few minutes after the app's authorization was revoked — by `delete-account`, or by Stop Using on
 * another device. That sheet's token has no email, since the consent that shared it is gone, and the
 * sheet authorizes the app again, still without it. With no account for its `sub`, GoTrue tries to
 * create a user with no email, and `public.users.email not null` fails that with a 500 — on every
 * attempt. So a 500 for an email-less token sends the sheet's code to `reset-apple-sign-in`, which
 * revokes that new authorization, and the user is asked to wait. Measured on an iPhone 13 (task 26
 * step 3): a sheet opened 10 s after the revoke was still the returning one, and one opened 3½
 * minutes after asked Share / Hide again, email included. The simulator never caught up.
 */
export async function signInWithApple(): Promise<Result> {
  const rawNonce = randomUUID();
  const hashedNonce = await digestStringAsync(CryptoDigestAlgorithm.SHA256, rawNonce);

  let credential: AppleAuthenticationCredential;
  try {
    credential = await signInAsync({
      requestedScopes: [AppleAuthenticationScope.FULL_NAME, AppleAuthenticationScope.EMAIL],
      nonce: hashedNonce,
    });
  } catch (error) {
    if (isCancel(error)) return { error: null };
    return { error: (error as Error).message };
  }

  const { identityToken } = credential;
  if (!identityToken) return { error: 'Sign-in did not return an identity token' };

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: identityToken,
    nonce: rawNonce,
  });
  if (error) {
    // auth-js reports GoTrue's 500 with `status` 500; a network failure has 0 and is not this case.
    if ((error as { status?: number }).status === 500 && !carriesEmail(identityToken)) {
      return { error: await resetAppleSignIn(credential.authorizationCode) };
    }
    return { error: error.message };
  }

  await saveSuggestedName(credential);
  return { error: null };
}

/**
 * Only a hint, so the token is decoded without verifying it: GoTrue has already checked it. A token
 * that cannot be read counts as carrying an email, so its failure shows as it is.
 */
function carriesEmail(identityToken: string): boolean {
  try {
    const part = identityToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')));
    return Boolean(payload.email);
  } catch {
    return true;
  }
}

/** Revokes the authorization the sheet just made, and says what to do next. Called with no
 * session, through the same client. */
async function resetAppleSignIn(authorizationCode: string | null): Promise<string> {
  if (!authorizationCode) return RESET_FAILED;
  const { error } = await supabase.functions.invoke('reset-apple-sign-in', {
    body: { authorizationCode },
  });
  return error ? RESET_FAILED : RESET_STARTED;
}

/**
 * A fresh `authorizationCode` for `delete-account`, which trades it with Apple for the token it
 * revokes. Apple's sheet again, with no scopes: no Supabase call, and nothing to save. A cancel is
 * its own result, so that the caller can leave everything as it was.
 */
export async function reauthorizeWithApple(): Promise<
  { code: string } | { cancelled: true } | { error: string }
> {
  let credential: AppleAuthenticationCredential;
  try {
    credential = await signInAsync({ requestedScopes: [] });
  } catch (error) {
    if (isCancel(error)) return { cancelled: true };
    return { error: (error as Error).message };
  }
  if (!credential.authorizationCode) return { error: 'Apple did not return an authorization code' };
  return { code: credential.authorizationCode };
}

/** A cancel is a rejection, not a result (expo-apple-authentication 57.0.2). */
function isCancel(error: unknown): boolean {
  return (error as { code?: string }).code === 'ERR_REQUEST_CANCELED';
}

/**
 * Apple sends the name on the first authorization only, and it is not in the identity token, so
 * GoTrue never sees it. Saved where GoTrue puts Google's claim, `user_metadata.full_name`, which
 * `SetNameScreen` prefills from. A suggestion only: never written to `public.users.name`, and a
 * failure here does not fail the sign-in that already succeeded.
 */
async function saveSuggestedName({ fullName }: AppleAuthenticationCredential) {
  const name = fullName ? formatFullName(fullName).trim() : '';
  if (!name) return;
  await supabase.auth.updateUser({ data: { full_name: name } });
}
