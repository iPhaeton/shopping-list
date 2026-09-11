import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { fetchLists, insertList, setListDeleted } from '../lib/listsApi';
import type { ListsScreenProps } from '../navigation/types';
import { ListsProvider } from '../state/ListsContext';
import type { List } from '../state/types';
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
  fetchLists: jest.fn(async () => ({ lists: [], error: null, truncated: false })),
  fetchItems: jest.fn(async () => ({ items: [], next: null, error: null })),
  fetchItem: jest.fn(async () => ({ item: null, error: null })),
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

async function renderScreen() {
  const navigation = { navigate: jest.fn(), setOptions: jest.fn() };

  await render(
    <ListsProvider userId="u1">
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

it('creates a list and shows it with an item summary', async () => {
  await renderScreen();

  await createList('Groceries');

  expect(screen.queryByText('No lists yet')).not.toBeOnTheScreen();
  expect(screen.getByText('Groceries')).toBeOnTheScreen();
  expect(screen.getByText('No items yet')).toBeOnTheScreen();
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
  let settle = (_result: { lists: List[] | null; error: string | null; truncated: boolean }) => {};
  jest.mocked(fetchLists).mockReturnValueOnce(
    new Promise((resolve) => {
      settle = resolve;
    })
  );

  await render(
    <ListsProvider userId="u1">
      <ListsScreen {...({ navigation: { navigate: jest.fn() } } as unknown as ListsScreenProps)} />
    </ListsProvider>
  );

  expect(screen.getByLabelText('Loading your lists')).toBeOnTheScreen();
  expect(screen.queryByText('No lists yet')).not.toBeOnTheScreen();

  await act(async () => settle({ lists: [], error: null, truncated: false }));

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
 * A list somebody shared with you says so; one you own reads exactly as it always has, so no
 * existing query moves. It deliberately does not say how widely *your* list is shared — the
 * `list_members` select policy shows you your own row only, so any count would read `1` for
 * everybody.
 */
it('marks a list somebody else shared, in the label as well as on screen', async () => {
  jest.mocked(fetchLists).mockResolvedValue({
    lists: [
      { id: 'l1', name: 'Groceries', role: 'reader', deletedAt: null, items: [], nextLive: null, nextBin: null },
      { id: 'l2', name: 'Hardware', role: 'owner', deletedAt: null, items: [], nextLive: null, nextBin: null },
    ],
    error: null,
    truncated: false,
  });

  await renderScreen();

  expect(screen.getByText('Shared with you')).toBeOnTheScreen();
  expect(screen.getByLabelText('Groceries, No items yet, shared with you')).toBeOnTheScreen();
  expect(screen.getByLabelText('Hardware, No items yet')).toBeOnTheScreen();
});

/**
 * "2 of 5 done" is a claim about every live row, and a fetch carries only a first page of them. A
 * list with more beyond that page says what it knows — and how many it knows — until it has been
 * scrolled to its end, at which point the cursor clears and the row reverts to the exact copy.
 */
it('says how many items a long list has loaded rather than pretending to know the count', async () => {
  const item = (n: number) => ({
    id: `i${n}`,
    title: `Item ${n}`,
    doneAt: n % 2 === 0 ? '2026-09-02T09:00:00.000Z' : null,
    deletedAt: null,
    createdAt: `2026-09-01T00:00:${String(n).padStart(2, '0')}.000Z`,
  });
  jest.mocked(fetchLists).mockResolvedValue({
    lists: [
      {
        id: 'l1',
        name: 'Groceries',
        role: 'owner',
        deletedAt: null,
        items: [item(1), item(2), item(3)],
        nextLive: { createdAt: item(3).createdAt, id: 'i3' },
        nextBin: null,
      },
      {
        id: 'l2',
        name: 'Hardware',
        role: 'owner',
        deletedAt: null,
        items: [item(1), item(2), item(3)],
        nextLive: null,
        nextBin: null,
      },
    ],
    error: null,
    truncated: false,
  });

  await renderScreen();

  expect(screen.getByText('3+ items')).toBeOnTheScreen();
  expect(screen.getByLabelText('Groceries, 3+ items')).toBeOnTheScreen();
  expect(screen.getByLabelText('Hardware, 1 of 3 done')).toBeOnTheScreen();
});

it('navigates to the list when a row is pressed', async () => {
  const { navigation } = await renderScreen();

  await createList('Groceries');
  await fireEvent.press(screen.getByLabelText('Groceries, No items yet'));

  expect(navigation.navigate).toHaveBeenCalledWith('ListDetail', {
    listId: expect.any(String),
  });
});

// --- The bin ------------------------------------------------------------------------------------

const BINNED_AT = '2026-09-10T09:00:00.000Z';

/** One live list and one in the bin, both owned. */
function withBin() {
  jest.mocked(fetchLists).mockResolvedValue({
    lists: [
      { id: 'l1', name: 'Groceries', role: 'owner', deletedAt: null, items: [], nextLive: null, nextBin: null },
      { id: 'l2', name: 'Hardware', role: 'owner', deletedAt: BINNED_AT, items: [], nextLive: null, nextBin: null },
    ],
    error: null,
    truncated: false,
  });
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
it('reveals them behind the checkbox, with no second request', async () => {
  withBin();

  await renderScreen();
  jest.mocked(fetchLists).mockClear();

  const toggle = screen.getByLabelText('Show 1 deleted');
  expect(toggle).not.toBeChecked();

  await fireEvent.press(toggle);

  expect(screen.getByLabelText('Show 1 deleted')).toBeChecked();
  expect(screen.getByText('Hardware')).toBeOnTheScreen();
  expect(screen.getByText('Deleted')).toBeOnTheScreen();
  expect(fetchLists).not.toHaveBeenCalled();
});

/** A control that reveals nothing is noise, and there is nothing else in the app like it. */
it('does not offer the checkbox when the bin is empty', async () => {
  jest.mocked(fetchLists).mockResolvedValue({
    lists: [{ id: 'l1', name: 'Groceries', role: 'owner', deletedAt: null, items: [], nextLive: null, nextBin: null }],
    error: null,
    truncated: false,
  });

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
  jest.mocked(fetchLists).mockResolvedValue({
    lists: [{ id: 'l1', name: 'Groceries', role: 'writer', deletedAt: null, items: [], nextLive: null, nextBin: null }],
    error: null,
    truncated: false,
  });

  await renderScreen();

  expect(screen.queryByLabelText('Delete Groceries')).not.toBeOnTheScreen();
});

/** The empty state is a claim about the account, and a binned list must not silence it. */
it('still says the account has no lists when the only one is in the bin', async () => {
  jest.mocked(fetchLists).mockResolvedValue({
    lists: [{ id: 'l2', name: 'Hardware', role: 'owner', deletedAt: BINNED_AT, items: [], nextLive: null, nextBin: null }],
    error: null,
    truncated: false,
  });

  await renderScreen();

  expect(screen.getByText('No lists yet')).toBeOnTheScreen();
});
