import type { Action, Item, List, State } from './types';

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

      const list: List = { id: action.id, name, role: 'owner', deletedAt: null, items: [] };
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
        if (!item) {
          return {
            ...list,
            items: [...list.items, { id: action.id, title, doneAt: null, deletedAt: null }],
          };
        }

        // Already here: leave `doneAt` and `deletedAt` alone, since somebody may have checked it off
        // or binned it since.
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

    case 'item/setDeleted': {
      return updateList(state, action.listId, (list) => {
        const item = list.items.find((candidate) => candidate.id === action.itemId);
        if (!item || item.deletedAt === action.deletedAt) return list;

        return {
          ...list,
          items: list.items.map((candidate) =>
            candidate.id === action.itemId
              ? { ...candidate, deletedAt: action.deletedAt }
              : candidate
          ),
        };
      });
    }

    case 'list/setDeleted': {
      // Through `updateList` like every other change to a list, and deliberately not a `filter` on
      // `state.lists`: a binned list stays in the array, where the bin can show it and a restore
      // can find it.
      return updateList(state, action.id, (list) =>
        list.deletedAt === action.deletedAt ? list : { ...list, deletedAt: action.deletedAt }
      );
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

/**
 * The rows a screen shows unless it has been asked for the bin as well.
 *
 * Everything that counts or renders has to go through one of these two. A tombstone reads exactly
 * like a live row otherwise, so the mistake is invisible in any test that does not delete something
 * first: a list quietly reads "2 of 47 done" with 42 of them in the bin, and "Nothing on this list"
 * stops appearing once a list has ever held anything.
 *
 * Both return a new array, so a screen passing one to a `FlatList` should memoise it.
 */
export function liveItems(list: List): Item[] {
  return list.items.filter((item) => item.deletedAt === null);
}

export function liveLists(lists: List[]): List[] {
  return lists.filter((list) => list.deletedAt === null);
}

export function countDone(list: List): number {
  return liveItems(list).filter((item) => item.doneAt !== null).length;
}
