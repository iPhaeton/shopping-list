import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { fetchLists, insertList, setListDeleted } from '../lib/listsApi';
import type { ListsScreenProps } from '../navigation/types';
import { ListsProvider } from '../state/ListsContext';
import type { Cursor, List, Stream } from '../state/types';
import { ListsScreen } from './ListsScreen';

/**
 * The screens take `navigation`/`route` as props rather than calling `useNavigation()`,
 * so a stub is enough here — no NavigationContainer needed.
 *
 * The provider now fetches on mount, so `src/lib/listsApi.ts` is mocked at the module boundary:
 * this suite is about the screen, and an empty database is what it used to start from anyway.
 *
 * Note: `render` and `fireEvent` are async in React Native Testing Library 14 and must
 * be awaited, otherwise the assertions run before anything has been mounted.
 */
jest.mock('../lib/listsApi', () => ({
  fetchLists: jest.fn(async () => ({ lists: [], next: null, error: null })),
  fetchItems: jest.fn(async () => ({ items: [], next: null, error: null })),
  fetchItem: jest.fn(async () => ({ item: null, error: null })),
  fetchList: jest.fn(async () => ({ list: null, error: null })),
  insertList: jest.fn(async () => ({ error: null, verdict: 'ok' })),
  addItem: jest.fn(async () => ({ error: null, verdict: 'ok' })),
  renameItem: jest.fn(async () => ({ error: null, verdict: 'ok' })),
  setItemDone: jest.fn(async () => ({ error: null, verdict: 'ok' })),
  renameList: jest.fn(async () => ({ error: null, verdict: 'ok' })),
  setListDeleted: jest.fn(async () => ({ error: null, verdict: 'ok' })),
  setItemDeleted: jest.fn(async () => ({ error: null, verdict: 'ok' })),
}));

/** The provider opens a realtime channel once it is ready; stubbed so no websocket is involved. */
jest.mock('../lib/listsChannel', () => ({ subscribeToChanges: jest.fn(() => () => {}) }));

// The provider queues writes on disk now; without this each test inherits the last one's outbox.
beforeEach(async () => {
  await AsyncStorage.clear();
});

/**
 * What the database holds, as `fetchLists` answers it: one stream at a time, the lists with no
 * tombstone to the live stream and the rest to the bin — a single page each, unless a cursor says
 * that stream has more.
 */
function serveLists(lists: List[], next: Partial<Record<Stream, Cursor>> = {}) {
  jest.mocked(fetchLists).mockImplementation(async (stream) => ({
    lists: lists.filter((list) => (list.deletedAt === null) === (stream === 'live')),
    next: next[stream] ?? null,
    error: null,
  }));
}

async function renderScreen() {
  const navigation = { navigate: jest.fn(), setOptions: jest.fn() };

  await render(
    <ListsProvider userId="u1" onSessionRevoked={() => {}}>
      <ListsScreen {...({ navigation } as unknown as ListsScreenProps)} />
    </ListsProvider>
  );

  // The screen shows a spinner until the first fetch settles.
  await screen.findByLabelText('New list name');

  return { navigation };
}

async function createList(name: string) {
  await fireEvent.changeText(screen.getByLabelText('New list name'), name);
  await fireEvent.press(screen.getByLabelText('Create'));
}

it('shows an empty state before any list exists', async () => {
  await renderScreen();

  expect(screen.getByText('No lists yet')).toBeOnTheScreen();
});

it('creates a list and shows it on screen', async () => {
  await renderScreen();

  await createList('Groceries');

  expect(screen.queryByText('No lists yet')).not.toBeOnTheScreen();
  expect(screen.getByText('Groceries')).toBeOnTheScreen();
});

it('clears the input after creating a list', async () => {
  await renderScreen();

  await createList('Groceries');

  expect(screen.getByLabelText('New list name')).toHaveDisplayValue('');
});

it('does not create a list from blank input', async () => {
  await renderScreen();

  await createList('   ');

  expect(screen.getByText('No lists yet')).toBeOnTheScreen();
});

it('keeps several lists', async () => {
  await renderScreen();

  await createList('Groceries');
  await createList('Hardware');

  expect(screen.getByText('Groceries')).toBeOnTheScreen();
  expect(screen.getByText('Hardware')).toBeOnTheScreen();
});

