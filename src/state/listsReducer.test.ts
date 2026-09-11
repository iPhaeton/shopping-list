import { countDone, initialState, listsReducer, liveItems, liveLists } from './listsReducer';
import type { State } from './types';

/** Stands in for a timestamp minted by the provider; the reducer never makes one itself. */
const DONE_AT = '2026-08-31T09:00:00.000Z';

/** Builds a state with one list ("l1") holding the given item titles, none done. */
function stateWithItems(...titles: string[]): State {
  return titles.reduce<State>(
    (state, title, index) =>
      listsReducer(state, { type: 'item/added', listId: 'l1', id: `i${index + 1}`, title }),
    listsReducer(initialState, { type: 'list/created', id: 'l1', name: 'Groceries' })
  );
}

describe('lists/loaded', () => {
  it('replaces the lists with what the database returned', () => {
    const lists = [
      { id: 'l9', name: 'Hardware', role: 'reader' as const, deletedAt: null, items: [{ id: 'i9', title: 'Nails', doneAt: DONE_AT, deletedAt: null }] },
    ];

    const state = listsReducer(stateWithItems('Milk'), { type: 'lists/loaded', lists });

    expect(state.lists).toEqual(lists);
  });

  it('empties the state for an account with no lists', () => {
    const state = listsReducer(stateWithItems('Milk'), { type: 'lists/loaded', lists: [] });

    expect(state.lists).toEqual([]);
  });
});

describe('list/created', () => {
  it('appends a named, empty list', () => {
    const state = listsReducer(initialState, {
      type: 'list/created',
      id: 'l1',
      name: 'Groceries',
    });

    expect(state.lists).toEqual([{ id: 'l1', name: 'Groceries', role: 'owner', deletedAt: null, items: [] }]);
  });

  it('trims the name', () => {
    const state = listsReducer(initialState, {
      type: 'list/created',
      id: 'l1',
      name: '  Groceries  ',
    });

    expect(state.lists[0].name).toBe('Groceries');
  });

  it('ignores a blank name', () => {
    const state = listsReducer(initialState, { type: 'list/created', id: 'l1', name: '   ' });

    expect(state).toBe(initialState);
  });

  it('keeps lists independent of each other', () => {
    let state = listsReducer(initialState, { type: 'list/created', id: 'l1', name: 'Groceries' });
    state = listsReducer(state, { type: 'list/created', id: 'l2', name: 'Hardware' });
    state = listsReducer(state, { type: 'item/added', listId: 'l1', id: 'i1', title: 'Milk' });

    expect(state.lists[0].items.map((item) => item.title)).toEqual(['Milk']);
    expect(state.lists[1].items).toEqual([]);
  });
});

describe('list/renamed', () => {
  it('renames the list and leaves its items alone', () => {
    const state = listsReducer(stateWithItems('Milk'), {
      type: 'list/renamed',
      id: 'l1',
      name: 'Weekly shop',
    });

    expect(state.lists[0].name).toBe('Weekly shop');
    expect(state.lists[0].items.map((item) => item.title)).toEqual(['Milk']);
  });

  it('trims the name', () => {
    const state = listsReducer(stateWithItems(), {
      type: 'list/renamed',
      id: 'l1',
      name: '  Weekly shop  ',
    });

    expect(state.lists[0].name).toBe('Weekly shop');
  });

  it('ignores a blank name', () => {
    const before = stateWithItems();
    const after = listsReducer(before, { type: 'list/renamed', id: 'l1', name: '   ' });

    expect(after).toBe(before);
  });

  it('ignores a list it does not have', () => {
    const before = stateWithItems();
    const after = listsReducer(before, { type: 'list/renamed', id: 'l9', name: 'Hardware' });

    expect(after).toBe(before);
  });

  /** A rename to the name it already has must not make React think anything moved. */
  it('returns the same state object when the name is unchanged', () => {
    const before = stateWithItems();
    const after = listsReducer(before, { type: 'list/renamed', id: 'l1', name: 'Groceries' });

    expect(after).toBe(before);
  });
});

