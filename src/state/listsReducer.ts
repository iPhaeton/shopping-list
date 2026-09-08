import type { Action, List, State } from './types';

export const initialState: State = { lists: [] };

export function listsReducer(state: State, action: Action): State {
  switch (action.type) {
    // Hydration from the database, and the way a failed write is rolled back: whatever the server
    // holds replaces whatever the screen was showing.
    case 'lists/loaded': {
      return { ...state, lists: action.lists };
    }

    case 'list/created': {
      const name = action.name.trim();
      if (!name) return state;

      // `owner` rather than something the action carries: the database's `on_list_created` trigger
      // mints exactly this row for the creator, so the optimistic list already matches what the
      // next fetch will return.
      const list: List = { id: action.id, name, role: 'owner', items: [] };
      return { ...state, lists: [...state.lists, list] };
    }

    case 'list/renamed': {
      const name = action.name.trim();
      if (!name) return state;

      return updateList(state, action.id, (list) => (list.name === name ? list : { ...list, name }));
    }

    case 'item/added': {
      const title = action.title.trim();
      if (!title) return state;

      return updateList(state, action.listId, (list) => ({
        ...list,
        items: [...list.items, { id: action.id, title, doneAt: null }],
      }));
    }

    case 'item/setDone': {
      return updateList(state, action.listId, (list) => {
        const item = list.items.find((candidate) => candidate.id === action.itemId);
        if (!item || item.doneAt === action.doneAt) return list;

        return {
          ...list,
          items: list.items.map((candidate) =>
            candidate.id === action.itemId ? { ...candidate, doneAt: action.doneAt } : candidate
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
  return list.items.filter((item) => item.doneAt !== null).length;
}
