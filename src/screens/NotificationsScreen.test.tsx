import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { LISTS_FULL } from '../lib/limits';
import { fetchLists } from '../lib/listsApi';
import { subscribeToChanges } from '../lib/listsChannel';
import {
  acceptInvitation,
  declineInvitation,
  fetchNotifications,
  fetchUnreadCount,
  markNotificationsRead,
  type Notification,
  type NotificationCursor,
} from '../lib/notificationsApi';
import { fetchProfile } from '../lib/profileApi';
import { supabase } from '../lib/supabase';
import type { NotificationsScreenProps } from '../navigation/types';
import { ListsProvider } from '../state/ListsContext';
import { NotificationsProvider } from '../state/NotificationsContext';
import { SessionProvider } from '../state/SessionContext';
import type { List } from '../state/types';
import { NotificationsScreen } from './NotificationsScreen';

/**
 * `notificationsApi` is this screen's seam, mocked at the module boundary — with a page of 3 rather
 * than 100, so paging takes a handful of rows. The screen reads the constants from the module it
 * imports, so the mock's are the ones in force. Above the screen sit the real providers it reads —
 * the session (for a revoked session's sign-out), the lists (`refresh`, the lists held, the nudge),
 * and the unread count — each over its own mocked seams, as `SharingScreen.test.tsx` sets them up.
 */
jest.mock('../lib/notificationsApi', () => ({
  NOTIFICATION_PAGE_SIZE: 3,
  NOTIFICATION_RELOAD_MAX: 1000,
  fetchNotifications: jest.fn(),
  fetchUnreadCount: jest.fn(),
  markNotificationsRead: jest.fn(),
  acceptInvitation: jest.fn(),
  declineInvitation: jest.fn(),
}));

jest.mock('../lib/listsApi', () => ({
  fetchLists: jest.fn(async () => ({ lists: [], next: null, error: null })),
  fetchListCounts: jest.fn(async () => ({ counts: { owned: 0, total: 0 }, error: null })),
  fetchList: jest.fn(async () => ({ list: null, error: null })),
  fetchItems: jest.fn(async () => ({ items: [], next: null, error: null })),
  fetchItem: jest.fn(async () => ({ item: null, error: null })),
}));

/** Captures the notifications handler, so a test can deliver a nudge as the database would. */
jest.mock('../lib/listsChannel', () => ({ subscribeToChanges: jest.fn() }));

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

const auth = supabase.auth as unknown as {
  getSession: jest.Mock;
  onAuthStateChange: jest.Mock;
  signOut: jest.Mock;
};

/** The screen's trailing debounce on a burst of nudges, mirrored here. */
const NUDGE_DEBOUNCE = 300;
const MINUTE = 60_000;

/** A stamp `minutes` before now — a few seconds more, so an age never sits on its boundary. */
const before = (minutes: number) => new Date(Date.now() - minutes * MINUTE - 5_000).toISOString();

type Invitation = Extract<Notification, { kind: 'list_invitation' }>;

function invitation(id: string, extra: Partial<Invitation> = {}): Invitation {
  return {
    id,
    kind: 'list_invitation',
    createdAt: before(2),
    readAt: null,
    actorId: 'u2',
    actorName: 'Maya',
    listId: `list-${id}`,
    listName: 'Weekend BBQ',
    invitationId: `inv-${id}`,
    role: 'writer',
    status: 'pending',
    available: true,
    ...extra,
  };
}

function answer(
  id: string,
  kind: 'invitation_accepted' | 'invitation_declined',
  extra: Partial<Notification> = {}
): Notification {
  return {
    id,
    kind,
    createdAt: before(60),
    readAt: null,
    actorId: 'u3',
    actorName: 'Sam',
    listId: `list-${id}`,
    listName: 'Camping trip',
    ...extra,
  } as Notification;
}

/** `n` read rows, newest first, `r1`…`rn`. */
function many(n: number): Notification[] {
  return Array.from({ length: n }, (_, i) =>
    answer(`r${i + 1}`, 'invitation_declined', {
      createdAt: before(i + 1),
      readAt: before(0),
      listName: `List ${i + 1}`,
      actorName: `Person ${i + 1}`,
    })
  );
}

/**
 * What the database holds, newest first, and the keyset it pages by: the rows after `before`, a
 * page at a time, with a cursor from a full page only. Marking a row read writes `readAt`.
 */
let server: Notification[] = [];

