import { countDone, initialState, listsReducer } from './listsReducer';
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
      { id: 'l9', name: 'Hardware', role: 'reader' as const, items: [{ id: 'i9', title: 'Nails', doneAt: DONE_AT }] },
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

    expect(state.lists).toEqual([{ id: 'l1', name: 'Groceries', role: 'owner', items: [] }]);
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

    expect(state.lists[0].items).toEqual([{ id: 'i1', title: 'Milk', doneAt: null }]);
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