/** The empty state must not appear before the fetch that would contradict it has come back. */
it('shows a spinner instead of the empty state while loading', async () => {
  let settle = (_result: { lists: List[] | null; next: Cursor | null; error: string | null }) => {};
  jest.mocked(fetchLists).mockReturnValueOnce(
    new Promise((resolve) => {
      settle = resolve;
    })
  );

  await render(
    <ListsProvider userId="u1" onSessionRevoked={() => {}}>
      <ListsScreen {...({ navigation: { navigate: jest.fn() } } as unknown as ListsScreenProps)} />
    </ListsProvider>
  );

  expect(screen.getByLabelText('Loading your lists')).toBeOnTheScreen();
  expect(screen.queryByText('No lists yet')).not.toBeOnTheScreen();

  await act(async () => settle({ lists: [], next: null, error: null }));

  expect(screen.getByText('No lists yet')).toBeOnTheScreen();
});

it('shows the message when the database refuses a write', async () => {
  jest.mocked(insertList).mockResolvedValueOnce({ error: 'permission denied', verdict: 'permanent' });

  await renderScreen();
  await createList('Groceries');

  expect(await screen.findByText('permission denied')).toBeOnTheScreen();
});

/** A write that has not landed *yet* is not an error, and must not be dressed as one. */
it('says a write is waiting to sync instead of raising an error', async () => {
  jest
    .mocked(insertList)
    .mockResolvedValueOnce({ error: 'TypeError: Failed to fetch', verdict: 'retryable' });

  await renderScreen();
  await createList('Groceries');

  expect(
    await screen.findByText("1 change will sync when you're back online")
  ).toBeOnTheScreen();
  expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
  expect(screen.getByText('Groceries')).toBeOnTheScreen();
});

/**
 * A list somebody shared with you says so, and says whether you can edit it; one you own reads
 * exactly as it always has, so no existing query moves. The a11y label deliberately does not grow
 * to mention the role — it stays `name, shared with you` regardless — only the *visible* subtitle
 * splits by role. It also deliberately does not say how widely *your* list is shared — the
 * `list_members` select policy shows you your own row only, so any count would read `1` for
 * everybody.
 */
it('marks a list somebody else shared, in the label as well as on screen', async () => {
  serveLists([
      { id: 'l1', name: 'Groceries', role: 'reader', deletedAt: null, joinedAt: null, itemsLoaded: false, items: [], nextLive: null, nextBin: null },
      { id: 'l2', name: 'Weekend BBQ', role: 'writer', deletedAt: null, joinedAt: null, itemsLoaded: false, items: [], nextLive: null, nextBin: null },
      { id: 'l3', name: 'Hardware', role: 'owner', deletedAt: null, joinedAt: null, itemsLoaded: false, items: [], nextLive: null, nextBin: null },
    ]);

  await renderScreen();

  expect(screen.getByText('Shared with you · view only')).toBeOnTheScreen();
  expect(screen.getByText('Shared with you · can edit')).toBeOnTheScreen();
  expect(screen.queryAllByText(/^Shared with you/)).toHaveLength(2);
  expect(screen.getByLabelText('Groceries, shared with you')).toBeOnTheScreen();
  expect(screen.getByLabelText('Weekend BBQ, shared with you')).toBeOnTheScreen();
  expect(screen.getByLabelText('Hardware')).toBeOnTheScreen();
});

it('navigates to the list when a row is pressed', async () => {
  const { navigation } = await renderScreen();

  await createList('Groceries');
  await fireEvent.press(screen.getByLabelText('Groceries'));

  expect(navigation.navigate).toHaveBeenCalledWith('ListDetail', {
    listId: expect.any(String),
  });
});

/**
 * The title row's Account button replaced the native header's since task 20 step 3 — drawn inside
 * the screen itself, as part of the sky/horizon composition, and reached with `navigation` as a
 * prop like everything else here, never a hook.
 */
it('opens Account when the Account button is pressed', async () => {
  const { navigation } = await renderScreen();

  await fireEvent.press(screen.getByLabelText('Account'));

  expect(navigation.navigate).toHaveBeenCalledWith('Account');
});

// --- The bin ------------------------------------------------------------------------------------

const BINNED_AT = '2026-09-10T09:00:00.000Z';

