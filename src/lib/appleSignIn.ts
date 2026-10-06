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
    // A cancel is a rejection, not a result (expo-apple-authentication 57.0.2).
    if ((error as { code?: string }).code === 'ERR_REQUEST_CANCELED') return { error: null };
    return { error: (error as Error).message };
  }

  const { identityToken } = credential;
  if (!identityToken) return { error: 'Sign-in did not return an identity token' };

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: identityToken,
    nonce: rawNonce,
  });
  if (error) return { error: error.message };

  await saveSuggestedName(credential);
  return { error: null };
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
