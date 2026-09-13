import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject } from 'react';

import { fetchItem, fetchItems, fetchList, fetchLists, MAX_ROWS } from '../lib/listsApi';
import { writeCachedLists } from '../lib/listCache';
import { reloadPages } from './reloadPages';
import { replay } from './replay';
import type { Action, List, WriteAction } from './types';

/**
 * How long a nudge from another device waits for company. Somebody adding five items sends five
 * nudges; this collapses them into one fetch, and is short enough that the screen still reads as
 * live.
 */
const NUDGE_DEBOUNCE_MS = 300;

/**
 * Server truth, and the two ways the provider asks for it: `hydrate` (everything) and `hydrateLists`
 * (one or more named lists, for a realtime nudge that says which). Split out of `ListsContext`
 * because this cluster shares one set of guards and one job — deciding when a re-read is safe and
 * folding its answer into state — while `flush` (now in `useOutbox`) is a different job that merely
 * calls into this one. `fetching`/`flushing`/`retry` are passed in rather than owned here: `fetching`
 * is written in this hook but read by `useOutbox`'s flush guard, and `flushing`/`retry` are written
 * there but read here by `refresh`'s and `drainDirty`'s guards — shared bidirectionally, so both
 * hooks receive them from `ListsContext` rather than either owning them.
 */
