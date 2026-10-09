import { act, fireEvent, render, screen } from '@testing-library/react-native';

import {
  fetchBlockedUsers,
  unblockUser,
  type BlockedCursor,
  type BlockedUser,
} from '../lib/notificationsApi';
import type { BlockedPeopleScreenProps } from '../navigation/types';
import { useNotifications } from '../state/NotificationsContext';
import { useSession } from '../state/SessionContext';
import { BlockedPeopleScreen } from './BlockedPeopleScreen';

/**
 * `notificationsApi` is this screen's seam, mocked at the module boundary with a page of 3 rather
 * than 100, so paging takes a handful of rows. The two contexts it reads are mocked as hooks, as
 * `ListsScreen.test.tsx` mocks the count: the screen only calls `refreshUnread` and `signOut`, and
 * the assertions are on exactly those calls.
 */
jest.mock('../lib/notificationsApi', () => ({
  BLOCKED_PAGE_SIZE: 3,
  fetchBlockedUsers: jest.fn(),
  unblockUser: jest.fn(),
}));
jest.mock('../state/NotificationsContext', () => ({ useNotifications: jest.fn() }));
jest.mock('../state/SessionContext', () => ({ useSession: jest.fn() }));

const OFFLINE_LOAD = "You need a connection to see who you've blocked.";
const OFFLINE_ACTION = 'You need a connection to unblock someone.';

/** `n` blocked people, newest block first: `Person 1`…`Person n`, blocked a minute apart. */
function people(n: number): BlockedUser[] {
  return Array.from({ length: n }, (_, i) => ({
    userId: `p${String(i + 1).padStart(2, '0')}`,
    name: `Person ${i + 1}`,
    blockedAt: `2026-10-09T10:${String(59 - i).padStart(2, '0')}:00+00:00`,
  }));
}

/**
 * What the database holds, newest block first, and the keyset it pages by: the rows strictly after
 * `before`'s *values* — so a cursor whose row was unblocked still continues where it was.
 */
let server: BlockedUser[] = [];

function page(before: BlockedCursor | null | undefined, limit: number) {
  const after = before
    ? server.filter(
        (row) =>
          row.blockedAt < before.blockedAt ||
          (row.blockedAt === before.blockedAt && row.userId < before.userId)
      )
    : server;
  const rows = after.slice(0, limit);
  const last = rows[rows.length - 1];
  return {
    blocked: rows,
    cursor: rows.length < limit || !last ? null : { blockedAt: last.blockedAt, userId: last.userId },
    error: null,
    retryable: false,
  };
}

const refreshUnread = jest.fn(async () => {});
const signOut = jest.fn(async () => ({ error: null }));
const navigation = { goBack: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  server = [];
  jest.mocked(fetchBlockedUsers).mockImplementation(async ({ before, limit }) => page(before, limit));
  jest.mocked(unblockUser).mockImplementation(async (userId) => {
    server = server.filter((row) => row.userId !== userId);
    return { error: null, verdict: 'ok' };
  });
  jest.mocked(useNotifications).mockReturnValue({ unread: 0, refreshUnread });
  jest.mocked(useSession).mockReturnValue({ signOut } as unknown as ReturnType<typeof useSession>);
});

async function renderScreen() {
  await render(<BlockedPeopleScreen {...({ navigation } as unknown as BlockedPeopleScreenProps)} />);
  await act(async () => {});
}

/** Scrolling to the end, as the list reports it. */
async function scrollToEnd() {
  await fireEvent(screen.getByText('Blocked people'), 'endReached');
}

/** The calls that read past page 1. */
const pages = () => jest.mocked(fetchBlockedUsers).mock.calls.filter(([args]) => args.before);

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((settle) => (resolve = settle));
  return { promise, resolve };
}

