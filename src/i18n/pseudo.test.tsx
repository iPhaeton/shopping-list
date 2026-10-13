import AsyncStorage from '@react-native-async-storage/async-storage';
import { i18n, type Messages } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { deviceTimeZone } from '../lib/deviceTimeZone';
import { fetchProfile } from '../lib/profileApi';
import { supabase } from '../lib/supabase';
import { messages as pseudoMessages } from '../locales/pseudo/messages';
import type { AccountScreenProps, SignInScreenProps } from '../navigation/types';
import { AccountScreen } from '../screens/AccountScreen';
import { SignInScreen } from '../screens/SignInScreen';
import { SessionProvider } from '../state/SessionContext';
import { ThemeProvider } from '../state/ThemeContext';

/**
 * Every string these screens show or speak comes from the catalog: under `pseudo` none is left in
 * plain English. Each screen is reached in English and switched in place, as the dev switch does —
 * so the `I18nProvider` here is real, and its re-render is part of what is checked. Sign in and
 * Account are the two with the most copy and no list data; jest-expo renders as iOS, so they include
 * the Apple and Google buttons web never draws.
 *
 * The mocks are the screens' own suites'.
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
jest.mock('../lib/appleSignIn', () => ({
  ...jest.requireActual('../lib/appleSignIn'),
  signInWithApple: jest.fn(),
}));
jest.mock('../lib/deviceTimeZone', () => ({ deviceTimeZone: jest.fn() }));
jest.mock('../lib/profileApi', () => ({
  fetchProfile: jest.fn(),
  setName: jest.fn(),
  deleteAccount: jest.fn(),
  deleteAccountWithApple: jest.fn(),
}));

const auth = supabase.auth as unknown as {
  getSession: jest.Mock;
  onAuthStateChange: jest.Mock;
  signInWithOtp: jest.Mock;
  verifyOtp: jest.Mock;
  signOut: jest.Mock;
};

const RELAY = 'k2x9dqvmp7@privaterelay.appleid.com';
const TYPED = 'alice@example.com';
/**
 * Never translated: what a person typed (D4), and the brand (D13). A clock time keeps the device's
 * own format (D13), `9:01 PM` in Jest's `en-US`.
 */
const UNTRANSLATED = [RELAY, TYPED, 'Alice', 'ShoppingLoop'];
const CLOCK_TIME = /\d{1,2}:\d{2}(\s?[AP]M)?/g;

beforeAll(() => {
  i18n.load('pseudo', pseudoMessages as Messages);
});

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: new Date('2026-06-21T12:00:00+02:00') });
  jest.mocked(deviceTimeZone).mockReturnValue('Europe/Warsaw');
  await AsyncStorage.clear();

  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  auth.signInWithOtp.mockResolvedValue({ error: null });
  jest.mocked(fetchProfile).mockResolvedValue({ name: 'Alice', error: null });
});

afterEach(async () => {
  await act(async () => {
    i18n.activate('en');
  });
  jest.useRealTimers();
});

async function renderInEnglish(screenUnderTest: ReactNode) {
  await render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider>
        <SessionProvider>{screenUnderTest}</SessionProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

async function switchToPseudo() {
  await act(async () => {
    i18n.activate('pseudo');
  });
}

/** The rendered tree as `screen.toJSON()` gives it: host elements and their text. */
type RenderedNode =
  | string
  | { props: Record<string, unknown> & { accessibilityValue?: { text?: unknown } }; children: RenderedNode[] | null };

/** Every string on screen or spoken: host text, and the props VoiceOver and a field read. */
function strings(): string[] {
  const found: string[] = [];
  const visit = (node: RenderedNode | null) => {
    if (node === null) return;
    if (typeof node === 'string') {
      found.push(node);
      return;
    }
    const { accessibilityLabel, accessibilityHint, accessibilityValue, placeholder } = node.props;
    for (const value of [accessibilityLabel, accessibilityHint, accessibilityValue?.text, placeholder]) {
      if (typeof value === 'string') found.push(value);
    }
    node.children?.forEach(visit);
  };
  const tree = screen.toJSON() as RenderedNode | RenderedNode[] | null;
  (Array.isArray(tree) ? tree : [tree]).forEach(visit);
  return found;
}

/** Pseudo text keeps an unaccented `v` or `x` here and there; English has letters in a row. */
function plainEnglish(): string[] {
  return strings().filter((text) => {
    const translated = UNTRANSLATED.reduce((rest, kept) => rest.split(kept).join(''), text);
    return /[A-Za-z]{2,}/.test(translated.replace(CLOCK_TIME, ''));
  });
}

describe('Sign in in pseudo', () => {
  beforeEach(() => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
  });

  it('leaves no English on the email step', async () => {
    await renderInEnglish(<SignInScreen {...({} as SignInScreenProps)} />);
    await screen.findByLabelText('Email address');

    await switchToPseudo();

    expect(strings().length).toBeGreaterThan(5);
    expect(plainEnglish()).toEqual([]);
  });

  it('leaves no English on the code step, countdown included', async () => {
    await renderInEnglish(<SignInScreen {...({} as SignInScreenProps)} />);
    await fireEvent.changeText(await screen.findByLabelText('Email address'), TYPED);
    await fireEvent.press(screen.getByLabelText('Send code'));
    await screen.findByLabelText('Six-digit code');

    await switchToPseudo();

    expect(plainEnglish()).toEqual([]);
  });
});

describe('Account in pseudo', () => {
  beforeEach(() => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1', email: RELAY } } } });
  });

  async function renderAccount() {
    const props = { navigation: { goBack: jest.fn(), navigate: jest.fn() }, route: {} };
    await renderInEnglish(<AccountScreen {...(props as unknown as AccountScreenProps)} />);
    await screen.findByLabelText('Sign out');
  }

  it('leaves no English with Auto on, the relay note and the sign-out confirm', async () => {
    await renderAccount();
    expect(screen.getByText(/^Night from \d/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText('Sign out of all devices'));
    await screen.findByLabelText('Confirm sign out of all devices');

    await switchToPseudo();

    expect(plainEnglish()).toEqual([]);
  });

  it('leaves no English with the name being edited and the delete confirm', async () => {
    await renderAccount();
    await fireEvent.press(screen.getByLabelText('Edit name'));
    await fireEvent.press(screen.getByLabelText('Delete account'));
    await screen.findByLabelText('Confirm delete account');

    await switchToPseudo();

    expect(plainEnglish()).toEqual([]);
  });
});
