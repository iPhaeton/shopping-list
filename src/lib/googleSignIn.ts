import { GoogleSignin } from '@react-native-google-signin/google-signin';

import { supabase } from './supabase';

export type Result = { error: string | null };

/**
 * `configure` fires once, at import time, and is never awaited here — `GoogleSignin.signIn()`
 * internally awaits the promise this kicks off, so nothing else needs to wait on it.
 *
 * `webClientId` is the "Web application" OAuth client from Google Cloud console, used on *both*
 * platforms as the audience GoTrue checks the ID token against — not an Android-specific id, per
 * Supabase's own native-sign-in guide.
 *
 * `iosClientId` is required on top of that on iOS specifically: found by actually running this on
 * the simulator, not from any doc. With no `GoogleService-Info.plist` (this project has no
 * Firebase), the native iOS side refuses to `configure()` at all without it — `webClientId` alone,
 * sufficient as it is for the token audience, does not satisfy iOS's own client-id requirement.
 */
GoogleSignin.configure({
  webClientId: '857897394234-sgkdm3k7p7qd5feo1vmetchp3hjkavsu.apps.googleusercontent.com',
  iosClientId: '857897394234-7k91redv8k4nfiqbm40m2ln2333btlli.apps.googleusercontent.com',
});

/**
 * The whole native round trip: the Play-Services/iOS sheet, then handing the ID token it returns to
 * Supabase. Success is reported through `onAuthStateChange`, which `SessionProvider` already owns —
 * nothing here sets any state directly. The returned `Result` only ever carries failure; a
 * cancelled sheet is not one.
 *
 * No nonce is generated or passed anywhere in this file. GoTrue's `signInWithIdToken` normally wants
 * a SHA-256 digest of a client nonce echoed in the Google ID token, but the installed
 * `@react-native-google-signin/google-signin` is the free "Original" module — its `signIn()` options
 * carry only `loginHint`, no nonce parameter at all; wiring a nonce through is a paid feature of that
 * library's premium fork. With no way to produce a matching pair, `supabase/config.toml` turns the
 * check off (`skip_nonce_check = true`) instead of this file pretending to satisfy it.
 */
export async function signInWithGoogle(): Promise<Result> {
  await GoogleSignin.hasPlayServices(); // no-op on iOS, required check on Android
  const result = await GoogleSignin.signIn();
  if (result.type === 'cancelled') return { error: null };

  const idToken = result.data?.idToken;
  if (!idToken) return { error: 'Sign-in did not return an identity token' };

  const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
  return { error: error?.message ?? null };
}
