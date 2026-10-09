import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text } from 'react-native';

import { writeCachedLists } from '../lib/listCache';
import {
  addItem,
  fetchItem,
  fetchItems,
  fetchList,
  fetchListCounts,
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
import { ITEMS_FULL } from '../lib/limits';
import { loadOutbox, saveOutbox } from '../lib/outbox';
import { ListsProvider, useLists } from './ListsContext';
import { inDeletionOrder, inJoinOrder, NO_LIST_COUNTS, NO_LIST_CURSORS } from './listsReducer';
import type { BinCursor, Cursor, List, Stream } from './types';
import { COMPLETION_CAP } from './usePaging';

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
  fetchListCounts: jest.fn(),
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
  fetchListCounts: jest.mocked(fetchListCounts),
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

/**
 * What the database answers `fetchLists` with, one stream at a time: the lists with no tombstone to
 * the live stream and the rest to the bin, as a single page — or the given cursors, for a test that
 * wants a stream with more to come.
 */
/** Where each stream's next page starts, in that stream's own key. */
type NextCursors = { live?: Cursor; bin?: BinCursor };

function pageOf(lists: List[], stream: Stream, next: NextCursors = {}) {
  return {
    lists: lists.filter((list) => (list.deletedAt === null) === (stream === 'live')),
    next: next[stream] ?? null,
    error: null,
  };
}

/** Every read of the lists from here on answers from `lists`, both streams. */
function serveLists(lists: List[], next: NextCursors = {}) {
  api.fetchLists.mockImplementation(async (stream) => pageOf(lists, stream, next));
}

/** The next read of the lists — both of its streams — answers from `lists`, and only that one. */
function serveListsOnce(lists: List[], next: NextCursors = {}) {
  api.fetchLists
    .mockImplementationOnce(async (stream) => pageOf(lists, stream, next))
    .mockImplementationOnce(async (stream) => pageOf(lists, stream, next));
}

/** Every read of the lists fails, both streams. */
function failLists(error: string) {
  api.fetchLists.mockResolvedValue({ lists: null, next: null, error });
}

/**
 * How many times the lists were read from the top — once per `hydrate`, which always asks for page 1
 * of the live stream (and of the bin beside it). Counting raw `fetchLists` calls would count both
 * streams and every continuation page.
 */
function hydrations(): number {
  return api.fetchLists.mock.calls.filter(([stream, after]) => stream === 'live' && after === null)
    .length;
}

const unsubscribe = jest.fn();

/** Captured so a test can deliver a nudge, or a reconnect, the way the database would. */
let nudge: (listId?: string) => void;
let resubscribe: () => void;
let notificationsNudge: () => void;

const USER = 'u1';

const MILK = { id: 'i1', title: 'Milk', doneAt: null, deletedAt: null, createdAt: null };
/** When the account joined GROCERIES, as the database stamps it. */
const JOINED = '2026-09-01T08:00:00+00:00';
/**
 * A list as it looks once its items are known — either because `fetchLists` is mocked as a
 * shortcut to skip straight past "enter list" for tests that are not about that mechanism, or
 * because the probe already pressed it. The real `fetchLists` never carries items any more; see
 * `describe('entering a list', ...)` for the tests that exercise that boundary directly.
 */
const GROCERIES = { id: 'l1', name: 'Groceries', role: 'owner' as const, deletedAt: null, joinedAt: JOINED, itemsLoaded: true, items: [MILK], nextLive: null, nextBin: null };
/** The same list as seen by somebody it was shared with, read-only. */
const READ_ONLY = { ...GROCERIES, role: 'reader' as const };

const OK: Result = { error: null, verdict: 'ok' };
/** What a write looks like with no signal: postgrest-js reports a failed fetch as status 0. */
const OFFLINE: Result = { error: 'TypeError: Failed to fetch', verdict: 'retryable' };
const REFUSED: Result = { error: 'permission denied', verdict: 'permanent' };
/** What `session_still_valid()` raises once this device's session is gone. */
const REVOKED: Result = {
  error: 'this device has been signed out',
  verdict: 'permanent',
  sessionRevoked: true,
};
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

  serveLists([]);
  api.fetchListCounts.mockResolvedValue({ counts: NO_LIST_COUNTS, error: null });
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

  jest.mocked(subscribeToChanges).mockImplementation((_userId, onChange, onResubscribe, onNotifications) => {
    nudge = onChange;
    resubscribe = onResubscribe;
    notificationsNudge = onNotifications;
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
    listCursors,
    listCounts,
    status,
    error,
    pending,
    blocked,
    lastNudge,
    lastNotificationsNudge,
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
    loadMoreLists,
    loadAllItems,
    loadAllLists,
    readEpoch,
  } = useLists();
  // The last completion's outcome, and the way to stop the one running.
  const [completion, setCompletion] = useState('none');
  // How many times `lastNotificationsNudge` has moved — it carries nothing but its own identity.
  const [notificationsNudges, setNotificationsNudges] = useState(0);
  useEffect(() => {
    if (lastNotificationsNudge) setNotificationsNudges((n) => n + 1);
  }, [lastNotificationsNudge]);
  const stop = useRef(new AbortController());
  const completeWith = (run: (signal: AbortSignal) => Promise<string>) => {
    stop.current = new AbortController();
    void run(stop.current.signal).then(setCompletion);
  };

  return (
    <>
      <Text>{`status: ${status}`}</Text>
      <Text>{`error: ${error ?? 'none'}`}</Text>
      <Text>{`pending: ${pending}`}</Text>
      <Text>{`blocked: ${blocked ? blocked.op.type : 'none'}`}</Text>
      <Text>{`lastNudge: ${lastNudge ? (lastNudge.listId ?? 'all') : 'none'}`}</Text>
      <Text>{`notifications nudges: ${notificationsNudges}`}</Text>
      <Text>{`list cursors: ${listCursors.live?.id ?? 'end'}, ${listCursors.bin?.id ?? 'end'}`}</Text>
      <Text>{`list counts: ${listCounts.owned} owned, ${listCounts.total} in total`}</Text>
      <Text>{`read epoch: ${readEpoch}`}</Text>
      <Text>{`completion: ${completion}`}</Text>
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
      <Button label="load more" onPress={() => void loadMore('l1', 'live')} />
      <Button label="load more bin" onPress={() => void loadMore('l1', 'bin')} />
      <Button label="enter list" onPress={() => void loadListItems(lists[0]?.id ?? 'l1')} />
      <Button label="load more lists" onPress={() => void loadMoreLists('live')} />
      <Button label="load more lists bin" onPress={() => void loadMoreLists('bin')} />
      <Button label="load all items" onPress={() => completeWith((signal) => loadAllItems('l1', signal))} />
      <Button label="load all lists" onPress={() => completeWith(loadAllLists)} />
      <Button label="stop loading all" onPress={() => stop.current.abort()} />
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
    <ListsProvider userId={USER} onSessionRevoked={() => {}}>
      <Probe />
    </ListsProvider>
  );

  await screen.findByText('status: ready');
}

it('hydrates the list itself from the database on mount, with no items yet', async () => {
  serveLists([{ ...GROCERIES, itemsLoaded: false, items: [] }]);

  await renderProbe();

  expect(screen.getByText('l1 Groceries: ')).toBeOnTheScreen();
  expect(hydrations()).toBe(1);
  expect(api.fetchItems).not.toHaveBeenCalled();
});

/**
 * The point of this step: `fetchLists` no longer carries any items, for any list — opening the
 * Lists screen used to fetch a first page of every list's rows, which is what made it laggy.
 * `loadListItems` is what a screen calls once it actually opens a list.
 */
describe('entering a list', () => {
  beforeEach(() => {
    serveLists([{ ...GROCERIES, itemsLoaded: false, items: [] }]);
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
  failLists('network down');

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
  serveLists([{ ...GROCERIES, items: [] }]);

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
  serveLists([GROCERIES]);

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
  serveLists([GROCERIES]);

  await renderProbe();
  await fireEvent.press(screen.getByLabelText('rename'));

  expect(screen.getByText('l1 Weekly shop: Milk')).toBeOnTheScreen();
  await waitFor(() => expect(api.renameList).toHaveBeenCalledWith('l1', 'Weekly shop'));
});

it('does not rename a list to nothing', async () => {
  serveLists([GROCERIES]);

  await renderProbe();
  await fireEvent.press(screen.getByLabelText('rename blank'));

  expect(api.renameList).not.toHaveBeenCalled();
});

it('renames an item optimistically and sends the new title', async () => {
  serveLists([GROCERIES]);

  await renderProbe();
  await fireEvent.press(screen.getByLabelText('rename item'));

  expect(screen.getByText('l1 Groceries: Oat milk')).toBeOnTheScreen();
  await waitFor(() => expect(api.renameItem).toHaveBeenCalledWith('i1', 'Oat milk'));
});

it('does not rename an item to nothing', async () => {
  serveLists([GROCERIES]);

  await renderProbe();
  await fireEvent.press(screen.getByLabelText('rename item blank'));

  expect(api.renameItem).not.toHaveBeenCalled();
  expect(screen.getByText('l1 Groceries: Milk')).toBeOnTheScreen();
});

/** A title is an absolute value like a list name, so only the newest of a queued run is sent. */
it('sends one write for an item renamed repeatedly with no signal', async () => {
  serveLists([GROCERIES]);
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
    serveLists([READ_ONLY]);
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
  serveLists([{ ...GROCERIES, role: 'writer' }]);

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
  serveLists([]);
  api.insertList.mockResolvedValue(REFUSED);

  await renderProbe();
  await fireEvent.press(screen.getByLabelText('create'));

  expect(await screen.findByText('error: permission denied')).toBeOnTheScreen();
  await waitFor(() => expect(hydrations()).toBe(2));
  expect(screen.queryByText(/Groceries/)).not.toBeOnTheScreen();
});

/**
 * A refused write for a revoked session is not an ordinary refusal: nothing is wrong with the write
 * itself, only this device's own credentials are stale. The provider hands off to
 * `onSessionRevoked` instead of banner-ing a message on a screen that is about to be replaced, and
 * leaves the write queued rather than dropping it — signing back in reloads the outbox from disk
 * and retries it.
 */
it('hands off to onSessionRevoked instead of banner-ing a write refused for a revoked session', async () => {
  serveLists([]);
  api.insertList.mockResolvedValue(REVOKED);
  const onSessionRevoked = jest.fn();

  await render(
    <ListsProvider userId={USER} onSessionRevoked={onSessionRevoked}>
      <Probe />
    </ListsProvider>
  );
  await screen.findByText('status: ready');

  await fireEvent.press(screen.getByLabelText('create'));

  await waitFor(() => expect(onSessionRevoked).toHaveBeenCalledTimes(1));
  expect(screen.getByText('error: none')).toBeOnTheScreen();
  expect(screen.getByText('pending: 1')).toBeOnTheScreen();
  // No rollback re-fetch: the provider is about to unmount once the caller signs this device out.
  expect(hydrations()).toBe(1);
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
  expect(hydrations()).toBe(1);
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
  serveLists([GROCERIES]);
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
  await writeCachedLists(USER, [GROCERIES], NO_LIST_CURSORS, NO_LIST_COUNTS);
  failLists('network down');

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
  failLists('network down');
  await renderProbe();

  expect(screen.getByText(/Groceries/)).toBeOnTheScreen();
});

it('never reads another account cached lists', async () => {
  await writeCachedLists('someone-else', [GROCERIES], NO_LIST_CURSORS, NO_LIST_COUNTS);

  await renderProbe();

  expect(screen.queryByText(/Groceries/)).not.toBeOnTheScreen();
});

/**
 * The whole feature end to end, and the reason the cache stores fetched rows rather than what is on
 * screen: replay the outbox over a cache that already contains it and the item appears twice.
 */
it('does not duplicate a pending write across a restart', async () => {
  serveLists([GROCERIES]);
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

  expect(hydrations()).toBe(2);
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

  expect(hydrations()).toBe(2);
});

/** Delivery is at-most-once: whatever was sent while the socket was down is gone, so re-read. */
it('re-reads when the socket comes back', async () => {
  jest.useFakeTimers();
  await renderProbe();

  await act(async () => resubscribe());
  await act(async () => {
    jest.advanceTimersByTime(NUDGE_DEBOUNCE);
  });

  expect(hydrations()).toBe(2);
});

/**
 * `lastNudge` is for a screen with state outside this reducer (only `SharingScreen`'s roster,
 * today) — it updates immediately, not behind the debounce that gates `fetchLists`, since nothing
 * about it triggers a fetch of its own.
 */
it('records the list a nudge named, for a screen outside this state to read', async () => {
  await renderProbe();

  await act(async () => nudge('l7'));

  expect(screen.getByText('lastNudge: l7')).toBeOnTheScreen();
});

it('records a nudge with no list as "all", the same case a resubscribe is', async () => {
  await renderProbe();

  await act(async () => resubscribe());

  expect(screen.getByText('lastNudge: all')).toBeOnTheScreen();
});

/**
 * `lastNotificationsNudge` is for `NotificationsContext` and the Notifications screen (task 28): a
 * fresh object per `notifications/changed`, so each one moves it, and a lists nudge does not.
 */
it('moves the notifications nudge on each notifications event, and only on those', async () => {
  await renderProbe();
  expect(screen.getByText('notifications nudges: 0')).toBeOnTheScreen();

  await act(async () => notificationsNudge());
  await act(async () => notificationsNudge());
  expect(screen.getByText('notifications nudges: 2')).toBeOnTheScreen();

  await act(async () => nudge('l1'));
  expect(screen.getByText('notifications nudges: 2')).toBeOnTheScreen();
  expect(screen.getByText('lastNudge: l1')).toBeOnTheScreen();
});

/** A reconnect may have missed either kind of nudge, so it moves both. */
it('moves both nudges on a resubscribe', async () => {
  await renderProbe();

  await act(async () => resubscribe());

  expect(screen.getByText('notifications nudges: 1')).toBeOnTheScreen();
  expect(screen.getByText('lastNudge: all')).toBeOnTheScreen();
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
  expect(hydrations()).toBe(1);

  await act(async () => settleInsert(OK));

  await waitFor(() => expect(hydrations()).toBe(2));
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
  serveListsOnce([GROCERIES]);
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
  serveListsOnce([GROCERIES]);
  await renderProbe();
  await waitFor(() => expect(screen.getByText(/l1 Groceries: Milk/)).toBeOnTheScreen());

  let settleFetch = () => {};
  const answered = new Promise<void>((resolve) => {
    settleFetch = resolve;
  });
  api.fetchLists.mockImplementation(async (stream) => {
    await answered;
    return pageOf([GROCERIES], stream);
  });

  await act(async () => resubscribe());
  await act(async () => {
    jest.advanceTimersByTime(NUDGE_DEBOUNCE);
  });
  expect(hydrations()).toBe(2);

  await fireEvent.press(screen.getByLabelText('toggle'));
  await screen.findByText('pending: 1');
  expect(api.setItemDone).not.toHaveBeenCalled();

  await act(async () => settleFetch());

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
  serveListsOnce([GROCERIES]);
  await renderProbe();
  await waitFor(() => expect(screen.getByText(/l1 Groceries/)).toBeOnTheScreen());

  api.fetchList.mockResolvedValueOnce({ list: GROCERIES, error: null });

  await act(async () => nudge('l1'));
  await act(async () => {
    jest.advanceTimersByTime(NUDGE_DEBOUNCE);
  });

  await waitFor(() => expect(api.fetchList).toHaveBeenCalledWith('l1'));
  // Still just the mount's call — a named nudge never falls back to asking for every list.
  expect(hydrations()).toBe(1);
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
    joinedAt: null,
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
  expect(hydrations()).toBe(1);
});

/** Unshared, or purged — `fetchList` answers the same way either time: not visible any more. */
it('drops a list a nudge names once it is no longer visible', async () => {
  jest.useFakeTimers();
  serveListsOnce([GROCERIES]);
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
  serveListsOnce([GROCERIES]);
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
  serveListsOnce([
      { ...GROCERIES, items: [fetched('i1', 'Milk', 1)] },
      { ...GROCERIES, id: 'l2', name: 'Hardware', items: [fetched('i2', 'Nails', 2)] },
    ]);
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
  expect(hydrations()).toBe(1);
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
    serveLists([GROCERIES]);
    await renderProbe();

    api.setItemDone.mockResolvedValue(BLOCKED);
    serveLists([BINNED_LIST]);
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
    serveLists([GROCERIES]);
    await renderProbe();

    api.setItemDone.mockResolvedValue(BLOCKED);
    serveLists([BINNED_LIST]);
    await fireEvent.press(screen.getByLabelText('toggle'));
    await screen.findByText('blocked: item/setDone');

    expect(await loadOutbox(USER)).toEqual([
      { type: 'item/setDone', listId: 'l1', itemId: 'i1', doneAt: expect.any(String) },
    ]);
  });

  it('stops sending while it waits for an answer', async () => {
    serveLists([GROCERIES]);
    await renderProbe();

    api.setItemDone.mockResolvedValue(BLOCKED);
    serveLists([BINNED_LIST]);
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
    serveLists([GROCERIES]);
    await renderProbe();

    api.setItemDone.mockResolvedValue(BLOCKED);
    serveLists([BINNED_LIST]);
    await fireEvent.press(screen.getByLabelText('toggle'));
    await screen.findByText('blocked: item/setDone');

    api.setItemDone.mockResolvedValue(OK);
    serveLists([GROCERIES]);
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
    serveLists([GROCERIES]);
    await renderProbe();

    api.setItemDone.mockResolvedValue(BLOCKED);
    serveLists([{ ...BINNED_LIST, items: BINNED_ITEM.items }]);
    await fireEvent.press(screen.getByLabelText('toggle'));
    await screen.findByText('blocked: item/setDone');

    api.setItemDone.mockResolvedValue(OK);
    serveLists([GROCERIES]);
    await fireEvent.press(screen.getByLabelText('restore blocked'));

    await waitFor(() => expect(screen.getByText('pending: 0')).toBeOnTheScreen());
    expect(api.setListDeleted).toHaveBeenCalledWith('l1', false);
    expect(api.setItemDeleted).toHaveBeenCalledWith('i1', false);
  });

  it('drops the write when the user would rather not', async () => {
    serveLists([GROCERIES]);
    await renderProbe();

    api.setItemDone.mockResolvedValue(BLOCKED);
    serveLists([BINNED_LIST]);
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
    serveLists([{ ...GROCERIES, role: 'writer' as const }]);
    await renderProbe();

    api.setItemDone.mockResolvedValue(BLOCKED);
    serveLists([{ ...BINNED_LIST, role: 'writer' as const }]);
    await fireEvent.press(screen.getByLabelText('toggle'));

    await waitFor(() => expect(screen.getByText('pending: 0')).toBeOnTheScreen());
    expect(screen.getByText('blocked: none')).toBeOnTheScreen();
    expect(screen.getByText('error: none')).toBeOnTheScreen();
    expect(await loadOutbox(USER)).toEqual([]);
  });
});

describe('binning and restoring', () => {
  it('sends the boolean and shows the tombstone before the database answers', async () => {
    serveLists([GROCERIES]);
    await renderProbe();

    await fireEvent.press(screen.getByLabelText('bin item'));

    expect(screen.getByText('l1 Groceries: Milk [binned]')).toBeOnTheScreen();
    expect(api.setItemDeleted).toHaveBeenCalledWith('i1', true);
  });

  /** Absolute values, so a change of mind on a train is one request rather than three. */
  it('coalesces bin, restore and bin again into one write', async () => {
    serveLists([GROCERIES]);
    api.setItemDeleted.mockResolvedValue(OFFLINE);
    await renderProbe();

    await fireEvent.press(screen.getByLabelText('bin item'));
    await fireEvent.press(screen.getByLabelText('restore item'));
    await fireEvent.press(screen.getByLabelText('bin item'));

    expect(screen.getByText('pending: 1')).toBeOnTheScreen();
  });

  it('refuses to bin a list you do not own, before anything is sent', async () => {
    serveLists([READ_ONLY]);
    await renderProbe();

    await fireEvent.press(screen.getByLabelText('bin list'));

    expect(screen.getByText('error: Only an owner can delete or restore this list.')).toBeOnTheScreen();
    expect(api.setListDeleted).not.toHaveBeenCalled();
  });

  it('refuses to bin an item on a list you can only read', async () => {
    serveLists([READ_ONLY]);
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
  serveLists([GROCERIES]);
  await renderProbe();

  let settleFetch = () => {};
  const answered = new Promise<void>((resolve) => {
    settleFetch = resolve;
  });
  api.setItemDone.mockResolvedValue(BLOCKED);
  api.fetchLists.mockImplementation(async (stream) => {
    await answered;
    return pageOf([BINNED_LIST], stream);
  });

  await fireEvent.press(screen.getByLabelText('toggle'));

  // The write has been answered, but the tombstone has not arrived yet.
  await waitFor(() => expect(hydrations()).toBe(2));
  expect(screen.getByText('blocked: none')).toBeOnTheScreen();

  await act(async () => settleFetch());

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
  serveLists([GROCERIES]);
  await renderProbe();

  api.setItemDone.mockResolvedValue(BLOCKED);
  serveLists([BINNED_LIST]);
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
/** The bin pages newest deletion first: Old jam (deleted at 21) above Jam (at 20), so Jam is last. */
const AFTER_JAM = { deletedAt: T(20), id: 'b2' };
/** Page 1 of both streams, each with more to come. */
const PAGED = {
  ...GROCERIES,
  items: [fetched('i1', 'Milk', 1), fetched('i2', 'Bread', 2), fetched('b1', 'Old jam', 11, T(21)), fetched('b2', 'Jam', 12, T(20))],
  nextLive: AFTER_BREAD,
  nextBin: AFTER_JAM,
};

describe('loading more', () => {
  it('reads the next page of live rows from the cursor and appends it', async () => {
    serveLists([PAGED]);
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

  /** The bin is its own view, so a page of it is asked for alone — never alongside a live one. */
  it('reads only the bin when the bin is asked for', async () => {
    serveLists([PAGED]);
    api.fetchItems.mockResolvedValueOnce({ items: [fetched('b3', 'Rye', 13, T(19))], next: null, error: null });
    await renderProbe();

    await fireEvent.press(screen.getByLabelText('load more bin'));

    await waitFor(() => expect(screen.getByText(/Rye \[binned\]/)).toBeOnTheScreen());
    expect(api.fetchItems).toHaveBeenCalledTimes(1);
    expect(api.fetchItems).toHaveBeenCalledWith('l1', 'bin', AFTER_JAM);
    // The live cursor is untouched: live mode asks for its own next page when it is shown.
    expect(screen.getByText(/^l1 Groceries \[more\]: /)).toBeOnTheScreen();
  });

  it('asks for nothing when every row is already here', async () => {
    serveLists([GROCERIES]);
    await renderProbe();

    await fireEvent.press(screen.getByLabelText('load more'));
    await fireEvent.press(screen.getByLabelText('load more bin'));

    expect(api.fetchItems).not.toHaveBeenCalled();
  });

  /** A scroll fires `onEndReached` more than once; the second call finds the first in flight. */
  it('sends one request for a list whose page is already in flight', async () => {
    serveLists([PAGED]);
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
    serveLists([PAGED]);
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
    serveListsOnce([{ ...GROCERIES, itemsLoaded: false, items: [] }]);
    api.fetchItems
      .mockResolvedValueOnce({
        items: [fetched('i1', 'Milk', 1), fetched('i2', 'Bread', 2)],
        next: AFTER_BREAD,
        error: null,
      })
      .mockResolvedValueOnce({
        items: [fetched('b1', 'Old jam', 11, T(21)), fetched('b2', 'Jam', 12, T(20))],
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
    serveLists([{ ...GROCERIES, itemsLoaded: false, items: [] }]);
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
        items: [fetched('b1', 'Old jam', 11, T(21)), fetched('b2', 'Jam', 12, T(20))],
        next: AFTER_JAM,
        error: null,
      });

    await act(async () => nudge());
    await act(async () => {
      jest.advanceTimersByTime(NUDGE_DEBOUNCE);
    });

    await waitFor(() => expect(hydrations()).toBe(2));
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
  serveLists([PAGED]);
  await renderProbe();

  // `i1` was binned by somebody else and, with the bin longer than a page, the re-fetch after the
  // block returns page 1 of the bin without it — and page 1 of the live rows shifted by one. A
  // fresh `fetchLists` never carries items, so the catch-up itself comes through `fetchItems`.
  api.setItemDone.mockResolvedValue(BLOCKED);
  serveLists([{ ...PAGED, items: [], itemsLoaded: false, nextLive: null, nextBin: null }]);
  api.fetchItems
    .mockResolvedValueOnce({
      items: [fetched('i2', 'Bread', 2), fetched('i3', 'Eggs', 3)],
      next: AFTER_BREAD,
      error: null,
    })
    .mockResolvedValueOnce({
      items: [fetched('b1', 'Old jam', 11, T(21)), fetched('b2', 'Jam', 12, T(20))],
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
  serveLists([GROCERIES]);
  await renderProbe();

  api.setItemDone.mockResolvedValue(BLOCKED);
  serveLists([BINNED_ITEM]);
  await fireEvent.press(screen.getByLabelText('toggle'));

  await screen.findByText('blocked: item/setDone');
  expect(api.fetchItem).not.toHaveBeenCalled();
});

// --- Lists, paged ------------------------------------------------------------------------------

/**
 * Lists page the way items do: page 1 of both streams on every `hydrate`, the rest on scroll, and a
 * re-read brings back as many pages as were loaded. `servePagedLists` stands in for the keyset read
 * itself, so a cursor it hands out is the one it is asked to continue from.
 */
const joinedAt = (n: number) => `2026-09-02T00:00:${String(n).padStart(2, '0')}+00:00`;
const cursorAt = (n: number): Cursor => ({ createdAt: joinedAt(n), id: `m${String(n).padStart(2, '0')}` });
const BINNED_AT = '2026-09-10T09:00:00.000Z';

/** List `n`, as a page of `fetchLists` carries it: joined in the order of `n`, nothing loaded. */
function member(n: number, deletedAt: string | null = null, name = `Member ${n}`): List {
  return {
    id: cursorAt(n).id,
    name,
    role: 'owner',
    deletedAt,
    joinedAt: joinedAt(n),
    itemsLoaded: false,
    items: [],
    nextLive: null,
    nextBin: null,
  };
}

/**
 * `fetchLists` over `all`, `size` lists a page, keyset like the real read: the live lists on
 * `(joinedAt, id)` ascending, the bin on `(deletedAt, id)` descending.
 */
function servePagedLists(all: List[], size: number) {
  api.fetchLists.mockImplementation(async (stream, after) => {
    const ordered =
      stream === 'live' ? inJoinOrder(pageOf(all, 'live').lists) : inDeletionOrder(pageOf(all, 'bin').lists);
    const rest = ordered.filter((list) => {
      if (after === null) return true;
      if ('deletedAt' in after) {
        const at = list.deletedAt as string;
        return at < after.deletedAt || (at === after.deletedAt && list.id < after.id);
      }
      const at = list.joinedAt as string;
      return at > after.createdAt || (at === after.createdAt && list.id > after.id);
    });
    const page = rest.slice(0, size);
    const last = page[page.length - 1];
    const next =
      page.length < size
        ? null
        : stream === 'live'
          ? { createdAt: last.joinedAt as string, id: last.id }
          : { deletedAt: last.deletedAt as string, id: last.id };
    return { lists: page, next, error: null };
  });
}

const row = (n: number) => new RegExp(`^${cursorAt(n).id} `);

describe('lists, paged', () => {
  const FIVE_LIVE = [1, 2, 3, 4, 5].map((n) => member(n));

  /** Mounts on page 1 of five live lists, two a page, then scrolls once: pages 1 and 2 loaded. */
  async function renderWithTwoPagesOfLists(all: List[] = FIVE_LIVE) {
    servePagedLists(all, 2);
    await renderProbe();
    await fireEvent.press(screen.getByLabelText('load more lists'));
    await waitFor(() => expect(screen.getByText(row(4))).toBeOnTheScreen());
    api.fetchLists.mockClear();
  }

  it('reads page 1 of both streams on mount, and the next page of lists from the cursor on scroll', async () => {
    servePagedLists(FIVE_LIVE, 2);
    await renderProbe();

    expect(api.fetchLists).toHaveBeenCalledWith('live', null);
    expect(api.fetchLists).toHaveBeenCalledWith('bin', null);
    expect(screen.getByText(row(2))).toBeOnTheScreen();
    expect(screen.queryByText(row(3))).not.toBeOnTheScreen();
    expect(screen.getByText('list cursors: m02, end')).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText('load more lists'));

    await waitFor(() => expect(screen.getByText(row(4))).toBeOnTheScreen());
    expect(api.fetchLists).toHaveBeenLastCalledWith('live', cursorAt(2));
    expect(screen.getByText('list cursors: m04, end')).toBeOnTheScreen();
  });

  /**
   * The bin pages newest deletion first and only when asked: page 1 holds the two most recently
   * binned, and the next page continues below them on `(deletedAt, id)`. Asking for it asks for no
   * live page, and the live scroll asks for no bin page.
   */
  it('reads the next page of the bin only when asked, newest deletion first', async () => {
    const binnedAt = (n: number) => `2026-09-10T09:00:0${n}.000Z`;
    // Joined 2, 3, 4, deleted in the opposite order: m02 last, so it leads the bin.
    servePagedLists([member(1), member(2, binnedAt(9)), member(3, binnedAt(5)), member(4, binnedAt(1))], 2);
    await renderProbe();
    expect(screen.getByText('list cursors: end, m03')).toBeOnTheScreen();
    expect(screen.queryByText(row(4))).not.toBeOnTheScreen();

    api.fetchLists.mockClear();
    await fireEvent.press(screen.getByLabelText('load more lists'));
    expect(api.fetchLists).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText('load more lists bin'));
    await waitFor(() => expect(screen.getByText(row(4))).toBeOnTheScreen());
    expect(api.fetchLists.mock.calls).toEqual([['bin', { deletedAt: binnedAt(5), id: 'm03' }]]);
    expect(screen.getByText('list cursors: end, end')).toBeOnTheScreen();
  });

  /** The Lists screen's case: a nudge must not snap a scroll two pages deep back to one. */
  it('leaves two pages of lists loaded when a nudge arrives', async () => {
    jest.useFakeTimers();
    await renderWithTwoPagesOfLists();

    await act(async () => nudge());
    await act(async () => {
      jest.advanceTimersByTime(NUDGE_DEBOUNCE);
    });

    await waitFor(() => expect(api.fetchLists).toHaveBeenCalledWith('live', cursorAt(2)));
    expect(api.fetchLists.mock.calls).toEqual([
      ['live', null],
      ['bin', null],
      ['live', cursorAt(2)],
    ]);
    await waitFor(() => expect(screen.getByText('list cursors: m04, end')).toBeOnTheScreen());
    expect(screen.getByText(row(4))).toBeOnTheScreen();
    expect(screen.queryByText(row(5))).not.toBeOnTheScreen();
  });

  /**
   * Unlike a list's items, the lists do not snap back to what the re-read got through: that would
   * drop the lists past it from state, including one open on List detail or one with writes queued.
   * The whole re-read is thrown away instead — page 1's news included.
   */
  it('leaves state untouched when a list continuation fails', async () => {
    jest.useFakeTimers();
    await renderWithTwoPagesOfLists();

    servePagedLists([member(1, null, 'Renamed since'), ...FIVE_LIVE.slice(1)], 2);
    const paged = api.fetchLists.getMockImplementation()!;
    api.fetchLists.mockImplementation(async (stream, after) =>
      after === null ? paged(stream, after) : { lists: null, next: null, error: 'network down' }
    );

    await act(async () => nudge());
    await act(async () => {
      jest.advanceTimersByTime(NUDGE_DEBOUNCE);
    });

    await waitFor(() => expect(api.fetchLists).toHaveBeenCalledWith('live', cursorAt(2)));
    expect(screen.getByText(/^m01 Member 1/)).toBeOnTheScreen();
    expect(screen.queryByText(/Renamed since/)).not.toBeOnTheScreen();
    expect(screen.getByText(row(4))).toBeOnTheScreen();
    expect(screen.getByText('list cursors: m04, end')).toBeOnTheScreen();
    // A nudge-triggered re-read is silent when it fails, as it always was.
    expect(screen.getByText('error: none')).toBeOnTheScreen();
  });

  /**
   * A list shared with you mid-stream sorts where you joined it. Appended while the lists before it
   * are not loaded yet, it would sit out of place; so it waits for its page, the way an item added
   * past a loaded page does.
   */
  it('appends a list a nudge names only when it falls inside the loaded pages', async () => {
    jest.useFakeTimers();
    servePagedLists(FIVE_LIVE, 2);
    await renderProbe();
    expect(screen.getByText('list cursors: m02, end')).toBeOnTheScreen();

    api.fetchList.mockImplementation(async (id) => ({
      list: id === 'm00' ? member(0) : member(9),
      error: null,
    }));

    await act(async () => {
      nudge('m00');
      nudge('m09');
    });
    await act(async () => {
      jest.advanceTimersByTime(NUDGE_DEBOUNCE);
    });

    await waitFor(() => expect(screen.getByText(row(0))).toBeOnTheScreen());
    expect(api.fetchList).toHaveBeenCalledWith('m09');
    expect(screen.queryByText(row(9))).not.toBeOnTheScreen();
    expect(screen.getByText('list cursors: m02, end')).toBeOnTheScreen();
  });

  /**
   * The blocked-write path, one level up. The list itself sorts past the loaded pages of the bin once
   * somebody else bins it, and a plan with no list in it is empty — which discards the write,
   * silently. The provider reads that one list before it asks.
   */
  it('fetches the list a blocked write landed on when the bin pages do not reach it', async () => {
    serveLists([GROCERIES]);
    await renderProbe();

    api.renameList.mockResolvedValue(BLOCKED);
    // Page 1 of the bin is full of lists binned since l1 was, and l1 sorts after them.
    const SINCE = { ...member(1, BINNED_AT), joinedAt: '2026-09-01T07:00:00+00:00' };
    serveLists([SINCE], { bin: { deletedAt: BINNED_AT, id: SINCE.id } });
    api.fetchList.mockResolvedValue({
      list: { ...BINNED_LIST, items: [], itemsLoaded: false },
      error: null,
    });

    await fireEvent.press(screen.getByLabelText('rename'));

    expect(await screen.findByText('blocked: list/renamed')).toBeOnTheScreen();
    expect(api.fetchList).toHaveBeenCalledWith('l1');
    expect(screen.getByText('pending: 1')).toBeOnTheScreen();
    // Folded in with the queued rename on top, and with no page's cursor moved by it.
    expect(screen.getByText(/^l1 Weekly shop \[binned\]/)).toBeOnTheScreen();
    expect(screen.getByText('list cursors: end, m01')).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText('restore blocked'));

    await waitFor(() => expect(api.setListDeleted).toHaveBeenCalledWith('l1', false));
  });

  /** The cache holds the list cursors, so a cold start re-reads as deep as the last session got. */
  it('re-reads as many pages of lists as the cache held on a cold start', async () => {
    await writeCachedLists(USER, FIVE_LIVE.slice(0, 4), { live: cursorAt(4), bin: null }, NO_LIST_COUNTS);
    servePagedLists(FIVE_LIVE, 2);

    await renderProbe();

    await waitFor(() => expect(api.fetchLists).toHaveBeenCalledWith('live', cursorAt(2)));
    expect(api.fetchLists).not.toHaveBeenCalledWith('live', cursorAt(4));
    expect(screen.getByText(row(4))).toBeOnTheScreen();
    expect(screen.queryByText(row(5))).not.toBeOnTheScreen();
  });
});

/**
 * The counts the Lists screen warns from (task 23 step 2). The server's, read beside page 1 on every
 * full re-read, with this device's own creates and bins counted on top as they are made — sent or
 * not — and nothing counted twice.
 */
describe('list counts', () => {
  const serveCounts = (owned: number, total: number) =>
    api.fetchListCounts.mockResolvedValue({ counts: { owned, total }, error: null });

  it('are read beside page 1 of the lists', async () => {
    serveCounts(7, 9);

    await renderProbe();

    expect(screen.getByText('list counts: 7 owned, 9 in total')).toBeOnTheScreen();
    expect(api.fetchListCounts).toHaveBeenCalledTimes(1);
  });

  /** They are the base pending writes are counted on, so there is no older copy worth keeping. */
  it('fail the whole re-read when they cannot be read, leaving state untouched', async () => {
    jest.useFakeTimers();
    serveLists([GROCERIES]);
    serveCounts(7, 9);
    await renderProbe();

    serveLists([{ ...GROCERIES, name: 'Renamed since' }]);
    api.fetchListCounts.mockResolvedValue({ counts: null, error: 'network down' });
    await act(async () => nudge());
    await act(async () => {
      jest.advanceTimersByTime(NUDGE_DEBOUNCE);
    });

    await waitFor(() => expect(api.fetchListCounts).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/^l1 Groceries/)).toBeOnTheScreen();
    expect(screen.queryByText(/Renamed since/)).not.toBeOnTheScreen();
    expect(screen.getByText('list counts: 7 owned, 9 in total')).toBeOnTheScreen();
  });

  it('count a list created with no signal before the database has it', async () => {
    serveCounts(99, 99);
    api.insertList.mockResolvedValue(OFFLINE);
    await renderProbe();

    await fireEvent.press(screen.getByLabelText('create'));

    expect(screen.getByText('list counts: 100 owned, 100 in total')).toBeOnTheScreen();
  });

  /** A re-read replaces the counts, so the queue has to be counted again on top of what it read. */
  it('count a pending create on top of the counts a re-read brings', async () => {
    await saveOutbox(USER, [{ type: 'list/created', id: 'l9', name: 'Hardware' }]);
    serveCounts(99, 99);
    api.insertList.mockResolvedValue(OFFLINE);

    await renderProbe();

    expect(screen.getByText('l9 Hardware: ')).toBeOnTheScreen();
    expect(screen.getByText('list counts: 100 owned, 100 in total')).toBeOnTheScreen();
  });

  it('count a create left in the outbox on a cold start with no signal', async () => {
    await writeCachedLists(USER, [GROCERIES], NO_LIST_CURSORS, { owned: 99, total: 99 });
    await saveOutbox(USER, [{ type: 'list/created', id: 'l9', name: 'Hardware' }]);
    failLists('network down');
    api.insertList.mockResolvedValue(OFFLINE);

    await renderProbe();

    expect(screen.getByText('list counts: 100 owned, 100 in total')).toBeOnTheScreen();
  });

  /** No re-read follows a write that lands, so the count it took has to stay taken. */
  it('still count a created list once the database has acknowledged it', async () => {
    serveCounts(99, 99);
    await renderProbe();

    await fireEvent.press(screen.getByLabelText('create'));
    await screen.findByText('pending: 0');

    expect(screen.getByText('list counts: 100 owned, 100 in total')).toBeOnTheScreen();
  });

  /** The outbox resending a create whose answer was lost: the server has counted it already. */
  it('do not count a pending create twice when the read already holds it', async () => {
    await saveOutbox(USER, [{ type: 'list/created', id: 'l1', name: 'Groceries' }]);
    serveLists([GROCERIES]);
    serveCounts(100, 100);
    api.insertList.mockResolvedValue(OFFLINE);

    await renderProbe();

    expect(screen.getByText('list counts: 100 owned, 100 in total')).toBeOnTheScreen();
  });

  it('free a slot as soon as an owned list is binned', async () => {
    serveLists([GROCERIES]);
    serveCounts(100, 100);
    api.setListDeleted.mockResolvedValue(OFFLINE);
    await renderProbe();

    await fireEvent.press(screen.getByLabelText('bin list'));

    expect(screen.getByText('list counts: 99 owned, 99 in total')).toBeOnTheScreen();
  });

  /** A nudge names lists, and says nothing about the others, so it neither reads nor resets them. */
  it('are kept by a nudge that names a list', async () => {
    jest.useFakeTimers();
    serveLists([GROCERIES]);
    serveCounts(100, 100);
    await renderProbe();
    await fireEvent.press(screen.getByLabelText('create'));
    await screen.findByText('pending: 0');
    api.fetchList.mockResolvedValue({ list: GROCERIES, error: null });

    await act(async () => nudge('l1'));
    await act(async () => {
      jest.advanceTimersByTime(NUDGE_DEBOUNCE);
    });

    await waitFor(() => expect(api.fetchList).toHaveBeenCalledWith('l1'));
    expect(api.fetchListCounts).toHaveBeenCalledTimes(1);
    expect(screen.getByText('list counts: 101 owned, 101 in total')).toBeOnTheScreen();
  });
});

/**
 * The item limit has no warning in the app: the 1,001st item appears, the database refuses it, and
 * the refusal is the whole story — one banner, the item gone, and nothing queued behind it left to
 * fail on its own.
 */
it('leaves one banner and drops the item when the database says the list is full', async () => {
  await saveOutbox(USER, [
    { type: 'item/added', listId: 'l1', id: 'i9', title: 'One too many' },
    { type: 'item/setDone', listId: 'l1', itemId: 'i9', doneAt: '2026-10-01T09:00:00.000Z' },
  ]);
  serveLists([GROCERIES]);
  api.addItem.mockResolvedValue({ error: ITEMS_FULL, verdict: 'permanent' });

  await renderProbe();

  expect(await screen.findByText(`error: ${ITEMS_FULL}`)).toBeOnTheScreen();
  await waitFor(() => expect(screen.getByText('pending: 0')).toBeOnTheScreen());
  expect(api.setItemDone).not.toHaveBeenCalled();
  expect(screen.queryByText(/One too many/)).not.toBeOnTheScreen();
});

/**
 * A search or a non-default sort is right only over a whole stream, so a screen completes it in the
 * background: page after page from state's cursor until it ends, and never a burst of requests.
 */
describe('completing a stream', () => {
  const AFTER_EGGS = { createdAt: T(3), id: 'i3' };
  type Page = { items: List['items'] | null; next: Cursor | null; error: string | null };

  /** The live continuations asked for, in order — page 1 reads and the bin left out. */
  function liveContinuations() {
    return api.fetchItems.mock.calls.filter(([, stream, after]) => stream === 'live' && after !== null).map(([, , after]) => after);
  }

  /** A list holding `n` live rows, with more to come. */
  function holding(n: number): List {
    const items = Array.from({ length: n }, (_, i) => ({ ...fetched(`i${i}`, `Row ${i}`, 1), id: `i${i}` }));
    return { ...GROCERIES, items, nextLive: { createdAt: T(1), id: `i${n - 1}` }, nextBin: null };
  }

  describe("a list's rows", () => {
    it('reads every remaining page from the cursor, one at a time, until it ends', async () => {
      serveLists([PAGED]);
      api.fetchItems
        .mockResolvedValueOnce({ items: [fetched('i3', 'Eggs', 3)], next: AFTER_EGGS, error: null })
        .mockResolvedValueOnce({ items: [fetched('i4', 'Ham', 4)], next: null, error: null });
      await renderProbe();

      await fireEvent.press(screen.getByLabelText('load all items'));

      expect(await screen.findByText('completion: complete')).toBeOnTheScreen();
      expect(liveContinuations()).toEqual([AFTER_BREAD, AFTER_EGGS]);
      expect(screen.getByText(/^l1 Groceries \[more binned\]: Milk, Bread, .*Eggs, Ham$/)).toBeOnTheScreen();
    });

    /** Offline every request fails at once: asking again would be a request loop. */
    it('stops after one request when the page fails', async () => {
      serveLists([PAGED]);
      api.fetchItems.mockResolvedValue({ items: null, next: null, error: 'Failed to fetch' });
      await renderProbe();

      await fireEvent.press(screen.getByLabelText('load all items'));

      expect(await screen.findByText('completion: failed')).toBeOnTheScreen();
      expect(api.fetchItems).toHaveBeenCalledTimes(1);
      expect(screen.getByText('error: none')).toBeOnTheScreen();
    });

    it('stops at the cap without a request when it already holds that many', async () => {
      serveLists([holding(COMPLETION_CAP)]);
      await renderProbe();

      await fireEvent.press(screen.getByLabelText('load all items'));

      expect(await screen.findByText('completion: capped')).toBeOnTheScreen();
      expect(api.fetchItems).not.toHaveBeenCalled();
    });

    it('stops at the cap once a page brings it there', async () => {
      serveLists([holding(COMPLETION_CAP - 400)]);
      api.fetchItems.mockResolvedValueOnce({
        items: Array.from({ length: 400 }, (_, i) => fetched(`p${i}`, `Page row ${i}`, 2)),
        next: { createdAt: T(2), id: 'p399' },
        error: null,
      });
      await renderProbe();

      await fireEvent.press(screen.getByLabelText('load all items'));

      expect(await screen.findByText('completion: capped')).toBeOnTheScreen();
      expect(api.fetchItems).toHaveBeenCalledTimes(1);
    });

    /**
     * The gap this is built against: a `hydrate` replaces state as deep as it was when *it* started.
     * A loop carrying its own cursor would fold the page it asked for on top, past a page the replace
     * dropped, and call the stream complete with rows missing. It reads the cursor from state instead,
     * and a page that no longer continues it is thrown away.
     */
    it('drops a page a re-read moved the cursor past, and carries on from state', async () => {
      jest.useFakeTimers();
      serveLists([PAGED]);
      let settle = (_page: Page) => {};
      api.fetchItems.mockImplementation(async (_listId, stream, after) => {
        if (stream === 'bin') {
          return { items: [fetched('b1', 'Old jam', 11, T(21)), fetched('b2', 'Jam', 12, T(20))], next: AFTER_JAM, error: null };
        }
        if (after === null) {
          // Somebody binned Bread since: page 1 now reaches Eggs.
          return { items: [fetched('i1', 'Milk', 1), fetched('i3', 'Eggs', 3)], next: AFTER_EGGS, error: null };
        }
        if (after.id === AFTER_BREAD.id) return new Promise<Page>((resolve) => (settle = resolve));
        return { items: [fetched('i4', 'Ham', 4)], next: null, error: null };
      });
      await renderProbe();

      await fireEvent.press(screen.getByLabelText('load all items'));
      expect(liveContinuations()).toEqual([AFTER_BREAD]);

      // The re-read: the list arrives bare, so its rows are read again from page 1.
      serveLists([{ ...PAGED, itemsLoaded: false, items: [], nextLive: null, nextBin: null }]);
      await act(async () => nudge());
      await act(async () => {
        jest.advanceTimersByTime(NUDGE_DEBOUNCE);
      });
      await waitFor(() => expect(screen.getByText(/^l1 Groceries \[more\] \[more binned\]: Milk, Eggs, /)).toBeOnTheScreen());

      // The page asked for before the re-read lands now, continuing a cursor state no longer ends at.
      await act(async () =>
        settle({ items: [fetched('i3', 'Eggs', 3), fetched('i9', 'Stale', 9)], next: { createdAt: T(9), id: 'i9' }, error: null })
      );

      expect(await screen.findByText('completion: complete')).toBeOnTheScreen();
      expect(liveContinuations()).toEqual([AFTER_BREAD, AFTER_EGGS]);
      expect(screen.getByText(/Milk, Eggs, Old jam \[binned\], Jam \[binned\], Ham$/)).toBeOnTheScreen();
      expect(screen.queryByText(/Stale/)).not.toBeOnTheScreen();
    });

    /** A scroll's page is in flight: the loop waits for it rather than asking twice. */
    it('waits for a page already in flight, and does not fail because it did', async () => {
      serveLists([PAGED]);
      let settle = (_page: Page) => {};
      api.fetchItems.mockReturnValueOnce(new Promise<Page>((resolve) => (settle = resolve)));
      api.fetchItems.mockResolvedValueOnce({ items: [fetched('i3', 'Eggs', 3)], next: null, error: null });
      await renderProbe();

      await fireEvent.press(screen.getByLabelText('load more'));
      await fireEvent.press(screen.getByLabelText('load all items'));
      expect(api.fetchItems).toHaveBeenCalledTimes(1);

      // The scroll's page fails; the loop asks for its own, from the same cursor.
      await act(async () => settle({ items: null, next: null, error: 'Failed to fetch' }));

      expect(await screen.findByText('completion: complete')).toBeOnTheScreen();
      expect(liveContinuations()).toEqual([AFTER_BREAD, AFTER_BREAD]);
    });

    it('stops between pages once told to, still folding the page it asked for', async () => {
      serveLists([PAGED]);
      let settle = (_page: Page) => {};
      api.fetchItems.mockReturnValueOnce(new Promise<Page>((resolve) => (settle = resolve)));
      await renderProbe();

      await fireEvent.press(screen.getByLabelText('load all items'));
      await fireEvent.press(screen.getByLabelText('stop loading all'));
      await act(async () => settle({ items: [fetched('i3', 'Eggs', 3)], next: AFTER_EGGS, error: null }));

      expect(await screen.findByText('completion: stopped')).toBeOnTheScreen();
      expect(screen.getByText(/Eggs$/)).toBeOnTheScreen();
      expect(api.fetchItems).toHaveBeenCalledTimes(1);
    });
  });

  describe('the lists', () => {
    it('reads every remaining page of lists, one at a time, until it ends', async () => {
      servePagedLists([1, 2, 3, 4, 5].map((n) => member(n)), 2);
      await renderProbe();
      api.fetchLists.mockClear();

      await fireEvent.press(screen.getByLabelText('load all lists'));

      expect(await screen.findByText('completion: complete')).toBeOnTheScreen();
      expect(api.fetchLists.mock.calls).toEqual([
        ['live', cursorAt(2)],
        ['live', cursorAt(4)],
      ]);
      expect(screen.getByText(row(5))).toBeOnTheScreen();
      expect(screen.getByText('list cursors: end, end')).toBeOnTheScreen();
    });

    it('stops after one request when a page of lists fails', async () => {
      servePagedLists([1, 2, 3, 4, 5].map((n) => member(n)), 2);
      await renderProbe();
      api.fetchLists.mockClear();
      api.fetchLists.mockResolvedValue({ lists: null, next: null, error: 'Failed to fetch' });

      await fireEvent.press(screen.getByLabelText('load all lists'));

      expect(await screen.findByText('completion: failed')).toBeOnTheScreen();
      expect(api.fetchLists).toHaveBeenCalledTimes(1);
    });

    it('stops at the cap without a request when it already holds that many', async () => {
      const many = Array.from({ length: COMPLETION_CAP }, (_, i) => member(i + 1));
      serveLists(many, { live: cursorAt(COMPLETION_CAP) });
      await renderProbe();
      api.fetchLists.mockClear();

      await fireEvent.press(screen.getByLabelText('load all lists'));

      expect(await screen.findByText('completion: capped')).toBeOnTheScreen();
      expect(api.fetchLists).not.toHaveBeenCalled();
    });
  });
});

/**
 * There is no connectivity library, so the app learns it is back online only from a read that
 * succeeds. `readEpoch` counts them, and a screen restarts a failed completion when it moves.
 */
describe('the read counter', () => {
  it('moves on a full re-read that succeeds, and not on one that fails', async () => {
    jest.useFakeTimers();
    serveLists([GROCERIES]);
    await renderProbe();
    expect(screen.getByText('read epoch: 1')).toBeOnTheScreen();

    failLists('Failed to fetch');
    await act(async () => resubscribe());
    await act(async () => {
      jest.advanceTimersByTime(NUDGE_DEBOUNCE);
    });
    await waitFor(() => expect(hydrations()).toBe(2));
    expect(screen.getByText('read epoch: 1')).toBeOnTheScreen();

    serveLists([GROCERIES]);
    await act(async () => resubscribe());
    await act(async () => {
      jest.advanceTimersByTime(NUDGE_DEBOUNCE);
    });

    await waitFor(() => expect(screen.getByText('read epoch: 2')).toBeOnTheScreen());
  });

  it('moves on a re-read of a named list only when that read succeeds', async () => {
    jest.useFakeTimers();
    serveLists([GROCERIES]);
    await renderProbe();
    api.fetchList.mockResolvedValue({ list: null, error: 'Failed to fetch' });

    await act(async () => nudge('l1'));
    await act(async () => {
      jest.advanceTimersByTime(NUDGE_DEBOUNCE);
    });
    await waitFor(() => expect(api.fetchList).toHaveBeenCalledTimes(1));
    expect(screen.getByText('read epoch: 1')).toBeOnTheScreen();

    api.fetchList.mockResolvedValue({ list: GROCERIES, error: null });
    await act(async () => nudge('l1'));
    await act(async () => {
      jest.advanceTimersByTime(NUDGE_DEBOUNCE);
    });

    await waitFor(() => expect(screen.getByText('read epoch: 2')).toBeOnTheScreen());
  });
});
