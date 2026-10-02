import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';

import {
  addItem as addItemRequest,
  fetchItems,
  fetchList,
  fetchLists,
  renameItem,
  renameList,
  setItemDeleted,
  setListDeleted,
} from '../lib/listsApi';
import type { ListDetailScreenProps } from '../navigation/types';
import type { List, Role } from '../state/types';
import { ListsProvider, useLists } from '../state/ListsContext';
import { ListDetailScreen } from './ListDetailScreen';

/**
 * `src/lib/listsApi.ts` is mocked at the module boundary — the provider fetches on mount now, and
 * this suite is about the screen, not about what the database returns.
 */
jest.mock('../lib/listsApi', () => ({
  fetchLists: jest.fn(async () => ({ lists: [], next: null, error: null })),
  fetchListCounts: jest.fn(async () => ({ counts: { owned: 0, total: 0 }, error: null })),
  fetchList: jest.fn(async () => ({ list: null, error: null })),
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

/**
 * What the database holds, as `fetchLists` answers it: one stream at a time, the lists with no
 * tombstone to the live stream and the rest to the bin, a single page each.
 */
function serveLists(lists: List[]) {
  jest.mocked(fetchLists).mockImplementation(async (stream) => ({
    lists: lists.filter((list) => (list.deletedAt === null) === (stream === 'live')),
    next: null,
    error: null,
  }));
}

const navigation = { navigate: jest.fn(), setOptions: jest.fn(), goBack: jest.fn() };

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
    <ListsProvider userId="u1" onSessionRevoked={() => {}}>
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

/**
 * `itemsLoaded: true` is a deliberate shortcut: `fetchLists` is mocked anyway, and this suite is
 * mostly about role-gated controls and rendering, not about the fetch-on-entry mechanism itself —
 * that has its own dedicated tests below, under `describe('loading a list on entry', ...)`. With
 * this set, the screen's mount effect finds nothing to fetch and renders straight through, exactly
 * as it did before items stopped riding along with `fetchLists`.
 */
const SHARED: List = {
  id: 'l1',
  name: 'Groceries',
  role: 'reader',
  deletedAt: null,
  joinedAt: null,
  itemsLoaded: true,
  items: [{ id: 'i1', title: 'Milk', doneAt: null, deletedAt: null, createdAt: null }],
  nextLive: null,
  nextBin: null,
};

/**
 * Renders the screen for a list that arrived from the database with a given role.
 *
 * The screen draws its own header — back button, Rename and Share pills, title — inside its own
 * tree, so a header press reaches the same screen instance with no navigator stood up at all.
 */
async function renderAs(role: Role) {
  serveLists([{ ...SHARED, role }]);

  await render(
    <ListsProvider userId="u1" onSessionRevoked={() => {}}>
      <ListDetailScreen {...detailProps('l1')} />
    </ListsProvider>
  );

  // Every role renders the item; only the controls around it differ.
  await screen.findByLabelText('Milk');
}

beforeEach(async () => {
  serveLists([]);
  navigation.setOptions.mockClear();
  navigation.navigate.mockClear();
  navigation.goBack.mockClear();
  jest.mocked(renameList).mockClear();
  jest.mocked(renameItem).mockClear();
  // The provider queues writes on disk now; without this each test inherits the last one's outbox.
  await AsyncStorage.clear();
});

it('shows an empty state for a list with no items', async () => {
  await renderScreen();

  expect(screen.getByText('Nothing on this list')).toBeOnTheScreen();
});

it('puts the list name in the header', async () => {
  await renderScreen('Hardware');

  // Drawn by the screen itself; the native header is hidden.
  expect(screen.getByRole('header', { name: 'Hardware' })).toBeOnTheScreen();
  // Still handed to the navigator too — the web tab title and the Sharing screen's back button
  // read it. `objectContaining` so a later option travelling in the same call does not break this.
  expect(navigation.setOptions).toHaveBeenCalledWith(expect.objectContaining({ title: 'Hardware' }));
});

/** The drawn button is the visible way back; the swipe and the hardware button are the stack's own. */
it('goes back from its own back button', async () => {
  await renderScreen();

  await fireEvent.press(screen.getByLabelText('Back'));

  expect(navigation.goBack).toHaveBeenCalledTimes(1);
});

it('offers a way back from a list that is not found', async () => {
  await render(
    <ListsProvider userId="u1" onSessionRevoked={() => {}}>
      <ListDetailScreen {...detailProps('does-not-exist')} />
    </ListsProvider>
  );

  await fireEvent.press(screen.getByLabelText('Back'));

  expect(navigation.goBack).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText('Share list')).not.toBeOnTheScreen();
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
    .mocked(addItemRequest)
    .mockResolvedValueOnce({ error: 'TypeError: Failed to fetch', verdict: 'retryable' });

  await renderScreen();
  await addItem('Milk');

  expect(await screen.findByText("1 change will sync when you're back online")).toBeOnTheScreen();
  expect(screen.getByLabelText('Milk')).not.toBeChecked();
});

it('falls back to a not-found state for an unknown list', async () => {
  await render(
    <ListsProvider userId="u1" onSessionRevoked={() => {}}>
      <ListDetailScreen {...detailProps('does-not-exist')} />
    </ListsProvider>
  );

  expect(await screen.findByText('List not found')).toBeOnTheScreen();
  // Only once a read by id agreed: lists are paged, so missing from state is not missing.
  expect(fetchList).toHaveBeenCalledWith('does-not-exist');
});

/**
 * Lists are paged, so a list somebody else binned can sort past the loaded pages of the bin and drop
 * out of state on the next re-read — while it is open here. The screen reads it by id before it
 * says "not found", and says nothing either way until that read has answered.
 */
it('reads a list it does not hold before saying it is not found', async () => {
  let settle = (_result: { list: List | null; error: string | null }) => {};
  jest.mocked(fetchList).mockReturnValueOnce(
    new Promise((resolve) => {
      settle = resolve;
    })
  );

  await render(
    <ListsProvider userId="u1" onSessionRevoked={() => {}}>
      <ListDetailScreen {...detailProps('l7')} />
    </ListsProvider>
  );

  expect(await screen.findByLabelText('Loading list')).toBeOnTheScreen();
  expect(screen.queryByText('List not found')).not.toBeOnTheScreen();
  expect(fetchList).toHaveBeenCalledWith('l7');

  await act(async () =>
    settle({
      list: {
        ...SHARED,
        id: 'l7',
        name: 'Old shop',
        role: 'owner',
        deletedAt: '2026-09-10T09:00:00.000Z',
        joinedAt: '2026-09-01T08:00:00+00:00',
        itemsLoaded: false,
        items: [],
      },
      error: null,
    })
  );

  expect(await screen.findByRole('header', { name: 'Old shop' })).toBeOnTheScreen();
  expect(await screen.findByText(/This list is in the bin/)).toBeOnTheScreen();
  expect(screen.queryByText('List not found')).not.toBeOnTheScreen();
});

/**
 * `fetchLists` carries no items at all any more — this is the point of the step. The screen has
 * to ask for them itself, the moment it has a list to ask about, and show something honest while
 * it waits rather than flashing the empty state.
 */
describe('loading a list on entry', () => {
  beforeEach(() => {
    jest.mocked(fetchItems).mockClear();
  });

  const BARE: List = {
    id: 'l1',
    name: 'Groceries',
    role: 'owner',
    deletedAt: null,
    joinedAt: null,
    itemsLoaded: false,
    items: [],
    nextLive: null,
    nextBin: null,
  };

  it('shows a spinner, then the list, once its first page arrives', async () => {
    serveLists([BARE]);
    let settleLive = (_page: { items: List['items'] | null; next: null; error: null }) => {};
    jest
      .mocked(fetchItems)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            settleLive = resolve;
          })
      )
      .mockImplementationOnce(async () => ({ items: [], next: null, error: null }));

    await render(
      <ListsProvider userId="u1" onSessionRevoked={() => {}}>
        <ListDetailScreen {...detailProps('l1')} />
      </ListsProvider>
    );

    expect(await screen.findByLabelText('Loading list items')).toBeOnTheScreen();
    expect(fetchItems).toHaveBeenCalledWith('l1', 'live', null);
    expect(fetchItems).toHaveBeenCalledWith('l1', 'bin', null);

    await act(async () =>
      settleLive({
        items: [{ id: 'i1', title: 'Milk', doneAt: null, deletedAt: null, createdAt: '2026-09-01T10:00:00Z' }],
        next: null,
        error: null,
      })
    );

    expect(await screen.findByLabelText('Milk')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Loading list items')).not.toBeOnTheScreen();
  });

  it('does not ask again once a list is loaded', async () => {
    serveLists([{ ...BARE, itemsLoaded: true }]);

    await render(
      <ListsProvider userId="u1" onSessionRevoked={() => {}}>
        <ListDetailScreen {...detailProps('l1')} />
      </ListsProvider>
    );

    await screen.findByText('Nothing on this list');
    expect(fetchItems).not.toHaveBeenCalled();
  });
});