/** One live list and one in the bin, both owned. */
function withBin() {
  serveLists([
      { id: 'l1', name: 'Groceries', role: 'owner', deletedAt: null, joinedAt: null, itemsLoaded: false, items: [], nextLive: null, nextBin: null },
      { id: 'l2', name: 'Hardware', role: 'owner', deletedAt: BINNED_AT, joinedAt: null, itemsLoaded: false, items: [], nextLive: null, nextBin: null },
    ]);
}

it('leaves deleted lists off the screen until they are asked for', async () => {
  withBin();

  await renderScreen();

  expect(screen.getByText('Groceries')).toBeOnTheScreen();
  expect(screen.queryByText('Hardware')).not.toBeOnTheScreen();
});

/**
 * Deleted rows arrive in the same fetch as live ones, so this is instant: no spinner and no round
 * trip. That is most of why the bin reads better than a separate screen would.
 */
it('reveals them behind the switch, with no second request', async () => {
  withBin();

  await renderScreen();
  jest.mocked(fetchLists).mockClear();

  const toggle = screen.getByRole('switch', { name: 'Show 1 deleted' });
  expect(toggle).not.toBeChecked();

  await fireEvent.press(toggle);

  expect(screen.getByLabelText('Show 1 deleted')).toBeChecked();
  expect(screen.getByText('Hardware')).toBeOnTheScreen();
  expect(screen.getByText('Deleted')).toBeOnTheScreen();
  expect(fetchLists).not.toHaveBeenCalled();
});

/** A control that reveals nothing is noise, and there is nothing else in the app like it. */
it('does not offer the switch when the bin is empty', async () => {
  serveLists([{ id: 'l1', name: 'Groceries', role: 'owner', deletedAt: null, joinedAt: null, itemsLoaded: false, items: [], nextLive: null, nextBin: null }]);

  await renderScreen();

  expect(screen.queryByLabelText('Show 1 deleted')).not.toBeOnTheScreen();
});

it('sends a list to the bin and brings it back', async () => {
  withBin();

  await renderScreen();

  await fireEvent.press(screen.getByLabelText('Delete Groceries'));
  expect(setListDeleted).toHaveBeenCalledWith('l1', true);

  await fireEvent.press(screen.getByLabelText('Show 2 deleted'));
  await fireEvent.press(screen.getByLabelText('Restore Hardware'));
  expect(setListDeleted).toHaveBeenCalledWith('l2', false);
});

/** Roles decide which controls exist; the database still decides whether a write is allowed. */
it('gives a non-owner no way to delete a list', async () => {
  serveLists([{ id: 'l1', name: 'Groceries', role: 'writer', deletedAt: null, joinedAt: null, itemsLoaded: false, items: [], nextLive: null, nextBin: null }]);

  await renderScreen();

  expect(screen.queryByLabelText('Delete Groceries')).not.toBeOnTheScreen();
});

/** The empty state is a claim about the account, and a binned list must not silence it. */
it('still says the account has no lists when the only one is in the bin', async () => {
  serveLists([{ id: 'l2', name: 'Hardware', role: 'owner', deletedAt: BINNED_AT, joinedAt: null, itemsLoaded: false, items: [], nextLive: null, nextBin: null }]);

  await renderScreen();

  expect(screen.getByText('No lists yet')).toBeOnTheScreen();
});

// --- More lists than a page ---------------------------------------------------------------------

/**
 * Lists are paged the way a list's items are: page 1 of both streams with every fetch, the rest as
 * the user scrolls. The `FlatList` gets an `onEndReached` handler only while there is a cursor to
 * follow, so an account whose lists fit in a page has nothing wired at all.
 */
const joined = (n: number) => `2026-09-02T00:00:${String(n).padStart(2, '0')}+00:00`;
const cursorAt = (n: number): Cursor => ({ createdAt: joined(n), id: `l${n}` });

/** List `n` as a page carries it: joined in the order of `n`. */
function listAt(n: number, deletedAt: string | null = null): List {
  return {
    id: `l${n}`,
    name: `List ${n}`,
    role: 'owner',
    deletedAt,
    joinedAt: joined(n),
    itemsLoaded: false,
    items: [],
    nextLive: null,
    nextBin: null,
  };
}

