import AsyncStorage from '@react-native-async-storage/async-storage';
import { i18n, type Messages } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { fetchLists } from '../lib/listsApi';
import { fetchNotifications, fetchUnreadCount, type Notification } from '../lib/notificationsApi';
import { fetchProfile } from '../lib/profileApi';
import { supabase } from '../lib/supabase';
import type { ListsScreenProps, NotificationsScreenProps } from '../navigation/types';
import { ListsScreen } from '../screens/ListsScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { ListsProvider } from '../state/ListsContext';
import { NotificationsProvider } from '../state/NotificationsContext';
import { SessionProvider } from '../state/SessionContext';
import { SortProvider } from '../state/SortContext';
import type { List } from '../state/types';
import { LOCALES, type AppLocale } from './locales';

/**
 * Every shipped catalog renders: Lists and Notifications, the two screens with the most plurals and
 * names, in each of the 21 catalogs. A translation Lingui cannot compile is shown as its raw ICU
 * source rather than thrown, so the check is that no `{` or `plural,` reaches the screen — in text or
 * in what VoiceOver reads. Rows cover each role, the three kinds of notification, and ages in
 * minutes, hours and days, so the plurals render.
 *
 * The mocks are the two screens' own suites', with one provider tree for both, as `App.tsx` has it.
 */
jest.mock('../lib/listsApi', () => ({
  fetchLists: jest.fn(),
  fetchListCounts: jest.fn(async () => ({ counts: { owned: 2, total: 3 }, error: null })),
  fetchList: jest.fn(async () => ({ list: null, error: null })),
  fetchItems: jest.fn(async () => ({ items: [], next: null, error: null })),
  fetchItem: jest.fn(async () => ({ item: null, error: null })),
}));
jest.mock('../lib/notificationsApi', () => ({
  NOTIFICATION_PAGE_SIZE: 100,
  NOTIFICATION_RELOAD_MAX: 1000,
  fetchNotifications: jest.fn(),
  fetchUnreadCount: jest.fn(),
  markNotificationsRead: jest.fn(async () => ({ error: null, verdict: 'ok' })),
  acceptInvitation: jest.fn(),
  declineInvitation: jest.fn(),
  blockInviter: jest.fn(),
}));
jest.mock('../lib/listsChannel', () => ({ subscribeToChanges: jest.fn(() => () => {}) }));
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
jest.mock('../lib/appleSignIn', () => ({ signInWithApple: jest.fn() }));
jest.mock('../lib/profileApi', () => ({ fetchProfile: jest.fn(), setName: jest.fn() }));

const auth = supabase.auth as unknown as { getSession: jest.Mock; onAuthStateChange: jest.Mock };

const MINUTE = 60_000;
const before = (minutes: number) => new Date(Date.now() - minutes * MINUTE - 5_000).toISOString();

function list(id: string, name: string, role: List['role']): List {
  return { id, name, role, deletedAt: null, joinedAt: before(10), itemsLoaded: false, items: [], nextLive: null, nextBin: null };
}

const LISTS = [list('l1', 'Weekend BBQ', 'owner'), list('l2', 'Camping trip', 'writer'), list('l3', 'Hardware store', 'reader')];

const common = { readAt: null, actorId: 'u2', actorName: 'Maya', listName: 'Weekend BBQ' };
const NOTIFICATIONS: Notification[] = [
  { ...common, id: 'n1', kind: 'list_invitation', createdAt: before(2), listId: 'x1', invitationId: 'i1', role: 'writer', status: 'pending', available: true },
  { ...common, id: 'n2', kind: 'list_invitation', createdAt: before(5), listId: 'x2', invitationId: 'i2', role: 'owner', status: 'accepted', available: true },
  { ...common, id: 'n3', kind: 'list_invitation', createdAt: before(30), listId: 'x3', invitationId: 'i3', role: 'reader', status: 'declined', available: true },
  { ...common, id: 'n4', kind: 'invitation_accepted', createdAt: before(60), listId: 'l1', actorName: 'Sam' },
  { ...common, id: 'n5', kind: 'invitation_declined', createdAt: before(3 * 24 * 60), listId: 'l2', listName: 'Camping trip', readAt: before(1) },
];

const catalog = (locale: AppLocale) => (require(`../locales/${locale}/messages`) as { messages: Messages }).messages;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.mocked(fetchLists).mockImplementation(async (stream) => ({ lists: stream === 'live' ? LISTS : [], next: null, error: null }));
  jest.mocked(fetchNotifications).mockResolvedValue({ notifications: NOTIFICATIONS, cursor: null, error: null, retryable: false });
  jest.mocked(fetchUnreadCount).mockResolvedValue({ count: 2, error: null, retryable: false });
  jest.mocked(fetchProfile).mockResolvedValue({ name: 'Alice', error: null });
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
});

afterAll(() => {
  i18n.activate('en');
});

function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nProvider i18n={i18n}>
      <SessionProvider>
        <SortProvider>
          <ListsProvider userId="u1" onSessionRevoked={() => {}}>
            <NotificationsProvider>{children}</NotificationsProvider>
          </ListsProvider>
        </SortProvider>
      </SessionProvider>
    </I18nProvider>
  );
}

type Node = { props?: Record<string, unknown>; children?: (Node | string)[] | null } | string;

/** Every string the screen draws or hands to VoiceOver. */
function shownText(node: Node | Node[] | null, found: string[] = []): string[] {
  if (node === null) return found;
  if (Array.isArray(node)) {
    for (const child of node) shownText(child, found);
    return found;
  }
  if (typeof node === 'string') {
    found.push(node);
    return found;
  }
  for (const prop of ['accessibilityLabel', 'accessibilityHint', 'placeholder'] as const) {
    if (typeof node.props?.[prop] === 'string') found.push(node.props[prop] as string);
  }
  shownText(node.children ?? null, found);
  return found;
}

function expectNoSource() {
  const text = shownText(screen.toJSON() as Node | Node[] | null);
  expect(text.join('\n')).toContain('Weekend BBQ');
  for (const line of text) {
    expect(line).not.toContain('{');
    expect(line).not.toContain('plural,');
  }
}

describe.each(LOCALES)('%s', (locale) => {
  beforeAll(() => {
    i18n.load(locale, catalog(locale));
    i18n.activate(locale);
  });

  it('renders Lists', async () => {
    const navigation = { navigate: jest.fn(), setOptions: jest.fn() };
    await render(
      <Providers>
        <ListsScreen {...({ navigation } as unknown as ListsScreenProps)} />
      </Providers>
    );
    await waitFor(() => expect(screen.getAllByLabelText(/Weekend BBQ/).length).toBeGreaterThan(0));
    await act(async () => {});
    expectNoSource();
  });

  it('renders Notifications', async () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn(), addListener: jest.fn(() => () => {}) };
    await render(
      <Providers>
        <NotificationsScreen {...({ navigation } as unknown as NotificationsScreenProps)} />
      </Providers>
    );
    await waitFor(() => expect(fetchNotifications).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText(/Weekend BBQ/).length).toBeGreaterThan(0));
    await act(async () => {});
    expectNoSource();
  });
});