// --- By role -----------------------------------------------------------------------------------

/**
 * The database refuses a reader's writes either way. The point of gating the controls is that a
 * button which fails is a worse experience than one that was never offered.
 */
describe('a reader', () => {
  it('gets no way to add an item, and is told why', async () => {
    await renderAs('reader');

    expect(screen.queryByLabelText('Add an item')).not.toBeOnTheScreen();
    expect(
      screen.getByText('Read only — you can see this list but not change it.')
    ).toBeOnTheScreen();
  });

  /** Still a labelled checkbox: whether an item is done is information a reader wants. */
  it('sees the checked state but cannot change it', async () => {
    await renderAs('reader');

    expect(screen.getByLabelText('Milk')).toBeDisabled();

    await fireEvent.press(screen.getByLabelText('Milk'));
    expect(screen.getByLabelText('Milk')).not.toBeChecked();
  });

  it('gets an empty state that does not ask them to add anything', async () => {
    serveLists([{ ...SHARED, role: 'reader', deletedAt: null, items: [], nextLive: null, nextBin: null }]);

    await render(
      <ListsProvider userId="u1" onSessionRevoked={() => {}}>
        <ListDetailScreen {...detailProps('l1')} />
      </ListsProvider>
    );

    // The title is unchanged; only the hint knows about roles.
    expect(await screen.findByText('Nothing on this list')).toBeOnTheScreen();
    expect(screen.getByText('Nobody has added anything yet.')).toBeOnTheScreen();
  });

  it('cannot rename the list', async () => {
    await renderAs('reader');

    expect(screen.queryByLabelText('Rename list')).not.toBeOnTheScreen();
  });

  it('gets no way to rename an item', async () => {
    await renderAs('reader');

    expect(screen.queryByLabelText('Rename Milk')).not.toBeOnTheScreen();
  });

  /**
   * `list_members_of` is gated on the caller's own membership rather than on ownership, so a reader
   * gets the full roster back. "Who else can see my shopping list" is a fair question for them.
   */
  it('can still see who else has access', async () => {
    await renderAs('reader');

    await fireEvent.press(screen.getByLabelText('Share list'));

    expect(navigation.navigate).toHaveBeenCalledWith('Sharing', { listId: 'l1' });
  });
});

