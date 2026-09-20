import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  addItem as addItemRequest,
  fetchItems,
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
  itemsLoaded: true,
  items: [{ id: 'i1', title: 'Milk', doneAt: null, deletedAt: null, createdAt: null }],
  nextLive: null,
  nextBin: null,
};

/**
 * Renders the screen for a list that arrived from the database with a given role, together with the
 * header the navigator would be showing.
 *
 * In the app the header lives outside the screen — `navigation.setOptions` hands `headerRight` to
 * the navigator, which renders it. Here the stub keeps the last options in state and renders them in
 * the *same* tree, so a header button press reaches the same screen instance rather than a second
 * copy of it. That is what makes the rename bar assertable at all.
 */
function Chrome({ listId }: { listId: string }) {
  const [options, setOptions] = useState<{ headerRight?: () => ReactNode }>({});

  const nav = useMemo(
    () => ({
      navigate: navigation.navigate,
      setOptions: (next: object) => {
        navigation.setOptions(next);
        setOptions(next);
      },
    }),
    []
  );

  return (
    <>
      {options.headerRight?.()}
      <ListDetailScreen
        {...({ navigation: nav, route: { params: { listId } } } as unknown as ListDetailScreenProps)}
      />
    </>
  );
}

async function renderAs(role: Role) {
  jest.mocked(fetchLists).mockResolvedValue({ lists: [{ ...SHARED, role }], error: null, truncated: false });

  await render(
    <ListsProvider userId="u1" onSessionRevoked={() => {}}>
      <Chrome listId="l1" />
    </ListsProvider>
  );

  // Every role renders the item; only the controls around it differ.
  await screen.findByLabelText('Milk');
}

