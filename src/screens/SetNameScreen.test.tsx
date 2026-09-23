import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { fetchProfile, setName as setNameApi } from '../lib/profileApi';
import { supabase } from '../lib/supabase';
import type { SetNameScreenProps } from '../navigation/types';
import { SessionProvider, useSession } from '../state/SessionContext';
import { SetNameScreen } from './SetNameScreen';

/** Mocked the same way as `SessionContext.test.tsx` and `AccountScreen.test.tsx`. */
jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
      signOut: jest.fn(),
    },
  },
}));

jest.mock('../lib/googleSignIn', () => ({ signInWithGoogle: jest.fn() }));
jest.mock('../lib/profileApi', () => ({ fetchProfile: jest.fn(), setName: jest.fn() }));

const auth = supabase.auth as unknown as {
  getSession: jest.Mock;
  onAuthStateChange: jest.Mock;
  signOut: jest.Mock;
};

const props = { navigation: {}, route: {} } as unknown as SetNameScreenProps;

/**
 * `RootNavigator` only ever mounts `SetNameScreen` once `state.status === 'nameRequired'` — the
 * route simply isn't in the stack before then. Mounting it unconditionally from a signed-out or
 * still-loading start (as a naive `render(<SetNameScreen />)` would) is a timing this screen never
 * sees in production: its `useState(() => prefillFrom(session))` initializer would capture a `null`
 * session from that too-early first render and never revisit it. This harness reproduces the real
 * mount contract instead of asking the component to defend against a mount that cannot happen.
 */
function GateHarness() {
  const { state } = useSession();
  if (state.status !== 'nameRequired') return null;
  return <SetNameScreen {...props} />;
}

let emitAuthChange: (session: unknown) => void;

beforeEach(() => {
  jest.clearAllMocks();

  auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
  auth.onAuthStateChange.mockImplementation((callback: (event: string, session: unknown) => void) => {
    emitAuthChange = (session) => callback('SIGNED_IN', session);
    return { data: { subscription: { unsubscribe: jest.fn() } } };
  });
  auth.signOut.mockResolvedValue({ error: null });
  // A restored session with a database-confirmed empty name — reaches `nameRequired` with
  // `confirmed: true` directly, the simplest reliable way to land on this screen for most cases.
  jest.mocked(fetchProfile).mockResolvedValue({ name: null, error: null });
  jest.mocked(setNameApi).mockResolvedValue({ error: null, verdict: 'ok' });
});

async function renderScreen() {
  await render(
    <SessionProvider>
      <GateHarness />
    </SessionProvider>
  );

  await screen.findByLabelText('Your name');
}

it('renders the gate once a name is confirmed missing', async () => {
  await renderScreen();

  expect(screen.getByLabelText('Continue')).toBeDisabled();
});

it('disables Continue below 3 trimmed characters', async () => {
  await renderScreen();

  await fireEvent.changeText(screen.getByLabelText('Your name'), 'Al');

  expect(screen.getByLabelText('Continue')).toBeDisabled();
});

it('enables Continue at exactly 3 trimmed characters', async () => {
  await renderScreen();

  await fireEvent.changeText(screen.getByLabelText('Your name'), 'Ali');

  expect(screen.getByLabelText('Continue')).not.toBeDisabled();
});

it("prefills from Google's OAuth name claim when present", async () => {
  auth.getSession.mockResolvedValue({
    data: { session: { user: { id: 'u1', user_metadata: { full_name: 'Googled Gary' } } } },
  });

  await renderScreen();

  expect(screen.getByLabelText('Your name').props.value).toBe('Googled Gary');
  expect(screen.getByLabelText('Continue')).not.toBeDisabled();
});

it('submits whatever was typed, trimming happens one layer down', async () => {
  await renderScreen();

  await fireEvent.changeText(screen.getByLabelText('Your name'), '  Alice  ');
  await fireEvent.press(screen.getByLabelText('Continue'));

  expect(setNameApi).toHaveBeenCalledWith('  Alice  ');
});

it("shows the server's refusal text verbatim", async () => {
  jest.mocked(setNameApi).mockResolvedValue({
    error: 'that name is taken',
    verdict: 'permanent',
    sessionRevoked: false,
  });

  await renderScreen();
  await fireEvent.changeText(screen.getByLabelText('Your name'), 'Alice');
  await fireEvent.press(screen.getByLabelText('Continue'));

  expect(await screen.findByText('that name is taken')).toBeOnTheScreen();
});

it('asks to connect rather than showing a raw retryable failure', async () => {
  jest.mocked(setNameApi).mockResolvedValue({ error: 'Network request failed', verdict: 'retryable' });

  await renderScreen();
  await fireEvent.changeText(screen.getByLabelText('Your name'), 'Alice');
  await fireEvent.press(screen.getByLabelText('Continue'));

  expect(await screen.findByText('You need a connection to set your name.')).toBeOnTheScreen();
});

it('redirects to sign-out on a revoked session', async () => {
  jest.mocked(setNameApi).mockResolvedValue({
    error: 'this device has been signed out',
    verdict: 'permanent',
    sessionRevoked: true,
  });

  await renderScreen();
  await fireEvent.changeText(screen.getByLabelText('Your name'), 'Alice');
  await fireEvent.press(screen.getByLabelText('Continue'));

  await waitFor(() => expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' }));
});

/**
 * The one retry this screen owns: a gate reached `confirmed: false` (a fetch that failed right
 * after a live sign-in, not a database-confirmed empty name) gets one more attempt on mount, before
 * the person has to type anything.
 */
describe('the one-shot retry for an unconfirmed gate', () => {
  it('clears the gate on its own if the retry finds a name', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    jest.mocked(fetchProfile).mockResolvedValueOnce({ name: null, error: 'offline' });

    await render(
      <SessionProvider>
        <GateHarness />
      </SessionProvider>
    );

    jest.mocked(fetchProfile).mockResolvedValue({ name: 'Alice', error: null });
    await act(async () => emitAuthChange({ user: { id: 'u1' } }));

    await waitFor(() => expect(screen.queryByLabelText('Your name')).toBeNull());
  });
});