describe('a writer', () => {
  it('gets the Add bar and no read-only note', async () => {
    await renderAs('writer');

    expect(screen.getByLabelText('Add an item')).toBeOnTheScreen();
    expect(
      screen.queryByText('Read only — you can see this list but not change it.')
    ).not.toBeOnTheScreen();
  });

  it('still cannot rename it — that stays with the owner', async () => {
    await renderAs('writer');

    expect(screen.queryByLabelText('Rename list')).not.toBeOnTheScreen();
    expect(screen.getByLabelText('Share list')).toBeOnTheScreen();
  });

  /** The editor opens in place of the row, seeded with the title it is about to replace. */
  it('renames an item from its row', async () => {
    await renderAs('writer');

    await fireEvent.press(screen.getByLabelText('Rename Milk'));

    expect(screen.getByLabelText('Item name')).toHaveDisplayValue('Milk');
    expect(screen.queryByLabelText('Milk')).not.toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText('Item name'), 'Oat milk');
    await fireEvent.press(screen.getByLabelText('Save'));

    expect(screen.queryByLabelText('Item name')).not.toBeOnTheScreen();
    expect(screen.getByLabelText('Oat milk')).not.toBeChecked();
    expect(renameItem).toHaveBeenCalledWith('i1', 'Oat milk');
  });

  it('saves from the keyboard too', async () => {
    await renderAs('writer');

    await fireEvent.press(screen.getByLabelText('Rename Milk'));
    await fireEvent.changeText(screen.getByLabelText('Item name'), 'Oat milk');
    await fireEvent(screen.getByLabelText('Item name'), 'submitEditing');

    expect(screen.getByLabelText('Oat milk')).toBeOnTheScreen();
    expect(renameItem).toHaveBeenCalledWith('i1', 'Oat milk');
  });

  it('closes the editor again without renaming anything', async () => {
    await renderAs('writer');

    await fireEvent.press(screen.getByLabelText('Rename Milk'));
    await fireEvent.changeText(screen.getByLabelText('Item name'), 'Oat milk');
    await fireEvent.press(screen.getByLabelText('Cancel'));

    expect(screen.queryByLabelText('Item name')).not.toBeOnTheScreen();
    expect(screen.getByLabelText('Milk')).toBeOnTheScreen();
    expect(renameItem).not.toHaveBeenCalled();
  });

  it('will not save a blank title', async () => {
    await renderAs('writer');

    await fireEvent.press(screen.getByLabelText('Rename Milk'));
    await fireEvent.changeText(screen.getByLabelText('Item name'), '   ');

    expect(screen.getByLabelText('Save')).toBeDisabled();

    await fireEvent.press(screen.getByLabelText('Save'));
    expect(screen.getByLabelText('Item name')).toBeOnTheScreen();
    expect(renameItem).not.toHaveBeenCalled();
  });

  /** Saving the name it already has is not a change, so nothing is queued and nothing is sent. */
  it('sends nothing when the title is saved unchanged', async () => {
    await renderAs('writer');

    await fireEvent.press(screen.getByLabelText('Rename Milk'));
    await fireEvent.press(screen.getByLabelText('Save'));

    expect(screen.getByLabelText('Milk')).toBeOnTheScreen();
    expect(renameItem).not.toHaveBeenCalled();
  });
});

