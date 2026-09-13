import { useCallback, useRef, type Dispatch, type MutableRefObject } from 'react';

import { fetchItems } from '../lib/listsApi';
import { foldPage } from './foldPage';
import type { Action, Cursor, List, Stream, WriteAction } from './types';

/**
 * The next page of a list's rows, on scroll — live, and the bin once the screen asks for it. Split
 * out of `ListsContext` because, unlike the fetch/retry core around `hydrate`/`flush`, paging shares
 * no guard with either: it reads `listsRef`/`live` and folds a page in through `foldPage`, and that
 * is the whole surface it needs.
 */
export function usePaging({
  listsRef,
  live,
  dispatch,
  queue,
}: {
  listsRef: MutableRefObject<List[]>;
  live: MutableRefObject<boolean>;
  dispatch: Dispatch<Action>;
  queue: MutableRefObject<WriteAction[]>;
}) {
  // Which lists have a page in flight, so a scroll that fires `onEndReached` twice sends one request.
  const paging = useRef(new Set<string>());

  /**
   * The next page of one list, on scroll.
   *
   * A read, so it carries none of `refresh`'s guards and may overlap a `hydrate`: a page that lands
   * during one is either included in the re-read `hydrate` does anyway, or dropped by the replace
   * and reloaded on the next scroll — both correct, neither worth a guard. What must not overlap is
   * still a flush and a fetch, and nothing here touches that.
   *
   * The bin only when asked, because the screen only shows it when asked, and one list at a time:
   * a scroll fires `onEndReached` more than once, and the second call finds the first in `paging`.
   * A page that fails is silent — the cursor is untouched, so the next scroll simply asks again —
   * since `error` is for a write the database refused, and a read hiccup is not that.
   */
  const loadMore = useCallback(async (listId: string, includeBin: boolean) => {
    if (paging.current.has(listId)) return;
    const list = listsRef.current.find((candidate) => candidate.id === listId);
    if (!list) return;

    const pages: [Stream, Cursor | null][] = [['live', list.nextLive]];
    if (includeBin) pages.push(['bin', list.nextBin]);

    paging.current.add(listId);
    try {
      for (const [stream, after] of pages) {
        if (after === null) continue;

        const { items, next } = await fetchItems(listId, stream, after);
        if (!live.current) return;
        if (!items) continue;

        foldPage(dispatch, queue, { type: 'items/pageLoaded', listId, items, stream: { name: stream, next } });
      }
    } finally {
      paging.current.delete(listId);
    }
  }, []);

  /**
   * A list's first page of both streams, fetched once — when the user opens it. Live and bin
   * together, matching what `fetchLists` used to embed and preserving the same guarantee: the
   * bin's first page is available offline for "Show deleted" and the blocked-write restore prompt,
   * from the moment the list is entered.
   *
   * `itemsLoaded` only flips once *both* requests have succeeded — a live-only or bin-only result
   * must not tell `ListDetailScreen` or `reloadPages` the list is loaded when half of it is
   * missing, so a partial failure dispatches nothing and leaves the flag false for the next mount
   * effect to retry.
   */
  const loadListItems = useCallback(async (listId: string) => {
    if (paging.current.has(listId)) return;
    const list = listsRef.current.find((candidate) => candidate.id === listId);
    if (!list || list.itemsLoaded) return;

    paging.current.add(listId);
    try {
      const [liveResult, binResult] = await Promise.all([
        fetchItems(listId, 'live', null),
        fetchItems(listId, 'bin', null),
      ]);
      if (!live.current) return;
      if (liveResult.items === null || binResult.items === null) return;

      foldPage(dispatch, queue, {
        type: 'items/firstPageLoaded',
        listId,
        live: { items: liveResult.items, next: liveResult.next },
        bin: { items: binResult.items, next: binResult.next },
      });
    } finally {
      paging.current.delete(listId);
    }
  }, []);

  return { loadMore, loadListItems };
}