describe('item/added', () => {
  it('appends an item that starts out not done', () => {
    const state = stateWithItems('Milk');

    expect(state.lists[0].items).toEqual([{ id: 'i1', title: 'Milk', doneAt: null, deletedAt: null }]);
  });

  it('preserves insertion order', () => {
    const state = stateWithItems('Milk', 'Bread', 'Eggs');

    expect(state.lists[0].items.map((item) => item.title)).toEqual(['Milk', 'Bread', 'Eggs']);
  });

  it('trims the title and ignores a blank one', () => {
    const trimmed = listsReducer(stateWithItems(), {
      type: 'item/added',
      listId: 'l1',
      id: 'i1',
      title: '  Milk  ',
    });
    expect(trimmed.lists[0].items[0].title).toBe('Milk');

    const before = stateWithItems();
    const blank = listsReducer(before, {
      type: 'item/added',
      listId: 'l1',
      id: 'i1',
      title: '  ',
    });
    expect(blank).toBe(before);
  });

  it('is a no-op for an unknown list', () => {
    const before = stateWithItems('Milk');
    const after = listsReducer(before, {
      type: 'item/added',
      listId: 'nope',
      id: 'i9',
      title: 'Bread',
    });

    expect(after).toBe(before);
  });
});

describe('item/renamed', () => {
  it('renames only the targeted item', () => {
    const state = listsReducer(stateWithItems('Milk', 'Bread', 'Eggs'), {
      type: 'item/renamed',
      listId: 'l1',
      itemId: 'i2',
      title: 'Sourdough',
    });

    expect(state.lists[0].items.map((item) => item.title)).toEqual(['Milk', 'Sourdough', 'Eggs']);
  });

  /** A replayed rename must not undo a tick or a restore that happened since. */
  it('leaves whether the item is done, and whether it is binned, alone', () => {
    const ticked = listsReducer(stateWithItems('Milk'), {
      type: 'item/setDone',
      listId: 'l1',
      itemId: 'i1',
      doneAt: DONE_AT,
    });
    const binned = listsReducer(ticked, {
      type: 'item/setDeleted',
      listId: 'l1',
      itemId: 'i1',
      deletedAt: DONE_AT,
    });

    const renamed = listsReducer(binned, {
      type: 'item/renamed',
      listId: 'l1',
      itemId: 'i1',
      title: 'Oat milk',
    });

    expect(renamed.lists[0].items[0]).toEqual({
      id: 'i1',
      title: 'Oat milk',
      doneAt: DONE_AT,
      deletedAt: DONE_AT,
    });
  });

  it('trims the title and ignores a blank one', () => {
    const trimmed = listsReducer(stateWithItems('Milk'), {
      type: 'item/renamed',
      listId: 'l1',
      itemId: 'i1',
      title: '  Oat milk  ',
    });
    expect(trimmed.lists[0].items[0].title).toBe('Oat milk');

    const before = stateWithItems('Milk');
    const blank = listsReducer(before, {
      type: 'item/renamed',
      listId: 'l1',
      itemId: 'i1',
      title: '  ',
    });
    expect(blank).toBe(before);
  });

  it('returns the same state object when the title is unchanged', () => {
    const before = stateWithItems('Milk');

    expect(
      listsReducer(before, { type: 'item/renamed', listId: 'l1', itemId: 'i1', title: 'Milk' })
    ).toBe(before);
  });

  it('is a no-op for an unknown list or item', () => {
    const before = stateWithItems('Milk');

    expect(
      listsReducer(before, {
        type: 'item/renamed',
        listId: 'nope',
        itemId: 'i1',
        title: 'Oat milk',
      })
    ).toBe(before);
    expect(
      listsReducer(before, {
        type: 'item/renamed',
        listId: 'l1',
        itemId: 'nope',
        title: 'Oat milk',
      })
    ).toBe(before);
  });
});

