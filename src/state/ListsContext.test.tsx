import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { writeCachedLists } from '../lib/listCache';
import { fetchLists, insertItem, insertList, setItemDone, type Result } from '../lib/listsApi';
import { saveOutbox } from '../lib/outbox';
import { ListsProvider, useLists } from './ListsContext';

/**
 * `src/lib/listsApi.ts` is mocked at the module boundary, the same seam the auth suites use for
 * `src/lib/supabase.ts` — so `@supabase/supabase-js` is never loaded here and the real provider
 * runs against four plain functions.
 *
 * The outbox and the list cache are **not** mocked. They are the feature under test, and what is
 * worth asserting is the real round trip through AsyncStorage (mocked in `jest.setup.ts` with the
 * library's own in-memory stand-in): a write that survives a restart is the whole promise.
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

const USER = 'u1';

const MILK = { id: 'i1', title: 'Milk', doneAt: null };
const GROCERIES = { id: 'l1', name: 'Groceries', role: 'owner' as const, items: [MILK] };

const OK: Result = { error: null, verdict: 'ok' };
/** What a write looks like with no signal: postgrest-js reports a failed fetch as status 0. */
const OFFLINE: Result = { error: 'TypeError: Failed to fetch', verdict: 'retryable' };
const REFUSED: Result = { error: 'permission denied', verdict: 'permanent' };
const DUPLICATE: Result = { error: 'duplicate key value violates unique constraint', verdict: 'applied' };

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();

  api.fetchLists.mockResolvedValue({ lists: [], error: null });
  api.insertList.mockResolvedValue(OK);
  api.insertItem.mockResolvedValue(OK);
  api.setItemDone.mockResolvedValue(OK);
});

afterEach(() => {
  jest.useRealTimers();
});

/** Renders the provider's whole surface as text, so assertions read what a screen would see. */
function Probe() {
  const { lists, status, error, pending, createList, addItem, toggleItem } = useLists();

  return (
    <>
      <Text>{`status: ${status}`}</Text>
      <Text>{`error: ${error ?? 'none'}`}</Text>
      <Text>{`pending: ${pending}`}</Text>
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
      {/* Whichever list is first, so this works for a fetched list and for one just created. */}
      <Button label="add" onPress={() => addItem(lists[0]?.id ?? 'l1', 'Bread')} />
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
    <ListsProvider userId={USER}>
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
  let settleInsert = (_result: Result) => {};
  api.insertList.mockReturnValue(
    new Promise<Result>((resolve) => {
      settleInsert = resolve;
    })
  );

  await renderProbe();
  await fireEvent.press(screen.getByLabelText('create'));

  const [id, name] = api.insertList.mock.calls[0];
  expect(name).toBe('Groceries');
  expect(screen.getByText(`${id} Groceries: `)).toBeOnTheScreen();

  await act(async () => settleInsert(OK));
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
 * A refusal is the one failure that still rolls back by re-fetching: the write is never going to
 * happen, so the screen has to stop showing it.
 */
it('surfaces a refused write and falls back to what the database holds', async () => {
  api.fetchLists.mockResolvedValue({ lists: [], error: null });
  api.insertList.mockResolvedValue(REFUSED);

  await renderProbe();
  await fireEvent.press(screen.getByLabelText('create'));

  expect(await screen.findByText('error: permission denied')).toBeOnTheScreen();
  await waitFor(() => expect(api.fetchLists).toHaveBeenCalledTimes(2));
  expect(screen.queryByText(/Groceries/)).not.toBeOnTheScreen();
});

// --- Offline -------------------------------------------------------------------------------

/** The change that used to be lost. It stays on screen, it stays queued, and nothing cries wolf. */
it('keeps a write the network could not deliver', async () => {
  api.insertList.mockResolvedValue(OFFLINE);

  await renderProbe();
  await fireEvent.press(screen.getByLabelText('create'));

  expect(await screen.findByText('pending: 1')).toBeOnTheScreen();
  expect(screen.getByText(/Groceries/)).toBeOnTheScreen();
  expect(screen.getByText('error: none')).toBeOnTheScreen();
  // No rollback re-fetch: it would fail too, and it would take the row down with it.
  expect(api.fetchLists).toHaveBeenCalledTimes(1);
});

it('retries a queued write on its own until it lands', async () => {
  jest.useFakeTimers();
  api.insertList.mockResolvedValueOnce(OFFLINE);

  await renderProbe();
  await fireEvent.press(screen.getByLabelText('create'));
  await screen.findByText('pending: 1');
  expect(api.insertList).toHaveBeenCalledTimes(1);

  // The first backoff step.
  await act(async () => {
    jest.advanceTimersByTime(1_000);
  });

  await waitFor(() => expect(screen.getByText('pending: 0')).toBeOnTheScreen());
  expect(api.insertList).toHaveBeenCalledTimes(2);
});

it('flushes an outbox left behind by a previous run', async () => {
  await saveOutbox(USER, [{ type: 'list/created', id: 'l9', name: 'Hardware' }]);

  await renderProbe();

  expect(await screen.findByText('pending: 0')).toBeOnTheScreen();
  expect(api.insertList).toHaveBeenCalledWith('l9', 'Hardware');
  expect(screen.getByText('l9 Hardware: ')).toBeOnTheScreen();
});

/** A retry catching up with itself, not a failure: the row is already there, under the id we sent. */
it('treats a duplicate key as the write having landed', async () => {
  api.insertList.mockResolvedValue(DUPLICATE);

  await renderProbe();
  await fireEvent.press(screen.getByLabelText('create'));

  expect(await screen.findByText('pending: 0')).toBeOnTheScreen();
  expect(screen.getByText('error: none')).toBeOnTheScreen();
  expect(screen.getByText(/Groceries/)).toBeOnTheScreen();
});

it('sends one write for a checkbox tapped repeatedly with no signal', async () => {
  api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null });
  api.setItemDone.mockResolvedValue(OFFLINE);

  await renderProbe();
  await fireEvent.press(screen.getByLabelText('toggle'));
  await fireEvent.press(screen.getByLabelText('toggle'));
  await fireEvent.press(screen.getByLabelText('toggle'));

  expect(await screen.findByText('pending: 1')).toBeOnTheScreen();
  expect(screen.getByText('l1 Groceries: Milk done')).toBeOnTheScreen();
  expect(api.setItemDone).toHaveBeenCalledTimes(1);
});

