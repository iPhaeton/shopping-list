import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';

import { insertItem } from '../lib/listsApi';
import type { ListDetailScreenProps } from '../navigation/types';
import { ListsProvider, useLists } from '../state/ListsContext';
import { ListDetailScreen } from './ListDetailScreen';

/**
 * `src/lib/listsApi.ts` is mocked at the module boundary — the provider fetches on mount now, and
 * this suite is about the screen, not about what the database returns.
 */
jest.mock('../lib/listsApi', () => ({
  fetchLists: jest.fn(async () => ({ lists: [], error: null })),
  insertList: jest.fn(async () => ({ error: null, verdict: 'ok' })),
  insertItem: jest.fn(async () => ({ error: null, verdict: 'ok' })),
  setItemDone: jest.fn(async () => ({ error: null, verdict: 'ok' })),
}));

const navigation = { navigate: jest.fn(), setOptions: jest.fn() };

function detailProps(listId: string) {
  return { navigation, route: { params: { listId } } } as unknown as ListDetailScreenProps;
}

/**
 * Creates a real list through the provider, then renders the detail screen for it.
 *
 * It waits for `status` first because hydration replaces the whole of state: a list created before
 * the fetch lands would be wiped by it. The app has the same ordering — `ListsScreen` renders a
 * spinner, not an input, until the fetch is in.
 */
function Harness({ listName }: { listName: string }) {
  const { lists, status, createList } = useLists();

  useEffect(() => {
    if (status === 'ready') createList(listName);
  }, [status, createList, listName]);

  const list = lists[0];
  return list ? <ListDetailScreen {...detailProps(list.id)} /> : null;
}

/**
 * Note: `render` and `fireEvent` are async in React Native Testing Library 14 and must
 * be awaited, otherwise the assertions run before anything has been mounted.
 */
async function renderScreen(listName = 'Groceries') {
  await render(
    <ListsProvider userId="u1">
      <Harness listName={listName} />
    </ListsProvider>
  );

  // Nothing renders until the fetch has settled and the harness has created its list.
  await screen.findByLabelText('Add an item');
}

async function addItem(title: string) {
  await fireEvent.changeText(screen.getByLabelText('Add an item'), title);
  await fireEvent.press(screen.getByLabelText('Add'));
}

beforeEach(async () => {
  navigation.setOptions.mockClear();
  // The provider queues writes on disk now; without this each test inherits the last one's outbox.
  await AsyncStorage.clear();
});

it('shows an empty state for a list with no items', async () => {
  await renderScreen();

  expect(screen.getByText('Nothing on this list')).toBeOnTheScreen();
});

it('puts the list name in the header', async () => {
  await renderScreen('Hardware');

  expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Hardware' });
});

it('adds items and shows them unchecked, in order', async () => {
  await renderScreen();

  await addItem('Milk');
  await addItem('Bread');

  expect(screen.queryByText('Nothing on this list')).not.toBeOnTheScreen();
  expect(screen.getByLabelText('Milk')).not.toBeChecked();
  expect(screen.getAllByRole('checkbox').map((row) => row.props.accessibilityLabel)).toEqual([
    'Milk',
    'Bread',
  ]);
});

it('clears the input after adding an item', async () => {
  await renderScreen();

  await addItem('Milk');

  expect(screen.getByLabelText('Add an item')).toHaveDisplayValue('');
});

it('does not add a blank item', async () => {
  await renderScreen();

  await addItem('   ');

  expect(screen.getByText('Nothing on this list')).toBeOnTheScreen();
});

it('marks an item done and unmarks it again', async () => {
  await renderScreen();
  await addItem('Milk');

  await fireEvent.press(screen.getByLabelText('Milk'));
  expect(screen.getByLabelText('Milk')).toBeChecked();

  await fireEvent.press(screen.getByLabelText('Milk'));
  expect(screen.getByLabelText('Milk')).not.toBeChecked();
});

it('toggles only the item that was pressed', async () => {
  await renderScreen();
  await addItem('Milk');
  await addItem('Bread');

  await fireEvent.press(screen.getByLabelText('Bread'));

  expect(screen.getByLabelText('Milk')).not.toBeChecked();
  expect(screen.getByLabelText('Bread')).toBeChecked();
});

/** With no signal the item is still added — it is queued, and the screen says so quietly. */
it('keeps an item added offline and says it is waiting to sync', async () => {
  jest
    .mocked(insertItem)
    .mockResolvedValueOnce({ error: 'TypeError: Failed to fetch', verdict: 'retryable' });

  await renderScreen();
  await addItem('Milk');

  expect(await screen.findByText("1 change will sync when you're back online")).toBeOnTheScreen();
  expect(screen.getByLabelText('Milk')).not.toBeChecked();
});

it('falls back to a not-found state for an unknown list', async () => {
  await render(
    <ListsProvider userId="u1">
      <ListDetailScreen {...detailProps('does-not-exist')} />
    </ListsProvider>
  );

  expect(screen.getByText('List not found')).toBeOnTheScreen();
});
