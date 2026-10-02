import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';

import { readCachedLists, writeCachedLists } from '../lib/listCache';
import { subscribeToChanges } from '../lib/listsChannel';
import { loadOutbox } from '../lib/outbox';
import { initialState, listsReducer } from './listsReducer';
import { replayState } from './replay';
import type { Blocked } from './restorePlan';
import type { List, ListCounts, ListCursors, Stream, WriteAction } from './types';
import { useBlockedWrites } from './useBlockedWrites';
import { useHydration } from './useHydration';
import { useListWrites } from './useListWrites';
import { useOutbox } from './useOutbox';
import { usePaging } from './usePaging';

type ListsContextValue = {
  lists: List[];
  /**
   * Where the next page of each stream of lists starts, `null` once that stream has ended. The Lists
   * screen reads them to know whether a scroll has more to fetch, and whether the bin count is only
   * what is loaded so far.
   */
  listCursors: ListCursors;
  /**
   * How many live lists you own and are on in total — the database's last word plus this device's
   * own writes since. Approximate, and only for warning before the tap: the Lists screen swaps its
   * Create bar for a sentence at either limit. The database is what enforces them.
   */
  listCounts: ListCounts;
  /** Whose lists these are. The sharing screen needs it to tell your own roster row from the rest. */
  userId: string;
  /** `loading` until there is something to show — a cached copy, or the first fetch settling. */
  status: 'loading' | 'ready';
  /** The last write the database *refused*, for the screen to render. Cleared by the next success. */
  error: string | null;
  /** Writes the database has not acknowledged yet. `0` means everything is saved. */
  pending: number;
  /**
   * A queued write that landed on something in the bin, waiting for the user to say what to do.
   *
   * Distinct from `error` because nothing went wrong and nothing has been thrown away: the write is
   * still at the head of the outbox, still on disk, and either `restoreBlocked` or `discardBlocked`
   * will move it. The flush loop is stopped while this is set.
   */
  blocked: Blocked | null;
  /** The most recent realtime nudge, for a screen with its own un-cached state (only
   * `SharingScreen`'s roster, today) to know when to re-read. `listId` is undefined for a
   * resubscribe or malformed payload — the same "might have missed something, re-check everything"
   * signal `refreshSoon()` already treats as `dirty = 'all'`. A fresh object every time, even for the
   * same listId twice in a row, so an effect keyed on it always re-fires. */
  lastNudge: { listId: string | undefined } | null;
  /** Returns the id of the new list, or null when `name` was blank. */
  createList: (name: string) => string | null;
  renameList: (listId: string, name: string) => void;
  addItem: (listId: string, title: string) => void;
  renameItem: (listId: string, itemId: string, title: string) => void;
  toggleItem: (listId: string, itemId: string) => void;
  setListDeleted: (listId: string, deleted: boolean) => void;
  setItemDeleted: (listId: string, itemId: string, deleted: boolean) => void;
  /** Lifts every tombstone in the blocked write's way, then lets it through. */
  restoreBlocked: () => void;
  /** Gives up on the blocked write and drops it. */
  discardBlocked: () => void;
  /** Server truth again, on demand. A read, so it is safe to call at any time after mount. */
  refresh: () => Promise<void>;
  /**
   * The next page of one stream of a list's rows — whichever the screen is showing, the live rows or
   * the bin. Resolves once the page is in state, or at once when there is nothing to load: no cursor,
   * or a page for that list already in flight. A read, so it is safe to call at any time after mount.
   */
  loadMore: (listId: string, stream: Stream) => Promise<void>;
  /**
   * A list's first page of both streams — call this on entering it. A no-op once `itemsLoaded` is
   * already true, or while a fetch for that list is already in flight. A read, so it is safe to
   * call at any time after mount.
   */
  loadListItems: (listId: string) => Promise<void>;
  /**
   * The next page of one stream of lists — live, or the bin while the screen is showing it. Resolves
   * once the page is in state, or at once when there is nothing to load: no cursor, or a page already
   * in flight. A read, so it is safe to call at any time after mount.
   */
  loadMoreLists: (stream: Stream) => Promise<void>;
  /**
   * One list by id, for a screen whose list is not in state — it can sort past the pages loaded so
   * far once somebody else bins it. Resolves to the list, or `null` when this account cannot see it.
   * A read, so it is safe to call at any time after mount.
   */
  loadList: (listId: string) => Promise<List | null>;
};

export type { Blocked } from './restorePlan';

const ListsContext = createContext<ListsContextValue | null>(null);