function page(cursorAfter: NotificationCursor | null | undefined, limit: number) {
  const start = cursorAfter ? server.findIndex((n) => n.id === cursorAfter.id) + 1 : 0;
  const rows = server.slice(start, start + limit);
  const last = rows[rows.length - 1];
  return {
    notifications: rows,
    cursor: rows.length < limit || !last ? null : { createdAt: last.createdAt, id: last.id },
    error: null,
    retryable: false,
  };
}

/** Lists this account holds, for the answer card's chevron. */
function serveLists(lists: Pick<List, 'id' | 'name'>[]) {
  jest.mocked(fetchLists).mockImplementation(async (stream) => ({
    lists:
      stream === 'live'
        ? lists.map((list) => ({
            ...list,
            role: 'owner' as const,
            deletedAt: null,
            joinedAt: null,
            itemsLoaded: false,
            items: [],
            nextLive: null,
            nextBin: null,
          }))
        : [],
    next: null,
    error: null,
  }));
}

let notificationsNudge: () => void = () => {};
const navigation = { navigate: jest.fn(), goBack: jest.fn() };

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();

  server = [];
  serveLists([]);
  jest.mocked(fetchNotifications).mockImplementation(async ({ before: cursorAfter, limit }) => page(cursorAfter, limit));
  jest.mocked(fetchUnreadCount).mockResolvedValue({ count: 0, error: null, retryable: false });
  jest.mocked(markNotificationsRead).mockImplementation(async (ids) => {
    server = server.map((n) => (ids.includes(n.id) ? { ...n, readAt: before(0) } : n));
    return { error: null, verdict: 'ok' };
  });
  jest.mocked(acceptInvitation).mockResolvedValue({ error: null, verdict: 'ok', listId: 'l1' });
  jest.mocked(declineInvitation).mockResolvedValue({ error: null, verdict: 'ok' });
  jest.mocked(fetchProfile).mockResolvedValue({ name: 'Alice', error: null });
  jest.mocked(subscribeToChanges).mockImplementation((_userId, _onChange, _onResubscribe, onNotifications) => {
    notificationsNudge = onNotifications;
    return () => {};
  });

  auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  auth.signOut.mockResolvedValue({ error: null });
});

afterEach(() => {
  jest.useRealTimers();
});

async function renderScreen() {
  await render(
    <SessionProvider>
      <ListsProvider userId="u1" onSessionRevoked={() => {}}>
        <NotificationsProvider>
          <NotificationsScreen {...({ navigation } as unknown as NotificationsScreenProps)} />
        </NotificationsProvider>
      </ListsProvider>
    </SessionProvider>
  );
  await waitFor(() => expect(fetchNotifications).toHaveBeenCalled());
  await act(async () => {});
}

/** A `notifications/changed` nudge, and the screen's debounce run out. Needs fake timers. */
async function nudge() {
  await waitFor(() => expect(subscribeToChanges).toHaveBeenCalled());
  await act(async () => notificationsNudge());
  await act(async () => {
    jest.advanceTimersByTime(NUDGE_DEBOUNCE);
  });
}

/** Scrolling to the end, as the list reports it. */
async function scrollToEnd() {
  await fireEvent(screen.getByText('Notifications'), 'endReached');
}

/** The calls that read from the top: a reload, or the first load. */
const reloads = () => jest.mocked(fetchNotifications).mock.calls.filter(([args]) => !args.before);

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((settle) => (resolve = settle));
  return { promise, resolve };
}

// --- The cards ------------------------------------------------------------------------------------

