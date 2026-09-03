import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { pickTarget, targets } from './supabaseTarget';

const target = pickTarget();
const { url, anonKey } = targets[target];

if (!url || !anonKey) {
  // Naming the selected target is the point: a phone booting with only the local pair filled in
  // says which two variables it wanted, rather than "missing config".
  const suffix = target.toUpperCase();
  throw new Error(
    `Missing EXPO_PUBLIC_SUPABASE_URL_${suffix} or EXPO_PUBLIC_SUPABASE_ANON_KEY_${suffix}. ` +
      'Copy .env.example to .env, fill in the values, then restart the dev server. The local pair ' +
      'comes from `npx supabase status`.'
  );
}

/**
 * Where the auth session is persisted.
 *
 * Named rather than passing `AsyncStorage` straight into `createClient`, because this object is
 * the seam a biometric unlock replaces: it would swap in a blob encrypted under a key held behind
 * a keystore ACL, and nothing else in the app would change.
 */
export const sessionStorage = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
  removeItem: (key: string) => AsyncStorage.removeItem(key),
};

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: sessionStorage,
    persistSession: true,
    autoRefreshToken: true,
    // On in the browser, where auth callbacks arrive in the URL; off on native, where deep-link
    // handling differs. Code-based OTP needs neither, but it is the documented default pair.
    detectSessionInUrl: Platform.OS === 'web',
  },
});

// Without this the access token silently expires while the app sits in the background. Web has no
// equivalent lifecycle — the tab keeps running — so the listener is native-only.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (status) => {
    if (status === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
