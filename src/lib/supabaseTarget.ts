import * as Device from 'expo-device';
import { Platform } from 'react-native';

/**
 * The local Supabase URL, patched for where "local" actually resolves on this platform.
 *
 * Only the Android emulator needs this: its own `127.0.0.1` is its own loopback, not the host
 * machine's — confirmed with `adb shell`, where a raw TCP connect to `127.0.0.1:54321` gets
 * "connection refused" while `10.0.2.2:54321` (the emulator's fixed alias back to the host
 * loopback interface) connects fine. The iOS Simulator needs no such patch: unlike the Android
 * emulator, it genuinely shares the Mac's network stack, so its `127.0.0.1` already is the host.
 */
function localUrl(): string | undefined {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL_LOCAL;
  if (!url || Platform.OS !== 'android' || Device.isDevice) return url;
  return url.replace('127.0.0.1', '10.0.2.2').replace('localhost', '10.0.2.2');
}

/**
 * Which Supabase this build talks to.
 *
 * Metro substitutes `process.env.EXPO_PUBLIC_*` by **literal text match**, so both pairs are
 * spelled out in full — a computed key, or one assembled from a suffix, is never replaced and
 * arrives as `undefined`. Env edits need a dev-server restart, sometimes `--clear`.
 */
export const targets = {
  local: {
    url: localUrl(),
    anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY_LOCAL,
  },
  cloud: {
    url: process.env.EXPO_PUBLIC_SUPABASE_URL_CLOUD,
    anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY_CLOUD,
  },
} as const;

export type TargetName = keyof typeof targets;

/**
 * Decided at runtime, not at build time: one `expo start` serves the browser and Expo Go from the
 * same bundle and the same env, so pressing `w` in a `npm start` session would silently get
 * whichever environment the build was made for. `Platform.OS` and `Device.isDevice` cannot
 * mismatch that way.
 *
 * - **web** → local. Mailpit makes the six-digit code machine-readable, which is what keeps the
 *   sign-in flow drivable end to end by Playwright. This is the verification path.
 * - **simulator or emulator** → local too. `localUrl()` below is what actually gets it there on
 *   Android — the iOS Simulator reaches the Docker stack over the shared host loopback as-is.
 * - **physical device** → cloud. A phone cannot reach this machine's `127.0.0.1:54321` at all.
 *
 * `Device.isDevice` is a synchronous constant. It is `true` on web, which is harmless — the
 * `Platform.OS` check runs first. Should it ever come back `undefined` under jest's native-module
 * mocking, the fallback is `local`, which fails towards the disposable database.
 */
export function pickTarget(): TargetName {
  // Escape hatch for a two-client test (`EXPO_PUBLIC_SUPABASE_TARGET=cloud npm run web`), and for
  // pointing a device back at a LAN address if that is ever wanted.
  const override = process.env.EXPO_PUBLIC_SUPABASE_TARGET;
  if (override === 'local' || override === 'cloud') return override;

  if (Platform.OS === 'web') return 'local';
  return Device.isDevice ? 'cloud' : 'local';
}