describe('an owner', () => {
  it('can open the sharing screen from the header', async () => {
    await renderAs('owner');

    await fireEvent.press(screen.getByLabelText('Share list'));

    expect(navigation.navigate).toHaveBeenCalledWith('Sharing', { listId: 'l1' });
  });

  it('renames the list from a bar the header button opens', async () => {
    await renderAs('owner');

    await fireEvent.press(screen.getByLabelText('Rename list'));

    // The bar starts on the name it is about to replace, rather than empty.
    expect(screen.getByLabelText('List name')).toHaveDisplayValue('Groceries');

    await fireEvent.changeText(screen.getByLabelText('List name'), 'Weekly shop');
    await fireEvent.press(screen.getByLabelText('Save'));

    expect(screen.getByLabelText('Add an item')).toBeOnTheScreen();
    expect(screen.queryByLabelText('List name')).not.toBeOnTheScreen();
    expect(renameList).toHaveBeenCalledWith('l1', 'Weekly shop');
  });

  it('closes the rename bar again without renaming anything', async () => {
    await renderAs('owner');

    await fireEvent.press(screen.getByLabelText('Rename list'));
    await fireEvent.press(screen.getByLabelText('Rename list'));

    expect(screen.queryByLabelText('List name')).not.toBeOnTheScreen();
    expect(renameList).not.toHaveBeenCalled();
  });

  /** The pills read short, like the mockup; their labels keep saying what they act on. */
  it('shows short pill text under the full labels', async () => {
    await renderAs('owner');

    expect(screen.getByLabelText('Rename list')).toHaveTextContent('Rename');
    expect(screen.getByLabelText('Share list')).toHaveTextContent('Share');
  });

  /** The bar is the title being edited, so it takes the title's place rather than adding a row. */
  it('swaps the title for the rename bar while it is open', async () => {
    await renderAs('owner');

    await fireEvent.press(screen.getByLabelText('Rename list'));
    expect(screen.queryByRole('header', { name: 'Groceries' })).not.toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText('List name'), 'Weekly shop');
    await fireEvent.press(screen.getByLabelText('Save'));

    expect(screen.getByRole('header', { name: 'Weekly shop' })).toBeOnTheScreen();
  });
});