beforeEach(async () => {
  jest.mocked(fetchLists).mockResolvedValue({ lists: [], error: null, truncated: false });
  navigation.setOptions.mockClear();
  navigation.navigate.mockClear();
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

  // `objectContaining` because an owner's header carries `headerRight` alongside the title.
  expect(navigation.setOptions).toHaveBeenCalledWith(expect.objectContaining({ title: 'Hardware' }));
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

  expect(screen.getByText('List not found')).toBeOnTheScreen();
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
    itemsLoaded: false,
    items: [],
    nextLive: null,
    nextBin: null,
  };

  it('shows a spinner, then the list, once its first page arrives', async () => {
    jest.mocked(fetchLists).mockResolvedValue({ lists: [BARE], error: null, truncated: false });
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
        <Chrome listId="l1" />
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
    jest.mocked(fetchLists).mockResolvedValue({ lists: [{ ...BARE, itemsLoaded: true }], error: null, truncated: false });

    await render(
      <ListsProvider userId="u1" onSessionRevoked={() => {}}>
        <Chrome listId="l1" />
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
    jest.mocked(fetchLists).mockResolvedValue({
      lists: [{ ...SHARED, role: 'reader', deletedAt: null, items: [], nextLive: null, nextBin: null }],
      error: null,
      truncated: false,
    });

    await render(
      <ListsProvider userId="u1" onSessionRevoked={() => {}}>
        <Chrome listId="l1" />
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
});

// --- The bin ------------------------------------------------------------------------------------

const BINNED_AT = '2026-09-10T09:00:00.000Z';

/** Renders a list holding one live item and one in the bin. */
async function renderWithBin(role: Role = 'owner') {
  jest.mocked(fetchLists).mockResolvedValue({
    lists: [
      {
        ...SHARED,
        role,
        items: [
          { id: 'i1', title: 'Milk', doneAt: null, deletedAt: null, createdAt: null },
          { id: 'i2', title: 'Bread', doneAt: null, deletedAt: BINNED_AT, createdAt: null },
        ],
      },
    ],
    error: null,
    truncated: false,
  });

  await render(
    <ListsProvider userId="u1" onSessionRevoked={() => {}}>
      <Chrome listId="l1" />
    </ListsProvider>
  );

  await screen.findByLabelText('Milk');
}

it('leaves deleted items off the list until they are asked for', async () => {
  await renderWithBin();

  expect(screen.queryByLabelText('Bread')).not.toBeOnTheScreen();
  expect(screen.getByLabelText('Show 1 deleted')).not.toBeChecked();
});

it('reveals them behind the checkbox, with no second request', async () => {
  await renderWithBin();
  jest.mocked(fetchLists).mockClear();

  await fireEvent.press(screen.getByLabelText('Show 1 deleted'));

  expect(screen.getByLabelText('Show 1 deleted')).toBeChecked();
  expect(screen.getByLabelText('Bread')).toBeOnTheScreen();
  expect(fetchLists).not.toHaveBeenCalled();
});

it('does not offer the checkbox when nothing has been deleted', async () => {
  await renderAs('writer');

  expect(screen.queryByLabelText('Show 1 deleted')).not.toBeOnTheScreen();
});

it('sends an item to the bin and brings it back', async () => {
  await renderWithBin('writer');

  await fireEvent.press(screen.getByLabelText('Delete Milk'));
  expect(setItemDeleted).toHaveBeenCalledWith('i1', true);

  await fireEvent.press(screen.getByLabelText('Show 2 deleted'));
  await fireEvent.press(screen.getByLabelText('Restore Bread'));
  expect(setItemDeleted).toHaveBeenCalledWith('i2', false);
});

it('gives a reader no way to delete an item', async () => {
  await renderWithBin('reader');

  expect(screen.queryByLabelText('Delete Milk')).not.toBeOnTheScreen();
});

/** A binned item cannot be ticked: there is nothing live to check off. */
it('will not let a deleted item be toggled', async () => {
  await renderWithBin('writer');
  await fireEvent.press(screen.getByLabelText('Show 1 deleted'));

  expect(screen.getByLabelText('Bread')).toBeDisabled();
});

/** Nor renamed, for the same reason — Restore is the one thing to offer it. */
it('offers a deleted item no rename, only a restore', async () => {
  await renderWithBin('writer');
  await fireEvent.press(screen.getByLabelText('Show 1 deleted'));

  expect(screen.queryByLabelText('Rename Bread')).not.toBeOnTheScreen();
  expect(screen.getByLabelText('Restore Bread')).toBeOnTheScreen();
  expect(screen.getByLabelText('Rename Milk')).toBeOnTheScreen();
});

/**
 * The count is a claim about what is on the list, and a binned item must not inflate it — nor
 * silence the empty state once every live item is gone.
 */
it('says the list is empty when every live item has been deleted', async () => {
  jest.mocked(fetchLists).mockResolvedValue({
    lists: [
      {
        ...SHARED,
        role: 'owner',
        items: [{ id: 'i1', title: 'Milk', doneAt: null, deletedAt: BINNED_AT, createdAt: null }],
      },
    ],
    error: null,
    truncated: false,
  });

  await render(
    <ListsProvider userId="u1" onSessionRevoked={() => {}}>
      <Chrome listId="l1" />
    </ListsProvider>
  );

  expect(await screen.findByText('Nothing on this list')).toBeOnTheScreen();
});

describe('a list opened from the bin', () => {
  async function renderBinnedList(role: Role = 'owner') {
    jest.mocked(fetchLists).mockResolvedValue({
      lists: [{ ...SHARED, role, deletedAt: BINNED_AT }],
      error: null,
      truncated: false,
    });

    await render(
      <ListsProvider userId="u1" onSessionRevoked={() => {}}>
        <Chrome listId="l1" />
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
const AFTER_JAM = { createdAt: T(12), id: 'b2' };

/** Page 1 of both streams loaded, each with more to come. */
async function renderPaged() {
  jest.mocked(fetchLists).mockResolvedValue({
    lists: [
      {
        ...SHARED,
        role: 'writer',
        items: [
          row('i1', 'Milk', 1),
          row('i2', 'Bread', 2),
          row('b1', 'Old jam', 11, BINNED_AT),
          row('b2', 'Jam', 12, BINNED_AT),
        ],
        nextLive: AFTER_BREAD,
        nextBin: AFTER_JAM,
      },
    ],
    error: null,
    truncated: false,
  });

  await render(
    <ListsProvider userId="u1" onSessionRevoked={() => {}}>
      <Chrome listId="l1" />
    </ListsProvider>
  );

  await screen.findByLabelText('Milk');
}

/** Reaching the end is an event on the `FlatList`; a row inside it is where the event walks up from. */
async function scrollToEnd() {
  await fireEvent(screen.getByLabelText('Milk'), 'endReached');
}

/** The item rows in order — the "Show deleted" toggle is a checkbox too, so it is left out. */
function itemLabels(): string[] {
  return screen
    .getAllByRole('checkbox')
    .map((row) => String(row.props.accessibilityLabel))
    .filter((label) => !label.startsWith('Show '));
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

  it('loads the bin as well once it is showing', async () => {
    jest
      .mocked(fetchItems)
      .mockResolvedValueOnce({ items: [row('i3', 'Eggs', 3)], next: null, error: null })
      .mockResolvedValueOnce({ items: [row('b3', 'Rye', 13, BINNED_AT)], next: null, error: null });
    await renderPaged();

    await fireEvent.press(screen.getByLabelText('Show 2+ deleted'));
    await scrollToEnd();

    expect(await screen.findByLabelText('Rye')).toBeOnTheScreen();
    expect(fetchItems).toHaveBeenCalledWith('l1', 'live', AFTER_BREAD);
    expect(fetchItems).toHaveBeenCalledWith('l1', 'bin', AFTER_JAM);
    // Every row is loaded now, so the count is exact and the `+` is gone.
    expect(screen.getByLabelText('Show 3 deleted')).toBeOnTheScreen();
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

  /**
   * The two streams load unevenly — page 2 of the live rows lands after page 1 of the bin — so the
   * combined view sorts by when each row was created rather than showing them in arrival order.
   */
  it('interleaves live and deleted rows by date when both are showing', async () => {
    jest
      .mocked(fetchItems)
      .mockResolvedValueOnce({ items: [row('i3', 'Eggs', 3)], next: null, error: null })
      .mockResolvedValueOnce({ items: [row('b3', 'Rye', 13, BINNED_AT)], next: null, error: null });
    await renderPaged();

    await fireEvent.press(screen.getByLabelText('Show 2+ deleted'));
    await scrollToEnd();
    await screen.findByLabelText('Rye');

    expect(itemLabels()).toEqual(['Milk', 'Bread', 'Eggs', 'Old jam', 'Jam', 'Rye']);
  });
});

it('asks for nothing at the end of a list that fits in a page', async () => {
  jest.mocked(fetchItems).mockClear();
  await renderWithBin('writer');

  await scrollToEnd();

  expect(fetchItems).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Loading more items')).not.toBeOnTheScreen();
});