it('drops the items of a list the database refused', async () => {
  let settleInsert = (_result: Result) => {};
  api.insertList.mockReturnValue(
    new Promise<Result>((resolve) => {
      settleInsert = resolve;
    })
  );

  await renderProbe();
  await fireEvent.press(screen.getByLabelText('create'));
  await fireEvent.press(screen.getByLabelText('add'));
  expect(await screen.findByText('pending: 2')).toBeOnTheScreen();

  await act(async () => settleInsert(REFUSED));

  expect(await screen.findByText('error: permission denied')).toBeOnTheScreen();
  expect(api.insertItem).not.toHaveBeenCalled();
  expect(screen.getByText('pending: 0')).toBeOnTheScreen();
  expect(screen.queryByText(/Groceries/)).not.toBeOnTheScreen();
});

// --- Reading offline -----------------------------------------------------------------------

it('shows the last known lists when the fetch fails', async () => {
  await writeCachedLists(USER, [GROCERIES]);
  api.fetchLists.mockResolvedValue({ lists: null, error: 'network down' });

  await renderProbe();

  expect(screen.getByText('l1 Groceries: Milk')).toBeOnTheScreen();
  // Nothing was lost and nothing is wrong, so there is nothing to say.
  expect(screen.getByText('error: none')).toBeOnTheScreen();
});

/**
 * A fetch only happens on mount, so a cache fed by fetches alone is a snapshot of the last cold
 * start: everything written since would be missing the next time the network is down. Caught in the
 * browser, where a restart offline showed an empty app after a session of successful writes.
 */
it('remembers writes the database acknowledged, not just what a fetch returned', async () => {
  await renderProbe();
  await fireEvent.press(screen.getByLabelText('create'));
  await screen.findByText('pending: 0');

  await screen.unmount();
  api.fetchLists.mockResolvedValue({ lists: null, error: 'network down' });
  await renderProbe();

  expect(screen.getByText(/Groceries/)).toBeOnTheScreen();
});

it('never reads another account cached lists', async () => {
  await writeCachedLists('someone-else', [GROCERIES]);

  await renderProbe();

  expect(screen.queryByText(/Groceries/)).not.toBeOnTheScreen();
});

/**
 * The whole feature end to end, and the reason the cache stores fetched rows rather than what is on
 * screen: replay the outbox over a cache that already contains it and the item appears twice.
 */
it('does not duplicate a pending write across a restart', async () => {
  api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null });
  api.insertItem.mockReturnValue(new Promise<Result>(() => {}));

  await renderProbe();
  await fireEvent.press(screen.getByLabelText('add'));
  expect(await screen.findByText('pending: 1')).toBeOnTheScreen();
  expect(screen.getByText('l1 Groceries: Milk, Bread')).toBeOnTheScreen();

  await screen.unmount();
  await renderProbe();

  expect(screen.getByText('l1 Groceries: Milk, Bread')).toBeOnTheScreen();
  expect(screen.getByText('pending: 1')).toBeOnTheScreen();
});
