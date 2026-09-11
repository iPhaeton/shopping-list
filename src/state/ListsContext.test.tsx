import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { writeCachedLists } from '../lib/listCache';
import {
  addItem,
  fetchLists,
  insertList,
  renameItem,
  renameList,
  setItemDeleted,
  setItemDone,
  setListDeleted,
  type Result,
} from '../lib/listsApi';
import { subscribeToChanges } from '../lib/listsChannel';
import { loadOutbox, saveOutbox } from '../lib/outbox';
import { ListsProvider, useLists } from './ListsContext';
import type { List } from './types';

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
  addItem: jest.fn(),
  renameItem: jest.fn(),
  setItemDone: jest.fn(),
  renameList: jest.fn(),
  setListDeleted: jest.fn(),
  setItemDeleted: jest.fn(),
}));

/**
 * The realtime channel is mocked at its own seam, so no websocket is opened and the two callbacks
 * can be driven by hand — the same shape `SessionContext.test.tsx` uses to push an auth transition.
 */
jest.mock('../lib/listsChannel', () => ({ subscribeToChanges: jest.fn() }));

const api = {
  fetchLists: jest.mocked(fetchLists),
  insertList: jest.mocked(insertList),
  addItem: jest.mocked(addItem),
  renameItem: jest.mocked(renameItem),
  setItemDone: jest.mocked(setItemDone),
  renameList: jest.mocked(renameList),
  setListDeleted: jest.mocked(setListDeleted),
  setItemDeleted: jest.mocked(setItemDeleted),
};

const unsubscribe = jest.fn();

/** Captured so a test can deliver a nudge, or a reconnect, the way the database would. */
let nudge: () => void;
let resubscribe: () => void;

const USER = 'u1';

const MILK = { id: 'i1', title: 'Milk', doneAt: null, deletedAt: null };
const GROCERIES = { id: 'l1', name: 'Groceries', role: 'owner' as const, deletedAt: null, items: [MILK] };
/** The same list as seen by somebody it was shared with, read-only. */
const READ_ONLY = { ...GROCERIES, role: 'reader' as const };

const OK: Result = { error: null, verdict: 'ok' };
/** What a write looks like with no signal: postgrest-js reports a failed fetch as status 0. */
const OFFLINE: Result = { error: 'TypeError: Failed to fetch', verdict: 'retryable' };
const REFUSED: Result = { error: 'permission denied', verdict: 'permanent' };
/**
 * The write was accepted and the caller was allowed to make it — there was just nothing live left
 * for it to land on. Note `verdict: 'ok'`: this is not a failure, and classifying it as one is the
 * mistake the provider is built to avoid.
 */
const BLOCKED: Result = { error: null, verdict: 'ok', outcome: 'target_deleted' };
const DUPLICATE: Result = { error: 'duplicate key value violates unique constraint', verdict: 'applied' };
/** The provider's trailing debounce on a nudge, mirrored here as the backoff tests mirror theirs. */
const NUDGE_DEBOUNCE = 300;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();

  api.fetchLists.mockResolvedValue({ lists: [], error: null });
  api.insertList.mockResolvedValue(OK);
  api.addItem.mockResolvedValue(OK);
  api.renameItem.mockResolvedValue(OK);
  api.setItemDone.mockResolvedValue(OK);
  api.renameList.mockResolvedValue(OK);
  api.setListDeleted.mockResolvedValue(OK);
  api.setItemDeleted.mockResolvedValue(OK);

  jest.mocked(subscribeToChanges).mockImplementation((_userId, onChange, onResubscribe) => {
    nudge = onChange;
    resubscribe = onResubscribe;
    return unsubscribe;
  });
});

afterEach(() => {
  jest.useRealTimers();
});

