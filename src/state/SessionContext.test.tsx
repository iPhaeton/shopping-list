import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { signInWithGoogle } from '../lib/googleSignIn';
import { supabase } from '../lib/supabase';
import { SessionProvider, useSession } from './SessionContext';

/**
 * `src/lib/supabase.ts` is mocked at the module boundary — which is why the client lives in its
 * own file rather than inline in the provider. `@supabase/supabase-js` is never loaded here, so
 * jest's `transformIgnorePatterns` needs no entry for it.
 *
 * `../lib/googleSignIn` is mocked the same way, and for the same reason: the native module it wraps
 * has no jest-safe implementation, so the real file must never load here.
 *
 * Note: `render`, `fireEvent` and `unmount` are async in React Native Testing Library 14 and must
 * be awaited. A transition pushed in from outside React — `emitAuthChange` below — additionally
 * needs wrapping in `act`, since nothing RNTL owns triggered it.
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

const unsubscribe = jest.fn();

/** Captured so a test can drive an auth transition the way Supabase would. */
let emitAuthChange: (session: unknown) => void;

beforeEach(() => {
  jest.clearAllMocks();

  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.onAuthStateChange.mockImplementation((callback: (event: string, session: unknown) => void) => {
    emitAuthChange = (session) => callback('SIGNED_IN', session);
    return { data: { subscription: { unsubscribe } } };
  });
  auth.signOut.mockResolvedValue({ error: null });
});

function Probe() {
  const { state, signOut, signOutEverywhere, signInWithGoogle } = useSession();

  return (
    <>
      <Text>{`status: ${state.status}`}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        onPress={() => {
          void signOut();
        }}>
        <Text>Sign out</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign out everywhere"
        onPress={() => {
          void signOutEverywhere();
        }}>
        <Text>Sign out everywhere</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Continue with Google"
        onPress={() => {
          void signInWithGoogle();
        }}>
        <Text>Continue with Google</Text>
      </Pressable>
    </>
  );
}

async function renderProbe() {
  await render(
    <SessionProvider>
      <Probe />
    </SessionProvider>
  );
}

it('settles on signedOut when no session was stored', async () => {
  await renderProbe();

  expect(await screen.findByText('status: signedOut')).toBeOnTheScreen();
});

it('restores a stored session', async () => {
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });

  await renderProbe();

  expect(await screen.findByText('status: signedIn')).toBeOnTheScreen();
});

it('follows Supabase auth transitions', async () => {
  await renderProbe();
  await screen.findByText('status: signedOut');

  await act(async () => emitAuthChange({ user: { id: 'u1' } }));

  expect(await screen.findByText('status: signedIn')).toBeOnTheScreen();
});

/**
 * The scope is the point of this assertion, not an incidental argument. supabase-js defaults to
 * `'global'`, which would revoke every device the account is signed in on; a bare
 * `toHaveBeenCalled()` would pass just as happily against that default.
 */
it('signs out this device only', async () => {
  await renderProbe();
  await screen.findByText('status: signedOut');

  await fireEvent.press(screen.getByLabelText('Sign out'));

  expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
});

/**
 * The confirmed action's scope is the point, mirroring the test above for the plain button.
 */
it('signs out every device on the confirmed action', async () => {
  await renderProbe();
  await screen.findByText('status: signedOut');

  await fireEvent.press(screen.getByLabelText('Sign out everywhere'));

  expect(auth.signOut).toHaveBeenCalledWith({ scope: 'global' });
});

/** `signInWithGoogle` is a plain delegate to `../lib/googleSignIn` — the module boundary does the
 * actual work, so this just checks the wiring holds. */
it('delegates Google sign-in to the lib module', async () => {
  jest.mocked(signInWithGoogle).mockResolvedValue({ error: null });

  await renderProbe();
  await screen.findByText('status: signedOut');

  await fireEvent.press(screen.getByLabelText('Continue with Google'));

  expect(signInWithGoogle).toHaveBeenCalledTimes(1);
});

it('unsubscribes from auth changes on unmount', async () => {
  await renderProbe();
  await screen.findByText('status: signedOut');

  await screen.unmount();

  expect(unsubscribe).toHaveBeenCalled();
});
