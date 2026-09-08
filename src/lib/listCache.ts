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
 */
const VERSION = 2;

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