/** Renders the provider's whole surface as text, so assertions read what a screen would see. */
function Probe() {
  const {
    lists,
    status,
    error,
    pending,
    blocked,
    createList,
    renameList,
    addItem,
    renameItem,
    toggleItem,
    setListDeleted,
    setItemDeleted,
    restoreBlocked,
    discardBlocked,
  } = useLists();

  return (
    <>
      <Text>{`status: ${status}`}</Text>
      <Text>{`error: ${error ?? 'none'}`}</Text>
      <Text>{`pending: ${pending}`}</Text>
      <Text>{`blocked: ${blocked ? blocked.op.type : 'none'}`}</Text>
      {lists.map((list) => (
        <Text key={list.id}>
          {`${list.id} ${list.name}${list.deletedAt === null ? '' : ' [binned]'}: ${list.items
            .map(
              (item) =>
                `${item.title}${item.doneAt === null ? '' : ' done'}${
                  item.deletedAt === null ? '' : ' [binned]'
                }`
            )
            .join(', ')}`}
        </Text>
      ))}
      {/* Labels deliberately name no list or item, so a query for one matches only a row. */}
      <Button label="create" onPress={() => createList('Groceries')} />
      <Button label="create blank" onPress={() => createList('   ')} />
      {/* Whichever list is first, so this works for a fetched list and for one just created. */}
      <Button label="add" onPress={() => addItem(lists[0]?.id ?? 'l1', 'Bread')} />
      <Button label="toggle" onPress={() => toggleItem('l1', 'i1')} />
      <Button label="rename" onPress={() => renameList('l1', 'Weekly shop')} />
      <Button label="rename blank" onPress={() => renameList('l1', '   ')} />
      <Button label="rename item" onPress={() => renameItem('l1', 'i1', 'Oat milk')} />
      <Button label="rename item again" onPress={() => renameItem('l1', 'i1', 'Soy milk')} />
      <Button label="rename item blank" onPress={() => renameItem('l1', 'i1', '   ')} />
      <Button label="bin list" onPress={() => setListDeleted('l1', true)} />
      <Button label="restore list" onPress={() => setListDeleted('l1', false)} />
      <Button label="bin item" onPress={() => setItemDeleted('l1', 'i1', true)} />
      <Button label="restore item" onPress={() => setItemDeleted('l1', 'i1', false)} />
      <Button label="restore blocked" onPress={restoreBlocked} />
      <Button label="discard blocked" onPress={discardBlocked} />
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
    expect(api.addItem).toHaveBeenCalledWith(expect.any(String), 'l1', 'Bread')
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

// --- Renaming, and who may write ---------------------------------------------------------------

it('renames a list optimistically and sends the new name', async () => {
  api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null });

  await renderProbe();
  await fireEvent.press(screen.getByLabelText('rename'));

  expect(screen.getByText('l1 Weekly shop: Milk')).toBeOnTheScreen();
  await waitFor(() => expect(api.renameList).toHaveBeenCalledWith('l1', 'Weekly shop'));
});

it('does not rename a list to nothing', async () => {
  api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null });

  await renderProbe();
  await fireEvent.press(screen.getByLabelText('rename blank'));

  expect(api.renameList).not.toHaveBeenCalled();
});

it('renames an item optimistically and sends the new title', async () => {
  api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null });

  await renderProbe();
  await fireEvent.press(screen.getByLabelText('rename item'));

  expect(screen.getByText('l1 Groceries: Oat milk')).toBeOnTheScreen();
  await waitFor(() => expect(api.renameItem).toHaveBeenCalledWith('i1', 'Oat milk'));
});

it('does not rename an item to nothing', async () => {
  api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null });

  await renderProbe();
  await fireEvent.press(screen.getByLabelText('rename item blank'));

  expect(api.renameItem).not.toHaveBeenCalled();
  expect(screen.getByText('l1 Groceries: Milk')).toBeOnTheScreen();
});

/** A title is an absolute value like a list name, so only the newest of a queued run is sent. */
it('sends one write for an item renamed repeatedly with no signal', async () => {
  api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null });
  api.renameItem.mockResolvedValue(OFFLINE);

  await renderProbe();
  await fireEvent.press(screen.getByLabelText('rename item'));
  await fireEvent.press(screen.getByLabelText('rename item again'));

  expect(await screen.findByText('pending: 1')).toBeOnTheScreen();
  expect(screen.getByText('l1 Groceries: Soy milk')).toBeOnTheScreen();
  expect(api.renameItem).toHaveBeenCalledTimes(1);
  expect(await loadOutbox(USER)).toEqual([
    { type: 'item/renamed', listId: 'l1', itemId: 'i1', title: 'Soy milk' },
  ]);
});

