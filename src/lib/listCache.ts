import AsyncStorage from '@react-native-async-storage/async-storage';

import type { List } from '../state/types';
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
 */
const VERSION = 4;

const keyFor = (userId: string) => `lists:${userId}`;

export async function readCachedLists(userId: string): Promise<List[] | null> {
  const raw = await AsyncStorage.getItem(keyFor(userId));
  if (!raw) return null;

  try {
    const stored = JSON.parse(raw) as { v?: unknown; lists?: unknown };
    if (stored.v !== VERSION || !Array.isArray(stored.lists)) return null;
    return stored.lists as List[];
  } catch {
    return null;
  }
}

/**
 * Only ever the rows a fetch returned, never the view on screen. The screen is server truth with
 * the outbox replayed on top; cache that, and the next load replays those same writes onto rows
 * that already contain them — a `list/created` appends by id, and the list appears twice.
 */
export function writeCachedLists(userId: string, lists: List[]): Promise<void> {
  const stored = JSON.stringify({ v: VERSION, lists, fetchedAt: new Date().toISOString() });
  return inOrder(() => AsyncStorage.setItem(keyFor(userId), stored));
}

export function clearCachedLists(userId: string): Promise<void> {
  return inOrder(() => AsyncStorage.removeItem(keyFor(userId)));
}
