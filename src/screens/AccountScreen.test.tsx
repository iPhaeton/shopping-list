import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Platform, Share } from 'react-native';

import { reauthorizeWithApple } from '../lib/appleSignIn';
import { deviceTimeZone } from '../lib/deviceTimeZone';
import {
  deleteAccount as deleteAccountApi,
  deleteAccountWithApple,
  fetchProfile,
  setName as setNameApi,
} from '../lib/profileApi';
import { supabase } from '../lib/supabase';
import type { AccountScreenProps } from '../navigation/types';
import { SessionProvider } from '../state/SessionContext';
import { ThemeProvider } from '../state/ThemeContext';
import { day, night } from '../theme';
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

/** `SessionProvider` imports these unconditionally; unmocked, Google's crashes under Jest reaching
 *  for a native module that isn't registered in this environment, and Apple's reaches for the real
 *  Supabase client. */
jest.mock('../lib/googleSignIn', () => ({ signInWithGoogle: jest.fn() }));
jest.mock('../lib/appleSignIn', () => ({
  signInWithApple: jest.fn(),
  reauthorizeWithApple: jest.fn(),
}));

/** `SessionProvider` also resolves the account's name on every sign-in now; unmocked, the real
 * module reaches for the real Supabase client. A non-null default keeps `state.status` at
 * `signedIn` throughout — this screen renders nothing while it is `nameRequired`. */
jest.mock('../lib/profileApi', () => ({
  fetchProfile: jest.fn(),
  setName: jest.fn(),
  deleteAccount: jest.fn(),
  deleteAccountWithApple: jest.fn(),
}));

/** Auto reads the zone to find a sunset; pinned so the appearance tests never see the real one. */
jest.mock('../lib/deviceTimeZone', () => ({ deviceTimeZone: jest.fn() }));

const auth = supabase.auth as unknown as {
  getSession: jest.Mock;
  onAuthStateChange: jest.Mock;
  signOut: jest.Mock;
};

const navigation = { goBack: jest.fn() };
const props = { navigation, route: {} } as unknown as AccountScreenProps;

