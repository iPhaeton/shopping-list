import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { fetchLists, insertList } from '../lib/listsApi';
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
  fetchLists: jest.fn(async () => ({ lists: [], error: null })),
  insertList: jest.fn(async () => ({ error: null, verdict: 'ok' })),
  insertItem: jest.fn(async () => ({ error: null, verdict: 'ok' })),
  setItemDone: jest.fn(async () => ({ error: null, verdict: 'ok' })),
}));

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
  let settle = (_result: { lists: List[] | null; error: string | null }) => {};
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

  await act(async () => settle({ lists: [], error: null }));

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

it('navigates to the list when a row is pressed', async () => {
  const { navigation } = await renderScreen();

  await createList('Groceries');
  await fireEvent.press(screen.getByLabelText('Groceries, No items yet'));

  expect(navigation.navigate).toHaveBeenCalledWith('ListDetail', {
    listId: expect.any(String),
  });
});
