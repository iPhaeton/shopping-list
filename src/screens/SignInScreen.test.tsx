import { fireEvent, render, screen } from '@testing-library/react-native';

import { supabase } from '../lib/supabase';
import type { SignInScreenProps } from '../navigation/types';
import { SessionProvider } from '../state/SessionContext';
import { SignInScreen } from './SignInScreen';

/**
 * The real `SessionProvider` is rendered against a mocked `src/lib/supabase.ts`, so these cover
 * the screen and the state machine together — the seam is the client module, not the context.
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

const auth = supabase.auth as unknown as {
  getSession: jest.Mock;
  onAuthStateChange: jest.Mock;
  signInWithOtp: jest.Mock;
  verifyOtp: jest.Mock;
  signOut: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();

  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  auth.signInWithOtp.mockResolvedValue({ error: null });
  auth.verifyOtp.mockResolvedValue({ error: null });
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
