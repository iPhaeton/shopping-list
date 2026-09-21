import AsyncStorage from '@react-native-async-storage/async-storage';

import { inOrder } from './storageQueue';

const VERSION = 1;

const keyFor = (userId: string) => `name:${userId}`;

/**
 * The last name the database confirmed for this account — never a "confirmed empty" marker. `null`
 * covers both "never cached" and "unreadable", which is also `SessionContext`'s fallback for either:
 * no answer here means don't gate a returning user over a name nobody has found missing.
 */
export async function readCachedName(userId: string): Promise<string | null> {
  const raw = await AsyncStorage.getItem(keyFor(userId));
  if (!raw) return null;

  try {
    const stored = JSON.parse(raw) as { v?: unknown; name?: unknown };
    if (stored.v !== VERSION || typeof stored.name !== 'string') return null;
    return stored.name;
  } catch {
    return null;
  }
}

export function writeCachedName(userId: string, name: string): Promise<void> {
  return inOrder(() => AsyncStorage.setItem(keyFor(userId), JSON.stringify({ v: VERSION, name })));
}

export function clearCachedName(userId: string): Promise<void> {
  return inOrder(() => AsyncStorage.removeItem(keyFor(userId)));
}
