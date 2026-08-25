import { createContext, useCallback, useContext, useMemo, useReducer, type ReactNode } from 'react';

import { initialState, listsReducer } from './listsReducer';
import type { List } from './types';

type ListsContextValue = {
  lists: List[];
  /** Returns the id of the new list, or null when `name` was blank. */
  createList: (name: string) => string | null;
  addItem: (listId: string, title: string) => void;
  toggleItem: (listId: string, itemId: string) => void;
};

const ListsContext = createContext<ListsContextValue | null>(null);

let nextId = 0;
function makeId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

export function ListsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(listsReducer, initialState);

  const createList = useCallback((name: string) => {
    if (!name.trim()) return null;

    const id = makeId('list');
    dispatch({ type: 'list/created', id, name });
    return id;
  }, []);

  const addItem = useCallback((listId: string, title: string) => {
    if (!title.trim()) return;
    dispatch({ type: 'item/added', listId, id: makeId('item'), title });
  }, []);

  const toggleItem = useCallback((listId: string, itemId: string) => {
    dispatch({ type: 'item/toggled', listId, itemId });
  }, []);

  const value = useMemo(
    () => ({ lists: state.lists, createList, addItem, toggleItem }),
    [state.lists, createList, addItem, toggleItem]
  );

  return <ListsContext.Provider value={value}>{children}</ListsContext.Provider>;
}

export function useLists(): ListsContextValue {
  const value = useContext(ListsContext);
  if (!value) throw new Error('useLists must be used inside a <ListsProvider>');
  return value;
}