beforeEach(() => {
  jest.clearAllMocks();

  auth.getSession.mockResolvedValue({
    data: { session: { user: { id: 'u1', email: 'alice@example.com' } } },
  });
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  auth.signOut.mockResolvedValue({ error: null });
  jest.mocked(fetchProfile).mockResolvedValue({ name: 'Alice', error: null });
  jest.mocked(setNameApi).mockResolvedValue({ error: null, verdict: 'ok' });
  jest.mocked(deleteAccountApi).mockResolvedValue({ error: null, verdict: 'ok' });
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

it('goes back through its own drawn Back button', async () => {
  await renderScreen();

  await fireEvent.press(screen.getByLabelText('Back'));

  expect(navigation.goBack).toHaveBeenCalled();
  expect(screen.getByRole('header', { name: 'Account' })).toBeOnTheScreen();
});

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

describe('deleting the account', () => {
  /** Task 25 step 1's copy, verbatim. */
  const WARNING =
    "Deleting your account can't be undone. Lists you're the only owner of will be deleted, " +
    'including for anyone you shared them with. Lists that have another owner will stay with ' +
    'their members.';

  async function openConfirm() {
    await fireEvent.press(screen.getByLabelText('Delete account'));
    await screen.findByLabelText('Confirm delete account');
  }

  it('opens a confirm with the warning, in place of the control', async () => {
    await renderScreen();

    expect(screen.queryByText(WARNING)).toBeNull();
    await openConfirm();

    expect(screen.getByText(WARNING)).toBeOnTheScreen();
    expect(screen.getByLabelText('Cancel deleting account')).toHaveTextContent('Cancel');
    expect(screen.getByLabelText('Confirm delete account')).toHaveTextContent(
      'Yes, delete my account'
    );
    expect(screen.queryByLabelText('Delete account')).toBeNull();
    expect(deleteAccountApi).not.toHaveBeenCalled();
  });

  it('cancels without deleting', async () => {
    await renderScreen();
    await openConfirm();

    await fireEvent.press(screen.getByLabelText('Cancel deleting account'));

    expect(screen.queryByText(WARNING)).toBeNull();
    expect(screen.getByLabelText('Delete account')).toBeOnTheScreen();
    expect(deleteAccountApi).not.toHaveBeenCalled();
  });

  it('deletes once confirmed, then signs this device out', async () => {
    await renderScreen();
    await openConfirm();

    await fireEvent.press(screen.getByLabelText('Confirm delete account'));

    await waitFor(() => expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' }));
    expect(deleteAccountApi).toHaveBeenCalledTimes(1);
  });

  it('says it is deleting, and cannot be cancelled, while the request runs', async () => {
    jest.mocked(deleteAccountApi).mockReturnValue(new Promise(() => {}));

    await renderScreen();
    await openConfirm();
    await fireEvent.press(screen.getByLabelText('Confirm delete account'));

    expect(screen.getByLabelText('Confirm delete account')).toHaveTextContent('Deleting…');
    expect(screen.getByLabelText('Confirm delete account')).toBeDisabled();
    expect(screen.getByLabelText('Cancel deleting account')).toBeDisabled();
    // Nothing else may end the session under it.
    expect(screen.getByLabelText('Sign out')).toBeDisabled();
    expect(screen.getByLabelText('Sign out of all devices')).toBeDisabled();
  });

  it('says it needs a connection when offline, and closes the confirm', async () => {
    jest
      .mocked(deleteAccountApi)
      .mockResolvedValue({ error: 'TypeError: Failed to fetch', verdict: 'retryable' });

    await renderScreen();
    await openConfirm();
    await fireEvent.press(screen.getByLabelText('Confirm delete account'));

    expect(
      await screen.findByText('You need a connection to delete your account.')
    ).toBeOnTheScreen();
    expect(screen.queryByText(WARNING)).toBeNull();
    expect(screen.getByLabelText('Delete account')).not.toBeDisabled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("shows any other refusal in the database's own words", async () => {
    jest.mocked(deleteAccountApi).mockResolvedValue({
      error: 'a list must keep at least one owner',
      verdict: 'permanent',
      sessionRevoked: false,
    });

    await renderScreen();
    await openConfirm();
    await fireEvent.press(screen.getByLabelText('Confirm delete account'));

    expect(await screen.findByText('a list must keep at least one owner')).toBeOnTheScreen();
    expect(screen.getByLabelText('Delete account')).not.toBeDisabled();
  });

  it('clears its banner when confirmed again', async () => {
    jest
      .mocked(deleteAccountApi)
      .mockResolvedValueOnce({ error: 'TypeError: Failed to fetch', verdict: 'retryable' })
      .mockReturnValueOnce(new Promise(() => {}));

    await renderScreen();
    await openConfirm();
    await fireEvent.press(screen.getByLabelText('Confirm delete account'));
    await screen.findByText('You need a connection to delete your account.');

    await openConfirm();
    await fireEvent.press(screen.getByLabelText('Confirm delete account'));

    expect(screen.queryByText('You need a connection to delete your account.')).toBeNull();
  });

  it('hands off to sign-out when refused for a revoked session', async () => {
    jest.mocked(deleteAccountApi).mockResolvedValue({
      error: 'this device has been signed out',
      verdict: 'permanent',
      sessionRevoked: true,
    });

    await renderScreen();
    await openConfirm();
    await fireEvent.press(screen.getByLabelText('Confirm delete account'));

    await waitFor(() => expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' }));
    expect(screen.queryByText('this device has been signed out')).toBeNull();
  });

  /** On iOS an Apple-linked account is deleted through Apple's sheet and `delete-account`. */
  describe('linked to Apple', () => {
    const originalOS = Platform.OS;

    function runningOn(os: typeof Platform.OS) {
      Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
    }

    beforeEach(() => {
      runningOn('ios');
      auth.getSession.mockResolvedValue({
        data: {
          session: {
            user: { id: 'u1', email: 'alice@example.com', app_metadata: { providers: ['apple'] } },
          },
        },
      });
      jest.mocked(reauthorizeWithApple).mockResolvedValue({ code: 'apple-code' });
    });

    afterEach(() => runningOn(originalOS));

    it("keeps the confirm open, with no banner, when Apple's sheet is cancelled", async () => {
      jest.mocked(reauthorizeWithApple).mockResolvedValue({ cancelled: true });

      await renderScreen();
      await openConfirm();
      await fireEvent.press(screen.getByLabelText('Confirm delete account'));

      await waitFor(() =>
        expect(screen.getByLabelText('Confirm delete account')).toHaveTextContent(
          'Yes, delete my account'
        )
      );
      expect(screen.getByText(WARNING)).toBeOnTheScreen();
      expect(screen.getByLabelText('Confirm delete account')).not.toBeDisabled();
      expect(screen.getByLabelText('Cancel deleting account')).not.toBeDisabled();
      expect(screen.getByLabelText('Sign out')).not.toBeDisabled();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(deleteAccountWithApple).not.toHaveBeenCalled();
      expect(auth.signOut).not.toHaveBeenCalled();
    });

    /** `supabase/functions/_shared/apple.ts`' sentences, which reach the banner as they are. */
    it.each([
      "This account doesn't sign in with Apple.",
      "Apple didn't confirm it's you. Try again.",
      "That Apple ID isn't the one this account signs in with.",
      "Apple couldn't be reached. Try again in a minute.",
    ])('shows "%s" verbatim', async (message) => {
      jest
        .mocked(deleteAccountWithApple)
        .mockResolvedValue({ error: message, verdict: 'permanent', sessionRevoked: false });

      await renderScreen();
      await openConfirm();
      await fireEvent.press(screen.getByLabelText('Confirm delete account'));

      expect(await screen.findByText(message)).toBeOnTheScreen();
      expect(deleteAccountWithApple).toHaveBeenCalledWith('apple-code');
      expect(screen.getByLabelText('Delete account')).not.toBeDisabled();
    });
  });

  /** Task 25 step 1: the two confirms are never open together. */
  it('closes the sign-out confirm when it opens, and the reverse', async () => {
    await renderScreen();

    await fireEvent.press(screen.getByLabelText('Sign out of all devices'));
    await openConfirm();
    expect(screen.queryByLabelText('Confirm sign out of all devices')).toBeNull();

    await fireEvent.press(screen.getByLabelText('Sign out of all devices'));
    expect(await screen.findByLabelText('Confirm sign out of all devices')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Confirm delete account')).toBeNull();
  });
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

describe('a hidden email', () => {
  const RELAY_SENTENCE =
    'This address hides your real email. On another iPhone, use Sign in with Apple. On Android or ' +
    'the web, sign in with this address, and Apple forwards the code to your inbox.';

  function signedInAs(email: string) {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1', email } } } });
  }

  it('says how to sign in elsewhere, under a relay address', async () => {
    signedInAs('k2x9dqvmp7@privaterelay.appleid.com');

    await renderScreen();

    expect(screen.getByText('k2x9dqvmp7@privaterelay.appleid.com')).toBeOnTheScreen();
    expect(screen.getByText(RELAY_SENTENCE)).toBeOnTheScreen();
    expect(screen.getByLabelText('Share email address')).toBeOnTheScreen();
  });

  it('recognises a relay address written in capitals', async () => {
    signedInAs('K2X9DQVMP7@PrivateRelay.AppleID.com');

    await renderScreen();

    expect(screen.getByText(RELAY_SENTENCE)).toBeOnTheScreen();
  });

  it('says nothing under any other address', async () => {
    await renderScreen();

    expect(screen.queryByText(RELAY_SENTENCE)).not.toBeOnTheScreen();
    expect(screen.queryByLabelText('Share email address')).not.toBeOnTheScreen();
  });

  it('says nothing when the relay domain only appears before the @', async () => {
    signedInAs('privaterelay.appleid.com@example.com');

    await renderScreen();

    expect(screen.queryByText(RELAY_SENTENCE)).not.toBeOnTheScreen();
    expect(screen.queryByLabelText('Share email address')).not.toBeOnTheScreen();
  });

  it('shares the address alone', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    signedInAs('k2x9dqvmp7@privaterelay.appleid.com');

    await renderScreen();
    await fireEvent.press(screen.getByLabelText('Share email address'));

    expect(share).toHaveBeenCalledWith({ message: 'k2x9dqvmp7@privaterelay.appleid.com' });
    share.mockRestore();
  });
});

describe('the appearance picker', () => {
  // Auto is the default, so what these see depends on the clock: noon in Warsaw, sunset at 21:01.
  beforeEach(async () => {
    jest.useFakeTimers({ now: new Date('2026-06-21T12:00:00+02:00') });
    jest.mocked(deviceTimeZone).mockReturnValue('Europe/Warsaw');
    await AsyncStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function renderThemed() {
    await render(
      <ThemeProvider>
        <SessionProvider>
          <AccountScreen {...props} />
        </SessionProvider>
      </ThemeProvider>
    );

    await screen.findByLabelText('Sign out');
  }

  it('offers Day, Night, and Auto, with Auto checked by default', async () => {
    await renderThemed();

    expect(screen.getByLabelText('Auto')).toBeChecked();
    expect(screen.getByLabelText('Day')).not.toBeChecked();
    expect(screen.getByLabelText('Night')).not.toBeChecked();
    expect(screen.getByText('Sign out')).toHaveStyle({ color: day.text });
  });

  it('says under Auto when the next change comes', async () => {
    await renderThemed();

    expect(screen.getByText(/^Night from \d/)).toBeOnTheScreen();
  });

  it('paints night under Auto after sunset, and names the morning', async () => {
    jest.setSystemTime(new Date('2026-06-21T23:30:00+02:00'));

    await renderThemed();

    expect(screen.getByText('Sign out')).toHaveStyle({ color: night.text });
    expect(screen.getByText(/^Day from \d/)).toBeOnTheScreen();
  });

  it('shows the hint only while Auto is chosen', async () => {
    await renderThemed();

    await fireEvent.press(screen.getByLabelText('Day'));
    expect(screen.queryByText(/ from \d/)).toBeNull();

    await fireEvent.press(screen.getByLabelText('Auto'));
    expect(screen.getByLabelText('Auto')).toBeChecked();
    expect(screen.getByText(/^Night from \d/)).toBeOnTheScreen();
  });

  it('switches to Night at once and remembers it on this device', async () => {
    await renderThemed();

    await fireEvent.press(screen.getByLabelText('Night'));

    expect(screen.getByLabelText('Night')).toBeChecked();
    expect(screen.getByLabelText('Day')).not.toBeChecked();
    expect(screen.getByText('Sign out')).toHaveStyle({ color: night.text });
    await waitFor(async () =>
      expect(JSON.parse((await AsyncStorage.getItem('theme-preference')) ?? 'null')).toEqual({
        v: 1,
        preference: 'night',
      })
    );
  });

  it('shows a stored Night choice as checked', async () => {
    await AsyncStorage.setItem('theme-preference', JSON.stringify({ v: 1, preference: 'night' }));

    await renderThemed();

    expect(screen.getByLabelText('Night')).toBeChecked();
    expect(screen.getByText('Sign out')).toHaveStyle({ color: night.text });
    expect(screen.queryByText(/ from \d/)).toBeNull();
  });
});
