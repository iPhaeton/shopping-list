import type { Action, Cursor, Item, List, State } from './types';

export const initialState: State = { lists: [] };

export function listsReducer(state: State, action: Action): State {
  switch (action.type) {
    // Hydration from the database, and the way a failed write is rolled back: whatever the server
    // holds replaces whatever the screen was showing.
    case 'lists/loaded': {
      return { ...state, lists: action.lists };
    }

    // A page of one list, read from the database. Rows already here are left alone — a page can
    // overlap what a re-read or a restore already brought in, and the row here may carry a tick or
    // a tombstone newer than the page's copy. New rows go in *before* the first optimistic row: a
    // list with page 1 loaded, an item added offline, then page 2 loaded must show page 2 above
    // the new item, which is where the next hydration will put it anyway.
    case 'items/pageLoaded': {
      return updateList(state, action.listId, (list) => {
        const known = new Set(list.items.map((item) => item.id));
        const fresh = action.items.filter((item) => !known.has(item.id));

        const cursors = action.stream
          ? action.stream.name === 'live'
            ? { nextLive: action.stream.next }
            : { nextBin: action.stream.next }
          : {};
        const moved =
          action.stream !== undefined &&
          !sameCursor(
            action.stream.name === 'live' ? list.nextLive : list.nextBin,
            action.stream.next
          );
        if (fresh.length === 0 && !moved) return list;

        const at = list.items.findIndex((item) => item.createdAt === null);
        const items =
          at === -1
            ? [...list.items, ...fresh]
            : [...list.items.slice(0, at), ...fresh, ...list.items.slice(at)];
        return { ...list, items, ...cursors };
      });
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

      const list: List = {
        id: action.id,
        name,
        role: 'owner',
        deletedAt: null,
        items: [],
        nextLive: null,
        nextBin: null,
      };
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
          // `createdAt: null` — the database stamps the real one, and `null` is what keeps this
          // row after every fetched page in `inCreationOrder`.
          return {
            ...list,
            items: [
              ...list.items,
              { id: action.id, title, doneAt: null, deletedAt: null, createdAt: null },
            ],
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

    case 'item/renamed': {
      const title = action.title.trim();
      if (!title) return state;

      // Only the title moves. `doneAt` and `deletedAt` are left exactly as they are, for the same
      // reason `item/added`'s "already here" branch leaves them: a rename folded back over fetched
      // rows must not undo a tick or a restore that happened since.
      return updateList(state, action.listId, (list) => {
        const item = list.items.find((candidate) => candidate.id === action.itemId);
        if (!item || item.title === title) return list;

        return {
          ...list,
          items: list.items.map((candidate) =>
            candidate.id === action.itemId ? { ...candidate, title } : candidate
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
 * **Every write action is idempotent by id, and `list/created` and `item/added` were not
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

/**
 * The order the server sends rows in — `(created_at, id)` — with rows the database has not
 * stamped yet last, in the order they were added.
 *
 * Needed because `items` is two streams end to end plus whatever was added since, and a row that
 * moves between them keeps its place in the array: restore something from the bin and, unsorted,
 * it would sit between page 1 and page 2 of the live rows. Returns a new array, so memoise it
 * before handing it to a `FlatList`.
 */
export function inCreationOrder(items: Item[]): Item[] {
  return [...items].sort((a, b) => {
    if (a.createdAt === null || b.createdAt === null) {
      return a.createdAt === b.createdAt ? 0 : a.createdAt === null ? 1 : -1;
    }
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function sameCursor(a: Cursor | null, b: Cursor | null): boolean {
  if (a === null || b === null) return a === b;
  return a.createdAt === b.createdAt && a.id === b.id;
}
