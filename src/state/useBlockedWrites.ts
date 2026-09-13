import { useCallback, useEffect, type Dispatch, type MutableRefObject } from 'react';

import { queueFirst } from '../lib/outbox';
import { restorePlan, type Blocked } from './restorePlan';
import type { Action, List, WriteAction } from './types';

/**
 * What to do about a write that landed on a tombstone — "restore it and keep my change", or give up
 * on it. Split out of `ListsContext` because, unlike the sync engine around `flush`/`hydrate`, this
 * corner only needs to read `blocked` and `lists` and act through `dispatch`/the outbox refs; it
 * shares no ordering constraint with the fetch/retry loop beyond calling `persist`/`hydrate`/`flush`
 * once it is done.
 */
export function useBlockedWrites({
  blocked,
  setBlocked,
  lists,
  dispatch,
  queue,
  stuck,
  persist,
  hydrate,
  flush,
}: {
  blocked: Blocked | null;
  setBlocked: (blocked: Blocked | null) => void;
  lists: List[];
  dispatch: Dispatch<Action>;
  queue: MutableRefObject<WriteAction[]>;
  stuck: MutableRefObject<boolean>;
  persist: () => Promise<void>;
  hydrate: () => Promise<{ error: string | null; lists: List[] | null }>;
  flush: () => Promise<void>;
}) {
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

    const restores = restorePlan(lists, blocked);
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
  }, [blocked, lists, persist, flush, discardBlocked]);

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
    if (restorePlan(lists, blocked).length > 0) return;

    discardBlocked();
  }, [blocked, lists, discardBlocked]);

  return { restoreBlocked, discardBlocked };
}