/**
 * The screens hide the controls a reader may not use, so none of these three are reachable by
 * tapping. They are written anyway: the database is the only real boundary, and the next screen to
 * call these functions will not remember the rule.
 */
describe('a list you only have read access to', () => {
  beforeEach(() => {
    api.fetchLists.mockResolvedValue({ lists: [READ_ONLY], error: null });
  });

  it('refuses to add an item, and says why', async () => {
    await renderProbe();
    await fireEvent.press(screen.getByLabelText('add'));

    expect(screen.getByText('error: You have read-only access to this list.')).toBeOnTheScreen();
    expect(api.addItem).not.toHaveBeenCalled();
    expect(screen.getByText('l1 Groceries: Milk')).toBeOnTheScreen();
  });

  it('refuses to toggle an item', async () => {
    await renderProbe();
    await fireEvent.press(screen.getByLabelText('toggle'));

    expect(screen.getByText('error: You have read-only access to this list.')).toBeOnTheScreen();
    expect(api.setItemDone).not.toHaveBeenCalled();
    expect(screen.getByText('l1 Groceries: Milk')).toBeOnTheScreen();
  });

  it('refuses to rename the list', async () => {
    await renderProbe();
    await fireEvent.press(screen.getByLabelText('rename'));

    expect(screen.getByText('error: Only an owner can rename this list.')).toBeOnTheScreen();
    expect(api.renameList).not.toHaveBeenCalled();
    expect(screen.getByText('l1 Groceries: Milk')).toBeOnTheScreen();
  });

  it('refuses to rename an item', async () => {
    await renderProbe();
    await fireEvent.press(screen.getByLabelText('rename item'));

    expect(screen.getByText('error: You have read-only access to this list.')).toBeOnTheScreen();
    expect(api.renameItem).not.toHaveBeenCalled();
    expect(screen.getByText('l1 Groceries: Milk')).toBeOnTheScreen();
  });
});

/** A writer adds, renames and ticks items but does not manage the list itself. */
it('lets a writer change items but not the name', async () => {
  api.fetchLists.mockResolvedValue({ lists: [{ ...GROCERIES, role: 'writer' }], error: null });

  await renderProbe();

  await fireEvent.press(screen.getByLabelText('add'));
  expect(screen.getByText('l1 Groceries: Milk, Bread')).toBeOnTheScreen();

  await fireEvent.press(screen.getByLabelText('rename item'));
  expect(screen.getByText('l1 Groceries: Oat milk, Bread')).toBeOnTheScreen();
  await waitFor(() => expect(api.renameItem).toHaveBeenCalledWith('i1', 'Oat milk'));

  await fireEvent.press(screen.getByLabelText('rename'));
  expect(api.renameList).not.toHaveBeenCalled();
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
  expect(api.addItem).not.toHaveBeenCalled();
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
  api.addItem.mockReturnValue(new Promise<Result>(() => {}));

  await renderProbe();
  await fireEvent.press(screen.getByLabelText('add'));
  expect(await screen.findByText('pending: 1')).toBeOnTheScreen();
  expect(screen.getByText('l1 Groceries: Milk, Bread')).toBeOnTheScreen();

  await screen.unmount();
  await renderProbe();

  expect(screen.getByText('l1 Groceries: Milk, Bread')).toBeOnTheScreen();
  expect(screen.getByText('pending: 1')).toBeOnTheScreen();
});

// --- Realtime ------------------------------------------------------------------------------

/**
 * A nudge says *that* a list changed, never what — so every assertion here is about `fetchLists`
 * being called, and never about a payload being applied.
 *
 * `renderProbe` has already awaited the mount fetch, so `fetchLists` stands at 1 when these start.
 */
it('subscribes to the account inbox once there is state to replace', async () => {
  await renderProbe();

  expect(subscribeToChanges).toHaveBeenCalledTimes(1);
  expect(jest.mocked(subscribeToChanges).mock.calls[0][0]).toBe(USER);
});

it('re-reads when another device changes a list', async () => {
  jest.useFakeTimers();
  await renderProbe();

  await act(async () => nudge());
  await act(async () => {
    jest.advanceTimersByTime(NUDGE_DEBOUNCE);
  });

  expect(api.fetchLists).toHaveBeenCalledTimes(2);
});

