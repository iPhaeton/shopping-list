import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, Text, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { subscribeToChanges } from '../lib/listsChannel';
import { fetchUnreadCount } from '../lib/notificationsApi';
import { ListsProvider } from './ListsContext';
import { NotificationsProvider, useNotifications } from './NotificationsContext';

/**
 * The count is read through `notificationsApi`, mocked at the module boundary. The real
 * `ListsProvider` sits above it, over its own mocked seams, because the nudge that re-reads the count
 * is that provider's `lastNotificationsNudge` — delivered here by hand through the captured
 * `subscribeToChanges` handler, as `ListsContext.test.tsx` delivers its own.
 */
jest.mock('../lib/notificationsApi', () => ({ fetchUnreadCount: jest.fn() }));

jest.mock('../lib/listsApi', () => ({
  fetchLists: jest.fn(async () => ({ lists: [], next: null, error: null })),
  fetchListCounts: jest.fn(async () => ({ counts: { owned: 0, total: 0 }, error: null })),
  fetchList: jest.fn(async () => ({ list: null, error: null })),
  fetchItems: jest.fn(async () => ({ items: [], next: null, error: null })),
  fetchItem: jest.fn(async () => ({ item: null, error: null })),
}));

jest.mock('../lib/listsChannel', () => ({ subscribeToChanges: jest.fn() }));

/** The provider's trailing debounce on a burst of nudges, mirrored here. */
const NUDGE_DEBOUNCE = 300;

let notificationsNudge: () => void = () => {};
let appStateListeners: ((state: AppStateStatus) => void)[] = [];

function Probe() {
  const { unread } = useNotifications();
  return <Text>{`unread: ${unread ?? 'unknown'}`}</Text>;
}

async function renderProvider() {
  await render(
    <ListsProvider userId="u1" onSessionRevoked={() => {}}>
      <NotificationsProvider>
        <Probe />
      </NotificationsProvider>
    </ListsProvider>
  );
  // The lists provider subscribes once its first read has settled.
  await waitFor(() => expect(subscribeToChanges).toHaveBeenCalled());
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();

  jest.mocked(fetchUnreadCount).mockResolvedValue({ count: 2, error: null, retryable: false });
  jest.mocked(subscribeToChanges).mockImplementation((_userId, _onChange, _onResubscribe, onNotifications) => {
    notificationsNudge = onNotifications;
    return () => {};
  });

  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListeners.push(listener);
    return {
      remove: () => (appStateListeners = appStateListeners.filter((other) => other !== listener)),
    } as NativeEventSubscription;
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('reads the count on mount', async () => {
  await renderProvider();

  expect(await screen.findByText('unread: 2')).toBeOnTheScreen();
  expect(fetchUnreadCount).toHaveBeenCalledTimes(1);
});

/** A cold start offline shows no dot rather than a guess. */
it('has no count before the first answer', async () => {
  jest.mocked(fetchUnreadCount).mockReturnValue(new Promise(() => {}));

  await renderProvider();

  expect(screen.getByText('unread: unknown')).toBeOnTheScreen();
});

it('reads the count again on coming back to the app', async () => {
  await renderProvider();
  await screen.findByText('unread: 2');

  jest.mocked(fetchUnreadCount).mockResolvedValue({ count: 5, error: null, retryable: false });
  await act(async () => appStateListeners.forEach((listener) => listener('active')));

  expect(await screen.findByText('unread: 5')).toBeOnTheScreen();
  expect(fetchUnreadCount).toHaveBeenCalledTimes(2);
});

/** Marking n notifications read sends n nudges; that is one read, not n. */
it('reads once per burst of nudges', async () => {
  jest.useFakeTimers();
  await renderProvider();
  await screen.findByText('unread: 2');

  jest.mocked(fetchUnreadCount).mockResolvedValue({ count: 0, error: null, retryable: false });
  await act(async () => {
    notificationsNudge();
    notificationsNudge();
    notificationsNudge();
  });
  expect(fetchUnreadCount).toHaveBeenCalledTimes(1);

  await act(async () => {
    jest.advanceTimersByTime(NUDGE_DEBOUNCE);
  });

  expect(fetchUnreadCount).toHaveBeenCalledTimes(2);
  expect(screen.getByText('unread: 0')).toBeOnTheScreen();
});

/** A dot a little stale beats one that flickers off whenever the signal drops. */
it('keeps the last count when a read fails', async () => {
  await renderProvider();
  await screen.findByText('unread: 2');

  jest
    .mocked(fetchUnreadCount)
    .mockResolvedValue({ count: null, error: 'TypeError: Failed to fetch', retryable: true });
  await act(async () => appStateListeners.forEach((listener) => listener('active')));

  expect(fetchUnreadCount).toHaveBeenCalledTimes(2);
  expect(screen.getByText('unread: 2')).toBeOnTheScreen();
});

/** An older read answering after a newer one must not put back a count that is already wrong. */
it('lands only the latest read to start', async () => {
  let answerFirst: (value: { count: number; error: null; retryable: false }) => void = () => {};
  jest
    .mocked(fetchUnreadCount)
    .mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)))
    .mockResolvedValueOnce({ count: 7, error: null, retryable: false });

  await renderProvider();
  await act(async () => appStateListeners.forEach((listener) => listener('active')));
  expect(await screen.findByText('unread: 7')).toBeOnTheScreen();

  await act(async () => answerFirst({ count: 1, error: null, retryable: false }));

  expect(screen.getByText('unread: 7')).toBeOnTheScreen();
});
