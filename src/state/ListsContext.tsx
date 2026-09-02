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
import { fetchLists, insertItem, insertList, setItemDone, type Result } from '../lib/listsApi';
import { dropDependents, enqueue, loadOutbox, saveOutbox } from '../lib/outbox';
import { initialState, listsReducer } from './listsReducer';
import { replay } from './replay';
import type { List, WriteAction } from './types';

/** Backoff floor and ceiling. Doubling from one second gets to the cap in six attempts. */
const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

type ListsContextValue = {
  lists: List[];
  /** `loading` until there is something to show — a cached copy, or the first fetch settling. */
  status: 'loading' | 'ready';
  /** The last write the database *refused*, for the screen to render. Cleared by the next success. */
  error: string | null;
  /** Writes the database has not acknowledged yet. `0` means everything is saved. */
  pending: number;
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

  // The outbox in memory, and the flush loop's own bookkeeping. Refs rather than state because the
  // loop reads them between awaits and has to see what was enqueued while it was waiting.
  const queue = useRef<WriteAction[]>([]);
  const flushing = useRef(false);
  const fetching = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempt = useRef(0);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;

    return () => {
      live.current = false;
      if (retry.current) clearTimeout(retry.current);
      retry.current = null;
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

  /** Server truth, with everything still unsent folded back on top. */
  const refresh = useCallback(async () => {
    fetching.current = true;

    try {
      const { lists, error: failure } = await fetchLists();
      if (!live.current || !lists) return failure;

      dispatch({ type: 'lists/loaded', lists: replay(lists, queue.current) });
      // The fetched rows, never the replayed view — see `writeCachedLists`.
      void writeCachedLists(userId, lists);
      return failure;
    } finally {
      fetching.current = false;
    }
  }, [userId]);

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
      if (flushing.current || fetching.current) return;
      flushing.current = true;

      try {
        while (live.current && queue.current.length > 0) {
          const op = queue.current[0];
          const { error: message, verdict } = await send(op);
          if (!live.current) return;

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
            await refresh();
          } else {
            attempt.current = 0;
            setError(null);
          }
        }
      } finally {
        flushing.current = false;
      }
    },
    [persist, refresh]
  );

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

      const failure = await refresh();
      if (cancelled) return;

      // A failed read is only worth a banner when there is nothing to show instead of an answer.
      if (failure && !cached) setError(failure);
      setStatus('ready');

      void flush();
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, refresh, flush]);

  // Keep the cached copy current. A fetch only happens on mount, so caching *only* what a fetch
  // returned leaves the next cold start showing the app as it was when it last started — which is
  // to say, without anything written since. With nothing pending, every row on screen has been
  // acknowledged by the database, so this is server truth by another route.
  useEffect(() => {
    if (status === 'ready' && pending === 0) void writeCachedLists(userId, state.lists);
  }, [userId, status, pending, state.lists]);

  // Backoff is a floor, not a schedule. When the OS says the app is back in front, or the browser
  // says the network is back, there is no reason to keep waiting.
  useEffect(() => {
    const resume = () => {
      if (retry.current) clearTimeout(retry.current);
      retry.current = null;
      attempt.current = 0;
      void flush();
    };

    if (Platform.OS === 'web') {
      window.addEventListener('online', resume);
      return () => window.removeEventListener('online', resume);
    }

    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') resume();
    });
    return () => subscription.remove();
  }, [flush]);

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

  const addItem = useCallback(
    (listId: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;

      const op: WriteAction = { type: 'item/added', listId, id: newId(), title: trimmed };
      dispatch(op);
      void enqueueOp(op);
    },
    [enqueueOp]
  );

  const toggleItem = useCallback(
    (listId: string, itemId: string) => {
      const item = state.lists
        .find((list) => list.id === listId)
        ?.items.find((candidate) => candidate.id === itemId);
      if (!item) return;

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

  const value = useMemo(
    () => ({ lists: state.lists, status, error, pending, createList, addItem, toggleItem }),
    [state.lists, status, error, pending, createList, addItem, toggleItem]
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

    case 'item/added':
      return insertItem(op.id, op.listId, op.title);

    case 'item/setDone':
      return setItemDone(op.itemId, op.doneAt !== null);
  }
}

export function useLists(): ListsContextValue {
  const value = useContext(ListsContext);
  if (!value) throw new Error('useLists must be used inside a <ListsProvider>');
  return value;
}
