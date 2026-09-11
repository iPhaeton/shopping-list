import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';

import { newId } from '../lib/ids';
import { readCachedLists, writeCachedLists } from '../lib/listCache';
import { subscribeToChanges } from '../lib/listsChannel';
import {
  addItem as addItemRequest,
  fetchItem,
  fetchItems,
  fetchLists,
  insertList,
  MAX_ROWS,
  renameItem as renameItemRequest,
  renameList as renameListRequest,
  setItemDeleted as setItemDeletedRequest,
  setItemDone,
  setListDeleted as setListDeletedRequest,
  type Result,
} from '../lib/listsApi';
import { dropDependents, enqueue, loadOutbox, queueFirst, saveOutbox } from '../lib/outbox';
import { initialState, listsReducer } from './listsReducer';
import { reloadPages } from './reloadPages';
import { replay } from './replay';
import { itemIdOf, listIdOf, restorePlan, type Blocked } from './restorePlan';
import { canEditItems, canManageList } from './roles';
import type { Action, Cursor, List, Stream, WriteAction } from './types';

/** Backoff floor and ceiling. Doubling from one second gets to the cap in six attempts. */
const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

/**
 * How long a nudge from another device waits for company. Somebody adding five items sends five
 * nudges; this collapses them into one fetch, and is short enough that the screen still reads as
 * live.
 */
const NUDGE_DEBOUNCE_MS = 300;

