import { GoogleSignin } from '@react-native-google-signin/google-signin';

import { signInWithGoogle } from './googleSignIn';
import { supabase } from './supabase';

/**
 * Both seams below the module under test are mocked, same shape as `listsChannel.test.ts`: the
 * native library (so no Play-Services/iOS sheet ever opens under jest) and `./supabase`.
 */
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: { configure: jest.fn(), hasPlayServices: jest.fn(), signIn: jest.fn() },
}));
jest.mock('./supabase', () => ({ supabase: { auth: { signInWithIdToken: jest.fn() } } }));

const signIn = jest.mocked(GoogleSignin.signIn);
const signInWithIdToken = jest.mocked(supabase.auth.signInWithIdToken);

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(GoogleSignin.hasPlayServices).mockResolvedValue(true);
});

it('exchanges the returned ID token for a Supabase session', async () => {
  signIn.mockResolvedValue({ type: 'success', data: { idToken: 'a-real-token' } } as never);
  signInWithIdToken.mockResolvedValue({ error: null } as never);

  const result = await signInWithGoogle();

  expect(signInWithIdToken).toHaveBeenCalledWith({ provider: 'google', token: 'a-real-token' });
  expect(result).toEqual({ error: null });
});

it('treats a cancelled sheet as no failure, and calls Supabase for nothing', async () => {
  signIn.mockResolvedValue({ type: 'cancelled', data: null } as never);

  const result = await signInWithGoogle();

  expect(signInWithIdToken).not.toHaveBeenCalled();
  expect(result).toEqual({ error: null });
});

it('surfaces a missing ID token as an error instead of calling Supabase with nothing', async () => {
  signIn.mockResolvedValue({ type: 'success', data: { idToken: null } } as never);

  const result = await signInWithGoogle();

  expect(signInWithIdToken).not.toHaveBeenCalled();
  expect(result).toEqual({ error: 'Sign-in did not return an identity token' });
});

it('surfaces the message Supabase rejects the token with', async () => {
  signIn.mockResolvedValue({ type: 'success', data: { idToken: 'a-real-token' } } as never);
  signInWithIdToken.mockResolvedValue({ error: { message: 'Bad ID token' } } as never);

  const result = await signInWithGoogle();

  expect(result).toEqual({ error: 'Bad ID token' });
});
