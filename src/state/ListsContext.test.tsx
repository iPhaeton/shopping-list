import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { writeCachedLists } from '../lib/listCache';
import {
  addItem,
  fetchItem,
  fetchItems,
  fetchList,
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
  fetchItems: jest.fn(),
  fetchItem: jest.fn(),
  fetchList: jest.fn(),
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
  fetchItems: jest.mocked(fetchItems),
  fetchItem: jest.mocked(fetchItem),
  fetchList: jest.mocked(fetchList),
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
let nudge: (listId?: string) => void;
let resubscribe: () => void;

const USER = 'u1';

const MILK = { id: 'i1', title: 'Milk', doneAt: null, deletedAt: null, createdAt: null };
/**
 * A list as it looks once its items are known — either because `fetchLists` is mocked as a
 * shortcut to skip straight past "enter list" for tests that are not about that mechanism, or
 * because the probe already pressed it. The real `fetchLists` never carries items any more; see
 * `describe('entering a list', ...)` for the tests that exercise that boundary directly.
 */
const GROCERIES = { id: 'l1', name: 'Groceries', role: 'owner' as const, deletedAt: null, itemsLoaded: true, items: [MILK], nextLive: null, nextBin: null };
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

  api.fetchLists.mockResolvedValue({ lists: [], error: null, truncated: false });
  api.fetchItems.mockResolvedValue({ items: [], next: null, error: null });
  api.fetchItem.mockResolvedValue({ item: null, error: null });
  api.fetchList.mockResolvedValue({ list: null, error: null });
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
    loadMore,
    loadListItems,
  } = useLists();

  return (
    <>
      <Text>{`status: ${status}`}</Text>
      <Text>{`error: ${error ?? 'none'}`}</Text>
      <Text>{`pending: ${pending}`}</Text>
      <Text>{`blocked: ${blocked ? blocked.op.type : 'none'}`}</Text>
      {lists.map((list) => (
        <Text key={list.id}>
          {`${list.id} ${list.name}${list.deletedAt === null ? '' : ' [binned]'}${
            list.nextLive === null ? '' : ' [more]'
          }${list.nextBin === null ? '' : ' [more binned]'}: ${list.items
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
      <Button label="load more" onPress={() => void loadMore('l1', false)} />
      <Button label="load more with bin" onPress={() => void loadMore('l1', true)} />
      <Button label="enter list" onPress={() => void loadListItems(lists[0]?.id ?? 'l1')} />
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

it('hydrates the list itself from the database on mount, with no items yet', async () => {
  api.fetchLists.mockResolvedValue({
    lists: [{ ...GROCERIES, itemsLoaded: false, items: [] }],
    error: null,
    truncated: false,
  });

  await renderProbe();

  expect(screen.getByText('l1 Groceries: ')).toBeOnTheScreen();
  expect(api.fetchLists).toHaveBeenCalledTimes(1);
  expect(api.fetchItems).not.toHaveBeenCalled();
});

/**
 * The point of this step: `fetchLists` no longer carries any items, for any list — opening the
 * Lists screen used to fetch a first page of every list's rows, which is what made it laggy.
 * `loadListItems` is what a screen calls once it actually opens a list.
 */
describe('entering a list', () => {
  beforeEach(() => {
    api.fetchLists.mockResolvedValue({
      lists: [{ ...GROCERIES, itemsLoaded: false, items: [] }],
      error: null,
      truncated: false,
    });
  });

  it("loads a list's first page of both streams, together, only once it is entered", async () => {
    api.fetchItems
      .mockResolvedValueOnce({ items: [MILK], next: null, error: null })
      .mockResolvedValueOnce({ items: [], next: null, error: null });

    await renderProbe();
    expect(screen.getByText('l1 Groceries: ')).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText('enter list'));

    await waitFor(() => expect(screen.getByText('l1 Groceries: Milk')).toBeOnTheScreen());
    expect(api.fetchItems).toHaveBeenCalledWith('l1', 'live', null);
    expect(api.fetchItems).toHaveBeenCalledWith('l1', 'bin', null);
  });

  it('does not ask again once a list is loaded', async () => {
    api.fetchItems
      .mockResolvedValueOnce({ items: [MILK], next: null, error: null })
      .mockResolvedValueOnce({ items: [], next: null, error: null });
    await renderProbe();

    await fireEvent.press(screen.getByLabelText('enter list'));
    await waitFor(() => expect(screen.getByText('l1 Groceries: Milk')).toBeOnTheScreen());
    api.fetchItems.mockClear();

    await fireEvent.press(screen.getByLabelText('enter list'));

    expect(api.fetchItems).not.toHaveBeenCalled();
  });

  /** The same guard `loadMore` gets: a second tap while the first request is still in flight. */
  it('sends one request per stream when entering fires twice before the first answers', async () => {
    let settle = (_page: { items: List['items'] | null; next: null; error: null }) => {};
    api.fetchItems.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      })
    );
    await renderProbe();

    await fireEvent.press(screen.getByLabelText('enter list'));
    await fireEvent.press(screen.getByLabelText('enter list'));
    // One call per stream (live, bin) — the second press must not double that.
    expect(api.fetchItems).toHaveBeenCalledTimes(2);

    await act(async () => settle({ items: [], next: null, error: null }));
  });

  /**
   * A page is server truth with the outbox folded back on top, and that includes the very first
   * one: an item added before the list finished loading must not be lost, and must land after the
   * fetched rows, matching where the next hydration would put it anyway.
   */
  it('folds a pending write over the first page once it arrives', async () => {
    api.fetchItems
      .mockResolvedValueOnce({ items: [MILK], next: null, error: null })
      .mockResolvedValueOnce({ items: [], next: null, error: null });
    await renderProbe();

    await fireEvent.press(screen.getByLabelText('add'));
    expect(screen.getByText('l1 Groceries: Bread')).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText('enter list'));

    await waitFor(() => expect(screen.getByText('l1 Groceries: Milk, Bread')).toBeOnTheScreen());
  });
});

it('reports a failed load without pretending the account has no lists', async () => {
  api.fetchLists.mockResolvedValue({ lists: null, error: 'network down', truncated: false });

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
  api.fetchLists.mockResolvedValue({ lists: [{ ...GROCERIES, items: [] }], error: null, truncated: false });

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
  api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null, truncated: false });

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
  api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null, truncated: false });

  await renderProbe();
  await fireEvent.press(screen.getByLabelText('rename'));

  expect(screen.getByText('l1 Weekly shop: Milk')).toBeOnTheScreen();
  await waitFor(() => expect(api.renameList).toHaveBeenCalledWith('l1', 'Weekly shop'));
});

it('does not rename a list to nothing', async () => {
  api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null, truncated: false });

  await renderProbe();
  await fireEvent.press(screen.getByLabelText('rename blank'));

  expect(api.renameList).not.toHaveBeenCalled();
});

it('renames an item optimistically and sends the new title', async () => {
  api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null, truncated: false });

  await renderProbe();
  await fireEvent.press(screen.getByLabelText('rename item'));

  expect(screen.getByText('l1 Groceries: Oat milk')).toBeOnTheScreen();
  await waitFor(() => expect(api.renameItem).toHaveBeenCalledWith('i1', 'Oat milk'));
});

it('does not rename an item to nothing', async () => {
  api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null, truncated: false });

  await renderProbe();
  await fireEvent.press(screen.getByLabelText('rename item blank'));

  expect(api.renameItem).not.toHaveBeenCalled();
  expect(screen.getByText('l1 Groceries: Milk')).toBeOnTheScreen();
});

/** A title is an absolute value like a list name, so only the newest of a queued run is sent. */
it('sends one write for an item renamed repeatedly with no signal', async () => {
  api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null, truncated: false });
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
    api.fetchLists.mockResolvedValue({ lists: [READ_ONLY], error: null, truncated: false });
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
  api.fetchLists.mockResolvedValue({ lists: [{ ...GROCERIES, role: 'writer' }], error: null, truncated: false });

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
  api.fetchLists.mockResolvedValue({ lists: [], error: null, truncated: false });
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
  api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null, truncated: false });
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
  api.fetchLists.mockResolvedValue({ lists: null, error: 'network down', truncated: false });

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
  api.fetchLists.mockResolvedValue({ lists: null, error: 'network down', truncated: false });
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
  api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null, truncated: false });
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

/**
 * The mirror image of the test above: here the fetch comes first. `enqueueOp`'s own call to `flush`
 * finds `fetching.current` still true and bails with nothing scheduled — nothing else redelivers it.
 * `hydrateLists`'s own `finally` is what has to pick the write back up once the fetch that was
 * holding the door clears, with no further trigger (no foreground event, no second nudge) firing in
 * this test.
 */
it('sends a write enqueued while a nudge-triggered fetch was in flight', async () => {
  jest.useFakeTimers();
  api.fetchLists.mockResolvedValueOnce({ lists: [GROCERIES], error: null, truncated: false });
  await renderProbe();
  await waitFor(() => expect(screen.getByText(/l1 Groceries: Milk/)).toBeOnTheScreen());

  let settleFetch = (_result: { list: List | null; error: string | null }) => {};
  api.fetchList.mockReturnValue(
    new Promise((resolve) => {
      settleFetch = resolve;
    })
  );

  await act(async () => nudge('l1'));
  await act(async () => {
    jest.advanceTimersByTime(NUDGE_DEBOUNCE);
  });
  await waitFor(() => expect(api.fetchList).toHaveBeenCalledWith('l1'));

  await fireEvent.press(screen.getByLabelText('toggle'));
  await screen.findByText('pending: 1');
  // Turned away, not sent: `fetching.current` was still true when `enqueueOp` called `flush`.
  expect(api.setItemDone).not.toHaveBeenCalled();

  await act(async () => settleFetch({ list: GROCERIES, error: null }));

  await waitFor(() => expect(api.setItemDone).toHaveBeenCalledWith('i1', true));
  await waitFor(() => expect(screen.getByText('pending: 0')).toBeOnTheScreen());
});

/** Same fix, the other door onto it: a full (unnamed) nudge's `hydrate`, not a named one's `hydrateLists`. */
it('sends a write enqueued while an unnamed nudge fetch was in flight', async () => {
  jest.useFakeTimers();
  api.fetchLists.mockResolvedValueOnce({ lists: [GROCERIES], error: null, truncated: false });
  await renderProbe();
  await waitFor(() => expect(screen.getByText(/l1 Groceries: Milk/)).toBeOnTheScreen());

  let settleFetch = (_result: { lists: List[] | null; error: string | null; truncated: boolean }) => {};
  api.fetchLists.mockReturnValue(
    new Promise((resolve) => {
      settleFetch = resolve;
    })
  );

  await act(async () => resubscribe());
  await act(async () => {
    jest.advanceTimersByTime(NUDGE_DEBOUNCE);
  });
  expect(api.fetchLists).toHaveBeenCalledTimes(2);

  await fireEvent.press(screen.getByLabelText('toggle'));
  await screen.findByText('pending: 1');
  expect(api.setItemDone).not.toHaveBeenCalled();

  await act(async () => settleFetch({ lists: [GROCERIES], error: null, truncated: false }));

  await waitFor(() => expect(api.setItemDone).toHaveBeenCalledWith('i1', true));
  await waitFor(() => expect(screen.getByText('pending: 0')).toBeOnTheScreen());
});

it('closes the channel when the provider goes away', async () => {
  await renderProbe();
  await screen.unmount();

  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

/**
 * A nudge that names a list is now scoped: it should read that one list, never every list, and the
 * point of this step is exactly that difference from the tests above.
 */
it('asks only for the list a nudge names, not every list', async () => {
  jest.useFakeTimers();
  api.fetchLists.mockResolvedValueOnce({ lists: [GROCERIES], error: null, truncated: false });
  await renderProbe();
  await waitFor(() => expect(screen.getByText(/l1 Groceries/)).toBeOnTheScreen());

  api.fetchList.mockResolvedValueOnce({ list: GROCERIES, error: null });

  await act(async () => nudge('l1'));
  await act(async () => {
    jest.advanceTimersByTime(NUDGE_DEBOUNCE);
  });

  await waitFor(() => expect(api.fetchList).toHaveBeenCalledWith('l1'));
  // Still just the mount's call — a named nudge never falls back to asking for every list.
  expect(api.fetchLists).toHaveBeenCalledTimes(1);
});

/** A list just shared with you is one `fetchList` has never seen locally before — it should appear. */
it('adds a list a nudge names once it becomes visible', async () => {
  jest.useFakeTimers();
  await renderProbe();
  await waitFor(() => expect(screen.getByText('status: ready')).toBeOnTheScreen());

  const shared = {
    id: 'l9',
    name: 'Shared with me',
    role: 'reader' as const,
    deletedAt: null,
    itemsLoaded: false,
    items: [],
    nextLive: null,
    nextBin: null,
  };
  api.fetchList.mockResolvedValueOnce({ list: shared, error: null });

  await act(async () => nudge('l9'));
  await act(async () => {
    jest.advanceTimersByTime(NUDGE_DEBOUNCE);
  });

  await waitFor(() => expect(screen.getByText(/l9 Shared with me/)).toBeOnTheScreen());
  expect(api.fetchLists).toHaveBeenCalledTimes(1);
});

/** Unshared, or purged — `fetchList` answers the same way either time: not visible any more. */
it('drops a list a nudge names once it is no longer visible', async () => {
  jest.useFakeTimers();
  api.fetchLists.mockResolvedValueOnce({ lists: [GROCERIES], error: null, truncated: false });
  await renderProbe();
  await waitFor(() => expect(screen.getByText(/l1 Groceries/)).toBeOnTheScreen());

  api.fetchList.mockResolvedValueOnce({ list: null, error: null });

  await act(async () => nudge('l1'));
  await act(async () => {
    jest.advanceTimersByTime(NUDGE_DEBOUNCE);
  });

  await waitFor(() => expect(screen.queryByText(/l1 Groceries/)).toBeNull());
});

/**
 * Deletion is a tombstone: a list still shared with you but put in the bin must not disappear the
 * way an unshared one does — it stays, marked binned, exactly as a full `fetchLists` has always
 * shown it.
 */
it('keeps a list a nudge names that is merely binned, not gone', async () => {
  jest.useFakeTimers();
  api.fetchLists.mockResolvedValueOnce({ lists: [GROCERIES], error: null, truncated: false });
  await renderProbe();
  await waitFor(() => expect(screen.getByText(/l1 Groceries: Milk/)).toBeOnTheScreen());

  api.fetchList.mockResolvedValueOnce({
    list: {
      ...GROCERIES,
      deletedAt: '2026-09-10T09:00:00.000Z',
      items: [],
      itemsLoaded: false,
      nextLive: null,
      nextBin: null,
    },
    error: null,
  });

  await act(async () => nudge('l1'));
  await act(async () => {
    jest.advanceTimersByTime(NUDGE_DEBOUNCE);
  });

  await waitFor(() => expect(screen.getByText(/l1 Groceries \[binned\]/)).toBeOnTheScreen());
});

/**
 * The point of this step, proven directly: a nudge naming one list must not re-walk another
 * previously-opened list's pages, the way a full `hydrate` (a nudge with no list id) still does.
 */
it('reloads only the list a nudge names, leaving another loaded list untouched', async () => {
  jest.useFakeTimers();
  api.fetchLists.mockResolvedValueOnce({
    lists: [
      { ...GROCERIES, items: [fetched('i1', 'Milk', 1)] },
      { ...GROCERIES, id: 'l2', name: 'Hardware', items: [fetched('i2', 'Nails', 2)] },
    ],
    error: null,
    truncated: false,
  });
  await renderProbe();
  await waitFor(() => expect(screen.getByText(/l2 Hardware: Nails/)).toBeOnTheScreen());

  api.fetchList.mockResolvedValueOnce({
    list: { ...GROCERIES, items: [], itemsLoaded: false, nextLive: null, nextBin: null },
    error: null,
  });
  // GROCERIES was `itemsLoaded` with a live row and an empty bin — the reload asks after both
  // streams, not only the one that held anything before.
  api.fetchItems
    .mockResolvedValueOnce({ items: [fetched('i1', 'Milk', 1)], next: null, error: null })
    .mockResolvedValueOnce({ items: [], next: null, error: null });

  await act(async () => nudge('l1'));
  await act(async () => {
    jest.advanceTimersByTime(NUDGE_DEBOUNCE);
  });

  await waitFor(() => expect(api.fetchItems).toHaveBeenCalledTimes(2));
  expect(api.fetchItems).toHaveBeenCalledWith('l1', 'live', null);
  expect(api.fetchItems).toHaveBeenCalledWith('l1', 'bin', null);
  expect(api.fetchLists).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/l1 Groceries: Milk/)).toBeOnTheScreen();
  expect(screen.getByText(/l2 Hardware: Nails/)).toBeOnTheScreen();
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
    api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null, truncated: false });
    await renderProbe();

    api.setItemDone.mockResolvedValue(BLOCKED);
    api.fetchLists.mockResolvedValue({ lists: [BINNED_LIST], error: null, truncated: false });
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
    api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null, truncated: false });
    await renderProbe();

    api.setItemDone.mockResolvedValue(BLOCKED);
    api.fetchLists.mockResolvedValue({ lists: [BINNED_LIST], error: null, truncated: false });
    await fireEvent.press(screen.getByLabelText('toggle'));
    await screen.findByText('blocked: item/setDone');

    expect(await loadOutbox(USER)).toEqual([
      { type: 'item/setDone', listId: 'l1', itemId: 'i1', doneAt: expect.any(String) },
    ]);
  });

  it('stops sending while it waits for an answer', async () => {
    api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null, truncated: false });
    await renderProbe();

    api.setItemDone.mockResolvedValue(BLOCKED);
    api.fetchLists.mockResolvedValue({ lists: [BINNED_LIST], error: null, truncated: false });
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
    api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null, truncated: false });
    await renderProbe();

    api.setItemDone.mockResolvedValue(BLOCKED);
    api.fetchLists.mockResolvedValue({ lists: [BINNED_LIST], error: null, truncated: false });
    await fireEvent.press(screen.getByLabelText('toggle'));
    await screen.findByText('blocked: item/setDone');

    api.setItemDone.mockResolvedValue(OK);
    api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null, truncated: false });
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
    api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null, truncated: false });
    await renderProbe();

    api.setItemDone.mockResolvedValue(BLOCKED);
    api.fetchLists.mockResolvedValue({
      lists: [{ ...BINNED_LIST, items: BINNED_ITEM.items }],
      error: null,
      truncated: false,
    });
    await fireEvent.press(screen.getByLabelText('toggle'));
    await screen.findByText('blocked: item/setDone');

    api.setItemDone.mockResolvedValue(OK);
    api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null, truncated: false });
    await fireEvent.press(screen.getByLabelText('restore blocked'));

    await waitFor(() => expect(screen.getByText('pending: 0')).toBeOnTheScreen());
    expect(api.setListDeleted).toHaveBeenCalledWith('l1', false);
    expect(api.setItemDeleted).toHaveBeenCalledWith('i1', false);
  });

  it('drops the write when the user would rather not', async () => {
    api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null, truncated: false });
    await renderProbe();

    api.setItemDone.mockResolvedValue(BLOCKED);
    api.fetchLists.mockResolvedValue({ lists: [BINNED_LIST], error: null, truncated: false });
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
      truncated: false,
    });
    await renderProbe();

    api.setItemDone.mockResolvedValue(BLOCKED);
    api.fetchLists.mockResolvedValue({
      lists: [{ ...BINNED_LIST, role: 'writer' as const }],
      error: null,
      truncated: false,
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
    api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null, truncated: false });
    await renderProbe();

    await fireEvent.press(screen.getByLabelText('bin item'));

    expect(screen.getByText('l1 Groceries: Milk [binned]')).toBeOnTheScreen();
    expect(api.setItemDeleted).toHaveBeenCalledWith('i1', true);
  });

  /** Absolute values, so a change of mind on a train is one request rather than three. */
  it('coalesces bin, restore and bin again into one write', async () => {
    api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null, truncated: false });
    api.setItemDeleted.mockResolvedValue(OFFLINE);
    await renderProbe();

    await fireEvent.press(screen.getByLabelText('bin item'));
    await fireEvent.press(screen.getByLabelText('restore item'));
    await fireEvent.press(screen.getByLabelText('bin item'));

    expect(screen.getByText('pending: 1')).toBeOnTheScreen();
  });

  it('refuses to bin a list you do not own, before anything is sent', async () => {
    api.fetchLists.mockResolvedValue({ lists: [READ_ONLY], error: null, truncated: false });
    await renderProbe();

    await fireEvent.press(screen.getByLabelText('bin list'));

    expect(screen.getByText('error: Only an owner can delete or restore this list.')).toBeOnTheScreen();
    expect(api.setListDeleted).not.toHaveBeenCalled();
  });

  it('refuses to bin an item on a list you can only read', async () => {
    api.fetchLists.mockResolvedValue({ lists: [READ_ONLY], error: null, truncated: false });
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
  api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null, truncated: false });
  await renderProbe();

  let settleFetch = (_result: { lists: List[] | null; error: string | null; truncated: boolean }) => {};
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

  await act(async () => settleFetch({ lists: [BINNED_LIST], error: null, truncated: false }));

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
  api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null, truncated: false });
  await renderProbe();

  api.setItemDone.mockResolvedValue(BLOCKED);
  api.fetchLists.mockResolvedValue({ lists: [BINNED_LIST], error: null, truncated: false });
  await fireEvent.press(screen.getByLabelText('toggle'));
  await screen.findByText('blocked: item/setDone');

  // Queued behind it, and going nowhere while the prompt is up.
  await fireEvent.press(screen.getByLabelText('add'));
  expect(api.addItem).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByLabelText('discard blocked'));

  await waitFor(() => expect(api.addItem).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByText('pending: 0')).toBeOnTheScreen());
});

// --- Pages ---------------------------------------------------------------------------------

/**
 * A fetch carries a first page of each list's rows; the rest is read on scroll. What is worth
 * asserting is the contract with `fetchItems` — which stream, from which cursor — and that a
 * re-fetch does not throw away what a scroll loaded.
 */
const T = (n: number) => `2026-09-01T00:00:${String(n).padStart(2, '0')}.000Z`;
const fetched = (id: string, title: string, n: number, deletedAt: string | null = null) => ({
  id,
  title,
  doneAt: null,
  deletedAt,
  createdAt: T(n),
});
const AFTER_BREAD = { createdAt: T(2), id: 'i2' };
const AFTER_JAM = { createdAt: T(12), id: 'b2' };
/** Page 1 of both streams, each with more to come. */
const PAGED = {
  ...GROCERIES,
  items: [fetched('i1', 'Milk', 1), fetched('i2', 'Bread', 2), fetched('b1', 'Old jam', 11, T(20)), fetched('b2', 'Jam', 12, T(20))],
  nextLive: AFTER_BREAD,
  nextBin: AFTER_JAM,
};

describe('loading more', () => {
  it('reads the next page of live rows from the cursor and appends it', async () => {
    api.fetchLists.mockResolvedValue({ lists: [PAGED], error: null, truncated: false });
    api.fetchItems.mockResolvedValue({
      items: [fetched('i3', 'Eggs', 3)],
      next: null,
      error: null,
    });
    await renderProbe();
    expect(screen.getByText(/l1 Groceries \[more\] \[more binned\]/)).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText('load more'));

    await waitFor(() =>
      expect(screen.getByText('l1 Groceries [more binned]: Milk, Bread, Old jam [binned], Jam [binned], Eggs')).toBeOnTheScreen()
    );
    expect(api.fetchItems).toHaveBeenCalledTimes(1);
    expect(api.fetchItems).toHaveBeenCalledWith('l1', 'live', AFTER_BREAD);
  });

  it('reads the bin as well when asked', async () => {
    api.fetchLists.mockResolvedValue({ lists: [PAGED], error: null, truncated: false });
    api.fetchItems
      .mockResolvedValueOnce({ items: [fetched('i3', 'Eggs', 3)], next: null, error: null })
      .mockResolvedValueOnce({ items: [fetched('b3', 'Rye', 13, T(20))], next: null, error: null });
    await renderProbe();

    await fireEvent.press(screen.getByLabelText('load more with bin'));

    await waitFor(() => expect(screen.getByText(/Rye \[binned\]/)).toBeOnTheScreen());
    expect(api.fetchItems).toHaveBeenCalledWith('l1', 'live', AFTER_BREAD);
    expect(api.fetchItems).toHaveBeenCalledWith('l1', 'bin', AFTER_JAM);
    expect(screen.getByText(/^l1 Groceries: /)).toBeOnTheScreen();
  });

  it('asks for nothing when every row is already here', async () => {
    api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null, truncated: false });
    await renderProbe();

    await fireEvent.press(screen.getByLabelText('load more with bin'));

    expect(api.fetchItems).not.toHaveBeenCalled();
  });

  /** A scroll fires `onEndReached` more than once; the second call finds the first in flight. */
  it('sends one request for a list whose page is already in flight', async () => {
    api.fetchLists.mockResolvedValue({ lists: [PAGED], error: null, truncated: false });
    let settle = (_page: { items: List['items'] | null; next: null; error: null }) => {};
    api.fetchItems.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      })
    );
    await renderProbe();

    await fireEvent.press(screen.getByLabelText('load more'));
    await fireEvent.press(screen.getByLabelText('load more'));
    expect(api.fetchItems).toHaveBeenCalledTimes(1);

    await act(async () => settle({ items: [fetched('i3', 'Eggs', 3)], next: null, error: null }));
    expect(screen.getByText(/Eggs$/)).toBeOnTheScreen();
  });

  /** Silent: the cursor is untouched, so the next scroll simply asks again. */
  it('keeps the cursor when a page fails, so the next scroll retries', async () => {
    api.fetchLists.mockResolvedValue({ lists: [PAGED], error: null, truncated: false });
    api.fetchItems.mockResolvedValueOnce({ items: null, next: null, error: 'network down' });
    await renderProbe();

    await fireEvent.press(screen.getByLabelText('load more'));
    await waitFor(() => expect(api.fetchItems).toHaveBeenCalledTimes(1));

    expect(screen.getByText(/l1 Groceries \[more\] \[more binned\]/)).toBeOnTheScreen();
    expect(screen.getByText('error: none')).toBeOnTheScreen();

    api.fetchItems.mockResolvedValueOnce({ items: [fetched('i3', 'Eggs', 3)], next: null, error: null });
    await fireEvent.press(screen.getByLabelText('load more'));
    await waitFor(() => expect(screen.getByText(/Eggs$/)).toBeOnTheScreen());
  });
});

/**
 * `lists/loaded` replaces state wholesale, and a fresh fetch never carries any items any more —
 * so left alone, a nudge while the user has a list open would collapse it back to nothing loaded
 * and flash a spinner. The provider re-reads each stream from page 1, one page at a time, back up
 * to how much was loaded before — on exactly the lists where nudges are most frequent.
 */
describe('a re-fetch with pages loaded', () => {
  /** Enters the list (page 1 of both streams) and scrolls the live rows once (page 2). */
  async function renderWithTwoPages() {
    jest.useFakeTimers();
    api.fetchLists.mockResolvedValueOnce({
      lists: [{ ...GROCERIES, itemsLoaded: false, items: [] }],
      error: null,
      truncated: false,
    });
    api.fetchItems
      .mockResolvedValueOnce({
        items: [fetched('i1', 'Milk', 1), fetched('i2', 'Bread', 2)],
        next: AFTER_BREAD,
        error: null,
      })
      .mockResolvedValueOnce({
        items: [fetched('b1', 'Old jam', 11, T(20)), fetched('b2', 'Jam', 12, T(20))],
        next: AFTER_JAM,
        error: null,
      });
    await renderProbe();

    await fireEvent.press(screen.getByLabelText('enter list'));
    await waitFor(() => expect(screen.getByText(/Jam \[binned\]$/)).toBeOnTheScreen());

    api.fetchItems.mockResolvedValueOnce({ items: [fetched('i3', 'Eggs', 3)], next: null, error: null });
    await fireEvent.press(screen.getByLabelText('load more'));
    await waitFor(() => expect(screen.getByText(/Eggs$/)).toBeOnTheScreen());

    // From here on, a real `fetchLists` call carries no items at all — every re-expansion request
    // below starts from page 1, exactly as it would against the database.
    api.fetchLists.mockResolvedValue({
      lists: [{ ...GROCERIES, itemsLoaded: false, items: [] }],
      error: null,
      truncated: false,
    });
    api.fetchItems.mockClear();
  }

  it('leaves two pages loaded when a nudge arrives with two pages loaded', async () => {
    await renderWithTwoPages();
    api.fetchItems
      .mockResolvedValueOnce({
        items: [fetched('i1', 'Milk', 1), fetched('i2', 'Bread', 2)],
        next: AFTER_BREAD,
        error: null,
      })
      .mockResolvedValueOnce({ items: [fetched('i3', 'Eggs', 3)], next: null, error: null })
      .mockResolvedValueOnce({
        items: [fetched('b1', 'Old jam', 11, T(20)), fetched('b2', 'Jam', 12, T(20))],
        next: AFTER_JAM,
        error: null,
      });

    await act(async () => nudge());
    await act(async () => {
      jest.advanceTimersByTime(NUDGE_DEBOUNCE);
    });

    await waitFor(() => expect(api.fetchLists).toHaveBeenCalledTimes(2));
    // Live is re-expanded fully (both its pages) before the bin, so the raw order differs from how
    // "load more" built it up originally — the screen sorts by creation order regardless; this
    // test is about nothing being lost, not about array position.
    await waitFor(() =>
      expect(screen.getByText(/Milk, Bread, Eggs, Old jam \[binned\], Jam \[binned\]$/)).toBeOnTheScreen()
    );
    // Two pages of live (to reach Eggs again) plus one page of the bin (which was never scrolled
    // further than page 1) — three requests to rebuild what a nudge would otherwise have erased.
    expect(api.fetchItems).toHaveBeenCalledTimes(3);
    expect(api.fetchItems).toHaveBeenNthCalledWith(1, 'l1', 'live', null);
    expect(api.fetchItems).toHaveBeenNthCalledWith(2, 'l1', 'live', AFTER_BREAD);
    expect(api.fetchItems).toHaveBeenNthCalledWith(3, 'l1', 'bin', null);
  });

  /**
   * Nothing is free to splice a stale page onto any more, so a failed re-expansion snaps the whole
   * list back to bare rather than to a partial page — the next visit reloads it from scratch.
   */
  it('empties the list when the re-read fails, rather than showing half of it', async () => {
    await renderWithTwoPages();
    api.fetchItems.mockResolvedValue({ items: null, next: null, error: 'network down' });

    await act(async () => nudge());
    await act(async () => {
      jest.advanceTimersByTime(NUDGE_DEBOUNCE);
    });

    await waitFor(() => expect(api.fetchItems).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('l1 Groceries: ')).toBeOnTheScreen());
  });
});

/**
 * The one interaction paging would otherwise break *silently*. `restorePlan` reads the tombstone
 * out of state and an empty plan means "discard the write" — so a tombstone beyond page 1 of the
 * bin, which the fetch does not bring, would drop the user's write with no banner. The provider
 * reads that one row before it asks.
 */
it('fetches the tombstone a blocked write landed on when the bin does not reach it', async () => {
  api.fetchLists.mockResolvedValue({ lists: [PAGED], error: null, truncated: false });
  await renderProbe();

  // `i1` was binned by somebody else and, with the bin longer than a page, the re-fetch after the
  // block returns page 1 of the bin without it — and page 1 of the live rows shifted by one. A
  // fresh `fetchLists` never carries items, so the catch-up itself comes through `fetchItems`.
  api.setItemDone.mockResolvedValue(BLOCKED);
  api.fetchLists.mockResolvedValue({
    lists: [{ ...PAGED, items: [], itemsLoaded: false, nextLive: null, nextBin: null }],
    error: null,
    truncated: false,
  });
  api.fetchItems
    .mockResolvedValueOnce({
      items: [fetched('i2', 'Bread', 2), fetched('i3', 'Eggs', 3)],
      next: AFTER_BREAD,
      error: null,
    })
    .mockResolvedValueOnce({
      items: [fetched('b1', 'Old jam', 11, T(20)), fetched('b2', 'Jam', 12, T(20))],
      next: AFTER_JAM,
      error: null,
    });
  api.fetchItem.mockResolvedValue({ item: fetched('i1', 'Milk', 1, T(21)), error: null });
  await fireEvent.press(screen.getByLabelText('toggle'));

  expect(await screen.findByText('blocked: item/setDone')).toBeOnTheScreen();
  expect(api.fetchItem).toHaveBeenCalledWith('i1');
  // Still queued: the write was neither dropped nor delivered.
  expect(screen.getByText('pending: 1')).toBeOnTheScreen();
  expect(screen.getByText(/Milk done \[binned\]/)).toBeOnTheScreen();
  // The cursors are where they were; one row is not a page.
  expect(screen.getByText(/l1 Groceries \[more\] \[more binned\]/)).toBeOnTheScreen();
});

it('does not read a row the fetch already brought', async () => {
  api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null, truncated: false });
  await renderProbe();

  api.setItemDone.mockResolvedValue(BLOCKED);
  api.fetchLists.mockResolvedValue({ lists: [BINNED_ITEM], error: null, truncated: false });
  await fireEvent.press(screen.getByLabelText('toggle'));

  await screen.findByText('blocked: item/setDone');
  expect(api.fetchItem).not.toHaveBeenCalled();
});

/** Lists are capped, not paged; landing on the cap is worth a word to a developer and nothing else. */
it('warns, in development only, when the list read hit the cap', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  api.fetchLists.mockResolvedValue({ lists: [GROCERIES], error: null, truncated: true });

  await renderProbe();

  expect(warn).toHaveBeenCalledWith(expect.stringContaining('MAX_ROWS'));
  expect(screen.getByText('error: none')).toBeOnTheScreen();
  warn.mockRestore();
});
