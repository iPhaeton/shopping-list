import { useCallback, useRef, type Dispatch, type MutableRefObject } from 'react';

import { fetchItems, fetchList, fetchLists } from '../lib/listsApi';
import { foldPage } from './foldPage';
import { initialState, listsReducer, liveItems, liveLists } from './listsReducer';
import { replay } from './replay';
import type { Action, List, ListCursors, Stream, WriteAction } from './types';

/**
 * Where completing a stream stops: 2,000 live rows held — 20 pages of lists, 5 of items. Not
 * "bounded by the limits": the database accepts overshoot, and an account already past a limit keeps
 * everything, so the loop needs its own stop.
 */
export const COMPLETION_CAP = 2000;

/** How a page read ended. `skipped`: nothing to read — no cursor, or a page already in flight. */
export type PageOutcome = 'loaded' | 'failed' | 'skipped';

/**
 * How completing a stream ended. `complete`: its cursor is `null`, every live row is held. `failed`:
 * a page failed, and the loop stopped there. `capped`: {@link COMPLETION_CAP} rows are held. `stopped`:
 * the screen that asked stopped needing it, or the provider unmounted.
 */
export type Completion = 'complete' | 'failed' | 'capped' | 'stopped';

/** The page actions, which all fold the same way. */
type PageAction = Extract<
  Action,
  { type: 'lists/pageLoaded' } | { type: 'items/pageLoaded' } | { type: 'items/firstPageLoaded' }
>;

/**
 * Runs `work` as the one request in flight under `key`, so another caller can find it and wait for
 * it. Registered before `work`'s cleanup can run: `finally` always runs a microtask later.
 */
function single<T>(inFlight: Map<string, Promise<unknown>>, key: string, work: () => Promise<T>): Promise<T> {
  const running = work().finally(() => inFlight.delete(key));
  inFlight.set(key, running);
  return running;
}

/** The lists have one guard for both streams, kept in a map of its own under this key. */
const LISTS = 'lists';

