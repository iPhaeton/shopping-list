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
      // Appended only when the id is new. A list already here is *updated* instead — see the note
      // above `updateList` for why that matters.
      if (state.lists.some((candidate) => candidate.id === action.id)) {
        return updateList(state, action.id, (list) => (list.name === name ? list : { ...list, name }));
      }

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

      return updateList(state, action.listId, (list) => {
        const item = list.items.find((candidate) => candidate.id === action.id);
        if (!item) return { ...list, items: [...list.items, { id: action.id, title, doneAt: null }] };

        // Already here: leave `doneAt` alone, since somebody may have checked it off since.
        if (item.title === title) return list;
        return {
          ...list,
          items: list.items.map((candidate) =>
            candidate.id === action.id ? { ...candidate, title } : candidate
          ),
        };
      });
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
 *
 * **All four write actions are idempotent by id, and `list/created` and `item/added` were not
 * always.** They appended unconditionally, which is only safe while a row cannot be in the fetched
 * set *and* still in the outbox — an invariant the provider keeps by never letting a fetch and a
 * flush overlap. Realtime made that invariant load-bearing rather than incidental, by fetching far
 * more often, so folding the outbox back over fetched rows now yields one row either way rather
 * than two. The fold itself stays where it was, one level up in `src/state/`, where it can be pure.
 *
 * This does **not** license caching the folded view: `writeCachedLists` still gets the rows the
 * fetch returned, for its own separate reason.
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