type ListsContextValue = {
  lists: List[];
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
   * The next page of a list's live rows — and of its bin too, when the screen is showing it.
   * Resolves once the page is in state, or at once when there is nothing to load: no cursor, or a
   * page for that list already in flight. A read, so it is safe to call at any time after mount.
   */
  loadMore: (listId: string, includeBin: boolean) => Promise<void>;
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
 */
export function ListsProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [state, dispatch] = useReducer(listsReducer, initialState);
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [blocked, setBlocked] = useState<Blocked | null>(null);

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

  // Realtime's two. `nudge` is the debounce timer collapsing a burst of somebody else's writes;
  // `owed` is a nudge the guards turned away, remembered so it can be honoured later.
  const nudge = useRef<ReturnType<typeof setTimeout> | null>(null);
  const owed = useRef(false);

  // Paging's two. `listsRef` mirrors `state.lists` for the callbacks that must not depend on it
  // (`hydrate` reads how much of each list was loaded; `loadMore` reads the cursors); `paging` is
  // the set of lists with a page in flight, so a scroll that fires twice sends one request.
  const listsRef = useRef(state.lists);
  const paging = useRef(new Set<string>());

  useEffect(() => {
    listsRef.current = state.lists;
  }, [state.lists]);

  useEffect(() => {
    live.current = true;

    return () => {
      live.current = false;
      if (retry.current) clearTimeout(retry.current);
      retry.current = null;
      if (nudge.current) clearTimeout(nudge.current);
      nudge.current = null;
    };
  }, []);

  const persist = useCallback(async () => {
    setPending(queue.current.length);

    try {
      await saveOutbox(userId, queue.current);
    } catch {
      // The queue is still in memory and will still be sent; what is lost is surviving a restart,
      // and that is worth saying out loud rather than pretending the change is safe.
      setError('Could not save your changes on this device — they will be lost if the app closes.');
    }
  }, [userId]);

  /**
   * Server truth, with everything still unsent folded back on top.
   *
   * Unguarded on purpose — the flush loop calls it to roll a refused write back, and that happens
   * with `flushing` set. `refresh` below is the guarded door everyone else comes through.
   *
   * A fetch carries a first page of each list's rows, and `lists/loaded` replaces state wholesale,
   * so this re-reads as many pages as were loaded before — see `reloadPages` — inside the same
   * `fetching` guard, one page per request. "Loaded before" is read from `listsRef`, a mirror of
   * state, rather than from a dependency: `hydrate` is a dependency of `flush`, which is a
   * dependency of everything, and re-creating that chain on every render is how the effects above
   * it start re-subscribing.
   *
   * Returns the array it dispatched, so a caller that needs to know what state holds *now* — the
   * blocked-write path — does not have to wait for React to commit it.
   */
  const hydrate = useCallback(async (): Promise<{ error: string | null; lists: List[] | null }> => {
    fetching.current = true;

    try {
      const { lists: fetched, error: failure, truncated } = await fetchLists();
      if (!live.current || !fetched) return { error: failure, lists: null };

      // Lists are capped, not paged: the read stops at `MAX_ROWS` memberships and PostgREST would
      // stop there silently anyway. A warning is all this earns until somebody is in a thousand
      // lists — see the `(user_id, created_at)` index if that day comes.
      if (truncated && __DEV__) {
        console.warn(`fetchLists hit MAX_ROWS (${MAX_ROWS}); lists beyond the cap are not shown.`);
      }

      const lists = await reloadPages(fetched, listsRef.current, fetchItems);
      if (!live.current) return { error: failure, lists: null };

      const loaded = replay(lists, queue.current);
      dispatch({ type: 'lists/loaded', lists: loaded });
      // The fetched rows, never the replayed view — see `writeCachedLists`.
      void writeCachedLists(userId, lists);
      return { error: failure, lists: loaded };
    } finally {
      fetching.current = false;
    }
  }, [userId]);

  /**
   * A page is server truth, and what the screen shows is server truth with the outbox on top — so
   * the queue goes back over it, exactly as `replay` puts it over a fetch. Through `dispatch`
   * rather than `replay` because a page lands on whatever state holds *now*, and every write
   * action is idempotent by id: re-applying one to a row that already carries it changes nothing,
   * and applying it to a row the page just brought is the point.
   */
  const foldPage = useCallback((action: Extract<Action, { type: 'items/pageLoaded' }>) => {
    dispatch(action);
    for (const queued of queue.current) dispatch(queued);
  }, []);

  /**
   * The row a blocked write landed on, when the fetch did not bring it.
   *
   * `restorePlan` reads the tombstone out of state, and an empty plan means *discard the write*.
   * With a bin longer than a page, the item somebody else binned may be beyond page 1 — the fetch
   * arrives without it, the plan comes back empty, and the user's write is dropped with no banner.
   * So when the op names an item that `loaded` does not hold, read that one row by key and fold it
   * in with no `stream`, leaving the cursors where they are. A row the caller cannot see comes
   * back `null`, and the plan is empty for the same reason it always was: purged, or removed.
   */
  const fetchMissingTarget = useCallback(async (op: WriteAction, loaded: List[] | null) => {
    const itemId = itemIdOf(op);
    if (!itemId || !loaded) return;

    const listId = listIdOf(op);
    const list = loaded.find((candidate) => candidate.id === listId);
    if (!list || list.items.some((item) => item.id === itemId)) return;

    const { item } = await fetchItem(itemId);
    if (!live.current || !item) return;
    foldPage({ type: 'items/pageLoaded', listId, items: [item] });
  }, [foldPage]);

  /**
   * The nudge that arrived while a write of ours was in the air, honoured now that it has landed.
   *
   * Without this the app would be stalest exactly when it is busiest: somebody else editing the list
   * while your own write is retrying is precisely when `refresh` stands down, and a nudge is a
   * one-shot — nothing redelivers it. `hydrate` rather than `refresh` only because `refresh` is
   * defined below this; the guards are re-checked here, which is what `refresh` would have done.
   */
  const drainOwed = useCallback(() => {
    if (!owed.current || flushing.current || retry.current) return;

    owed.current = false;
    void hydrate();
  }, [hydrate]);

  /**
   * Sends the head of the outbox, one at a time, until it is empty or the network refuses to
   * cooperate. Serial on purpose: `items.list_id` is a foreign key, so an item insert must not
   * overtake the list insert it depends on.
   *
   * Never runs alongside a fetch. If they overlapped, a write that completed while the fetch was in
   * flight would be missing from both the response and the queue, and the row would vanish.
   */
  const flush = useCallback(
    async function run(): Promise<void> {
      if (flushing.current || fetching.current || stuck.current) return;
      flushing.current = true;

      try {
        while (live.current && queue.current.length > 0) {
          const op = queue.current[0];
          const { error: message, verdict, outcome } = await send(op);
          if (!live.current) return;

          // The write was accepted and the caller was allowed to make it — there was just nothing
          // live left for it to land on, because somebody put the list or the item in the bin.
          //
          // **Nothing is removed from the queue here, and that is the whole design.** Treating this
          // like a refusal was the first attempt and it is wrong three ways over: `dropDependents`
          // would throw away the tick queued behind an add, so "keep my change" would restore the
          // item unticked; the op would exist only in React state, so a reload before the user
          // answered would lose it; and the loop would carry on to the next write on the same list,
          // overwrite this prompt, and leave a restore queued *behind* a write it was meant to
          // unblock. So: leave it at the head, persist nothing, stop, and ask.
          if (verdict === 'ok' && outcome === 'target_deleted') {
            stuck.current = true;
            attempt.current = 0;
            setError(null);

            // **The fetch comes first, and the order is load-bearing.** The tombstone is somebody
            // else's write, so this device has never seen it; `restorePlan` reading the pre-delete
            // view would find nothing in the bin, conclude there was nothing to offer, and *discard
            // the write* — silently, which is exactly what happened in the browser before this was
            // reordered. Announce the block only once state can answer the question.
            //
            // The op stays queued throughout, so `replay` keeps the optimistic row on screen where
            // it belongs: the write is pending, not refused.
            //
            // Two fetches now, both before the announcement: the tombstone may be beyond the
            // first page of the bin, where the wholesale read does not reach.
            const { lists: loaded } = await hydrate();
            if (!live.current) return;
            await fetchMissingTarget(op, loaded);
            if (!live.current) return;

            setBlocked({ op, listId: listIdOf(op) });
            return;
          }

          if (verdict === 'retryable') {
            if (retry.current) return;

            const delay = Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** attempt.current);
            attempt.current += 1;
            retry.current = setTimeout(() => {
              retry.current = null;
              void run();
            }, delay);
            return;
          }

          // By identity, not by position: a toggle coalesced into the head while this one was in
          // flight is a *different*, newer write, and dropping it by index would lose it.
          const rest = queue.current.filter((candidate) => candidate !== op);
          queue.current = verdict === 'permanent' ? dropDependents(rest, op) : rest;
          await persist();

          if (verdict === 'permanent') {
            setError(message);
            // The one case that still rolls back by re-fetching: the write is never happening, so
            // the screen has to stop showing it.
            await hydrate();
          } else {
            attempt.current = 0;
            setError(null);
          }
        }
      } finally {
        flushing.current = false;
        drainOwed();
      }
    },
    [persist, hydrate, fetchMissingTarget, drainOwed]
  );

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

        foldPage({ type: 'items/pageLoaded', listId, items, stream: { name: stream, next } });
      }
    } finally {
      paging.current.delete(listId);
    }
  }, [foldPage]);

  /**
   * A re-read on demand, for the sharing screen and for coming back to the app.
   *
   * `flush` guards itself against a fetch; nothing guards a fetch against a flush. A read issued
   * while a write is in the air can come back without that write just as the loop removes it from
   * the queue — and the row disappears from the screen until the next fetch. A set `retry` means
   * backoff took over, so we are offline and a fetch would fail anyway.
   */
  const refresh = useCallback(async () => {
    if (flushing.current || retry.current) return;
    owed.current = false;
    await hydrate();
  }, [hydrate]);

  /**
   * Somebody else changed a list you are in. Trailing debounce, so a burst of their writes is one
   * fetch rather than one each.
   *
   * The nudge itself is never applied to state — it says *that* something changed, not what, and the
   * fetch is the mechanism. That is deliberate: `replay` is the only place that knows how server
   * truth and pending writes combine, a dropped message costs staleness while a mis-applied delta
   * costs divergence, and server-stamped values like `done_at` arrive correct only by being read.
   *
   * When the guards `refresh` carries turn the fetch away, the nudge is *remembered* rather than
   * dropped — see `drainOwed`.
   */
  const refreshSoon = useCallback(() => {
    if (nudge.current) return;

    nudge.current = setTimeout(() => {
      nudge.current = null;
      if (flushing.current || retry.current) {
        owed.current = true;
        return;
      }

      void refresh();
    }, NUDGE_DEBOUNCE_MS);
  }, [refresh]);

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
        dispatch({ type: 'lists/loaded', lists: replay(cached, ops) });
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
    if (status === 'ready' && pending === 0) void writeCachedLists(userId, state.lists);
  }, [userId, status, pending, state.lists]);

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
    return subscribeToChanges(userId, refreshSoon, refreshSoon);
  }, [userId, status, refreshSoon]);

  const enqueueOp = useCallback(
    async (op: WriteAction) => {
      queue.current = enqueue(queue.current, op);
      // On disk before the request goes out, so a crash between the two loses nothing.
      await persist();

      // A backoff timer already running means the network just refused us. Another write is not
      // evidence that it came back, so let the timer decide when to try again.
      if (!retry.current) void flush();
    },
    [persist, flush]
  );

  const createList = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return null;

      const id = newId();
      const op: WriteAction = { type: 'list/created', id, name: trimmed };
      dispatch(op);
      void enqueueOp(op);
      return id;
    },
    [enqueueOp]
  );

  /**
   * No id to mint — the list already has one. Renaming is an absolute value like a toggle, so a
   * retry cannot double-apply it and a queued rename can be replaced by a newer one.
   */
  const renameList = useCallback(
    (listId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;

      const list = state.lists.find((candidate) => candidate.id === listId);
      if (!list) return;
      if (!canManageList(list.role)) {
        setError('Only an owner can rename this list.');
        return;
      }

      const op: WriteAction = { type: 'list/renamed', id: listId, name: trimmed };
      dispatch(op);
      void enqueueOp(op);
    },
    [state.lists, enqueueOp]
  );

  const addItem = useCallback(
    (listId: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;

      const list = state.lists.find((candidate) => candidate.id === listId);
      if (!list) return;
      if (!canEditItems(list.role)) {
        setError('You have read-only access to this list.');
        return;
      }

      const op: WriteAction = { type: 'item/added', listId, id: newId(), title: trimmed };
      dispatch(op);
      void enqueueOp(op);
    },
    [state.lists, enqueueOp]
  );

  /**
   * `renameList` one rung down: whoever may add an item may rename one. Same shape too — no id to
   * mint, an absolute value, so a retry cannot double-apply and a queued rename is replaced by a
   * newer one rather than sent twice.
   */
  const renameItem = useCallback(
    (listId: string, itemId: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;

      const list = state.lists.find((candidate) => candidate.id === listId);
      const item = list?.items.find((candidate) => candidate.id === itemId);
      if (!list || !item) return;
      if (!canEditItems(list.role)) {
        setError('You have read-only access to this list.');
        return;
      }

      const op: WriteAction = { type: 'item/renamed', listId, itemId, title: trimmed };
      dispatch(op);
      void enqueueOp(op);
    },
    [state.lists, enqueueOp]
  );

  const toggleItem = useCallback(
    (listId: string, itemId: string) => {
      const list = state.lists.find((candidate) => candidate.id === listId);
      const item = list?.items.find((candidate) => candidate.id === itemId);
      if (!list || !item) return;

      // Unreachable from the UI, which hides the controls a reader may not use. Written anyway,
      // because the next screen to call these will not remember the rule.
      if (!canEditItems(list.role)) {
        setError('You have read-only access to this list.');
        return;
      }

      // The target state, computed here and sent whole. The reducer is never asked to flip, which
      // is also what makes a queued toggle safe to replace with a newer one.
      const done = item.doneAt === null;

      // A placeholder for the optimistic row only — this device's clock does not decide when an
      // item was checked off. The database stamps the real instant, and the next hydration replaces
      // what is dispatched here.
      const doneAt = done ? new Date().toISOString() : null;

      const op: WriteAction = { type: 'item/setDone', listId, itemId, doneAt };
      dispatch(op);
      void enqueueOp(op);
    },
    [state.lists, enqueueOp]
  );

  /**
   * Putting a list in the bin, and taking it back out. Owners only, matching `set_list_deleted`.
   *
   * Like every other write here the value is absolute and the timestamp is a placeholder for the
   * optimistic row: the database stamps the real one, and the next hydration replaces this. That
   * matters more than it does for `doneAt`, because the stored instant is what the nightly purge
   * measures its thirty days against.
   */
  const setListDeleted = useCallback(
    (listId: string, deleted: boolean) => {
      const list = state.lists.find((candidate) => candidate.id === listId);
      if (!list) return;
      if (!canManageList(list.role)) {
        setError('Only an owner can delete or restore this list.');
        return;
      }

      const op: WriteAction = {
        type: 'list/setDeleted',
        id: listId,
        deletedAt: deleted ? new Date().toISOString() : null,
      };
      dispatch(op);
      void enqueueOp(op);
    },
    [state.lists, enqueueOp]
  );

  /** The same one rung down: whoever may add an item may bin one, and may bring it back. */
  const setItemDeleted = useCallback(
    (listId: string, itemId: string, deleted: boolean) => {
      const list = state.lists.find((candidate) => candidate.id === listId);
      const item = list?.items.find((candidate) => candidate.id === itemId);
      if (!list || !item) return;

      if (!canEditItems(list.role)) {
        setError('You have read-only access to this list.');
        return;
      }

      const op: WriteAction = {
        type: 'item/setDeleted',
        listId,
        itemId,
        deletedAt: deleted ? new Date().toISOString() : null,
      };
      dispatch(op);
      void enqueueOp(op);
    },
    [state.lists, enqueueOp]
  );

  /**
   * "Restore it and keep my change."
   *
   * Every tombstone between the user and their write is lifted, not just the first one: an item
   * binned inside a binned list needs both, or the write is blocked again by the item the moment the
   * list comes back — and the user, having already said yes once, would be asked again.
   *
   * The restores go to the **front** of the queue. The blocked write is still queued and still
   * first, so appending them would send it before the thing meant to unblock it and earn the same
   * answer a second time.
   */
  const discardBlocked = useCallback(() => {
    if (!blocked) return;

    // By identity, matching the flush loop: whatever is at the head is the op this prompt is about.
    queue.current = queue.current.filter((candidate) => candidate !== blocked.op);
    stuck.current = false;
    setBlocked(null);
    void persist().then(async () => {
      // The write is never happening, so the screen has to stop showing it. **Awaited**, not fired
      // off: `hydrate` holds `fetching` for its duration and `flush` refuses to run alongside a
      // fetch, so an un-awaited read here would make the flush below a no-op and strand whatever
      // was queued behind the write just discarded.
      await hydrate();
      return flush();
    });
  }, [blocked, persist, hydrate, flush]);

  const restoreBlocked = useCallback(() => {
    if (!blocked) return;

    const restores = restorePlan(state.lists, blocked);
    if (restores.length === 0) {
      discardBlocked();
      return;
    }

    for (const restore of restores) {
      dispatch(restore);
      queue.current = queueFirst(queue.current, restore);
    }

    stuck.current = false;
    setBlocked(null);
    void persist().then(() => flush());
  }, [blocked, state.lists, persist, flush, discardBlocked]);

  /**
   * A blocked write nobody on this account may unblock is dropped rather than left to sit.
   *
   * It has to happen here rather than in the banner, which could only decline to render: the write
   * is still the head of the outbox and the flush loop is stopped while it is, so a prompt that is
   * merely invisible would stall every write behind it. This is the writer's half of the brief —
   * their write to a list an owner binned just drops — and it is also what stops the prompt looping
   * when a restore is itself refused, because the fetch that follows the refusal carries the role
   * that refused it.
   */
  useEffect(() => {
    if (!blocked) return;
    if (restorePlan(state.lists, blocked).length > 0) return;

    discardBlocked();
  }, [blocked, state.lists, discardBlocked]);

  const value = useMemo(
    () => ({
      lists: state.lists,
      userId,
      status,
      error,
      pending,
      blocked,
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
    }),
    [
      state.lists,
      userId,
      status,
      error,
      pending,
      blocked,
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
    ]
  );

  return <ListsContext.Provider value={value}>{children}</ListsContext.Provider>;
}

/**
 * The queued action carries everything the request needs, so this is the whole mapping from "a
 * write" to "a call". The boolean is derived rather than stored: `doneAt` on the action is the
 * optimistic row's placeholder, and only the database's clock decides the real one.
 */
function send(op: WriteAction): Promise<Result> {
  switch (op.type) {
    case 'list/created':
      return insertList(op.id, op.name);

    case 'list/renamed':
      return renameListRequest(op.id, op.name);

    case 'list/setDeleted':
      return setListDeletedRequest(op.id, op.deletedAt !== null);

    case 'item/added':
      return addItemRequest(op.id, op.listId, op.title);

    case 'item/renamed':
      return renameItemRequest(op.itemId, op.title);

    case 'item/setDone':
      return setItemDone(op.itemId, op.doneAt !== null);

    // The boolean is derived at send time, exactly as `doneAt` is: what is queued is the value the
    // row should have, so a coalesced delete-then-restore sends one request saying "not deleted".
    case 'item/setDeleted':
      return setItemDeletedRequest(op.itemId, op.deletedAt !== null);
  }
}

export function useLists(): ListsContextValue {
  const value = useContext(ListsContext);
  if (!value) throw new Error('useLists must be used inside a <ListsProvider>');
  return value;
}
