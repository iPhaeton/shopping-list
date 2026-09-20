import { fireEvent, render, screen } from '@testing-library/react-native';

import { supabase } from '../lib/supabase';
import type { AccountScreenProps } from '../navigation/types';
import { SessionProvider } from '../state/SessionContext';
import { AccountScreen } from './AccountScreen';

/**
 * Mocked the same way as `SessionContext.test.tsx`: Account-screen actions go through
 * `SessionContext`, not `ListsContext`, so there is nothing here to fetch or subscribe to.
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

const auth = supabase.auth as unknown as {
  getSession: jest.Mock;
  onAuthStateChange: jest.Mock;
  signOut: jest.Mock;
};

const props = { navigation: {}, route: {} } as unknown as AccountScreenProps;

beforeEach(() => {
  jest.clearAllMocks();

  auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  auth.signOut.mockResolvedValue({ error: null });
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
