import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ThemeName } from '../theme';
import { inOrder } from './storageQueue';

const VERSION = 1;

/**
 * One key per device, not per account: the choice applies on the signed-out screens too, and
 * survives an account switch. Never sent to the server.
 */
const KEY = 'theme-preference';

export type ThemePreference = ThemeName;

const DEFAULT: ThemePreference = 'day';

/**
 * Never rejects. Absent, unreadable, and anything this version does not recognise all come back as
 * the default — a theme is not worth a startup failure.
 */
export async function readThemePreference(): Promise<ThemePreference> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return DEFAULT;

    const stored = JSON.parse(raw) as { v?: unknown; preference?: unknown };
    if (stored.v !== VERSION) return DEFAULT;
    return stored.preference === 'day' || stored.preference === 'night' ? stored.preference : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function writeThemePreference(preference: ThemePreference): Promise<void> {
  return inOrder(() => AsyncStorage.setItem(KEY, JSON.stringify({ v: VERSION, preference })));
}
