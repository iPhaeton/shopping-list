import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { LISTS_FULL, OWNED_LISTS_FULL } from '../lib/limits';
import { fetchListCounts, fetchLists, insertList, setListDeleted } from '../lib/listsApi';
import type { ListsScreenProps } from '../navigation/types';
import { ListsProvider } from '../state/ListsContext';
import type { BinCursor, Cursor, List } from '../state/types';
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
  fetchListCounts: jest.fn(async () => ({ counts: { owned: 0, total: 0 }, error: null })),
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
function serveLists(lists: List[], next: { live?: Cursor; bin?: BinCursor } = {}) {
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
 * "Show deleted" switches the whole screen to the bin: the binned lists and nothing else, and the
 * Create bar gives way to a sentence, since nothing is created there. Page 1 of the bin arrives with
 * every read of the lists, so the switch is instant: no spinner and no round trip.
 */
it('switches the screen to the bin and back, with no second request', async () => {
  withBin();

  await renderScreen();
  jest.mocked(fetchLists).mockClear();

  const toggle = screen.getByRole('switch', { name: 'Show deleted' });
  expect(toggle).not.toBeChecked();

  await fireEvent.press(toggle);

  expect(screen.getByRole('switch', { name: 'Show deleted' })).toBeChecked();
  expect(screen.getByText('Hardware')).toBeOnTheScreen();
  expect(screen.queryByText('Groceries')).not.toBeOnTheScreen();
  expect(screen.getByText('Deleted lists, newest first.')).toBeOnTheScreen();
  expect(screen.queryByLabelText('New list name')).not.toBeOnTheScreen();
  // Every row here is deleted, so no row says so.
  expect(screen.queryByText('Deleted')).not.toBeOnTheScreen();
  expect(fetchLists).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByRole('switch', { name: 'Show deleted' }));

  expect(screen.getByText('Groceries')).toBeOnTheScreen();
  expect(screen.queryByText('Hardware')).not.toBeOnTheScreen();
  expect(screen.getByLabelText('New list name')).toBeOnTheScreen();
});

/** A control that reveals nothing is noise, and there is nothing else in the app like it. */
it('does not offer the switch when the bin is empty', async () => {
  serveLists([{ id: 'l1', name: 'Groceries', role: 'owner', deletedAt: null, joinedAt: null, itemsLoaded: false, items: [], nextLive: null, nextBin: null }]);

  await renderScreen();

  expect(screen.queryByRole('switch', { name: 'Show deleted' })).not.toBeOnTheScreen();
});

/**
 * Restoring the bin's last list must not take away the only way back to the live lists, so a
 * checked switch stays — over the one place that says the bin is empty.
 */
it('keeps the switch once the last binned list is restored, and says the bin is empty', async () => {
  withBin();

  await renderScreen();
  await fireEvent.press(screen.getByRole('switch', { name: 'Show deleted' }));
  await fireEvent.press(screen.getByLabelText('Restore Hardware'));

  expect(setListDeleted).toHaveBeenCalledWith('l2', false);
  expect(screen.getByText('The bin is empty')).toBeOnTheScreen();
  expect(screen.getByText('Deleted lists wait here for 30 days.')).toBeOnTheScreen();
  expect(screen.getByRole('switch', { name: 'Show deleted' })).toBeChecked();

  await fireEvent.press(screen.getByRole('switch', { name: 'Show deleted' }));

  expect(screen.getByText('Groceries')).toBeOnTheScreen();
  expect(screen.getByText('Hardware')).toBeOnTheScreen();
  expect(screen.queryByRole('switch', { name: 'Show deleted' })).not.toBeOnTheScreen();
});