describe('the list', () => {
  it('shows everyone blocked, each with Unblock', async () => {
    server = [
      { userId: 'u2', name: 'Maya', blockedAt: '2026-10-09T10:00:00+00:00' },
      { userId: 'u3', name: 'Jordan', blockedAt: '2026-10-09T09:00:00+00:00' },
    ];

    await renderScreen();

    expect(screen.getByText('Maya')).toBeOnTheScreen();
    expect(screen.getByText('Jordan')).toBeOnTheScreen();
    expect(screen.getByLabelText('Unblock Maya')).toHaveTextContent('Unblock');
    expect(screen.getByLabelText('Unblock Jordan')).toHaveTextContent('Unblock');
    expect(fetchBlockedUsers).toHaveBeenCalledWith({ limit: 3 });
  });

  it('says the first page is on its way', async () => {
    const reply = deferred<ReturnType<typeof page>>();
    jest.mocked(fetchBlockedUsers).mockReturnValue(reply.promise);

    await renderScreen();
    expect(screen.getByLabelText('Loading blocked people')).toBeOnTheScreen();

    await act(async () => reply.resolve(page(null, 3)));
    expect(screen.queryByLabelText('Loading blocked people')).not.toBeOnTheScreen();
  });

  it('says so when nobody is blocked', async () => {
    await renderScreen();

    expect(screen.getByText("You haven't blocked anyone")).toBeOnTheScreen();
    expect(screen.getByText('People you block from Notifications show up here.')).toBeOnTheScreen();
  });

  it.each([
    [{ error: 'TypeError: Failed to fetch', retryable: true }, OFFLINE_LOAD],
    [{ error: 'permission denied', retryable: false }, 'permission denied'],
  ])('says why the first page failed (%o)', async (failure, message) => {
    jest.mocked(fetchBlockedUsers).mockResolvedValue({ blocked: null, cursor: null, ...failure });

    await renderScreen();

    expect(screen.getByText(message)).toBeOnTheScreen();
    expect(screen.queryByLabelText('Loading blocked people')).not.toBeOnTheScreen();
    expect(screen.queryByText("You haven't blocked anyone")).not.toBeOnTheScreen();
  });

  it('goes back through its own drawn Back button', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByLabelText('Back'));

    expect(navigation.goBack).toHaveBeenCalled();
  });
});

describe('paging', () => {
  it('reads the next page from the last row, and adds it below', async () => {
    server = people(5);

    await renderScreen();
    expect(screen.queryByText('Person 4')).not.toBeOnTheScreen();
    await scrollToEnd();

    expect(pages()[0][0]).toEqual({
      before: { blockedAt: '2026-10-09T10:57:00+00:00', userId: 'p03' },
      limit: 3,
    });
    expect(screen.getByText('Person 4')).toBeOnTheScreen();
    expect(screen.getByText('Person 5')).toBeOnTheScreen();
    expect(screen.getByText('Person 1')).toBeOnTheScreen();
  });

  it('shows the spinner while the next page is on its way', async () => {
    server = people(5);
    await renderScreen();

    const reply = deferred<ReturnType<typeof page>>();
    jest.mocked(fetchBlockedUsers).mockReturnValueOnce(reply.promise);
    await scrollToEnd();
    expect(screen.getByLabelText('Loading more blocked people')).toBeOnTheScreen();

    await act(async () => reply.resolve(page(server[2], 3)));
    expect(screen.queryByLabelText('Loading more blocked people')).not.toBeOnTheScreen();
    expect(screen.getByText('Person 5')).toBeOnTheScreen();
  });

  it('reads nothing more once a short page said the list ended', async () => {
    server = people(5);

    await renderScreen();
    await scrollToEnd();
    await scrollToEnd();

    expect(pages()).toHaveLength(1);
  });

  it('reads nothing past a first page that was already short', async () => {
    server = people(2);

    await renderScreen();
    await scrollToEnd();

    expect(pages()).toHaveLength(0);
  });

  it('asks again for a page that failed', async () => {
    server = people(5);
    await renderScreen();

    jest
      .mocked(fetchBlockedUsers)
      .mockResolvedValueOnce({ blocked: null, cursor: null, error: 'TypeError: Failed to fetch', retryable: true });
    await scrollToEnd();
    expect(screen.queryByText('Person 4')).not.toBeOnTheScreen();
    expect(screen.queryByText(OFFLINE_LOAD)).not.toBeOnTheScreen();

    await scrollToEnd();
    expect(pages()).toHaveLength(2);
    expect(screen.getByText('Person 4')).toBeOnTheScreen();
  });
});

