import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from 'react';

import { newId } from '../lib/ids';
import { fetchLists, insertItem, insertList, setItemDone, type Result } from '../lib/listsApi';
import { initialState, listsReducer } from './listsReducer';
import type { List } from './types';

type ListsContextValue = {
  lists: List[];
  /** `loading` until the first fetch settles, so a screen does not flash an empty state at it. */
  status: 'loading' | 'ready';
  /** The last read or write failure, for the screen to render. Cleared by the next success. */
  error: string | null;
  /** Returns the id of the new list, or null when `name` was blank. */
  createList: (name: string) => string | null;
  addItem: (listId: string, title: string) => void;
  toggleItem: (listId: string, itemId: string) => void;
};

const ListsContext = createContext<ListsContextValue | null>(null);

/**
 * The only file that persists list data. The reducer stays pure and the screens keep reading
 * through `useLists()`, so neither knows the state came from Postgres.
 *
 * Mounted only while signed in (see `App.tsx`), which is why nothing here consults the session:
 * there is always a token, sign-out unmounts the provider and discards the state with it, and
 * row-level security — not a filter written here — is what keeps one account's lists private.
 *
 * Writes are optimistic: the id is minted up front, the reducer moves immediately, and the request
 * follows. A failure is not swallowed — it sets `error` and re-fetches, so the screen converges on
 * what the database actually holds.
 */
export function ListsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(listsReducer, initialState);
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { lists, error: failure } = await fetchLists();
    if (lists) dispatch({ type: 'lists/loaded', lists });
    return failure;
  }, []);

  useEffect(() => {
    let active = true;

    void load().then((failure) => {
      if (!active) return;
      setError(failure);
      setStatus('ready');
    });

    return () => {
      active = false;
    };
  }, [load]);

  // Rolling back by re-fetching is why there is no `list/removed` or `item/removed` action: one
  // path repairs every kind of failed write, and it repairs it with server truth rather than with
  // the client's guess at what it had just done.
  const write = useCallback(
    async (request: () => Promise<Result>) => {
      const { error: failure } = await request();
      if (!failure) {
        setError(null);
        return;
      }

      setError(failure);
      await load();
    },
    [load]
  );

  const createList = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return null;

      const id = newId();
      dispatch({ type: 'list/created', id, name: trimmed });
      void write(() => insertList(id, trimmed));
      return id;
    },
    [write]
  );

  const addItem = useCallback(
    (listId: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;

      const id = newId();
      dispatch({ type: 'item/added', listId, id, title: trimmed });
      void write(() => insertItem(id, listId, trimmed));
    },
    [write]
  );

  const toggleItem = useCallback(
    (listId: string, itemId: string) => {
      const item = state.lists
        .find((list) => list.id === listId)
        ?.items.find((candidate) => candidate.id === itemId);
      if (!item) return;

      // The target state, computed here and sent whole. The reducer is never asked to flip.
      const done = item.doneAt === null;

      // A placeholder for the optimistic row only — this device's clock does not decide when an
      // item was checked off. The database stamps the real instant, and the next hydration replaces
      // what is dispatched here.
      const doneAt = done ? new Date().toISOString() : null;

      dispatch({ type: 'item/setDone', listId, itemId, doneAt });
      void write(() => setItemDone(itemId, done));
    },
    [state.lists, write]
  );

  const value = useMemo(
    () => ({ lists: state.lists, status, error, createList, addItem, toggleItem }),
    [state.lists, status, error, createList, addItem, toggleItem]
  );

  return <ListsContext.Provider value={value}>{children}</ListsContext.Provider>;
}

export function useLists(): ListsContextValue {
  const value = useContext(ListsContext);
  if (!value) throw new Error('useLists must be used inside a <ListsProvider>');
  return value;
}