// --- The bin ------------------------------------------------------------------------------------

const BINNED_AT = '2026-09-10T09:00:00.000Z';

/** Renders a list holding one live item and one in the bin. */
async function renderWithBin(role: Role = 'owner') {
  serveLists([
      {
        ...SHARED,
        role,
        items: [
          { id: 'i1', title: 'Milk', doneAt: null, deletedAt: null, createdAt: null },
          { id: 'i2', title: 'Bread', doneAt: null, deletedAt: BINNED_AT, createdAt: null },
        ],
      },
    ]);

  await render(
    <ListsProvider userId="u1" onSessionRevoked={() => {}}>
      <ListDetailScreen {...detailProps('l1')} />
    </ListsProvider>
  );

  await screen.findByLabelText('Milk');
}

it('leaves deleted items off the list until they are asked for', async () => {
  await renderWithBin();

  expect(screen.queryByLabelText('Bread')).not.toBeOnTheScreen();
  expect(screen.getByRole('switch', { name: 'Show deleted' })).not.toBeChecked();
});

/**
 * "Show deleted" switches the list to its bin: the binned items and nothing else, and the Add bar
 * gives way to a sentence, since nothing is added there. Page 1 of the bin arrived when the list was
 * opened, so the switch is instant: no spinner and no round trip.
 */
