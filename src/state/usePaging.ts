import { useCallback, useRef, type Dispatch, type MutableRefObject } from 'react';

import { fetchItems, fetchList, fetchLists } from '../lib/listsApi';
import { foldPage } from './foldPage';
import { initialState, listsReducer } from './listsReducer';
import { replay } from './replay';
import type { Action, List, ListCursors, Stream, WriteAction } from './types';

/**
 * The next page on scroll — of a list's rows, and of the lists themselves — of whichever stream the
 * screen is showing; and one list by id, for a list something needs but has not paged to. Split
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
   * The next page of one stream of one list, on scroll.
   *
   * A read, so it carries none of `refresh`'s guards and may overlap a `hydrate`: a page that lands
   * during one is either included in the re-read `hydrate` does anyway, or dropped by the replace
   * and reloaded on the next scroll — both correct, neither worth a guard. What must not overlap is
   * still a flush and a fetch, and nothing here touches that.
   *
   * Only the stream the screen is showing, since the screen shows one at a time: live mode never
   * asks for a page of the bin, and the bin never for a live one. One list at a time: a scroll fires
   * `onEndReached` more than once, and the second call finds the first in `paging`. A page that
   * fails is silent — the cursor is untouched, so the next scroll simply asks again — since `error`
   * is for a write the database refused, and a read hiccup is not that.
   */
  const loadMore = useCallback(async (listId: string, stream: Stream) => {
    if (paging.current.has(listId)) return;
    const list = listsRef.current.find((candidate) => candidate.id === listId);
    if (!list) return;
    if ((stream === 'live' ? list.nextLive : list.nextBin) === null) return;

    paging.current.add(listId);
    try {
      // One branch per stream, so each cursor is paired with its own stream's name.
      const page =
        stream === 'live'
          ? await fetchItems(listId, 'live', list.nextLive).then(({ items, next }) => ({
              items,
              stream: { name: 'live', next } as const,
            }))
          : await fetchItems(listId, 'bin', list.nextBin).then(({ items, next }) => ({
              items,
              stream: { name: 'bin', next } as const,
            }));
      if (!live.current || !page.items) return;

      foldPage(dispatch, queue, { type: 'items/pageLoaded', listId, items: page.items, stream: page.stream });
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
   * `loadMore` one level up: the next page of lists on the Lists screen's scroll — live, or the bin
   * while "Show deleted" is on, never both. Same rules, for the same reasons: a read, so it may
   * overlap a `hydrate` (the page is either re-read by it or dropped by its replace and asked for
   * again on the next scroll); one request at a time; a failed page is silent and leaves the cursor
   * for the next scroll to retry.
   */
  const loadMoreLists = useCallback(async (stream: Stream) => {
    if (pagingLists.current) return;

    const cursors = listCursorsRef.current;
    if (cursors[stream] === null) return;

    pagingLists.current = true;
    try {
      const page =
        stream === 'live'
          ? await fetchLists('live', cursors.live).then(({ lists, next }) => ({
              lists,
              stream: { name: 'live', next } as const,
            }))
          : await fetchLists('bin', cursors.bin).then(({ lists, next }) => ({
              lists,
              stream: { name: 'bin', next } as const,
            }));
      if (!live.current || !page.lists) return;

      foldPage(dispatch, queue, { type: 'lists/pageLoaded', lists: page.lists, stream: page.stream });
    } finally {
      pagingLists.current = false;
    }
  }, []);

  /**
   * One list by id, folded in with no `stream` so the list cursors stay where they are — for a list
   * that is needed but lies past the pages loaded so far. Somebody else binned it, and more than a
   * page of lists has been binned since — the bin is newest first — so it sorts past the loaded
   * pages of the bin: the target of a blocked write, or the list List detail has open. Resolves to the list it folded in, or `null` when it is not visible to this account (or the
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

