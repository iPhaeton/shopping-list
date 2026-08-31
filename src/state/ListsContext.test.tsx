import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { fetchLists, insertItem, insertList, setItemDone } from '../lib/listsApi';
import { ListsProvider, useLists } from './ListsContext';

/**
 * `src/lib/listsApi.ts` is mocked at the module boundary, the same seam the auth suites use for
 * `src/lib/supabase.ts` — so `@supabase/supabase-js` is never loaded here and the real provider
 * runs against four plain functions.
 *
 * Note: `render` and `fireEvent` are async in React Native Testing Library 14 and must be awaited.
 * Resolving a promise the provider is already waiting on additionally needs `act`, since nothing
 * RNTL owns triggered the update that follows.
 */
jest.mock('../lib/listsApi', () => ({
  fetchLists: jest.fn(),
  insertList: jest.fn(),
  insertItem: jest.fn(),
  setItemDone: jest.fn(),
}));

const api = {
  fetchLists: jest.mocked(fetchLists),
  insertList: jest.mocked(insertList),
  insertItem: jest.mocked(insertItem),
  setItemDone: jest.mocked(setItemDone),
};

const MILK = { id: 'i1', title: 'Milk', doneAt: null };
const GROCERIES = { id: 'l1', name: 'Groceries', items: [MILK] };

beforeEach(() => {
  jest.clearAllMocks();

  api.fetchLists.mockResolvedValue({ lists: [], error: null });
  api.insertList.mockResolvedValue({ error: null });
  api.insertItem.mockResolvedValue({ error: null });
  api.setItemDone.mockResolvedValue({ error: null });
});

/** Renders the provider's whole surface as text, so assertions read what a screen would see. */
function Probe() {
  const { lists, status, error, createList, addItem, toggleItem } = useLists();

  return (
    <>
      <Text>{`status: ${status}`}</Text>
      <Text>{`error: ${error ?? 'none'}`}</Text>
      {lists.map((list) => (
        <Text key={list.id}>
          {`${list.id} ${list.name}: ${list.items
            .map((item) => `${item.title}${item.doneAt === null ? '' : ' done'}`)
            .join(', ')}`}
        </Text>
      ))}
      {/* Labels deliberately name no list or item, so a query for one matches only a row. */}
      <Button label="create" onPress={() => createList('Groceries')} />
      <Button label="create blank" onPress={() => createList('   ')} />
      <Button label="add" onPress={() => addItem('l1', 'Bread')} />
      <Button label="toggle" onPress={() => toggleItem('l1', 'i1')} />
    </>
  );
}

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      <Text>{label}</Text>
    </Pressable>
  );
}

async function renderProbe() {
  await render(
    <ListsProvider>
      <Probe />
    </ListsProvider>
  );

  await screen.findByText('status: ready');
}

it('hydrates from the database on mount', async () => {
  api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null });

  await renderProbe();

  expect(screen.getByText('l1 Groceries: Milk')).toBeOnTheScreen();
  expect(api.fetchLists).toHaveBeenCalledTimes(1);
});

it('reports a failed load without pretending the account has no lists', async () => {
  api.fetchLists.mockResolvedValue({ lists: null, error: 'network down' });

  await renderProbe();

  expect(screen.getByText('error: network down')).toBeOnTheScreen();
});

/**
 * The point of minting the id on the client: the row is on screen before the insert is answered,
 * and it carries the same id the insert was given, so a retry cannot duplicate it.
 */
it('shows a new list before the insert comes back, under the id it sent', async () => {
  let settleInsert = (_result: { error: string | null }) => {};
  api.insertList.mockReturnValue(
    new Promise<{ error: string | null }>((resolve) => {
      settleInsert = resolve;
    })
  );

  await renderProbe();
  await fireEvent.press(screen.getByLabelText('create'));

  const [id, name] = api.insertList.mock.calls[0];
  expect(name).toBe('Groceries');
  expect(screen.getByText(`${id} Groceries: `)).toBeOnTheScreen();

  await act(async () => settleInsert({ error: null }));
  expect(screen.getByText('error: none')).toBeOnTheScreen();
});

it('does not write a blank list name', async () => {
  await renderProbe();

  await fireEvent.press(screen.getByLabelText('create blank'));

  expect(api.insertList).not.toHaveBeenCalled();
});

it('adds an item optimistically and inserts it against its list', async () => {
  api.fetchLists.mockResolvedValue({ lists: [{ ...GROCERIES, items: [] }], error: null });

  await renderProbe();
  await fireEvent.press(screen.getByLabelText('add'));

  expect(screen.getByText('l1 Groceries: Bread')).toBeOnTheScreen();
  await waitFor(() =>
    expect(api.insertItem).toHaveBeenCalledWith(expect.any(String), 'l1', 'Bread')
  );
});

/**
 * Done, then not done — never "flip whatever is there now". The timestamp is the database's to
 * mint, so what crosses this boundary is the target state, not a time.
 */
it('sends an absolute value when an item is toggled', async () => {
  api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null });

  await renderProbe();

  await fireEvent.press(screen.getByLabelText('toggle'));
  expect(screen.getByText('l1 Groceries: Milk done')).toBeOnTheScreen();
  expect(api.setItemDone).toHaveBeenLastCalledWith('i1', true);

  await fireEvent.press(screen.getByLabelText('toggle'));
  expect(screen.getByText('l1 Groceries: Milk')).toBeOnTheScreen();
  expect(api.setItemDone).toHaveBeenLastCalledWith('i1', false);
});

/**
 * Rollback is a re-fetch rather than an inverse action, so the screen ends up showing what the
 * database holds instead of the client's guess at what it had just done.
 */
it('surfaces a failed write and falls back to what the database holds', async () => {
  api.fetchLists.mockResolvedValue({ lists: [], error: null });
  api.insertList.mockResolvedValue({ error: 'permission denied' });

  await renderProbe();
  await fireEvent.press(screen.getByLabelText('create'));

  expect(await screen.findByText('error: permission denied')).toBeOnTheScreen();
  await waitFor(() => expect(api.fetchLists).toHaveBeenCalledTimes(2));
  expect(screen.queryByText(/Groceries/)).not.toBeOnTheScreen();
});