describe('item/setDone', () => {
  it('marks an item done and back again', () => {
    const before = stateWithItems('Milk');

    const done = listsReducer(before, {
      type: 'item/setDone',
      listId: 'l1',
      itemId: 'i1',
      doneAt: DONE_AT,
    });
    expect(done.lists[0].items[0].doneAt).toBe(DONE_AT);

    const undone = listsReducer(done, {
      type: 'item/setDone',
      listId: 'l1',
      itemId: 'i1',
      doneAt: null,
    });
    expect(undone.lists[0].items[0].doneAt).toBeNull();
  });

  it('only touches the targeted item', () => {
    const state = listsReducer(stateWithItems('Milk', 'Bread', 'Eggs'), {
      type: 'item/setDone',
      listId: 'l1',
      itemId: 'i2',
      doneAt: DONE_AT,
    });

    expect(state.lists[0].items.map((item) => item.doneAt)).toEqual([null, DONE_AT, null]);
  });

  /**
   * The point of an absolute value rather than a flip: a retried request, or a second device
   * sending the same thing, changes nothing the second time.
   */
  it('is a no-op when the item already holds that value', () => {
    const before = listsReducer(stateWithItems('Milk'), {
      type: 'item/setDone',
      listId: 'l1',
      itemId: 'i1',
      doneAt: DONE_AT,
    });

    expect(
      listsReducer(before, { type: 'item/setDone', listId: 'l1', itemId: 'i1', doneAt: DONE_AT })
    ).toBe(before);
  });

  it('is a no-op for an unknown list or item', () => {
    const before = stateWithItems('Milk');

    expect(
      listsReducer(before, {
        type: 'item/setDone',
        listId: 'nope',
        itemId: 'i1',
        doneAt: DONE_AT,
      })
    ).toBe(before);
    expect(
      listsReducer(before, {
        type: 'item/setDone',
        listId: 'l1',
        itemId: 'nope',
        doneAt: DONE_AT,
      })
    ).toBe(before);
  });
});

describe('immutability', () => {
  it('does not mutate the previous state', () => {
    const before = stateWithItems('Milk');
    const snapshot = JSON.parse(JSON.stringify(before));

    listsReducer(before, { type: 'item/setDone', listId: 'l1', itemId: 'i1', doneAt: DONE_AT });
    listsReducer(before, { type: 'item/added', listId: 'l1', id: 'i2', title: 'Bread' });
    listsReducer(before, { type: 'list/created', id: 'l2', name: 'Hardware' });

    expect(before).toEqual(snapshot);
  });
});

describe('countDone', () => {
  it('counts only items marked done', () => {
    const state = listsReducer(stateWithItems('Milk', 'Bread', 'Eggs'), {
      type: 'item/setDone',
      listId: 'l1',
      itemId: 'i2',
      doneAt: DONE_AT,
    });

    expect(countDone(state.lists[0])).toBe(1);
  });
});

// --- The bin ------------------------------------------------------------------------------------

/** Stands in for a tombstone the database stamped; the reducer never makes one itself. */
const DELETED_AT = '2026-09-10T09:00:00.000Z';