describe('unblocking', () => {
  it('drops the row and re-reads the count, with no confirm', async () => {
    server = people(2);

    await renderScreen();
    await fireEvent.press(screen.getByLabelText('Unblock Person 1'));

    expect(unblockUser).toHaveBeenCalledWith('p01');
    expect(screen.queryByText('Person 1')).not.toBeOnTheScreen();
    expect(screen.getByText('Person 2')).toBeOnTheScreen();
    expect(refreshUnread).toHaveBeenCalledTimes(1);
  });

  /** The keyset continues from the cursor's values, so its row going changes nothing. */
  it('keeps the cursor, even when the row it came from is gone', async () => {
    server = people(5);

    await renderScreen();
    await fireEvent.press(screen.getByLabelText('Unblock Person 3'));
    await scrollToEnd();

    expect(pages()[0][0]).toEqual({
      before: { blockedAt: '2026-10-09T10:57:00+00:00', userId: 'p03' },
      limit: 3,
    });
    for (const name of ['Person 1', 'Person 2', 'Person 4', 'Person 5']) {
      expect(screen.getByText(name)).toBeOnTheScreen();
    }
    expect(screen.queryByText('Person 3')).not.toBeOnTheScreen();
  });

  it('shows Unblocking… on that pill only, and holds it', async () => {
    server = people(2);
    const reply = deferred<{ error: null; verdict: 'ok' }>();
    jest.mocked(unblockUser).mockReturnValueOnce(reply.promise);

    await renderScreen();
    await fireEvent.press(screen.getByLabelText('Unblock Person 1'));

    expect(screen.getByLabelText('Unblock Person 1')).toHaveTextContent('Unblocking…');
    expect(screen.getByLabelText('Unblock Person 1')).toBeDisabled();
    expect(screen.getByLabelText('Unblock Person 2')).toHaveTextContent('Unblock');
    expect(screen.getByLabelText('Unblock Person 2')).not.toBeDisabled();

    await act(async () => reply.resolve({ error: null, verdict: 'ok' }));
    expect(screen.queryByText('Person 1')).not.toBeOnTheScreen();
  });

  it('says a connection is needed, and keeps the row', async () => {
    server = people(2);
    jest.mocked(unblockUser).mockResolvedValueOnce({ error: 'TypeError: Failed to fetch', verdict: 'retryable' });

    await renderScreen();
    await fireEvent.press(screen.getByLabelText('Unblock Person 1'));

    expect(screen.getByText(OFFLINE_ACTION)).toBeOnTheScreen();
    expect(screen.getByLabelText('Unblock Person 1')).toHaveTextContent('Unblock');
    expect(screen.getByLabelText('Unblock Person 1')).not.toBeDisabled();
    expect(refreshUnread).not.toHaveBeenCalled();
  });

  it('signs this device out for a revoked session', async () => {
    server = people(2);
    jest.mocked(unblockUser).mockResolvedValueOnce({
      error: 'this device has been signed out',
      verdict: 'permanent',
      sessionRevoked: true,
    });

    await renderScreen();
    await fireEvent.press(screen.getByLabelText('Unblock Person 1'));

    expect(signOut).toHaveBeenCalledWith('revoked');
    expect(screen.queryByText('this device has been signed out')).not.toBeOnTheScreen();
  });

  /** Otherwise the empty state would say nobody is blocked while older blocks remain. */
  it('reads the next page once every loaded row is gone', async () => {
    server = people(4);

    await renderScreen();
    for (const name of ['Person 1', 'Person 2', 'Person 3']) {
      await fireEvent.press(screen.getByLabelText(`Unblock ${name}`));
    }

    expect(pages()).toHaveLength(1);
    expect(screen.getByText('Person 4')).toBeOnTheScreen();
    expect(screen.queryByText("You haven't blocked anyone")).not.toBeOnTheScreen();
  });

  it('says nobody is blocked once the last of them is unblocked', async () => {
    server = people(1);

    await renderScreen();
    await fireEvent.press(screen.getByLabelText('Unblock Person 1'));

    expect(screen.getByText("You haven't blocked anyone")).toBeOnTheScreen();
    expect(pages()).toHaveLength(0);
  });
});