/** Somebody adding five items sends five nudges. That is one fetch, not five. */
it('collapses a burst of nudges into one fetch', async () => {
  jest.useFakeTimers();
  await renderProbe();

  await act(async () => {
    nudge();
    nudge();
    nudge();
  });
  await act(async () => {
    jest.advanceTimersByTime(NUDGE_DEBOUNCE);
  });

  expect(api.fetchLists).toHaveBeenCalledTimes(2);
});

/** Delivery is at-most-once: whatever was sent while the socket was down is gone, so re-read. */
it('re-reads when the socket comes back', async () => {
  jest.useFakeTimers();
  await renderProbe();

  await act(async () => resubscribe());
  await act(async () => {
    jest.advanceTimersByTime(NUDGE_DEBOUNCE);
  });

  expect(api.fetchLists).toHaveBeenCalledTimes(2);
});

/**
 * The case the app would otherwise get wrong at exactly the worst moment: somebody else editing
 * while a write of ours is still in the air. `refresh` stands down while a flush is running, and
 * nothing redelivers a nudge — so it has to be remembered and honoured when the write lands.
 */
it('remembers a nudge that arrived while a write was in flight', async () => {
  jest.useFakeTimers();

  let settleInsert = (_result: Result) => {};
  api.insertList.mockReturnValue(
    new Promise<Result>((resolve) => {
      settleInsert = resolve;
    })
  );

  await renderProbe();
  await fireEvent.press(screen.getByLabelText('create'));
  await screen.findByText('pending: 1');

  await act(async () => nudge());
  await act(async () => {
    jest.advanceTimersByTime(NUDGE_DEBOUNCE);
  });

  // Turned away, not dropped: a fetch now could come back without the write we are still sending.
  expect(api.fetchLists).toHaveBeenCalledTimes(1);

  await act(async () => settleInsert(OK));

  await waitFor(() => expect(api.fetchLists).toHaveBeenCalledTimes(2));
});

