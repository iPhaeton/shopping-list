import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { signInWithGoogle } from '../lib/googleSignIn';
import { fetchProfile, setName as setNameApi } from '../lib/profileApi';
import { writeCachedName } from '../lib/nameCache';
import { supabase } from '../lib/supabase';
import { SessionProvider, useSession } from './SessionContext';

/**
 * `src/lib/supabase.ts` is mocked at the module boundary — which is why the client lives in its
 * own file rather than inline in the provider. `@supabase/supabase-js` is never loaded here, so
 * jest's `transformIgnorePatterns` needs no entry for it.
 *
 * `../lib/googleSignIn` is mocked the same way, and for the same reason: the native module it wraps
 * has no jest-safe implementation, so the real file must never load here. `../lib/profileApi` is
 * mocked so the name-gate machinery can be driven without a real fetch — its default in `beforeEach`
 * resolves a name, so every existing `status: signedIn` assertion still holds at steady state; an
 * intermediate `nameRequired` tick along the way is invisible to `findByText`'s polling.
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
jest.mock('../lib/profileApi', () => ({ fetchProfile: jest.fn(), setName: jest.fn() }));

const auth = supabase.auth as unknown as {
  getSession: jest.Mock;
  onAuthStateChange: jest.Mock;
  signInWithOtp: jest.Mock;
  verifyOtp: jest.Mock;
  signOut: jest.Mock;
};

const unsubscribe = jest.fn();

/** Captured so a test can drive an auth transition the way Supabase would. `event` defaults to the
 * ordinary live sign-in case; the restore-broadcast race (`_recoverAndRefresh` also firing
 * `'SIGNED_IN'`) is exercised through `getSession` instead, not through this. */
let emitAuthChange: (session: unknown, event?: string) => void;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();

  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.onAuthStateChange.mockImplementation((callback: (event: string, session: unknown) => void) => {
    emitAuthChange = (session, event = 'SIGNED_IN') => callback(event, session);
    return { data: { subscription: { unsubscribe } } };
  });
  auth.signOut.mockResolvedValue({ error: null });
  jest.mocked(fetchProfile).mockResolvedValue({ name: 'Alice', error: null });
  jest.mocked(setNameApi).mockResolvedValue({ error: null, verdict: 'ok' });
});

