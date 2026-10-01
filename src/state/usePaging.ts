import { useCallback, useRef, type Dispatch, type MutableRefObject } from 'react';

import { fetchItems, fetchList, fetchLists } from '../lib/listsApi';
import { foldPage } from './foldPage';
import { initialState, listsReducer } from './listsReducer';
import { replay } from './replay';
import type { Action, Cursor, List, ListCursors, Stream, WriteAction } from './types';

/**
 * The next page on scroll — of a list's rows, and of the lists themselves — live, and the bin once
 * the screen asks for it; and one list by id, for a list something needs but has not paged to. Split
 * out of `ListsContext` because, unlike the fetch/retry core around `hydrate`/`flush`, paging shares
 * no guard with either: it reads `listsRef`/`listCursorsRef`/`live` and folds a page in through
 * `foldPage`, and that is the whole surface it needs.
 */
export function usePaging({
  listsRef,
  listCursorsRef,
  live,
  dispatch,
  queue,
}: {
  listsRef: MutableRefObject<List[]>;
  listCursorsRef: MutableRefObject<ListCursors>;
  live: MutableRefObject<boolean>;
  dispatch: Dispatch<Action>;
  queue: MutableRefObject<WriteAction[]>;
}) {
  // Which lists have a page in flight, so a scroll that fires `onEndReached` twice sends one request.
  const paging = useRef(new Set<string>());
  // The same for the Lists screen's own scroll — one screen, so one flag.
  const pagingLists = useRef(false);

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

  /**
   * `loadMore` one level up: the next page of lists on the Lists screen's scroll — live, and the bin
   * as well while "Show deleted" is on. Same rules, for the same reasons: a read, so it may overlap a
   * `hydrate` (the page is either re-read by it or dropped by its replace and asked for again on the
   * next scroll); one request at a time; a failed page is silent and leaves the cursor for the next
   * scroll to retry.
   */
  const loadMoreLists = useCallback(async (includeBin: boolean) => {
    if (pagingLists.current) return;

    const cursors = listCursorsRef.current;
    const pages: [Stream, Cursor | null][] = [['live', cursors.live]];
    if (includeBin) pages.push(['bin', cursors.bin]);

    pagingLists.current = true;
    try {
      for (const [stream, after] of pages) {
        if (after === null) continue;

        const { lists, next } = await fetchLists(stream, after);
        if (!live.current) return;
        if (!lists) continue;

        foldPage(dispatch, queue, { type: 'lists/pageLoaded', lists, stream: { name: stream, next } });
      }
    } finally {
      pagingLists.current = false;
    }
  }, []);

  /**
   * One list by id, folded in with no `stream` so the list cursors stay where they are — for a list
   * that is needed but lies past the pages loaded so far. Somebody else binned it, and it now sorts
   * past the loaded pages of the bin: the target of a blocked write, or the list List detail has
   * open. Resolves to the list it folded in, or `null` when it is not visible to this account (or the
   * read failed), so a caller can go on to what hangs off it.
   */
  const loadList = useCallback(async (listId: string): Promise<List | null> => {
    const { list } = await fetchList(listId);
    if (!live.current || !list) return null;

    const action = { type: 'lists/pageLoaded' as const, lists: [list] };
    foldPage(dispatch, queue, action);
    // Mirrored at once, the way `hydrate` sets the ref after its own dispatch: List detail's mount
    // effect asks `loadListItems` for this list's items in the very commit it appears, and that
    // looks the list up in `listsRef` — which the provider's mirroring effect updates only after
    // the child's effect has already run, and found nothing.
    listsRef.current = replay(
      listsReducer({ ...initialState, lists: listsRef.current }, action).lists,
      queue.current
    );
    return list;
  }, []);

  return { loadMore, loadListItems, loadMoreLists, loadList };
}