it('sends a list to the bin and brings it back', async () => {
  withBin();

  await renderScreen();

  await fireEvent.press(screen.getByLabelText('Delete Groceries'));
  expect(setListDeleted).toHaveBeenCalledWith('l1', true);

  await fireEvent.press(screen.getByLabelText('Show deleted'));
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
const binCursorAt = (n: number): BinCursor => ({ deletedAt: BINNED_AT, id: `l${n}` });

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
async function scrollToEnd(row = 'List 1') {
  await fireEvent(screen.getByLabelText(row), 'endReached');
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

  /**
   * No count, ever — the user's call (task 24 step 1). It could only say what is loaded, not what
   * exists, so it needed a `+` until the bin's last page was in.
   */
  it('reads Show deleted with one list in the bin', async () => {
    serveLists([listAt(1), listAt(2, BINNED_AT)]);
    await renderScreen();

    expect(screen.getByRole('switch', { name: 'Show deleted' })).toBeOnTheScreen();
    expect(screen.getByText('Show deleted')).toBeOnTheScreen();
  });

  it('reads Show deleted with a hundred in the bin and more to come', async () => {
    const binned = Array.from({ length: 100 }, (_, i) => listAt(i + 2, BINNED_AT));
    serveLists([listAt(1), ...binned], { bin: binCursorAt(101) });
    await renderScreen();

    expect(screen.getByRole('switch', { name: 'Show deleted' })).toBeOnTheScreen();
    expect(screen.queryByText(/Show \d/)).not.toBeOnTheScreen();
  });

  /** The bin is its own view: a scroll asks for the next page of the stream on screen, never both. */
  it('asks only for the stream on screen at the end', async () => {
    serveLists([listAt(1), listAt(2, BINNED_AT)], { live: cursorAt(1), bin: binCursorAt(2) });
    await renderScreen();

    jest.mocked(fetchLists).mockClear();
    jest.mocked(fetchLists).mockResolvedValueOnce({ lists: [], next: null, error: null });
    await scrollToEnd();
    expect(jest.mocked(fetchLists).mock.calls).toEqual([['live', cursorAt(1)]]);

    jest.mocked(fetchLists).mockClear();
    jest
      .mocked(fetchLists)
      .mockResolvedValueOnce({ lists: [listAt(3, '2026-09-09T09:00:00.000Z')], next: null, error: null });
    await fireEvent.press(screen.getByLabelText('Show deleted'));
    await scrollToEnd('List 2');

    expect(await screen.findByText('List 3')).toBeOnTheScreen();
    expect(jest.mocked(fetchLists).mock.calls).toEqual([['bin', binCursorAt(2)]]);
  });

  /**
   * The live lists by when they were joined, a list created here and not yet acknowledged last —
   * sorted, since the two streams arrive end to end.
   */
  it('orders the live lists by when they were joined, a new one last', async () => {
    serveLists([listAt(1), listAt(3), listAt(2, BINNED_AT), listAt(4, BINNED_AT)]);
    await renderScreen();
    await createList('List 0');

    expect(rowLabels()).toEqual(['List 1', 'List 3', 'List 0']);
  });

  /** The bin newest deletion first, the order it is paged in, however the lists were joined. */
  it('orders the bin by when each list was deleted, newest first', async () => {
    serveLists([
      listAt(1),
      listAt(2, '2026-09-10T09:00:00.000Z'),
      listAt(3, '2026-09-12T09:00:00.000Z'),
      listAt(4, '2026-09-11T09:00:00.000Z'),
    ]);
    await renderScreen();

    await fireEvent.press(screen.getByLabelText('Show deleted'));

    expect(rowLabels()).toEqual(['List 3', 'List 4', 'List 2']);
  });
});

// --- At a list limit ----------------------------------------------------------------------------

/**
 * At either list limit the Create bar gives way to a sentence saying so — task 23 step 2. Asserted
 * verbatim, as every piece of copy a person reads here is. The item limit has no counterpart: List
 * detail never warns, and the database's refusal is the whole story there.
 */
describe('at a list limit', () => {
  const GROCERIES: List = { id: 'l1', name: 'Groceries', role: 'owner', deletedAt: null, joinedAt: '2026-09-01T08:00:00+00:00', itemsLoaded: false, items: [], nextLive: null, nextBin: null };

  function serveCounts(owned: number, total: number) {
    jest.mocked(fetchListCounts).mockResolvedValue({ counts: { owned, total }, error: null });
  }

  /** `renderScreen` waits for the Create bar, which is exactly what may not be there. */
  async function renderAtCounts(owned: number, total: number) {
    serveCounts(owned, total);
    const navigation = { navigate: jest.fn(), setOptions: jest.fn() };
    await render(
      <ListsProvider userId="u1" onSessionRevoked={() => {}}>
        <ListsScreen {...({ navigation } as unknown as ListsScreenProps)} />
      </ListsProvider>
    );
    await waitFor(() => expect(screen.queryByLabelText('Loading your lists')).not.toBeOnTheScreen());
  }

  afterEach(() => serveCounts(0, 0));

  it('says so in place of the Create bar at 100 owned lists', async () => {
    await renderAtCounts(100, 100);

    expect(screen.getByText('You own 100 lists. Delete one or hand one over to make room.')).toBeOnTheScreen();
    expect(screen.queryByLabelText('New list name')).not.toBeOnTheScreen();
  });

  it('says so in place of the Create bar at 1,000 lists in total', async () => {
    await renderAtCounts(3, 1000);

    expect(screen.getByText("You're on 1,000 lists. Delete or leave one to make room.")).toBeOnTheScreen();
    expect(screen.queryByLabelText('New list name')).not.toBeOnTheScreen();
  });

  it('keeps the Create bar one short of either limit', async () => {
    await renderAtCounts(99, 999);

    expect(screen.getByLabelText('New list name')).toBeOnTheScreen();
    expect(screen.queryByText(OWNED_LISTS_FULL)).not.toBeOnTheScreen();
    expect(screen.queryByText(LISTS_FULL)).not.toBeOnTheScreen();
  });

  /** The database checks the total first, so the warning names the limit a refusal would. */
  it('names the total when both are reached', async () => {
    await renderAtCounts(100, 1000);

    expect(screen.getByText(LISTS_FULL)).toBeOnTheScreen();
    expect(screen.queryByText(OWNED_LISTS_FULL)).not.toBeOnTheScreen();
  });

  it('counts a list the moment it is created', async () => {
    await renderAtCounts(99, 99);

    await createList('Groceries');

    expect(screen.getByText(OWNED_LISTS_FULL)).toBeOnTheScreen();
    expect(screen.queryByLabelText('New list name')).not.toBeOnTheScreen();
  });

  /** Nothing is created from the bin, so there it says what the bin is instead. */
  it('gives way to the bin sentence while the bin is shown', async () => {
    serveLists([GROCERIES, { ...GROCERIES, id: 'l2', name: 'Hardware', deletedAt: '2026-09-10T09:00:00.000Z' }]);
    await renderAtCounts(100, 100);

    await fireEvent.press(screen.getByLabelText('Show deleted'));

    expect(screen.getByText('Deleted lists, newest first.')).toBeOnTheScreen();
    expect(screen.queryByText(OWNED_LISTS_FULL)).not.toBeOnTheScreen();
  });

  /** The sentence says "delete one", so deleting one has to bring the bar back. */
  it('brings the Create bar back when a list is binned', async () => {
    serveLists([GROCERIES]);
    await renderAtCounts(100, 100);

    await fireEvent.press(screen.getByLabelText('Delete Groceries'));

    expect(screen.getByLabelText('New list name')).toBeOnTheScreen();
    expect(screen.queryByText(OWNED_LISTS_FULL)).not.toBeOnTheScreen();
  });
});
