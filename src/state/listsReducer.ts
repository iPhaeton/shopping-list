import type { Action, List, State } from './types';

export const initialState: State = { lists: [] };

export function listsReducer(state: State, action: Action): State {
  switch (action.type) {
    case 'list/created': {
      const name = action.name.trim();
      if (!name) return state;

      const list: List = { id: action.id, name, items: [] };
      return { ...state, lists: [...state.lists, list] };
    }

    case 'item/added': {
      const title = action.title.trim();
      if (!title) return state;

      return updateList(state, action.listId, (list) => ({
        ...list,
        items: [...list.items, { id: action.id, title, done: false }],
      }));
    }

    case 'item/toggled': {
      return updateList(state, action.listId, (list) => {
        if (!list.items.some((item) => item.id === action.itemId)) return list;

        return {
          ...list,
          items: list.items.map((item) =>
            item.id === action.itemId ? { ...item, done: !item.done } : item
          ),
        };
      });
    }
  }
}

/**
 * Replaces one list via `update`. Returns the original state object untouched when the
 * list is unknown, or when `update` decided there was nothing to change.
 */
function updateList(state: State, listId: string, update: (list: List) => List): State {
  const index = state.lists.findIndex((list) => list.id === listId);
  if (index === -1) return state;

  const updated = update(state.lists[index]);
  if (updated === state.lists[index]) return state;

  const lists = [...state.lists];
  lists[index] = updated;
  return { ...state, lists };
}

export function countDone(list: List): number {
  return list.items.filter((item) => item.done).length;
}
