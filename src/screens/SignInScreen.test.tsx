import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform, Pressable, Text } from 'react-native';

import { signInWithGoogle } from '../lib/googleSignIn';
import { supabase } from '../lib/supabase';
import type { SignInScreenProps } from '../navigation/types';
import { SessionProvider, useSession } from '../state/SessionContext';
import { SignInScreen } from './SignInScreen';

/**
 * The real `SessionProvider` is rendered against a mocked `src/lib/supabase.ts`, so these cover
 * the screen and the state machine together — the seam is the client module, not the context.
 *
 * `../lib/googleSignIn` is mocked for the same reason `supabase.ts` is: the native module it wraps
 * has no jest-safe implementation.
 *
 * Note: `render` and `fireEvent` are async in React Native Testing Library 14 and must be awaited.
 */
jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
      signInWithOtp: jest.fn(),
      verifyOtp: jest.fn(),
      signOut: jest.fn(),
    },
  },
}));

jest.mock('../lib/googleSignIn', () => ({ signInWithGoogle: jest.fn() }));

const auth = supabase.auth as unknown as {
  getSession: jest.Mock;
  onAuthStateChange: jest.Mock;
  signInWithOtp: jest.Mock;
  verifyOtp: jest.Mock;
  signOut: jest.Mock;
};

/** Captured so a test can deliver a sign-out the way Supabase would, mirroring `SessionContext.test.tsx`. */
let emitAuthChange: (session: unknown) => void;

const originalOS = Platform.OS;

/** `Platform.OS` is a plain property on RN's module object; assigning through defineProperty keeps
 * TypeScript out of the way of what is, at runtime, a mutable field. Same pattern as
 * `supabaseTarget.test.ts`. */
function runningOn(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
}

beforeEach(() => {
  jest.clearAllMocks();

  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.onAuthStateChange.mockImplementation((callback: (event: string, session: unknown) => void) => {
    emitAuthChange = (session) => callback('SIGNED_IN', session);
    return { data: { subscription: { unsubscribe: jest.fn() } } };
  });
  auth.signOut.mockResolvedValue({ error: null });
  auth.signInWithOtp.mockResolvedValue({ error: null });
  auth.verifyOtp.mockResolvedValue({ error: null });
  jest.mocked(signInWithGoogle).mockResolvedValue({ error: null });
});

afterEach(() => {
  runningOn(originalOS);
});

async function renderScreen() {
  const navigation = { navigate: jest.fn(), setOptions: jest.fn() };

  await render(
    <SessionProvider>
      <SignInScreen {...({ navigation } as unknown as SignInScreenProps)} />
    </SessionProvider>
  );

  return { navigation };
}

/** Fills the email field and requests a code, leaving the screen on the code phase. */
async function requestCode(email = 'shopper@example.com') {
  await fireEvent.changeText(screen.getByLabelText('Email address'), email);
  await fireEvent.press(screen.getByLabelText('Send code'));
  await screen.findByLabelText('Six-digit code');
}

/**
 * Stands in for a write that got refused for a revoked session, which calls `signOut('revoked')`
 * from outside this screen (`useOutbox`, `SharingScreen`) — nothing on `SignInScreen` itself can
 * trigger it, so a probe rendered alongside it drives the same context method a real caller would.
 */
function ForceRevokedSignOut() {
  const { signOut } = useSession();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="force revoked sign-out"
      onPress={() => void signOut('revoked')}>
      <Text>force</Text>
    </Pressable>
  );
}

it('will not send a code without an email address', async () => {
  await renderScreen();

  expect(screen.getByLabelText('Send code')).toBeDisabled();

  await fireEvent.press(screen.getByLabelText('Send code'));

  expect(auth.signInWithOtp).not.toHaveBeenCalled();
});

it('requests a code and moves to the code phase', async () => {
  await renderScreen();

  await requestCode();

  expect(auth.signInWithOtp).toHaveBeenCalledWith({
    email: 'shopper@example.com',
    options: { shouldCreateUser: true },
  });
  expect(screen.getByText('Check your email')).toBeOnTheScreen();
});