describe('the cards', () => {
  it('shows a pending invitation with its role, age, and both answers', async () => {
    server = [invitation('n1')];

    await renderScreen();

    expect(await screen.findByText('Maya invited you to Weekend BBQ')).toBeOnTheScreen();
    expect(screen.getByText('as a writer · 2 min ago')).toBeOnTheScreen();
    expect(screen.getByLabelText('Decline invitation to Weekend BBQ')).toHaveTextContent('Decline');
    expect(screen.getByLabelText('Accept invitation to Weekend BBQ')).toHaveTextContent('Accept');
  });

  it.each([
    ['reader', 'as a reader · 2 min ago'],
    ['owner', 'as an owner · 2 min ago'],
  ] as const)('names the role %s with its article', async (role, line) => {
    server = [invitation('n1', { role })];

    await renderScreen();

    expect(await screen.findByText(line)).toBeOnTheScreen();
  });

  it('opens the list from an invitation you accepted', async () => {
    server = [invitation('n1', { status: 'accepted', actorName: 'Alex', listName: 'Hardware store', listId: 'l7', createdAt: before(5 * 60) })];

    await renderScreen();

    expect(await screen.findByText('You joined · 5 h ago')).toBeOnTheScreen();
    const card = screen.getByLabelText('Open Hardware store');
    expect(card).toHaveAccessibilityValue({
      text: 'Unread, Alex invited you to Hardware store, You joined, 5 h ago',
    });
    expect(screen.queryByLabelText('Accept invitation to Hardware store')).not.toBeOnTheScreen();

    await fireEvent.press(card);
    expect(navigation.navigate).toHaveBeenCalledWith('ListDetail', { listId: 'l7' });
  });

  it('shows an invitation you declined, with no answers left to give', async () => {
    server = [invitation('n1', { status: 'declined', listName: 'Ski trip', createdAt: before(2 * 24 * 60) })];

    await renderScreen();

    expect(await screen.findByText('Maya invited you to Ski trip')).toBeOnTheScreen();
    expect(screen.getByText('Declined · 2 d ago')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Accept invitation to Ski trip')).not.toBeOnTheScreen();
    expect(screen.queryByLabelText('Open Ski trip')).not.toBeOnTheScreen();
  });

  /** The list was binned, or the inviter is no longer an owner of it. */
  it('shows an invitation that is no longer available, with no answers', async () => {
    server = [invitation('n1', { available: false, listName: 'Birthday party', createdAt: before(3 * 24 * 60) })];

    await renderScreen();

    expect(await screen.findByText('No longer available · 3 d ago')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Accept invitation to Birthday party')).not.toBeOnTheScreen();
    expect(screen.queryByLabelText('Decline invitation to Birthday party')).not.toBeOnTheScreen();
  });

  it('shows a decline of your invitation', async () => {
    server = [answer('n1', 'invitation_declined', { actorName: 'Jordan', listName: 'Pharmacy', createdAt: before(24 * 60) })];

    await renderScreen();

    expect(await screen.findByText('Jordan declined your invitation to Pharmacy')).toBeOnTheScreen();
    expect(screen.getByText('1 d ago')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Open Pharmacy')).not.toBeOnTheScreen();
  });

  /** The inviter may have left the list since; then there is nothing to open. */
  it('opens the list from an accepted invitation of yours only while you hold the list', async () => {
    serveLists([{ id: 'l1', name: 'Camping trip' }]);
    server = [
      answer('n1', 'invitation_accepted', { listId: 'l1', readAt: before(0) }),
      answer('n2', 'invitation_accepted', { listId: 'l2', listName: 'Pharmacy', readAt: before(0) }),
    ];

    await renderScreen();

    expect(await screen.findByLabelText('Open Camping trip')).toHaveAccessibilityValue({
      text: 'Sam accepted your invitation to Camping trip, 1 h ago',
    });
    expect(screen.getByText('Sam accepted your invitation to Pharmacy')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Open Pharmacy')).not.toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText('Open Camping trip'));
    expect(navigation.navigate).toHaveBeenCalledWith('ListDetail', { listId: 'l1' });
  });

  it('says so when there are no notifications', async () => {
    await renderScreen();

    expect(await screen.findByText('No notifications yet')).toBeOnTheScreen();
    expect(screen.getByText('Invitations to shared lists show up here.')).toBeOnTheScreen();
  });

  it('says the first page is on its way', async () => {
    jest.mocked(fetchNotifications).mockReturnValue(new Promise(() => {}));

    await render(
      <SessionProvider>
        <ListsProvider userId="u1" onSessionRevoked={() => {}}>
          <NotificationsProvider>
            <NotificationsScreen {...({ navigation } as unknown as NotificationsScreenProps)} />
          </NotificationsProvider>
        </ListsProvider>
      </SessionProvider>
    );

    expect(screen.getByLabelText('Loading notifications')).toBeOnTheScreen();
  });

  it('goes back through its own drawn Back button', async () => {
    await renderScreen();

    await fireEvent.press(screen.getByLabelText('Back'));

    expect(navigation.goBack).toHaveBeenCalled();
  });
});

// --- Answering --------------------------------------------------------------------------------------

describe('answering an invitation', () => {
  it('accepts, shows the pending text meanwhile, re-reads the lists, then shows You joined', async () => {
    server = [invitation('n1')];
    const reply = deferred<{ error: null; verdict: 'ok'; listId: string }>();
    jest.mocked(acceptInvitation).mockReturnValue(reply.promise);

    await renderScreen();
    const hydrated = jest.mocked(fetchLists).mock.calls.length;

    await fireEvent.press(await screen.findByLabelText('Accept invitation to Weekend BBQ'));
    expect(acceptInvitation).toHaveBeenCalledWith('inv-n1');
    expect(screen.getByLabelText('Accept invitation to Weekend BBQ')).toHaveTextContent('Accepting…');
    expect(screen.getByLabelText('Accept invitation to Weekend BBQ')).toBeDisabled();
    expect(screen.getByLabelText('Decline invitation to Weekend BBQ')).toBeDisabled();

    server = [{ ...server[0], status: 'accepted' } as Notification];
    await act(async () => reply.resolve({ error: null, verdict: 'ok', listId: 'list-n1' }));

    expect(await screen.findByText('You joined · 2 min ago')).toBeOnTheScreen();
    expect(jest.mocked(fetchLists).mock.calls.length).toBeGreaterThan(hydrated);
  });

  it('declines, then shows Declined', async () => {
    server = [invitation('n1')];
    jest.mocked(declineInvitation).mockImplementation(async () => {
      server = [{ ...server[0], status: 'declined' } as Notification];
      return { error: null, verdict: 'ok' };
    });

    await renderScreen();
    await fireEvent.press(await screen.findByLabelText('Decline invitation to Weekend BBQ'));

    expect(declineInvitation).toHaveBeenCalledWith('inv-n1');
    expect(await screen.findByText('Declined · 2 min ago')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Accept invitation to Weekend BBQ')).not.toBeOnTheScreen();
  });

  /** `acceptInvitation` already turned the database's "they …" into the second person. */
  it('shows a limit refusal in the second person, and re-reads', async () => {
    server = [invitation('n1')];
    jest.mocked(acceptInvitation).mockResolvedValue({ error: LISTS_FULL, verdict: 'permanent' });

    await renderScreen();
    await fireEvent.press(await screen.findByLabelText('Accept invitation to Weekend BBQ'));

    expect(await screen.findByText(LISTS_FULL)).toBeOnTheScreen();
    expect(reloads()).toHaveLength(2);
    expect(screen.getByLabelText('Accept invitation to Weekend BBQ')).not.toBeDisabled();
  });

  it('says a connection is needed to answer, and re-reads nothing', async () => {
    server = [invitation('n1')];
    jest
      .mocked(acceptInvitation)
      .mockResolvedValue({ error: 'TypeError: Failed to fetch', verdict: 'retryable' });

    await renderScreen();
    await fireEvent.press(await screen.findByLabelText('Accept invitation to Weekend BBQ'));

    expect(await screen.findByText('You need a connection to answer an invitation.')).toBeOnTheScreen();
    expect(reloads()).toHaveLength(1);
    expect(screen.getByLabelText('Accept invitation to Weekend BBQ')).not.toBeDisabled();
  });

  it('signs this device out instead of showing a refusal for a revoked session', async () => {
    server = [invitation('n1')];
    jest.mocked(declineInvitation).mockResolvedValue({
      error: 'this device has been signed out',
      verdict: 'permanent',
      sessionRevoked: true,
    });

    await renderScreen();
    await fireEvent.press(await screen.findByLabelText('Decline invitation to Weekend BBQ'));

    await act(async () => {});
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(screen.queryByText('this device has been signed out')).not.toBeOnTheScreen();
  });
});

it('says a connection is needed to see the notifications', async () => {
  jest.mocked(fetchNotifications).mockResolvedValue({
    notifications: null,
    cursor: null,
    error: 'TypeError: Failed to fetch',
    retryable: true,
  });

  await renderScreen();

  expect(await screen.findByText('You need a connection to see your notifications.')).toBeOnTheScreen();
  expect(screen.queryByText('No notifications yet')).not.toBeOnTheScreen();
});

// --- Paging (D8) ------------------------------------------------------------------------------------

describe('paging', () => {
  it('reads the next page from the last row, and adds it below', async () => {
    server = many(5);

    await renderScreen();
    expect(await screen.findByText('Person 3 declined your invitation to List 3')).toBeOnTheScreen();
    expect(screen.queryByText('Person 4 declined your invitation to List 4')).not.toBeOnTheScreen();

    await scrollToEnd();

    expect(fetchNotifications).toHaveBeenLastCalledWith({
      before: { createdAt: server[2].createdAt, id: 'r3' },
      limit: 3,
    });
    expect(await screen.findByText('Person 5 declined your invitation to List 5')).toBeOnTheScreen();
    expect(screen.getByText('Person 1 declined your invitation to List 1')).toBeOnTheScreen();
  });

  it('shows the spinner while the next page is on its way', async () => {
    server = many(5);
    await renderScreen();

    const next = deferred<ReturnType<typeof page>>();
    jest.mocked(fetchNotifications).mockReturnValueOnce(next.promise);
    await scrollToEnd();
    expect(screen.getByLabelText('Loading more notifications')).toBeOnTheScreen();

    await act(async () => next.resolve(page({ createdAt: server[2].createdAt, id: 'r3' }, 3)));

    expect(screen.queryByLabelText('Loading more notifications')).not.toBeOnTheScreen();
  });

  it('reads nothing more once a short page said the stream ended', async () => {
    server = many(5);
    await renderScreen();
    await scrollToEnd();
    await screen.findByText('Person 5 declined your invitation to List 5');
    const calls = jest.mocked(fetchNotifications).mock.calls.length;

    await scrollToEnd();

    expect(fetchNotifications).toHaveBeenCalledTimes(calls);
  });

  it('reads nothing past a first page that was already short', async () => {
    server = many(2);
    await renderScreen();

    await scrollToEnd();

    expect(fetchNotifications).toHaveBeenCalledTimes(1);
  });

  /** A failed page shows nothing; the next scroll to the end asks again. */
  it('asks again for a page that failed', async () => {
    server = many(5);
    await renderScreen();

    jest.mocked(fetchNotifications).mockResolvedValueOnce({
      notifications: null,
      cursor: null,
      error: 'TypeError: Failed to fetch',
      retryable: true,
    });
    await scrollToEnd();
    expect(screen.queryByText('You need a connection to see your notifications.')).not.toBeOnTheScreen();

    await scrollToEnd();

    expect(await screen.findByText('Person 5 declined your invitation to List 5')).toBeOnTheScreen();
  });

  it('re-reads everything shown in one call on a nudge, so every loaded page is current', async () => {
    jest.useFakeTimers();
    server = many(5);
    await renderScreen();
    await scrollToEnd();
    await screen.findByText('Person 5 declined your invitation to List 5');
    jest.mocked(fetchNotifications).mockClear();

    // The row on page 2 is withdrawn; a re-read of page 1 alone would leave it on screen.
    server = server.filter((n) => n.id !== 'r4');
    await nudge();

    expect(fetchNotifications).toHaveBeenCalledTimes(1);
    expect(fetchNotifications).toHaveBeenCalledWith({ limit: 6 });
    expect(screen.queryByText('Person 4 declined your invitation to List 4')).not.toBeOnTheScreen();
    expect(screen.getByText('Person 5 declined your invitation to List 5')).toBeOnTheScreen();
  });

  /**
   * One more than is shown: a full answer means "there is more", so a re-read of exactly what is
   * shown would bring the cursor back at the end of the stream, and the next scroll would read an
   * empty page (seen in the browser, task 28 step 3).
   */
  it('knows the end is still the end after a re-read', async () => {
    jest.useFakeTimers();
    server = many(5);
    await renderScreen();
    await scrollToEnd();
    await screen.findByText('Person 5 declined your invitation to List 5');

    await nudge();
    const calls = jest.mocked(fetchNotifications).mock.calls.length;
    await scrollToEnd();

    expect(fetchNotifications).toHaveBeenCalledTimes(calls);
  });

  it('collapses a burst of nudges into one re-read', async () => {
    jest.useFakeTimers();
    server = many(2);
    await renderScreen();
    await waitFor(() => expect(subscribeToChanges).toHaveBeenCalled());

    await act(async () => {
      notificationsNudge();
      notificationsNudge();
      notificationsNudge();
    });
    await act(async () => {
      jest.advanceTimersByTime(NUDGE_DEBOUNCE);
    });

    expect(reloads()).toHaveLength(2);
  });

  /** The re-read replaced the cursor the page was asked from: it continues nothing on screen. */
  it('drops a page that lands after a re-read replaced the cursor', async () => {
    jest.useFakeTimers();
    server = many(5);
    await renderScreen();

    const stale = deferred<ReturnType<typeof page>>();
    jest.mocked(fetchNotifications).mockReturnValueOnce(stale.promise);
    await scrollToEnd();
    await nudge();

    // The page continued r3; the re-read (one more than the 3 shown) now ends at r4.
    await act(async () => stale.resolve(page({ createdAt: server[2].createdAt, id: 'r3' }, 3)));

    expect(screen.getByText('Person 4 declined your invitation to List 4')).toBeOnTheScreen();
    expect(screen.queryByText('Person 5 declined your invitation to List 5')).not.toBeOnTheScreen();
    expect(screen.queryByLabelText('Loading more notifications')).not.toBeOnTheScreen();

    // The next scroll asks again, from the cursor the re-read left.
    await scrollToEnd();
    expect(fetchNotifications).toHaveBeenLastCalledWith({
      before: { createdAt: server[3].createdAt, id: 'r4' },
      limit: 3,
    });
    expect(await screen.findByText('Person 5 declined your invitation to List 5')).toBeOnTheScreen();
  });

  /** Of two re-reads, only the one that started later may land. */
  it('lands only the later of two re-reads', async () => {
    jest.useFakeTimers();
    server = many(2);
    await renderScreen();

    const first = deferred<ReturnType<typeof page>>();
    jest.mocked(fetchNotifications).mockReturnValueOnce(first.promise);
    await nudge();
    server = [...many(1).map((n) => ({ ...n, id: 'new', listName: 'Newest' })), ...server];
    await nudge();
    expect(await screen.findByText('Person 1 declined your invitation to Newest')).toBeOnTheScreen();

    await act(async () => first.resolve({ ...page(null, 3), notifications: many(2).slice(1) }));

    expect(screen.getByText('Person 1 declined your invitation to Newest')).toBeOnTheScreen();
  });
});

// --- Read marking (D4, per page) --------------------------------------------------------------------

describe('read marking', () => {
  const unread = (ids: string[]) => many(ids.length).map((n, i) => ({ ...n, id: ids[i], readAt: null }));

  it('marks exactly the unread rows each page brought, and re-reads the count', async () => {
    server = [...unread(['a1', 'a2']), ...many(2), ...unread(['b1'])];

    await renderScreen();
    await waitFor(() => expect(markNotificationsRead).toHaveBeenCalledTimes(1));
    expect(markNotificationsRead).toHaveBeenLastCalledWith(['a1', 'a2']);
    await waitFor(() => expect(fetchUnreadCount).toHaveBeenCalledTimes(2));

    await scrollToEnd();
    await waitFor(() => expect(markNotificationsRead).toHaveBeenCalledTimes(2));
    expect(markNotificationsRead).toHaveBeenLastCalledWith(['b1']);
  });

  it('dots the rows that were unread, and nothing else', async () => {
    server = [...unread(['a1']), ...many(1)];

    await renderScreen();

    expect(await screen.findAllByLabelText('Unread')).toHaveLength(1);
  });

  /** The mark's own nudges re-read the screen, and the dots must last the visit. */
  it('keeps the dots through a re-read, and sends no second mark', async () => {
    jest.useFakeTimers();
    server = [...unread(['a1', 'a2'])];
    await renderScreen();
    await waitFor(() => expect(markNotificationsRead).toHaveBeenCalledTimes(1));
    expect(server.every((n) => n.readAt !== null)).toBe(true);

    await nudge();

    expect(screen.getAllByLabelText('Unread')).toHaveLength(2);
    expect(markNotificationsRead).toHaveBeenCalledTimes(1);
  });

  it('dots and marks a notification that arrives during the visit', async () => {
    jest.useFakeTimers();
    server = [...unread(['a1'])];
    await renderScreen();
    await waitFor(() => expect(markNotificationsRead).toHaveBeenCalledTimes(1));

    server = [invitation('n9'), ...server];
    await nudge();

    await waitFor(() => expect(markNotificationsRead).toHaveBeenCalledTimes(2));
    expect(markNotificationsRead).toHaveBeenLastCalledWith(['n9']);
    expect(screen.getAllByLabelText('Unread')).toHaveLength(2);
  });

  it('signs this device out when a mark is refused for a revoked session', async () => {
    jest.mocked(markNotificationsRead).mockResolvedValue({
      error: 'this device has been signed out',
      verdict: 'permanent',
      sessionRevoked: true,
    });
    server = [...unread(['a1'])];

    await renderScreen();

    await waitFor(() => expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' }));
  });
});
