import AsyncStorage from '@react-native-async-storage/async-storage';

import type { List, ListCounts, ListCursors } from '../state/types';
import { inOrder } from './storageQueue';

/**
 * The last rows the database handed over, so a cold start with no signal shows the lists instead of
 * claiming the account has none.
 *
 * Disposable by design — anything unreadable is dropped and re-fetched, which is the whole
 * difference between this and `src/lib/outbox.ts`. Losing the cache costs a round trip; losing the
 * outbox loses the user's writes.
 *
 * `2` since sharing: `List` gained a `role`, and the `v` check below is what stops a blob written
 * before that from rendering lists with `role: undefined` and a UI left to guess. `outbox.ts`'s
 * version deliberately did *not* move with it — a mismatch there discards unsent writes.
 *
 * **`3` since deletion, and this one is not cosmetic.** `List` and `Item` gained `deletedAt`, which
 * a v2 blob rehydrates as `undefined` — and `undefined !== null` is `true`, so every cached row
 * would read as deleted and the first screen after an upgrade would be empty. That is the exact
 * failure this check exists to prevent, and it costs one fetch. `outbox.ts` stays at `1` again: the
 * new actions are additive and a v1 blob still replays.
 *
 * **`4` since pagination, for the same reason in the other direction.** `List` gained `nextLive`
 * and `nextBin`, which a v3 blob rehydrates as `undefined` — and `undefined !== null` reads as
 * "there is more", so the first scroll would ask for a page after a cursor that does not exist.
 * `Item` gained `createdAt` too. `outbox.ts` stays at `1` a third time: `item/added` deliberately
 * carries no timestamp, so a queued v1 op is still exactly what the reducer expects.
 *
 * **`5` since items stopped riding along with `fetchLists`.** `List` gained `itemsLoaded`, and
 * unlike the two bumps above a missing one is not actively dangerous — `undefined` reads as
 * falsy everywhere it is checked, so it fails closed to "not loaded" rather than lying. Bumped
 * anyway, on the same convention as every other shape change here: a v4 blob left alone would
 * make a deeply-scrolled cached list look never-opened and pay for a redundant re-fetch from page
 * 1, which is cheap but still wrong, and the fix costs nothing but one more dropped blob.
 *
 * **`6` since lists are paged too (task 23).** `List` gained `joinedAt`, which a v5 blob rehydrates
 * as `undefined` — and `undefined !== null` reads as "stamped", so an optimistic-looking list would
 * be counted as a loaded one. The blob also gained the list cursors beside `lists`, so a cold start
 * seeds state with how far each stream of lists was paged and the first `hydrate` re-reads that
 * many. `outbox.ts` stays at `1`: `list/created` is unchanged, and the reducer mints `joinedAt: null`.
 *
 * **`7` since the list limits (task 23 step 2).** The blob gained `counts` — how many live lists the
 * account owns and is on, as the database last said — so a cold start with no signal still knows
 * whether to show the Create bar or the sentence that replaces it at a limit. Missing, it would read
 * as `undefined`, and `undefined >= 100` is `false`: the bar would come back at the limit until the
 * first fetch, quietly. `outbox.ts` stays at `1` once more: no queued action changed shape.
 */
const VERSION = 7;

const keyFor = (userId: string) => `lists:${userId}`;

export async function readCachedLists(
  userId: string
): Promise<{ lists: List[]; cursors: ListCursors; counts: ListCounts } | null> {
  const raw = await AsyncStorage.getItem(keyFor(userId));
  if (!raw) return null;

  try {
    const stored = JSON.parse(raw) as {
      v?: unknown;
      lists?: unknown;
      cursors?: unknown;
      counts?: unknown;
    };
    if (
      stored.v !== VERSION ||
      !Array.isArray(stored.lists) ||
      !isCursors(stored.cursors) ||
      !isCounts(stored.counts)
    ) {
      return null;
    }
    return { lists: stored.lists as List[], cursors: stored.cursors, counts: stored.counts };
  } catch {
    return null;
  }
}

/**
 * Only ever the rows a fetch returned, never the view on screen. The screen is server truth with
 * the outbox replayed on top; cache that, and the next load replays those same writes onto rows
 * that already contain them — a `list/created` appends by id, and the list appears twice. The same
 * goes for `counts`: the ones the fetch read, before a pending create is counted on top.
 */
export function writeCachedLists(
  userId: string,
  lists: List[],
  cursors: ListCursors,
  counts: ListCounts
): Promise<void> {
  const stored = JSON.stringify({
    v: VERSION,
    lists,
    cursors,
    counts,
    fetchedAt: new Date().toISOString(),
  });
  return inOrder(() => AsyncStorage.setItem(keyFor(userId), stored));
}

/** Both keys present — `null` or an object each — since `undefined` would read as "there is more". */
function isCursors(value: unknown): value is ListCursors {
  if (typeof value !== 'object' || value === null) return false;
  const { live, bin } = value as { live?: unknown; bin?: unknown };
  const cursor = (c: unknown) => c === null || typeof c === 'object';
  return cursor(live) && cursor(bin);
}

/** Both numbers present, since `undefined` would compare below every limit. */
function isCounts(value: unknown): value is ListCounts {
  if (typeof value !== 'object' || value === null) return false;
  const { owned, total } = value as { owned?: unknown; total?: unknown };
  return typeof owned === 'number' && typeof total === 'number';
}

export function clearCachedLists(userId: string): Promise<void> {
  return inOrder(() => AsyncStorage.removeItem(keyFor(userId)));
}
