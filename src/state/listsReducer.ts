import type {
  Action,
  BinCursor,
  Cursor,
  Item,
  List,
  ListCounts,
  ListCursors,
  State,
  StreamPage,
} from './types';

/** Before the first fetch: no lists, and no list cursors — "nothing asked yet", not "ended". */
export const NO_LIST_CURSORS: ListCursors = { live: null, bin: null };

/**
 * Before the first count arrives. Zero rather than "unknown": the counts only decide whether the
 * app warns before the tap, and below every limit is the direction that fails safe — the database
 * still refuses what it must.
 */
export const NO_LIST_COUNTS: ListCounts = { owned: 0, total: 0 };

export const initialState: State = {
  lists: [],
  listCursors: NO_LIST_CURSORS,
  listCounts: NO_LIST_COUNTS,
};

export function listsReducer(state: State, action: Action): State {
  switch (action.type) {
    // Hydration from the database, and the way a failed write is rolled back: whatever the server
    // holds replaces whatever the screen was showing.
    case 'lists/loaded': {
      const listCounts = action.counts ?? state.listCounts;
      return { ...state, lists: action.lists, listCursors: action.cursors, listCounts };
    }

    // A page of lists — `items/pageLoaded`'s rules one level up. A list already here is left alone
    // (it may carry a rename or a tombstone newer than the page's copy), and new ones go in before
    // the first optimistic list, which the screen sorts last anyway.
    case 'lists/pageLoaded': {
      if (!continues(action, action.stream && state.listCursors[action.stream.name])) return state;

      const known = new Set(state.lists.map((list) => list.id));
      const fresh = action.lists.filter((list) => !known.has(list.id));

      const moved =
        action.stream !== undefined &&
        !sameCursor(state.listCursors[action.stream.name], action.stream.next);
      if (fresh.length === 0 && !moved) return state;

      return {
        ...state,
        lists: insertFetched(state.lists, fresh, (list) => list.joinedAt === null),
        listCursors: action.stream ? withCursor(state.listCursors, action.stream) : state.listCursors,
      };
    }

    // A page of one list, read from the database. Rows already here are left alone — a page can
    // overlap what a re-read or a restore already brought in, and the row here may carry a tick or
    // a tombstone newer than the page's copy. New rows go in *before* the first optimistic row: a
    // list with page 1 loaded, an item added offline, then page 2 loaded must show page 2 above
    // the new item, which is where the next hydration will put it anyway.
    case 'items/pageLoaded': {
      return updateList(state, action.listId, (list) => {
        const at = action.stream && (action.stream.name === 'live' ? list.nextLive : list.nextBin);
        if (!continues(action, at)) return list;

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

        return { ...list, items: insertFetched(list.items, fresh, unstamped), ...cursors };
      });
    }

    // The first page of both streams, fetched together on entering a list. Idempotent on
    // `itemsLoaded` rather than by id alone — a defensive no-op if this somehow fires twice for
    // the same list, matching the file's style elsewhere.
    case 'items/firstPageLoaded': {
      return updateList(state, action.listId, (list) => {
        if (list.itemsLoaded) return list;

        const known = new Set(list.items.map((item) => item.id));
        const fresh = [...action.live.items, ...action.bin.items].filter(
          (item) => !known.has(item.id)
        );

        return {
          ...list,
          items: insertFetched(list.items, fresh, unstamped),
          nextLive: action.live.next,
          nextBin: action.bin.next,
          itemsLoaded: true,
        };
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
        // The database stamps the membership when the insert lands; `null` until then keeps this
        // list after every fetched one in `inJoinOrder`, as `createdAt: null` does for an item.
        joinedAt: null,
        // Nothing on the server to fetch yet, so this list starts already "loaded" — no spinner
        // for a list you just created.
        itemsLoaded: true,
        items: [],
        nextLive: null,
        nextBin: null,
      };
      // Counted here, on the append only, and that is what makes it exact rather than a guess: a
      // pending create folded back over a fetch that already holds it — the outbox resending one
      // whose answer was lost — lands on the branch above and is not counted twice.
      return {
        ...state,
        lists: [...state.lists, list],
        listCounts: {
          owned: state.listCounts.owned + 1,
          total: state.listCounts.total + 1,
        },
      };
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
      const next = updateList(state, action.id, (list) =>
        list.deletedAt === action.deletedAt ? list : { ...list, deletedAt: action.deletedAt }
      );

      // Nothing in the bin counts toward a limit, so binning frees a slot at once and restoring
      // takes one — the sentence in place of the Create bar says "delete one", and has to go away
      // when you do. Only a move between live and the bin counts: the database's own `deleted_at`
      // differs from the one this device minted, and a pending bin folded back over a fetch that
      // already has it moves nothing.
      const before = state.lists.find((list) => list.id === action.id);
      if (!before || (before.deletedAt === null) === (action.deletedAt === null)) {
        return next;
      }
      const step = action.deletedAt === null ? 1 : -1;
      return {
        ...next,
        listCounts: {
          owned: next.listCounts.owned + (before.role === 'owner' ? step : 0),
          total: next.listCounts.total + step,
        },
      };
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
 * The rows a screen shows unless it has been switched to the bin — and, below, the rows it shows
 * when it has.
 *
 * Everything that counts or renders has to go through one of these four. A tombstone reads exactly
 * like a live row otherwise, so the mistake is invisible in any test that does not delete something
 * first: a list quietly reads "2 of 47 done" with 42 of them in the bin, and "Nothing on this list"
 * stops appearing once a list has ever held anything.
 *
 * All four return a new array, so a screen passing one to a `FlatList` should memoise it.
 */
export function liveItems(list: List): Item[] {
  return list.items.filter((item) => item.deletedAt === null);
}

export function liveLists(lists: List[]): List[] {
  return lists.filter((list) => list.deletedAt === null);
}

export function binItems(list: List): Item[] {
  return list.items.filter((item) => item.deletedAt !== null);
}

export function binLists(lists: List[]): List[] {
  return lists.filter((list) => list.deletedAt !== null);
}

export function countDone(list: List): number {
  return liveItems(list).filter((item) => item.doneAt !== null).length;
}

/**
 * The order the server sends live rows in — `(created_at, id)` — with rows the database has not
 * stamped yet last, in the order they were added.
 *
 * Needed because `items` is two streams end to end plus whatever was added since, and a row that
 * moves between them keeps its place in the array: restore something from the bin and, unsorted,
 * it would sit between page 1 and page 2 of the live rows. Returns a new array, so memoise it
 * before handing it to a `FlatList`.
 */
export function inCreationOrder(items: Item[]): Item[] {
  return [...items].sort((a, b) => byStamp(a.createdAt, a.id, b.createdAt, b.id));
}

/**
 * `inCreationOrder` for lists: the order `fetchLists` pages the live ones in — `(joinedAt, id)`, when
 * you joined each — with an optimistic list last. Needed for the same two reasons one level up: the
 * array is two streams end to end plus lists fetched one at a time, and a list that moves between
 * streams keeps its place in it. Returns a new array, so memoise it.
 */
export function inJoinOrder(lists: List[]): List[] {
  return [...lists].sort((a, b) => byStamp(a.joinedAt, a.id, b.joinedAt, b.id));
}

/**
 * The bin's order, for items and lists alike: `(deletedAt, id)` descending, newest deletion first —
 * the order both bin reads page in, so a page loaded on scroll lands below the rows on screen.
 *
 * A row binned on this device carries the tap's device time until a re-read replaces it with the
 * database's stamp, so clock skew can misplace it until then. Accepted: it heals itself. Meant for
 * binned rows only; a live row's `null` would sort first. Returns a new array, so memoise it.
 */
export function inDeletionOrder<T extends { id: string; deletedAt: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => byStamp(b.deletedAt, b.id, a.deletedAt, a.id));
}

/**
 * `(stamp, id)` ascending, `null` stamps last and in their original order (the sort is stable).
 * Exported for `arrange.ts`, whose date key is this order and its exact reverse.
 */
export function byStamp(aStamp: string | null, aId: string, bStamp: string | null, bId: string): number {
  if (aStamp === null || bStamp === null) {
    return aStamp === bStamp ? 0 : aStamp === null ? 1 : -1;
  }
  if (aStamp !== bStamp) return aStamp < bStamp ? -1 : 1;
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

/**
 * Whether a page continues where state's stream ends: `at` is state's cursor for the page's stream.
 * A page that carries no `after` is not checked — see the `after` note on `items/pageLoaded`.
 */
function continues(
  action: { stream?: StreamPage; after?: Cursor | BinCursor | null },
  at: Cursor | BinCursor | null | undefined
): boolean {
  if (action.after === undefined || action.stream === undefined || at === undefined) return true;
  return sameCursor(at, action.after);
}

function sameCursor(a: Cursor | BinCursor | null, b: Cursor | BinCursor | null): boolean {
  if (a === null || b === null) return a === b;
  return a.id === b.id && stampOf(a) === stampOf(b);
}

function stampOf(cursor: Cursor | BinCursor): string {
  return 'deletedAt' in cursor ? cursor.deletedAt : cursor.createdAt;
}

/** `cursors` with `page`'s stream moved to where its next page starts. */
function withCursor(cursors: ListCursors, page: StreamPage): ListCursors {
  return page.name === 'live' ? { ...cursors, live: page.next } : { ...cursors, bin: page.next };
}

/**
 * Inserts fetched rows before the first optimistic one, not at the end: a list with a page
 * loaded, an item added offline, then another page loaded must show the new page above that
 * item, which is where the next hydration would put it anyway. The same holds for a page of lists
 * and a list created offline.
 */
function insertFetched<T>(rows: T[], fresh: T[], optimistic: (row: T) => boolean): T[] {
  const at = rows.findIndex(optimistic);
  return at === -1 ? [...rows, ...fresh] : [...rows.slice(0, at), ...fresh, ...rows.slice(at)];
}

function unstamped(item: Item): boolean {
  return item.createdAt === null;
}