/**
 * The only file that persists list data. The reducer stays pure and the screens keep reading
 * through `useLists()`, so neither knows the state came from Postgres.
 *
 * Mounted only while signed in (see `App.tsx`), which is why nothing here consults the session:
 * there is always a token, sign-out unmounts the provider and discards the state with it, and
 * row-level security — not a filter written here — is what keeps one account's lists private. The
 * `userId` prop is for the two storage keys below, not for authorization.
 *
 * **A write is not lost when it fails.** It is dispatched, written to the outbox on disk, and then
 * sent; if the send fails for any reason short of a refusal, it stays queued and is retried until
 * it lands — across backgrounding, across a restart, across days of no signal. What the screen
 * shows is always server truth with the outbox replayed on top, so a pending write is visible long
 * before the database has it, and a refused one disappears when the re-fetch arrives.
 *
 * The fetch/retry/paging machinery that makes this true lives one level down, in three hooks this
 * component wires together: `useHydration` (server reads), `useOutbox` (the queue and its flush
 * loop), `usePaging` (scrolling, through the lists and through a list's own rows). They share refs
 * rather than a shared object because each ref's readers and writers cross hook boundaries in
 * different directions — see each hook's own comment for which.
 */
export function ListsProvider({
  userId,
  onSessionRevoked,
  children,
}: {
  userId: string;
  /** A write was refused because this device's session was revoked elsewhere — hand off to the
   * caller, which owns `useSession()`; this provider stays session-agnostic (see the comment above). */
  onSessionRevoked: () => void;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(listsReducer, initialState);
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [lastNudge, setLastNudge] = useState<{ listId: string | undefined } | null>(null);

  // The outbox in memory, and the flush loop's own bookkeeping. Refs rather than state because the
  // loop reads them between awaits and has to see what was enqueued while it was waiting.
  const queue = useRef<WriteAction[]>([]);
  const flushing = useRef(false);
  const fetching = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempt = useRef(0);
  const live = useRef(true);

  // The mirror of `blocked` that the loop can read between awaits. The loop stops while it is set —
  // the write it is about is still the head of the queue, and re-sending it would only earn the same
  // answer — so this is a guard beside `flushing`/`fetching` rather than a piece of screen state.
  const stuck = useRef(false);

  // Mirrors `state.lists` for callbacks that must not depend on it directly — `useHydration` reads
  // how much of each list was loaded, `usePaging` reads the cursors — so it is shared between them
  // rather than owned by either.
  const listsRef = useRef(state.lists);

  useEffect(() => {
    listsRef.current = state.lists;
  }, [state.lists]);

  // The same mirror for the list cursors: `useHydration` reads which lists fall inside the loaded
  // range, `usePaging` where the next page of lists starts.
  const listCursorsRef = useRef(state.listCursors);

  useEffect(() => {
    listCursorsRef.current = state.listCursors;
  }, [state.listCursors]);

  // The same mirror, for `flush`: `useHydration` runs before `useOutbox`, so `hydrate`'s own
  // `finally` cannot close over `flush` directly — `flush` is built from `hydrate` one hook later,
  // and closing over it would make a dependency cycle. Kept current the same way `listsRef` is,
  // once `useOutbox` produces the real function below.
  const flushRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    live.current = true;

    return () => {
      live.current = false;
      if (retry.current) clearTimeout(retry.current);
      retry.current = null;
    };
  }, []);

  const { loadMore, loadListItems, loadMoreLists, loadList } = usePaging({
    listsRef,
    listCursorsRef,
    live,
    dispatch,
    queue,
  });

  const { hydrate, refresh, refreshSoon, drainDirty } = useHydration({
    userId,
    dispatch,
    queue,
    live,
    listsRef,
    listCursorsRef,
    fetching,
    flushing,
    retry,
    flushRef,
  });

  const { persist, flush, enqueueOp } = useOutbox({
    userId,
    dispatch,
    queue,
    live,
    fetching,
    flushing,
    retry,
    attempt,
    stuck,
    hydrate,
    loadList,
    drainDirty,
    setError,
    setBlocked,
    setPending,
    onSessionRevoked,
  });

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const { createList, renameList, addItem, renameItem, toggleItem, setListDeleted, setItemDeleted } =
    useListWrites({ lists: state.lists, dispatch, enqueueOp, setError });

  const { restoreBlocked, discardBlocked } = useBlockedWrites({
    blocked,
    setBlocked,
    lists: state.lists,
    dispatch,
    queue,
    stuck,
    persist,
    hydrate,
    flush,
  });

  // Hydrate: the outbox and the cached rows first, so the app is usable with no network at all,
  // then the database.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [ops, cached] = await Promise.all([loadOutbox(userId), readCachedLists(userId)]);
      if (cancelled) return;

      queue.current = ops;
      setPending(ops.length);

      if (cached) {
        const { lists, listCounts } = replayState(
          { lists: cached.lists, listCursors: cached.cursors, listCounts: cached.counts },
          ops
        );
        dispatch({ type: 'lists/loaded', lists, cursors: cached.cursors, counts: listCounts });
        // Synchronously, as `hydrate` does after its own dispatch: `hydrate` below counts how many
        // lists were loaded from these refs before its first await, and the mirroring effects have
        // not run yet — without this a cold start would re-read one page of lists, not as many as
        // were cached.
        listsRef.current = lists;
        listCursorsRef.current = cached.cursors;
        setStatus('ready');
      }

      const { error: failure } = await hydrate();
      if (cancelled) return;

      // A failed read is only worth a banner when there is nothing to show instead of an answer.
      if (failure && !cached) setError(failure);
      setStatus('ready');

      void flush();
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, hydrate, flush]);

  // Keep the cached copy current. A fetch only happens on mount, so caching *only* what a fetch
  // returned leaves the next cold start showing the app as it was when it last started — which is
  // to say, without anything written since. With nothing pending, every row on screen has been
  // acknowledged by the database, so this is server truth by another route.
  useEffect(() => {
    if (status === 'ready' && pending === 0) {
      void writeCachedLists(userId, state.lists, state.listCursors, state.listCounts);
    }
  }, [userId, status, pending, state.lists, state.listCursors, state.listCounts]);

  /**
   * Coming back to the app: send whatever is queued, then re-read.
   *
   * Backoff is a floor, not a schedule — when the OS says the app is in front, or the browser says
   * the network is back, there is no reason to keep waiting. The re-read is new with sharing: the
   * fetch used to happen only on mount, which was fine while you were the only writer, but a list
   * somebody else changed an hour ago would stay stale until a cold start and read as sharing being
   * broken. `refresh` is the guarded one, so it stands down if the flush it just ran is still going.
   */
  useEffect(() => {
    const resume = () => {
      if (retry.current) clearTimeout(retry.current);
      retry.current = null;
      attempt.current = 0;

      void (async () => {
        await flush();
        await refresh();
      })();
    };

    if (Platform.OS === 'web') {
      // `online` fires when connectivity changes; on the web the foreground event that matters is
      // coming back to the tab, and neither implies the other.
      const onVisible = () => {
        if (document.visibilityState === 'visible') resume();
      };

      window.addEventListener('online', resume);
      document.addEventListener('visibilitychange', onVisible);
      return () => {
        window.removeEventListener('online', resume);
        document.removeEventListener('visibilitychange', onVisible);
      };
    }

    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') resume();
    });
    return () => subscription.remove();
  }, [flush, refresh]);

  /**
   * Somebody else's change, as it happens, instead of whenever this app next comes to the front.
   *
   * The effect above stays exactly as it was, and that is the point: this is an optimisation over a
   * path that already works. A socket that never connects, or a message dropped in flight, costs
   * latency rather than correctness, because the foreground re-fetch is still there to repair it.
   *
   * Gated on `'ready'` because a fetch before the mount hydration has settled would race it, and
   * `lists/loaded` replaces list state wholesale.
   */
  useEffect(() => {
    if (status !== 'ready') return;
    const onNudge = (listId?: string) => {
      refreshSoon(listId);
      setLastNudge({ listId });
    };
    return subscribeToChanges(userId, onNudge, onNudge);
  }, [userId, status, refreshSoon]);

  const value = useMemo(
    () => ({
      lists: state.lists,
      listCursors: state.listCursors,
      listCounts: state.listCounts,
      userId,
      status,
      error,
      pending,
      blocked,
      lastNudge,
      createList,
      renameList,
      addItem,
      renameItem,
      toggleItem,
      setListDeleted,
      setItemDeleted,
      restoreBlocked,
      discardBlocked,
      refresh,
      loadMore,
      loadListItems,
      loadMoreLists,
      loadList,
    }),
    [
      state.lists,
      state.listCursors,
      state.listCounts,
      userId,
      status,
      error,
      pending,
      blocked,
      lastNudge,
      createList,
      renameList,
      addItem,
      renameItem,
      toggleItem,
      setListDeleted,
      setItemDeleted,
      restoreBlocked,
      discardBlocked,
      refresh,
      loadMore,
      loadListItems,
      loadMoreLists,
      loadList,
    ]
  );

  return <ListsContext.Provider value={value}>{children}</ListsContext.Provider>;
}

export function useLists(): ListsContextValue {
  const value = useContext(ListsContext);
  if (!value) throw new Error('useLists must be used inside a <ListsProvider>');
  return value;
}
