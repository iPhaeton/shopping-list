import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  itemSortOf,
  listSortOf,
  readSortPreference,
  withItemSort,
  withListSort,
  writeSortPreference,
  type StoredSorts,
} from '../lib/sortPreference';
import type { ItemSort, ListSort } from './arrange';

type SortContextValue = {
  /** The Lists screen's sort. */
  listSort: ListSort;
  setListSort: (sort: ListSort) => void;
  /** One list's item sort: each list keeps its own. */
  itemSortFor: (listId: string) => ItemSort;
  setItemSort: (listId: string, sort: ItemSort) => void;
};

const SortContext = createContext<SortContextValue | null>(null);

/**
 * The sorts remembered on this device (`src/lib/sortPreference.ts`), held in memory once read.
 *
 * **Nothing renders until the read resolves**, as `ThemeProvider` gates on the theme: a screen
 * that drew its rows in the default order and then jumped to the stored one would reorder under
 * the finger. After that a change re-sorts at once, and the write follows; a failed write costs the
 * sort at the next cold start, not now.
 *
 * Above `SessionProvider` in `App.tsx`, so it is read once per launch and outlives a sign-out —
 * per device, like the theme.
 */
export function SortProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<StoredSorts | null>(null);
  // The latest value, for a second change made before React has committed the first: each write
  // must build on the one before it, or a quick double tap stores only the second key.
  const latest = useRef<StoredSorts | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readSortPreference().then((read) => {
      if (cancelled) return;
      latest.current = read;
      setStored(read);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const change = useCallback((update: (sorts: StoredSorts) => StoredSorts) => {
    if (latest.current === null) return;
    const next = update(latest.current);
    latest.current = next;
    setStored(next);
    writeSortPreference(next).catch(() => undefined);
  }, []);

  const value = useMemo<SortContextValue | null>(
    () =>
      stored === null
        ? null
        : {
            listSort: listSortOf(stored),
            setListSort: (sort) => change((sorts) => withListSort(sorts, sort)),
            itemSortFor: (listId) => itemSortOf(stored, listId),
            setItemSort: (listId, sort) => change((sorts) => withItemSort(sorts, listId, sort)),
          },
    [stored, change]
  );

  if (value === null) return null;

  return <SortContext.Provider value={value}>{children}</SortContext.Provider>;
}

export function useSorts(): SortContextValue {
  const value = useContext(SortContext);
  if (!value) throw new Error('useSorts must be used inside a <SortProvider>');
  return value;
}