it('closes the channel when the provider goes away', async () => {
  await renderProbe();
  await screen.unmount();

  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

// --- Writing to something somebody else put in the bin ------------------------------------------

/** The list as another owner left it after binning it, which is what the next fetch returns. */
const BINNED_LIST = { ...GROCERIES, deletedAt: '2026-09-10T09:00:00.000Z' };
const BINNED_ITEM = {
  ...GROCERIES,
  items: [{ ...MILK, deletedAt: '2026-09-10T09:00:00.000Z' }],
};

describe('a write that lands on a tombstone', () => {
  it('asks rather than erroring, and keeps the write', async () => {
    api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null });
    await renderProbe();

    api.setItemDone.mockResolvedValue(BLOCKED);
    api.fetchLists.mockResolvedValue({ lists: [BINNED_LIST], error: null });
    await fireEvent.press(screen.getByLabelText('toggle'));

    expect(await screen.findByText('blocked: item/setDone')).toBeOnTheScreen();
    // Not an error: nothing failed and nothing was refused.
    expect(screen.getByText('error: none')).toBeOnTheScreen();
    // And not delivered either — it is still queued, and still on disk.
    expect(screen.getByText('pending: 1')).toBeOnTheScreen();
  });

  /**
   * The whole reason the op is left at the head of the queue rather than pulled out and held in
   * React state: a reload before the user answers must not lose it.
   */
  it('leaves the blocked write in the outbox on disk', async () => {
    api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null });
    await renderProbe();

    api.setItemDone.mockResolvedValue(BLOCKED);
    api.fetchLists.mockResolvedValue({ lists: [BINNED_LIST], error: null });
    await fireEvent.press(screen.getByLabelText('toggle'));
    await screen.findByText('blocked: item/setDone');

    expect(await loadOutbox(USER)).toEqual([
      { type: 'item/setDone', listId: 'l1', itemId: 'i1', doneAt: expect.any(String) },
    ]);
  });

  it('stops sending while it waits for an answer', async () => {
    api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null });
    await renderProbe();

    api.setItemDone.mockResolvedValue(BLOCKED);
    api.fetchLists.mockResolvedValue({ lists: [BINNED_LIST], error: null });
    await fireEvent.press(screen.getByLabelText('toggle'));
    await screen.findByText('blocked: item/setDone');

    api.setItemDone.mockClear();
    await fireEvent.press(screen.getByLabelText('add'));

    // The queue is stopped, so neither the blocked write nor the one behind it goes out.
    expect(api.setItemDone).not.toHaveBeenCalled();
    expect(api.addItem).not.toHaveBeenCalled();
  });

  /** Two writes: the restore first, then the write that was waiting on it. */
  it('restores and then lets the original write through, in that order', async () => {
    api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null });
    await renderProbe();

    api.setItemDone.mockResolvedValue(BLOCKED);
    api.fetchLists.mockResolvedValue({ lists: [BINNED_LIST], error: null });
    await fireEvent.press(screen.getByLabelText('toggle'));
    await screen.findByText('blocked: item/setDone');

    api.setItemDone.mockResolvedValue(OK);
    api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null });
    await fireEvent.press(screen.getByLabelText('restore blocked'));

    await waitFor(() => expect(screen.getByText('pending: 0')).toBeOnTheScreen());
    expect(api.setListDeleted).toHaveBeenCalledWith('l1', false);
    expect(api.setItemDone).toHaveBeenCalledWith('i1', true);
    expect(api.setListDeleted.mock.invocationCallOrder[0]).toBeLessThan(
      api.setItemDone.mock.invocationCallOrder[1]
    );
    expect(screen.getByText('blocked: none')).toBeOnTheScreen();
  });

  it('lifts the item too when it was binned inside a binned list', async () => {
    api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null });
    await renderProbe();

    api.setItemDone.mockResolvedValue(BLOCKED);
    api.fetchLists.mockResolvedValue({
      lists: [{ ...BINNED_LIST, items: BINNED_ITEM.items }],
      error: null,
    });
    await fireEvent.press(screen.getByLabelText('toggle'));
    await screen.findByText('blocked: item/setDone');

    api.setItemDone.mockResolvedValue(OK);
    api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null });
    await fireEvent.press(screen.getByLabelText('restore blocked'));

    await waitFor(() => expect(screen.getByText('pending: 0')).toBeOnTheScreen());
    expect(api.setListDeleted).toHaveBeenCalledWith('l1', false);
    expect(api.setItemDeleted).toHaveBeenCalledWith('i1', false);
  });

  it('drops the write when the user would rather not', async () => {
    api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null });
    await renderProbe();

    api.setItemDone.mockResolvedValue(BLOCKED);
    api.fetchLists.mockResolvedValue({ lists: [BINNED_LIST], error: null });
    await fireEvent.press(screen.getByLabelText('toggle'));
    await screen.findByText('blocked: item/setDone');

    await fireEvent.press(screen.getByLabelText('discard blocked'));

    await waitFor(() => expect(screen.getByText('pending: 0')).toBeOnTheScreen());
    expect(screen.getByText('blocked: none')).toBeOnTheScreen();
    expect(await loadOutbox(USER)).toEqual([]);
    expect(api.setListDeleted).not.toHaveBeenCalled();
  });

  /**
   * The writer's half of the brief. There is nothing they may lift, so they are not asked — and the
   * write cannot be left queued either, because the loop is stopped while it sits there. It drops,
   * and everything behind it goes out.
   */
  it('drops a write nobody on this account may unblock, without asking', async () => {
    api.fetchLists.mockResolvedValue({
      lists: [{ ...GROCERIES, role: 'writer' as const }],
      error: null,
    });
    await renderProbe();

    api.setItemDone.mockResolvedValue(BLOCKED);
    api.fetchLists.mockResolvedValue({
      lists: [{ ...BINNED_LIST, role: 'writer' as const }],
      error: null,
    });
    await fireEvent.press(screen.getByLabelText('toggle'));

    await waitFor(() => expect(screen.getByText('pending: 0')).toBeOnTheScreen());
    expect(screen.getByText('blocked: none')).toBeOnTheScreen();
    expect(screen.getByText('error: none')).toBeOnTheScreen();
    expect(await loadOutbox(USER)).toEqual([]);
  });
});