it('switches the list to its bin and back, with no second request', async () => {
  await renderWithBin();
  jest.mocked(fetchLists).mockClear();
  jest.mocked(fetchItems).mockClear();

  await fireEvent.press(screen.getByRole('switch', { name: 'Show deleted' }));

  expect(screen.getByRole('switch', { name: 'Show deleted' })).toBeChecked();
  expect(screen.getByLabelText('Bread')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Milk')).not.toBeOnTheScreen();
  expect(screen.getByText('Deleted items, newest first.')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Add an item')).not.toBeOnTheScreen();
  // Every row here is deleted, so no row says so.
  expect(screen.queryByText('Deleted')).not.toBeOnTheScreen();
  expect(fetchLists).not.toHaveBeenCalled();
  expect(fetchItems).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByRole('switch', { name: 'Show deleted' }));

  expect(screen.getByLabelText('Milk')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Bread')).not.toBeOnTheScreen();
  expect(screen.getByLabelText('Add an item')).toBeOnTheScreen();
});

it('does not offer the switch when nothing has been deleted', async () => {
  await renderAs('writer');

  expect(screen.queryByRole('switch', { name: 'Show deleted' })).not.toBeOnTheScreen();
});

/**
 * Restoring the bin's last item must not take away the only way back to the list, so a checked
 * switch stays — over the one place that says the bin is empty.
 */
it('keeps the switch once the last binned item is restored, and says the bin is empty', async () => {
  await renderWithBin('writer');
  await fireEvent.press(screen.getByRole('switch', { name: 'Show deleted' }));

  await fireEvent.press(screen.getByLabelText('Restore Bread'));

  expect(setItemDeleted).toHaveBeenCalledWith('i2', false);
  expect(screen.getByText('The bin is empty')).toBeOnTheScreen();
  expect(screen.getByText('Deleted items wait here for 30 days.')).toBeOnTheScreen();
  expect(screen.getByRole('switch', { name: 'Show deleted' })).toBeChecked();

  await fireEvent.press(screen.getByRole('switch', { name: 'Show deleted' }));

  expect(itemLabels()).toEqual(['Milk', 'Bread']);
  expect(screen.queryByRole('switch', { name: 'Show deleted' })).not.toBeOnTheScreen();
});

it('sends an item to the bin and brings it back', async () => {
  await renderWithBin('writer');

  await fireEvent.press(screen.getByLabelText('Delete Milk'));
  expect(setItemDeleted).toHaveBeenCalledWith('i1', true);

  await fireEvent.press(screen.getByLabelText('Show deleted'));
  await fireEvent.press(screen.getByLabelText('Restore Bread'));
  expect(setItemDeleted).toHaveBeenCalledWith('i2', false);
});

/** The read-only notice is not a write control, so a reader keeps it in the bin too. */
it('keeps a reader’s read-only notice in the bin', async () => {
  await renderWithBin('reader');

  await fireEvent.press(screen.getByLabelText('Show deleted'));

  expect(screen.getByText('Read only — you can see this list but not change it.')).toBeOnTheScreen();
  expect(screen.queryByText('Deleted items, newest first.')).not.toBeOnTheScreen();
  expect(screen.getByLabelText('Bread')).toBeOnTheScreen();
});

it('gives a reader no way to delete an item', async () => {
  await renderWithBin('reader');

  expect(screen.queryByLabelText('Delete Milk')).not.toBeOnTheScreen();
});

/** A binned item cannot be ticked: there is nothing live to check off. */
it('will not let a deleted item be toggled', async () => {
  await renderWithBin('writer');
  await fireEvent.press(screen.getByLabelText('Show deleted'));

  expect(screen.getByLabelText('Bread')).toBeDisabled();
});

/** Nor renamed, for the same reason — Restore is the one thing to offer it. */
it('offers a deleted item no rename, only a restore', async () => {
  await renderWithBin('writer');
  await fireEvent.press(screen.getByLabelText('Show deleted'));

  expect(screen.queryByLabelText('Rename Bread')).not.toBeOnTheScreen();
  expect(screen.getByLabelText('Restore Bread')).toBeOnTheScreen();
});

/**
 * The count is a claim about what is on the list, and a binned item must not inflate it — nor
 * silence the empty state once every live item is gone.
 */
it('says the list is empty when every live item has been deleted', async () => {
  serveLists([
      {
        ...SHARED,
        role: 'owner',
        items: [{ id: 'i1', title: 'Milk', doneAt: null, deletedAt: BINNED_AT, createdAt: null }],
      },
    ]);

  await render(
    <ListsProvider userId="u1" onSessionRevoked={() => {}}>
      <ListDetailScreen {...detailProps('l1')} />
    </ListsProvider>
  );

  expect(await screen.findByText('Nothing on this list')).toBeOnTheScreen();
});

describe('a list opened from the bin', () => {
  async function renderBinnedList(role: Role = 'owner') {
    serveLists([{ ...SHARED, role, deletedAt: BINNED_AT }]);

    await render(
      <ListsProvider userId="u1" onSessionRevoked={() => {}}>
        <ListDetailScreen {...detailProps('l1')} />
      </ListsProvider>
    );

    await screen.findByLabelText('Milk');
  }

  /** It opens and reads normally — it is a real list still — but nothing may write to it. */
  it('takes away every control that would write to it', async () => {
    await renderBinnedList();

    expect(screen.queryByLabelText('Add an item')).not.toBeOnTheScreen();
    expect(screen.queryByLabelText('Rename list')).not.toBeOnTheScreen();
    expect(screen.queryByLabelText('Rename Milk')).not.toBeOnTheScreen();
    expect(screen.queryByLabelText('Delete Milk')).not.toBeOnTheScreen();
  });

  /**
   * Said out loud because the two tombstones are independent: restore a list you binned items
   * inside, and you get it back missing them, with nothing otherwise to say where they went.
   */
  it('warns that restoring it will not bring back separately deleted items', async () => {
    await renderBinnedList();

    expect(
      screen.getByText(/Restoring it brings back everything except the items you deleted separately/)
    ).toBeOnTheScreen();
  });

  it('offers an owner a way out', async () => {
    await renderBinnedList();

    await fireEvent.press(screen.getByLabelText('Restore Groceries'));

    expect(setListDeleted).toHaveBeenCalledWith('l1', false);
  });

  it('offers a writer none, since only an owner may restore a list', async () => {
    await renderBinnedList('writer');

    expect(screen.queryByLabelText('Restore Groceries')).not.toBeOnTheScreen();
  });
});

// --- Long lists ---------------------------------------------------------------------------------

/**
 * A fetch carries a first page of each stream; the rest arrives as the user scrolls. The `FlatList`
 * gets an `onEndReached` handler only while there is a cursor to follow, so a list that fits in a
 * page has nothing wired at all — and a scroll on one never sends a request.
 */
const T = (n: number) => `2026-09-01T00:00:${String(n).padStart(2, '0')}.000Z`;
const row = (id: string, title: string, n: number, deletedAt: string | null = null) => ({
  id,
  title,
  doneAt: null,
  deletedAt,
  createdAt: T(n),
});
const AFTER_BREAD = { createdAt: T(2), id: 'i2' };
/** The bin pages newest deletion first: Old jam (deleted at 21) above Jam (at 20), so Jam is last. */
const AFTER_JAM = { deletedAt: T(20), id: 'b2' };

/** Page 1 of both streams loaded, each with more to come. */
async function renderPaged() {
  serveLists([
      {
        ...SHARED,
        role: 'writer',
        items: [
          row('i1', 'Milk', 1),
          row('i2', 'Bread', 2),
          row('b1', 'Old jam', 11, T(21)),
          row('b2', 'Jam', 12, T(20)),
        ],
        nextLive: AFTER_BREAD,
        nextBin: AFTER_JAM,
      },
    ]);

  await render(
    <ListsProvider userId="u1" onSessionRevoked={() => {}}>
      <ListDetailScreen {...detailProps('l1')} />
    </ListsProvider>
  );

  await screen.findByLabelText('Milk');
}

/**
 * Reaching the end is an event on the `FlatList`; a row inside it is where the event walks up from.
 * In the bin, start from a row's `Restore`: its checkbox is disabled, and RNTL fires nothing from a
 * disabled element.
 */
async function scrollToEnd(row = 'Milk') {
  await fireEvent(screen.getByLabelText(row), 'endReached');
}

/**
 * The item rows in order. The "Show deleted" toggle used to be a checkbox too and needed
 * filtering out here; since task 20 step 3 it is `accessibilityRole="switch"`, so
 * `getAllByRole('checkbox')` already excludes it on its own.
 */
function itemLabels(): string[] {
  return screen.getAllByRole('checkbox').map((row) => String(row.props.accessibilityLabel));
}

describe('a list longer than a page', () => {
  beforeEach(() => {
    jest.mocked(fetchItems).mockClear();
  });

  it('loads the next page of live rows when scrolled to the end', async () => {
    jest
      .mocked(fetchItems)
      .mockResolvedValueOnce({ items: [row('i3', 'Eggs', 3)], next: null, error: null });
    await renderPaged();

    await scrollToEnd();

    expect(await screen.findByLabelText('Eggs')).toBeOnTheScreen();
    expect(fetchItems).toHaveBeenCalledTimes(1);
    expect(fetchItems).toHaveBeenCalledWith('l1', 'live', AFTER_BREAD);
    expect(itemLabels()).toEqual(['Milk', 'Bread', 'Eggs']);
  });

  /** The bin is its own view: a scroll there asks for the bin's next page and nothing else. */
  it('loads only the next page of the bin while it is showing', async () => {
    jest
      .mocked(fetchItems)
      .mockResolvedValueOnce({ items: [row('b3', 'Rye', 13, T(19))], next: null, error: null });
    await renderPaged();

    await fireEvent.press(screen.getByLabelText('Show deleted'));
    await scrollToEnd('Restore Jam');

    expect(await screen.findByLabelText('Rye')).toBeOnTheScreen();
    expect(jest.mocked(fetchItems).mock.calls).toEqual([['l1', 'bin', AFTER_JAM]]);
    // No count, however many are loaded or still to come.
    expect(screen.getByRole('switch', { name: 'Show deleted' })).toBeOnTheScreen();
  });

  it('reads Show deleted with a further page of the bin still to come', async () => {
    await renderPaged();

    expect(screen.getByRole('switch', { name: 'Show deleted' })).toBeOnTheScreen();
    expect(screen.queryByText(/Show \d/)).not.toBeOnTheScreen();
  });

  it('shows a spinner at the foot of the list while the page is on its way', async () => {
    let settle = (_page: { items: never[]; next: null; error: null }) => {};
    jest.mocked(fetchItems).mockReturnValueOnce(
      new Promise((resolve) => {
        settle = resolve;
      })
    );
    await renderPaged();

    await scrollToEnd();
    expect(screen.getByLabelText('Loading more items')).toBeOnTheScreen();

    await act(async () => settle({ items: [], next: null, error: null }));
    expect(screen.queryByLabelText('Loading more items')).not.toBeOnTheScreen();
  });

  /** Live mode never asks for a page of the bin, however much of it is still to come. */
  it('asks only for the live rows at the end in live mode', async () => {
    jest.mocked(fetchItems).mockResolvedValueOnce({ items: [row('i3', 'Eggs', 3)], next: null, error: null });
    await renderPaged();

    await scrollToEnd();
    await screen.findByLabelText('Eggs');

    expect(jest.mocked(fetchItems).mock.calls).toEqual([['l1', 'live', AFTER_BREAD]]);
  });

  /**
   * The bin newest deletion first, the order it is paged in — not the order the rows were added, and
   * with a page loaded on scroll landing below the rows already shown.
   */
  it('orders the bin by when each row was deleted, newest first', async () => {
    jest
      .mocked(fetchItems)
      .mockResolvedValueOnce({ items: [row('b3', 'Rye', 13, T(19))], next: null, error: null });
    await renderPaged();

    await fireEvent.press(screen.getByLabelText('Show deleted'));
    expect(itemLabels()).toEqual(['Old jam', 'Jam']);

    await scrollToEnd('Restore Jam');
    await screen.findByLabelText('Rye');

    expect(itemLabels()).toEqual(['Old jam', 'Jam', 'Rye']);
  });
});

it('asks for nothing at the end of a list that fits in a page', async () => {
  jest.mocked(fetchItems).mockClear();
  await renderWithBin('writer');

  await scrollToEnd();

  expect(fetchItems).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Loading more items')).not.toBeOnTheScreen();
});