/** Reaching the end is an event on the `FlatList`; a row inside it is where the event walks up from. */
async function scrollToEnd() {
  await fireEvent(screen.getByLabelText('List 1'), 'endReached');
}

/** The list rows in the order they are drawn. */
function rowLabels(): string[] {
  return screen
    .getAllByRole('button')
    .map((row) => String(row.props.accessibilityLabel))
    .filter((label) => label.startsWith('List '));
}

describe('more lists than a page', () => {
  it('loads the next page of lists when scrolled to the end', async () => {
    serveLists([listAt(1), listAt(2)], { live: cursorAt(2) });
    await renderScreen();
    jest.mocked(fetchLists).mockClear();
    jest.mocked(fetchLists).mockResolvedValueOnce({ lists: [listAt(3)], next: null, error: null });

    await scrollToEnd();

    expect(await screen.findByLabelText('List 3')).toBeOnTheScreen();
    expect(fetchLists).toHaveBeenCalledTimes(1);
    expect(fetchLists).toHaveBeenCalledWith('live', cursorAt(2));
    expect(rowLabels()).toEqual(['List 1', 'List 2', 'List 3']);
  });

  it('shows a spinner at the foot of the lists while the page is on its way', async () => {
    serveLists([listAt(1), listAt(2)], { live: cursorAt(2) });
    await renderScreen();
    let settle = (_page: { lists: List[]; next: null; error: null }) => {};
    jest.mocked(fetchLists).mockReturnValueOnce(
      new Promise((resolve) => {
        settle = resolve;
      })
    );

    await scrollToEnd();
    expect(screen.getByLabelText('Loading more lists')).toBeOnTheScreen();

    await act(async () => settle({ lists: [], next: null, error: null }));
    expect(screen.queryByLabelText('Loading more lists')).not.toBeOnTheScreen();
  });

  it('asks for nothing at the end when every list is loaded', async () => {
    serveLists([listAt(1), listAt(2, BINNED_AT)]);
    await renderScreen();
    jest.mocked(fetchLists).mockClear();

    await scrollToEnd();

    expect(fetchLists).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Loading more lists')).not.toBeOnTheScreen();
  });

  /** The count is what is loaded, not what exists, until the bin's last page is in. */
  it('says the bin holds more than it has loaded', async () => {
    const binned = Array.from({ length: 100 }, (_, i) => listAt(i + 2, BINNED_AT));
    serveLists([listAt(1), ...binned], { bin: cursorAt(101) });

    await renderScreen();

    expect(screen.getByRole('switch', { name: 'Show 100+ deleted' })).toBeOnTheScreen();
  });

  it('loads the bin as well once it is showing', async () => {
    serveLists([listAt(1), listAt(2, BINNED_AT)], { bin: cursorAt(2) });
    await renderScreen();

    // Hidden, the bin's cursor is not followed.
    jest.mocked(fetchLists).mockClear();
    await scrollToEnd();
    expect(fetchLists).not.toHaveBeenCalled();

    jest
      .mocked(fetchLists)
      .mockResolvedValueOnce({ lists: [listAt(3, BINNED_AT)], next: null, error: null });
    await fireEvent.press(screen.getByLabelText('Show 1+ deleted'));
    await scrollToEnd();

    expect(await screen.findByText('List 3')).toBeOnTheScreen();
    expect(fetchLists).toHaveBeenCalledWith('bin', cursorAt(2));
    // Every list is loaded now, so the count is exact and the `+` is gone.
    expect(screen.getByLabelText('Show 2 deleted')).toBeOnTheScreen();
  });

  /**
   * The two streams arrive end to end, so with the bin showing the screen sorts by when each list
   * was joined rather than drawing them in arrival order — and a list created here, not yet
   * acknowledged, stays last.
   */
  it('orders lists by when they were joined, the bin interleaved, a new one last', async () => {
    serveLists([listAt(1), listAt(3), listAt(2, BINNED_AT), listAt(4, BINNED_AT)]);
    await renderScreen();
    await createList('List 0');

    expect(rowLabels()).toEqual(['List 1', 'List 3', 'List 0']);

    await fireEvent.press(screen.getByLabelText('Show 2 deleted'));

    expect(rowLabels()).toEqual(['List 1', 'List 2', 'List 3', 'List 4', 'List 0']);
  });
});