/**
 * The next page on scroll — of a list's rows, and of the lists themselves — of whichever stream the
 * screen is showing; every remaining live page, for a search or sort that needs the whole stream;
 * and one list by id, for a list something needs but has not paged to. Split out of `ListsContext`
 * because, unlike the fetch/retry core around `hydrate`/`flush`, paging shares no guard with either:
 * it reads `listsRef`/`listCursorsRef`/`live` and folds a page in through `foldPage`, and that is
 * the whole surface it needs.
 *
 * **Every page it folds sets `listsRef`/`listCursorsRef` at once**, by running the same reducer
 * over them, as `hydrate` does after its own dispatch: the mirroring effects lag a commit, and a
 * child's effects run before the provider's. The completion loop reads its next cursor from the
 * refs, and so does a screen's effect started in the commit a page lands in.
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
  // The page in flight for each list, so a scroll that fires `onEndReached` twice sends one request,
  // and the completion loop can wait for a page somebody else asked for instead of asking again.
  const paging = useRef(new Map<string, Promise<unknown>>());
  // The same for the lists themselves — one screen, so one entry, under `LISTS`.
  const pagingLists = useRef(new Map<string, Promise<unknown>>());

  const fold = useCallback((action: PageAction) => {
    foldPage(dispatch, queue, action);
    const next = listsReducer(
      { ...initialState, lists: listsRef.current, listCursors: listCursorsRef.current },
      action
    );
    listsRef.current = replay(next.lists, queue.current);
    listCursorsRef.current = next.listCursors;
  }, []);

  /**
   * The next page of one stream of one list.
   *
   * A read, so it carries none of `refresh`'s guards and may overlap a `hydrate`. The page carries
   * the cursor it was read from, and the reducer folds it only if state's cursor still equals it:
   * a page that lands after a `hydrate` replaced state is either already in that re-read or past a
   * page the replace dropped, and is discarded either way rather than leaving a gap. What must not
   * overlap is still a flush and a fetch, and nothing here touches that.
   *
   * Only the stream the screen is showing, since the screen shows one at a time: live mode never
   * asks for a page of the bin, and the bin never for a live one. One list at a time: a scroll fires
   * `onEndReached` more than once, and the second call finds the first in `paging`. A page that
   * fails leaves the cursor untouched, so the next scroll simply asks again; `error` is for a write
   * the database refused, and a read hiccup is not that. It is reported, though, for the completion
   * loop, which must stop at the first failure rather than ask again at once.
   */
  const loadMore = useCallback(async (listId: string, stream: Stream): Promise<PageOutcome> => {
    if (paging.current.has(listId)) return 'skipped';
    const list = listsRef.current.find((candidate) => candidate.id === listId);
    if (!list) return 'skipped';
    if ((stream === 'live' ? list.nextLive : list.nextBin) === null) return 'skipped';

    return single(paging.current, listId, async () => {
      // One branch per stream, so each cursor is paired with its own stream's name.
      const page =
        stream === 'live'
          ? await fetchItems(listId, 'live', list.nextLive).then(({ items, next }) => ({
              items,
              stream: { name: 'live', next } as const,
              after: list.nextLive,
            }))
          : await fetchItems(listId, 'bin', list.nextBin).then(({ items, next }) => ({
              items,
              stream: { name: 'bin', next } as const,
              after: list.nextBin,
            }));
      if (!page.items) return 'failed';
      if (!live.current) return 'skipped';

      fold({ type: 'items/pageLoaded', listId, items: page.items, stream: page.stream, after: page.after });
      return 'loaded';
    });
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

    await single(paging.current, listId, async () => {
      const [liveResult, binResult] = await Promise.all([
        fetchItems(listId, 'live', null),
        fetchItems(listId, 'bin', null),
      ]);
      if (!live.current) return;
      if (liveResult.items === null || binResult.items === null) return;

      fold({
        type: 'items/firstPageLoaded',
        listId,
        live: { items: liveResult.items, next: liveResult.next },
        bin: { items: binResult.items, next: binResult.next },
      });
    });
  }, []);

  /**
   * `loadMore` one level up: the next page of lists on the Lists screen's scroll — live, or the bin
   * while "Show deleted" is on, never both. Same rules, for the same reasons: a read, so it may
   * overlap a `hydrate` (the page lands only if it continues state's cursor); one request at a time;
   * a failed page leaves the cursor for the next scroll to retry, and says so.
   */
  const loadMoreLists = useCallback(async (stream: Stream): Promise<PageOutcome> => {
    if (pagingLists.current.has(LISTS)) return 'skipped';

    const cursors = listCursorsRef.current;
    if (cursors[stream] === null) return 'skipped';

    return single(pagingLists.current, LISTS, async () => {
      const page =
        stream === 'live'
          ? await fetchLists('live', cursors.live).then(({ lists, next }) => ({
              lists,
              stream: { name: 'live', next } as const,
              after: cursors.live,
            }))
          : await fetchLists('bin', cursors.bin).then(({ lists, next }) => ({
              lists,
              stream: { name: 'bin', next } as const,
              after: cursors.bin,
            }));
      if (!page.lists) return 'failed';
      if (!live.current) return 'skipped';

      fold({ type: 'lists/pageLoaded', lists: page.lists, stream: page.stream, after: page.after });
      return 'loaded';
    });
  }, []);

  /**
   * Every remaining page of one list's live rows, for a search or a sort that is only right over all
   * of them. One page at a time at the normal size, until the cursor is `null`.
   *
   * - **Each round reads the cursor from state** (the refs), never one it carried: a `hydrate` may
   *   have replaced state since the last page, as deep as state was when *it* started. The page then
   *   lands only if it still continues that cursor.
   * - **It stops at the first failed page.** Offline, every request fails almost at once, so asking
   *   again would be a request loop; one failed page is one request. The screen restarts it.
   * - **It stops at {@link COMPLETION_CAP} rows held**, checked before each request, so a list
   *   already past it costs no request at all.
   * - A page already in flight — a scroll's, or the first page's — is waited for, never doubled, and
   *   never counted as this loop's failure.
   * - It stops between pages once `signal` aborts. A page already asked for still lands.
   */
  const loadAllItems = useCallback(async (listId: string, signal: AbortSignal): Promise<Completion> => {
    for (;;) {
      if (!live.current || signal.aborted) return 'stopped';

      const inFlight = paging.current.get(listId);
      if (inFlight) {
        await inFlight.catch(() => undefined);
        continue;
      }

      const list = listsRef.current.find((candidate) => candidate.id === listId);
      if (!list?.itemsLoaded) return 'stopped';
      if (list.nextLive === null) return 'complete';
      if (liveItems(list).length >= COMPLETION_CAP) return 'capped';

      if ((await loadMore(listId, 'live')) === 'failed') return 'failed';
    }
  }, [loadMore]);

  /** `loadAllItems` one level up: every remaining page of live lists, by the same rules. */
  const loadAllLists = useCallback(async (signal: AbortSignal): Promise<Completion> => {
    for (;;) {
      if (!live.current || signal.aborted) return 'stopped';

      const inFlight = pagingLists.current.get(LISTS);
      if (inFlight) {
        await inFlight.catch(() => undefined);
        continue;
      }

      if (listCursorsRef.current.live === null) return 'complete';
      if (liveLists(listsRef.current).length >= COMPLETION_CAP) return 'capped';

      if ((await loadMoreLists('live')) === 'failed') return 'failed';
    }
  }, [loadMoreLists]);

  /**
   * One list by id, folded in with no `stream` so the list cursors stay where they are — for a list
   * that is needed but lies past the pages loaded so far. Somebody else binned it, and more than a
   * page of lists has been binned since — the bin is newest first — so it sorts past the loaded
   * pages of the bin: the target of a blocked write, or the list List detail has open. Resolves to
   * the list it folded in, or `null` when it is not visible to this account (or the read failed), so
   * a caller can go on to what hangs off it.
   *
   * Mirrored into `listsRef` at once by `fold`: List detail's mount effect asks `loadListItems` for
   * this list's items in the very commit it appears, and that looks the list up in `listsRef` —
   * which the provider's mirroring effect updates only after the child's effect has already run.
   */
  const loadList = useCallback(async (listId: string): Promise<List | null> => {
    const { list } = await fetchList(listId);
    if (!live.current || !list) return null;

    fold({ type: 'lists/pageLoaded', lists: [list] });
    return list;
  }, []);

  return { loadMore, loadListItems, loadMoreLists, loadAllItems, loadAllLists, loadList };
}