export function useHydration({
  userId,
  dispatch,
  queue,
  live,
  listsRef,
  fetching,
  flushing,
  retry,
}: {
  userId: string;
  dispatch: Dispatch<Action>;
  queue: MutableRefObject<WriteAction[]>;
  live: MutableRefObject<boolean>;
  listsRef: MutableRefObject<List[]>;
  fetching: MutableRefObject<boolean>;
  flushing: MutableRefObject<boolean>;
  retry: MutableRefObject<ReturnType<typeof setTimeout> | null>;
}) {
  // Realtime's two. `nudge` is the debounce timer collapsing a burst of somebody else's writes into
  // one fetch; `dirty` is which lists that burst named — a set of ids, or `'all'` once any nudge (or
  // a resubscribe) arrives with no list id, since then nothing narrower is safe. Mutated on every
  // nudge regardless of whether the guards below let a fetch start, so nothing a burst names is lost
  // while a write or another fetch is in the way — `drainDirty` is what acts on it once they clear.
  const nudge = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef<Set<string> | 'all'>(new Set());

  useEffect(() => {
    return () => {
      if (nudge.current) clearTimeout(nudge.current);
      nudge.current = null;
    };
  }, []);

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
      // Set here too, not only by the mirroring effect below: a screen's own mount effect can run
      // in the same commit as this dispatch, and children's effects fire before their parent's —
      // reading the ref there would see it one commit behind, the same trap `hydrate`'s return
      // value exists to avoid for the blocked-write path.
      listsRef.current = loaded;
      // The fetched rows, never the replayed view — see `writeCachedLists`.
      void writeCachedLists(userId, lists);
      return { error: failure, lists: loaded };
    } finally {
      fetching.current = false;
    }
  }, [userId]);

  /**
   * `hydrate`, scoped to `listIds`. Fetches fresh metadata for just those lists; everything else in
   * state passes through `listsRef.current` unchanged. `reloadPages` only reloads a list whose
   * "fetched" copy holds fewer rows than its "previous" copy — for an object compared against
   * itself that is never true, so nothing outside `listIds` triggers a single item request.
   *
   * Deliberately does not cache. The untouched lists it hands `reloadPages` are `listsRef.current`'s
   * own objects — the *replayed* view, which may hold a write the database has not acknowledged
   * yet. Caching that would persist an unsent write as server truth, the mistake `writeCachedLists`
   * exists to avoid. `hydrate` may cache because everything it hands over came from a fetch; this
   * does not, so it does not — the existing `pending === 0` effect below catches this dispatch once
   * the outbox actually empties.
   *
   * A list `fetchList` reports as no longer visible (unshared, purged) is dropped from state; one
   * it has never seen before is appended (freshly shared) at the end of the array — not inserted at
   * its `created_at` position, since nothing here tracks that for a list and nothing downstream
   * sorts on it. A per-id fetch that errors leaves that id's local copy untouched, matching a failed
   * nudge-triggered `hydrate` today: silent.
   */
  const hydrateLists = useCallback(async (listIds: Set<string>): Promise<void> => {
    fetching.current = true;

    try {
      const results = await Promise.all(
        [...listIds].map(async (id) => [id, await fetchList(id)] as const)
      );
      if (!live.current) return;

      const removed = new Set<string>();
      const fetchedById = new Map<string, List>();
      for (const [id, { list, error }] of results) {
        if (error) continue;
        if (list === null) removed.add(id);
        else fetchedById.set(id, list);
      }

      const previous = listsRef.current;
      const fetched = previous
        .filter((list) => !removed.has(list.id))
        .map((list) => fetchedById.get(list.id) ?? list);
      for (const [id, list] of fetchedById) {
        if (!previous.some((candidate) => candidate.id === id)) fetched.push(list);
      }

      const lists = await reloadPages(fetched, previous, fetchItems);
      if (!live.current) return;

      const loaded = replay(lists, queue.current);
      dispatch({ type: 'lists/loaded', lists: loaded });
      listsRef.current = loaded;
    } finally {
      fetching.current = false;
    }
  }, []);

  /**
   * Acts on whatever `dirty` holds, and loops if a nudge names something else while it is working —
   * `hydrate`/`hydrateLists` hold `fetching.current` for their own duration, so nothing else can
   * start a fetch meanwhile, and this loop is the one place that notices when it is safe to.
   */
  const runDirty = useCallback(async () => {
    while (live.current && (dirty.current === 'all' || dirty.current.size > 0)) {
      const targets = dirty.current;
      dirty.current = new Set();
      if (targets === 'all') await hydrate();
      else await hydrateLists(targets);
    }
  }, [hydrate, hydrateLists]);

  /**
   * The nudges a write, or another fetch, turned away — remembered in `dirty` rather than dropped,
   * since nothing redelivers one. Called from the debounce timer once it fires, and from `flush`'s
   * own `finally` once a write stops holding the door.
   *
   * Not called from `hydrate`'s or `hydrateLists`'s own `finally`: doing so would make a
   * `useCallback` cycle (`drainDirty` → `runDirty` → `hydrateLists` → `drainDirty`) and would race
   * `discardBlocked`/`restoreBlocked`'s `hydrate().then(flush())` chains — a drain fired
   * synchronously inside `hydrate`'s `finally` sets `fetching.current` back to `true` before that
   * `.then` resumes, so `flush` would see it set and bail with the write still queued.
   * `runDirty`'s own loop already covers "something else was named while I was working" without
   * either hazard: a nudge that arrives mid-fetch is picked up by the same `runDirty` call the
   * moment `fetching.current` clears, since its loop is still running.
   */
  const drainDirty = useCallback(() => {
    if (flushing.current || retry.current || fetching.current) return;
    if (dirty.current === 'all' || dirty.current.size > 0) void runDirty();
  }, [runDirty]);

  /**
   * A re-read on demand, for the sharing screen and for coming back to the app.
   *
   * `flush` guards itself against a fetch; nothing guards a fetch against a flush. A read issued
   * while a write is in the air can come back without that write just as the loop removes it from
   * the queue — and the row disappears from the screen until the next fetch. A set `retry` means
   * backoff took over, so we are offline and a fetch would fail anyway.
   *
   * Unlike a nudge, this carries no information about which list changed — "I want the truth" or
   * "the app just came to the foreground" say nothing narrower — so it is always a full `hydrate`,
   * never `hydrateLists`. It also does not check `fetching.current`, so it can in principle start
   * alongside a nudge-driven `runDirty` already in flight; whichever dispatch lands last wins. That
   * gap already exists between any two independent triggers of `hydrate` today, this does not widen
   * it, and the outcome is bounded — one list's view rolls back one cycle, repaired by the next
   * nudge or foreground event — so it is not worth a larger guard here.
   */
  const refresh = useCallback(async () => {
    if (flushing.current || retry.current) return;
    dirty.current = new Set();
    await hydrate();
  }, [hydrate]);

  /**
   * Somebody else changed a list you are in — `listId` when the nudge named one, `undefined` when
   * it did not (a malformed payload, or a resubscribe, which can never know what it missed).
   * Trailing debounce, so a burst of their writes is one fetch rather than one each, scoped to
   * whichever lists the burst actually named.
   *
   * `dirty` is updated before the early return below, on *every* call: a nudge that arrives while a
   * timer is already pending must still be counted, or a burst naming two lists would silently drop
   * the second one's id. Once `dirty` is `'all'` it stays that way regardless of what arrives after,
   * until something drains it.
   *
   * The nudge itself is never applied to state — it says *that* a list changed, not what, and a
   * fetch of that list is the mechanism. That is deliberate: `replay` is the only place that knows
   * how server truth and pending writes combine, a dropped message costs staleness while a
   * mis-applied delta costs divergence, and server-stamped values like `done_at` arrive correct only
   * by being read.
   *
   * When the guards `drainDirty` carries turn the fetch away, `dirty` already holds what was
   * turned away — nothing extra to remember, unlike the old boolean `owed` this replaced.
   */
  const refreshSoon = useCallback(
    (listId?: string) => {
      if (dirty.current !== 'all') {
        if (listId === undefined) dirty.current = 'all';
        else dirty.current.add(listId);
      }

      if (nudge.current) return;

      nudge.current = setTimeout(() => {
        nudge.current = null;
        drainDirty();
      }, NUDGE_DEBOUNCE_MS);
    },
    [drainDirty]
  );

  return { hydrate, refresh, refreshSoon, drainDirty };
}