function Probe() {
  const { state, signOut, signOutEverywhere, signInWithGoogle, setName, retryName } = useSession();
  const reason = state.status === 'signedOut' && state.reason ? `, reason: ${state.reason}` : '';
  const nameInfo =
    state.status === 'signedIn'
      ? `name: ${state.name ?? 'unconfirmed'}`
      : state.status === 'nameRequired'
        ? `name: required (confirmed: ${state.confirmed})`
        : '';

  return (
    <>
      <Text>{`status: ${state.status}${reason}`}</Text>
      <Text>{nameInfo}</Text>
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
        accessibilityLabel="Sign out (revoked)"
        onPress={() => {
          void signOut('revoked');
        }}>
        <Text>Sign out (revoked)</Text>
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Set name"
        onPress={() => {
          void setName('Alice');
        }}>
        <Text>Set name</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Retry name" onPress={retryName}>
        <Text>Retry name</Text>
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
 * `onAuthStateChange`'s listener only ever sees the resulting session, never why it changed, so the
 * reason is bridged across via a ref set just before `supabase.auth.signOut` is called and read back
 * once the listener fires — this is what lets `SignInScreen` say why it was reached.
 */
it('carries a revoked reason through to the next auth transition', async () => {
  await renderProbe();
  await screen.findByText('status: signedOut');

  await fireEvent.press(screen.getByLabelText('Sign out (revoked)'));
  await act(async () => emitAuthChange(null));

  expect(await screen.findByText('status: signedOut, reason: revoked')).toBeOnTheScreen();
});

/** An ordinary sign-out must never be mistaken for a kicked device. */
it('carries no reason for an ordinary sign-out', async () => {
  await renderProbe();
  await screen.findByText('status: signedOut');

  await fireEvent.press(screen.getByLabelText('Sign out'));
  await act(async () => emitAuthChange(null));

  expect(await screen.findByText('status: signedOut')).toBeOnTheScreen();
  expect(screen.queryByText(/reason:/)).not.toBeOnTheScreen();
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

describe('the name gate', () => {
  /**
   * Regression test for a real bug: a restored session used to flip to `signedIn` synchronously,
   * before either the cache or a fetch had actually said a name existed — "assume set" was meant as
   * a *failure* fallback, but was being applied to the merely-*pending* case too. A brand new account
   * that had never set a name would flash the full app (and mount `ListsProvider`, start fetching
   * lists) on every reopen, before correcting to the gate a tick later. Catching the eventual state
   * alone (as the tests below do) can't see this — the bug was in what showed up *before* that.
   */
  it('never shows the full app for a restored session before a cache or fetch backs it up', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    let settle: (value: { name: string | null; error: string | null }) => void = () => {};
    jest.mocked(fetchProfile).mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      })
    );

    await renderProbe();

    // Still resolving (nothing cached, the fetch is deliberately held open) — neither the full app
    // nor the gate may show yet.
    expect(screen.getByText('status: loading')).toBeOnTheScreen();
    expect(screen.queryByText('status: signedIn')).not.toBeOnTheScreen();
    expect(screen.queryByText('status: nameRequired')).not.toBeOnTheScreen();

    await act(async () => settle({ name: null, error: null }));

    expect(await screen.findByText('status: nameRequired')).toBeOnTheScreen();
    expect(screen.queryByText('status: signedIn')).not.toBeOnTheScreen();
  });

  it('never gates a returning user, even when nothing is cached and the confirming fetch fails', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    jest.mocked(fetchProfile).mockResolvedValue({ name: null, error: 'offline' });

    await renderProbe();

    expect(await screen.findByText('status: signedIn')).toBeOnTheScreen();
    expect(screen.queryByText('status: nameRequired')).not.toBeOnTheScreen();
  });

  it("shows a returning user's cached name immediately, without waiting on the fetch", async () => {
    await writeCachedName('u1', 'Cached Carl');
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    jest.mocked(fetchProfile).mockReturnValue(
      new Promise<{ name: string | null; error: string | null }>(() => {}) // never resolves
    );

    await renderProbe();

    expect(await screen.findByText('name: Cached Carl')).toBeOnTheScreen();
  });

  it('gates a returning user once a fetch actually confirms there is no name', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    jest.mocked(fetchProfile).mockResolvedValue({ name: null, error: null });

    await renderProbe();

    expect(await screen.findByText('name: required (confirmed: true)')).toBeOnTheScreen();
  });

  it('gates a live sign-in when the confirming fetch fails right after it', async () => {
    jest.mocked(fetchProfile).mockResolvedValue({ name: null, error: 'offline' });

    await renderProbe();
    await screen.findByText('status: signedOut');

    await act(async () => emitAuthChange({ user: { id: 'u1' } }));

    expect(await screen.findByText('name: required (confirmed: false)')).toBeOnTheScreen();
  });

  it('does not gate a live sign-in when the confirming fetch succeeds', async () => {
    await renderProbe();
    await screen.findByText('status: signedOut');

    await act(async () => emitAuthChange({ user: { id: 'u1' } }));

    expect(await screen.findByText('name: Alice')).toBeOnTheScreen();
  });

  it('moves a gated account to signedIn once a name is set', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    jest.mocked(fetchProfile).mockResolvedValue({ name: null, error: null });

    await renderProbe();
    await screen.findByText('name: required (confirmed: true)');

    jest.mocked(setNameApi).mockResolvedValue({ error: null, verdict: 'ok' });
    await fireEvent.press(screen.getByLabelText('Set name'));

    expect(await screen.findByText('status: signedIn')).toBeOnTheScreen();
    expect(await screen.findByText('name: Alice')).toBeOnTheScreen();
  });

  it('retryName re-fetches once for an unconfirmed gate and can clear it', async () => {
    jest.mocked(fetchProfile).mockResolvedValueOnce({ name: null, error: 'offline' });

    await renderProbe();
    await screen.findByText('status: signedOut');
    await act(async () => emitAuthChange({ user: { id: 'u1' } }));
    await screen.findByText('name: required (confirmed: false)');

    jest.mocked(fetchProfile).mockResolvedValue({ name: 'Alice', error: null });
    await fireEvent.press(screen.getByLabelText('Retry name'));

    expect(await screen.findByText('name: Alice')).toBeOnTheScreen();
  });
});
