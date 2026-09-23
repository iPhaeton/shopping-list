import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { fetchProfile, setName as setNameApi } from '../lib/profileApi';
import { supabase } from '../lib/supabase';
import type { AccountScreenProps } from '../navigation/types';
import { SessionProvider } from '../state/SessionContext';
import { AccountScreen } from './AccountScreen';

/**
 * Mocked the same way as `SessionContext.test.tsx`: Account-screen actions go through
 * `SessionContext`, not `ListsContext`, so there is nothing here to fetch or subscribe to besides
 * the profile name.
 */
jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
      signOut: jest.fn(),
    },
  },
}));

/** `SessionProvider` imports this unconditionally; unmocked, the real module crashes under Jest
 *  reaching for a native module that isn't registered in this environment. */
jest.mock('../lib/googleSignIn', () => ({ signInWithGoogle: jest.fn() }));

/** `SessionProvider` also resolves the account's name on every sign-in now; unmocked, the real
 * module reaches for the real Supabase client. A non-null default keeps `state.status` at
 * `signedIn` throughout — this screen renders nothing while it is `nameRequired`. */
jest.mock('../lib/profileApi', () => ({ fetchProfile: jest.fn(), setName: jest.fn() }));

const auth = supabase.auth as unknown as {
  getSession: jest.Mock;
  onAuthStateChange: jest.Mock;
  signOut: jest.Mock;
};

const props = { navigation: {}, route: {} } as unknown as AccountScreenProps;

beforeEach(() => {
  jest.clearAllMocks();

  auth.getSession.mockResolvedValue({
    data: { session: { user: { id: 'u1', email: 'alice@example.com' } } },
  });
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  auth.signOut.mockResolvedValue({ error: null });
  jest.mocked(fetchProfile).mockResolvedValue({ name: 'Alice', error: null });
  jest.mocked(setNameApi).mockResolvedValue({ error: null, verdict: 'ok' });
});

async function renderScreen() {
  await render(
    <SessionProvider>
      <AccountScreen {...props} />
    </SessionProvider>
  );

  // Nothing renders until the restored session settles.
  await screen.findByLabelText('Sign out');
}

it('signs out this device only', async () => {
  await renderScreen();

  await fireEvent.press(screen.getByLabelText('Sign out'));

  expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
});

it('reveals a confirm step before signing out every device', async () => {
  await renderScreen();

  expect(screen.queryByLabelText('Confirm sign out of all devices')).toBeNull();

  await fireEvent.press(screen.getByLabelText('Sign out of all devices'));

  expect(await screen.findByLabelText('Confirm sign out of all devices')).toBeOnTheScreen();
  expect(auth.signOut).not.toHaveBeenCalled();
});

it('cancels the confirm step without signing out', async () => {
  await renderScreen();

  await fireEvent.press(screen.getByLabelText('Sign out of all devices'));
  await screen.findByLabelText('Confirm sign out of all devices');
  await fireEvent.press(screen.getByLabelText('Cancel'));

  expect(screen.queryByLabelText('Confirm sign out of all devices')).toBeNull();
  expect(auth.signOut).not.toHaveBeenCalled();
});

it('signs out every device once confirmed', async () => {
  await renderScreen();

  await fireEvent.press(screen.getByLabelText('Sign out of all devices'));
  await fireEvent.press(await screen.findByLabelText('Confirm sign out of all devices'));

  expect(auth.signOut).toHaveBeenCalledWith({ scope: 'global' });
});

it('shows a refusal and re-enables the plain sign out button', async () => {
  auth.signOut.mockResolvedValue({ error: { message: 'Network request failed' } });

  await renderScreen();
  await fireEvent.press(screen.getByLabelText('Sign out'));

  expect(await screen.findByText('Network request failed')).toBeOnTheScreen();
  expect(screen.getByLabelText('Sign out')).not.toBeDisabled();
});

describe('the account row', () => {
  it("shows the account's email", async () => {
    await renderScreen();

    expect(await screen.findByText('alice@example.com')).toBeOnTheScreen();
  });

  it("shows the account's confirmed name", async () => {
    await renderScreen();

    expect(await screen.findByText('Alice')).toBeOnTheScreen();
  });

  it('edits the name and saves it', async () => {
    await renderScreen();
    await screen.findByText('Alice');

    await fireEvent.press(screen.getByLabelText('Edit name'));
    await fireEvent.changeText(screen.getByLabelText('Your name'), 'Alicia');
    await fireEvent.press(screen.getByLabelText('Save name'));

    expect(setNameApi).toHaveBeenCalledWith('Alicia');
    expect(await screen.findByText('Alicia')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Your name')).toBeNull();
  });

  it('disables Save name below 3 trimmed characters', async () => {
    await renderScreen();
    await screen.findByText('Alice');

    await fireEvent.press(screen.getByLabelText('Edit name'));
    await fireEvent.changeText(screen.getByLabelText('Your name'), 'Al');

    expect(screen.getByLabelText('Save name')).toBeDisabled();
  });

  it('shows a refusal without leaving edit mode', async () => {
    jest.mocked(setNameApi).mockResolvedValue({
      error: 'that name is taken',
      verdict: 'permanent',
      sessionRevoked: false,
    });

    await renderScreen();
    await screen.findByText('Alice');

    await fireEvent.press(screen.getByLabelText('Edit name'));
    await fireEvent.changeText(screen.getByLabelText('Your name'), 'Bob');
    await fireEvent.press(screen.getByLabelText('Save name'));

    expect(await screen.findByText('that name is taken')).toBeOnTheScreen();
    expect(screen.getByLabelText('Your name')).toBeOnTheScreen();
  });

  it('hands off to sign-out when editing the name is refused for a revoked session', async () => {
    jest.mocked(setNameApi).mockResolvedValue({
      error: 'this device has been signed out',
      verdict: 'permanent',
      sessionRevoked: true,
    });

    await renderScreen();
    await screen.findByText('Alice');

    await fireEvent.press(screen.getByLabelText('Edit name'));
    await fireEvent.changeText(screen.getByLabelText('Your name'), 'Bob');
    await fireEvent.press(screen.getByLabelText('Save name'));

    await waitFor(() => expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' }));
  });
});
