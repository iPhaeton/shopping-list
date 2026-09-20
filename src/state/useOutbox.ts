import { useCallback, type Dispatch, type MutableRefObject } from 'react';

import { fetchItem } from '../lib/listsApi';
import { dropDependents, enqueue, saveOutbox } from '../lib/outbox';
import { foldPage } from './foldPage';
import { itemIdOf, listIdOf, type Blocked } from './restorePlan';
import { sendWrite } from './sendWrite';
import type { Action, List, WriteAction } from './types';

/** Backoff floor and ceiling. Doubling from one second gets to the cap in six attempts. */
const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

/**
 * The outbox: saving it to disk, sending its head, and queuing a new write onto it. Split out of
 * `ListsContext` because this cluster shares one job — getting a write from the screen onto the
 * database, retried until it lands — while `useHydration` is a different job this one merely calls
 * into. None of `flushing`/`retry`/`attempt`/`stuck` can be owned here: `flushing`/`retry` are read
 * by `useHydration`'s `refresh`/`drainDirty` guards, `stuck` is read/written by `useBlockedWrites`,
 * and `retry`/`attempt` are also reset directly by the foreground-resume effect in `ListsContext` —
 * all four stay refs created there and threaded in.
 */
export function useOutbox({
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
  drainDirty,
  setError,
  setBlocked,
  setPending,
  onSessionRevoked,
}: {
  userId: string;
  dispatch: Dispatch<Action>;
  queue: MutableRefObject<WriteAction[]>;
  live: MutableRefObject<boolean>;
  fetching: MutableRefObject<boolean>;
  flushing: MutableRefObject<boolean>;
  retry: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  attempt: MutableRefObject<number>;
  stuck: MutableRefObject<boolean>;
  hydrate: () => Promise<{ error: string | null; lists: List[] | null }>;
  drainDirty: () => void;
  setError: (message: string | null) => void;
  setBlocked: (blocked: Blocked | null) => void;
  setPending: (pending: number) => void;
  /** This device's session was revoked elsewhere; sign it out locally instead of banner-ing the write. */
  onSessionRevoked: () => void;
}) {
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
   * The row a blocked write landed on, when the fetch did not bring it.
   *
   * `restorePlan` reads the tombstone out of state, and an empty plan means *discard the write*.
   * `fetchLists` carries no items at all now, so this fires for essentially every blocked write on
   * a list that is not currently (or was not previously) open — read that one row by key and fold
   * it in with no `stream`, leaving the cursors where they are. A row the caller cannot see comes
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
    foldPage(dispatch, queue, { type: 'items/pageLoaded', listId, items: [item] });
  }, []);

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
          const { error: message, verdict, outcome, sessionRevoked } = await sendWrite(op);
          if (!live.current) return;

          // The write itself is fine; only this device's credentials are stale. Leave it queued —
          // signing back in reloads the outbox from disk and retries it, same as any other unsent
          // write across a sign-out — and let the redirect happen instead of banner-ing a message
          // nobody will be looking at the screen to read.
          if (sessionRevoked) {
            onSessionRevoked();
            return;
          }

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
        drainDirty();
      }
    },
    [persist, hydrate, fetchMissingTarget, drainDirty, onSessionRevoked]
  );

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

  return { persist, flush, enqueueOp };
}