describe('binning and restoring', () => {
  it('sends the boolean and shows the tombstone before the database answers', async () => {
    api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null });
    await renderProbe();

    await fireEvent.press(screen.getByLabelText('bin item'));

    expect(screen.getByText('l1 Groceries: Milk [binned]')).toBeOnTheScreen();
    expect(api.setItemDeleted).toHaveBeenCalledWith('i1', true);
  });

  /** Absolute values, so a change of mind on a train is one request rather than three. */
  it('coalesces bin, restore and bin again into one write', async () => {
    api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null });
    api.setItemDeleted.mockResolvedValue(OFFLINE);
    await renderProbe();

    await fireEvent.press(screen.getByLabelText('bin item'));
    await fireEvent.press(screen.getByLabelText('restore item'));
    await fireEvent.press(screen.getByLabelText('bin item'));

    expect(screen.getByText('pending: 1')).toBeOnTheScreen();
  });

  it('refuses to bin a list you do not own, before anything is sent', async () => {
    api.fetchLists.mockResolvedValue({ lists: [READ_ONLY], error: null });
    await renderProbe();

    await fireEvent.press(screen.getByLabelText('bin list'));

    expect(screen.getByText('error: Only an owner can delete or restore this list.')).toBeOnTheScreen();
    expect(api.setListDeleted).not.toHaveBeenCalled();
  });

  it('refuses to bin an item on a list you can only read', async () => {
    api.fetchLists.mockResolvedValue({ lists: [READ_ONLY], error: null });
    await renderProbe();

    await fireEvent.press(screen.getByLabelText('bin item'));

    expect(screen.getByText('error: You have read-only access to this list.')).toBeOnTheScreen();
    expect(api.setItemDeleted).not.toHaveBeenCalled();
  });
});

/**
 * The regression test for a bug only the browser found.
 *
 * `blocked` used to be announced *before* the fetch that follows it. The tombstone is somebody
 * else's write, so this device had never seen it — `restorePlan` read the pre-delete view, concluded
 * there was nothing to lift, and discarded the write. Silently: no banner, no error, and a tick that
 * simply never happened. Jest batched the two updates together and did not notice; the browser did.
 *
 * So the assertion is about *order*, not about the outcome: while the fetch is still in flight there
 * must be no prompt, because a prompt at that moment is a prompt made on stale information.
 */
it('does not announce a blocked write until the fetch behind it has landed', async () => {
  api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null });
  await renderProbe();

  let settleFetch = (_result: { lists: List[] | null; error: string | null }) => {};
  api.setItemDone.mockResolvedValue(BLOCKED);
  api.fetchLists.mockReturnValue(
    new Promise((resolve) => {
      settleFetch = resolve;
    })
  );

  await fireEvent.press(screen.getByLabelText('toggle'));

  // The write has been answered, but the tombstone has not arrived yet.
  await waitFor(() => expect(api.fetchLists).toHaveBeenCalledTimes(2));
  expect(screen.getByText('blocked: none')).toBeOnTheScreen();

  await act(async () => settleFetch({ lists: [BINNED_LIST], error: null }));

  expect(await screen.findByText('blocked: item/setDone')).toBeOnTheScreen();
  expect(screen.getByText('pending: 1')).toBeOnTheScreen();
});

/**
 * The flush loop is stopped while a write is blocked, so everything queued behind it is stopped too.
 * Resolving the prompt has to start it again — and `hydrate` has to be *awaited* first, since it
 * holds `fetching` and `flush` refuses to run alongside a fetch. Un-awaited, the flush is a no-op and
 * the writes behind the discarded one never go out.
 */
it('sends the writes queued behind a blocked one once it is resolved', async () => {
  api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null });
  await renderProbe();

  api.setItemDone.mockResolvedValue(BLOCKED);
  api.fetchLists.mockResolvedValue({ lists: [BINNED_LIST], error: null });
  await fireEvent.press(screen.getByLabelText('toggle'));
  await screen.findByText('blocked: item/setDone');

  // Queued behind it, and going nowhere while the prompt is up.
  await fireEvent.press(screen.getByLabelText('add'));
  expect(api.addItem).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByLabelText('discard blocked'));

  await waitFor(() => expect(api.addItem).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByText('pending: 0')).toBeOnTheScreen());
});