describe('item/setDeleted', () => {
  it('tombstones an item in place rather than removing it', () => {
    const state = listsReducer(stateWithItems('Milk', 'Bread'), {
      type: 'item/setDeleted',
      listId: 'l1',
      itemId: 'i1',
      deletedAt: DELETED_AT,
    });

    expect(state.lists[0].items).toHaveLength(2);
    expect(state.lists[0].items[0].deletedAt).toBe(DELETED_AT);
  });

  it('restores it by carrying null, the same way a toggle carries a value', () => {
    const binned = listsReducer(stateWithItems('Milk'), {
      type: 'item/setDeleted',
      listId: 'l1',
      itemId: 'i1',
      deletedAt: DELETED_AT,
    });

    const state = listsReducer(binned, {
      type: 'item/setDeleted',
      listId: 'l1',
      itemId: 'i1',
      deletedAt: null,
    });

    expect(state.lists[0].items[0].deletedAt).toBeNull();
  });

  it('leaves whether the item is done alone', () => {
    const done = listsReducer(stateWithItems('Milk'), {
      type: 'item/setDone',
      listId: 'l1',
      itemId: 'i1',
      doneAt: DONE_AT,
    });

    const state = listsReducer(done, {
      type: 'item/setDeleted',
      listId: 'l1',
      itemId: 'i1',
      deletedAt: DELETED_AT,
    });

    expect(state.lists[0].items[0].doneAt).toBe(DONE_AT);
  });

  it('is a no-op for an item that is not there', () => {
    const before = stateWithItems('Milk');

    expect(
      listsReducer(before, {
        type: 'item/setDeleted',
        listId: 'l1',
        itemId: 'nope',
        deletedAt: DELETED_AT,
      })
    ).toBe(before);
  });

  it('returns the same state object when the item is already in that state', () => {
    const before = stateWithItems('Milk');

    expect(
      listsReducer(before, {
        type: 'item/setDeleted',
        listId: 'l1',
        itemId: 'i1',
        deletedAt: null,
      })
    ).toBe(before);
  });
});

describe('list/setDeleted', () => {
  /**
   * The property the whole feature rests on: a binned list is still in the array, so the bin can
   * show it, a restore can find it, and `list_members` never had to cascade away.
   */
  it('keeps the list in the array and marks it instead', () => {
    const state = listsReducer(stateWithItems('Milk'), {
      type: 'list/setDeleted',
      id: 'l1',
      deletedAt: DELETED_AT,
    });

    expect(state.lists).toHaveLength(1);
    expect(state.lists[0].deletedAt).toBe(DELETED_AT);
    expect(state.lists[0].items).toHaveLength(1);
  });

  it('restores it by carrying null', () => {
    const binned = listsReducer(stateWithItems('Milk'), {
      type: 'list/setDeleted',
      id: 'l1',
      deletedAt: DELETED_AT,
    });

    expect(listsReducer(binned, { type: 'list/setDeleted', id: 'l1', deletedAt: null }).lists[0].deletedAt).toBeNull();
  });

  it('is a no-op for a list that is not there', () => {
    const before = stateWithItems('Milk');

    expect(listsReducer(before, { type: 'list/setDeleted', id: 'nope', deletedAt: DELETED_AT })).toBe(
      before
    );
  });

  it('returns the same state object when the list is already in that state', () => {
    const before = stateWithItems('Milk');

    expect(listsReducer(before, { type: 'list/setDeleted', id: 'l1', deletedAt: null })).toBe(before);
  });
});

/**
 * These three are what stop a tombstone reading exactly like a live row. The mistake they prevent is
 * invisible in any test that never deletes anything, which is why each one deletes first.
 */
describe('liveItems, liveLists and countDone', () => {
  function withBinnedItem() {
    return listsReducer(stateWithItems('Milk', 'Bread', 'Eggs'), {
      type: 'item/setDeleted',
      listId: 'l1',
      itemId: 'i2',
      deletedAt: DELETED_AT,
    });
  }

  it('leaves a tombstoned item out of the live set', () => {
    expect(liveItems(withBinnedItem().lists[0]).map((item) => item.title)).toEqual(['Milk', 'Eggs']);
  });

  it('leaves a tombstoned list out of the live set', () => {
    const state = listsReducer(
      listsReducer(stateWithItems('Milk'), { type: 'list/created', id: 'l2', name: 'Hardware' }),
      { type: 'list/setDeleted', id: 'l1', deletedAt: DELETED_AT }
    );

    expect(liveLists(state.lists).map((list) => list.name)).toEqual(['Hardware']);
  });

  /** Without this a list reads "2 of 47 done" with 42 of them in the bin. */
  it('does not count a done item that has since been binned', () => {
    const done = listsReducer(withBinnedItem(), {
      type: 'item/setDone',
      listId: 'l1',
      itemId: 'i2',
      doneAt: DONE_AT,
    });

    expect(countDone(done.lists[0])).toBe(0);
  });
});