it('stays on the email phase and shows why when the request fails', async () => {
  auth.signInWithOtp.mockResolvedValue({ error: { message: 'Email rate limit exceeded' } });

  await renderScreen();
  await fireEvent.changeText(screen.getByLabelText('Email address'), 'shopper@example.com');
  await fireEvent.press(screen.getByLabelText('Send code'));

  expect(await screen.findByText('Email rate limit exceeded')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Six-digit code')).not.toBeOnTheScreen();
});

it('will not submit a code shorter than six digits', async () => {
  await renderScreen();
  await requestCode();

  await fireEvent.changeText(screen.getByLabelText('Six-digit code'), '123');

  expect(screen.getByLabelText('Sign in')).toBeDisabled();
});

it('verifies a six-digit code as an email OTP', async () => {
  await renderScreen();
  await requestCode();

  await fireEvent.changeText(screen.getByLabelText('Six-digit code'), '123456');
  await fireEvent.press(screen.getByLabelText('Sign in'));

  expect(auth.verifyOtp).toHaveBeenCalledWith({
    email: 'shopper@example.com',
    token: '123456',
    type: 'email',
  });
});

it('clears the code and shows why when it is rejected', async () => {
  auth.verifyOtp.mockResolvedValue({ error: { message: 'Token has expired or is invalid' } });

  await renderScreen();
  await requestCode();

  await fireEvent.changeText(screen.getByLabelText('Six-digit code'), '000000');
  await fireEvent.press(screen.getByLabelText('Sign in'));

  expect(await screen.findByText('Token has expired or is invalid')).toBeOnTheScreen();
  expect(screen.getByLabelText('Six-digit code')).toHaveDisplayValue('');
});

it('offers a cooldown before the code can be resent', async () => {
  await renderScreen();
  await requestCode();

  expect(screen.getByLabelText('Resend code')).toBeDisabled();
  expect(screen.getByText('Resend code in 60s')).toBeOnTheScreen();
});

it('goes back to the email phase to use a different address', async () => {
  await renderScreen();
  await requestCode();

  await fireEvent.press(screen.getByLabelText('Use a different email'));

  expect(screen.getByLabelText('Email address')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Six-digit code')).not.toBeOnTheScreen();
});

/** Web is permanently out of scope for this feature — email OTP stays the only door there. */
it('hides the Google button on web', async () => {
  runningOn('web');

  await renderScreen();

  expect(screen.queryByLabelText('Continue with Google')).not.toBeOnTheScreen();
});

it('offers the Google button on native platforms', async () => {
  await renderScreen();

  expect(screen.getByLabelText('Continue with Google')).toBeOnTheScreen();
});

it('starts native Google sign-in when its button is pressed', async () => {
  await renderScreen();

  await fireEvent.press(screen.getByLabelText('Continue with Google'));

  expect(signInWithGoogle).toHaveBeenCalledTimes(1);
});

it('shows why Google sign-in failed', async () => {
  jest.mocked(signInWithGoogle).mockResolvedValue({ error: 'Bad ID token' });

  await renderScreen();
  await fireEvent.press(screen.getByLabelText('Continue with Google'));

  expect(await screen.findByText('Bad ID token')).toBeOnTheScreen();
});

/**
 * The whole point of carrying a reason through `SessionContext`: a device that lands here because
 * `session_still_valid()` refused a write should say so, rather than looking like an ordinary,
 * unexplained sign-out.
 */
it('shows why when reached after a write refused for a revoked session', async () => {
  const navigation = { navigate: jest.fn(), setOptions: jest.fn() };

  await render(
    <SessionProvider>
      <ForceRevokedSignOut />
      <SignInScreen {...({ navigation } as unknown as SignInScreenProps)} />
    </SessionProvider>
  );
  await screen.findByLabelText('Email address');

  await fireEvent.press(screen.getByLabelText('force revoked sign-out'));
  await act(async () => emitAuthChange(null));

  expect(await screen.findByText('You were signed out on another device.')).toBeOnTheScreen();
});

/** An ordinary visit to the sign-in screen — nothing was ever revoked — shows no such line. */
it('shows no reason on an ordinary visit', async () => {
  await renderScreen();

  expect(screen.queryByText(/signed out on another device/)).not.toBeOnTheScreen();
});
