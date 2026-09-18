import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { pickTarget } from './supabaseTarget';

/**
 * `expo-device` is a native module, so jest-expo would mock it away to something this suite cannot
 * steer. A plain object stands in, and each test redefines `isDevice` on it.
 */
jest.mock('expo-device', () => ({ isDevice: true }));

const originalOS = Platform.OS;
const originalTarget = process.env.EXPO_PUBLIC_SUPABASE_TARGET;

/** `Platform.OS` is a plain property on RN's module object; assigning through defineProperty keeps
 * TypeScript out of the way of what is, at runtime, a mutable field. */
function runningOn(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
}

function onARealDevice(isDevice: boolean | undefined) {
  Object.defineProperty(Device, 'isDevice', { value: isDevice, configurable: true, writable: true });
}

afterEach(() => {
  runningOn(originalOS);
  onARealDevice(true);
  if (originalTarget === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_TARGET;
  else process.env.EXPO_PUBLIC_SUPABASE_TARGET = originalTarget;
});

it('sends the browser to the local stack, where Mailpit makes the code readable', () => {
  runningOn('web');
  onARealDevice(true); // expo-device reports true on web; the platform check has to win

  expect(pickTarget()).toBe('local');
});

it('sends a simulator to the local stack, which it reaches over the host loopback', () => {
  runningOn('ios');
  onARealDevice(false);

  expect(pickTarget()).toBe('local');
});

it('sends an Android emulator to the local stack too', () => {
  runningOn('android');
  onARealDevice(false);

  expect(pickTarget()).toBe('local');
});

it('sends a physical device to cloud, because it cannot reach 127.0.0.1 on this machine', () => {
  runningOn('ios');
  onARealDevice(true);

  expect(pickTarget()).toBe('cloud');
});

it('falls back to local if expo-device reports nothing', () => {
  runningOn('ios');
  onARealDevice(undefined);

  expect(pickTarget()).toBe('local');
});

it('lets the browser be pointed at cloud for a two-client test', () => {
  runningOn('web');
  process.env.EXPO_PUBLIC_SUPABASE_TARGET = 'cloud';

  expect(pickTarget()).toBe('cloud');
});

it('lets a physical device be pointed back at local', () => {
  runningOn('ios');
  onARealDevice(true);
  process.env.EXPO_PUBLIC_SUPABASE_TARGET = 'local';

  expect(pickTarget()).toBe('local');
});

it('ignores an override that names neither target', () => {
  runningOn('web');
  process.env.EXPO_PUBLIC_SUPABASE_TARGET = 'staging';

  expect(pickTarget()).toBe('local');
});

/**
 * `jest.isolateModules` gives `./supabaseTarget` a fresh module registry, which pulls in fresh
 * `react-native`/`expo-device` instances too — the outer `runningOn`/`onARealDevice` mutate
 * different object instances and would not reach this copy, so platform state is set on the
 * fresh requires themselves, same trick as the literal-name test below.
 */
function targetsIsolated(os: typeof Platform.OS, isDevice: boolean | undefined) {
  let targets!: typeof import('./supabaseTarget').targets;
  jest.isolateModules(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL_LOCAL = 'http://127.0.0.1:54321';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY_LOCAL = 'local-key';

    const freshPlatform = (require('react-native') as typeof import('react-native')).Platform;
    const freshDevice = require('expo-device') as typeof import('expo-device');
    Object.defineProperty(freshPlatform, 'OS', { value: os, configurable: true, writable: true });
    Object.defineProperty(freshDevice, 'isDevice', { value: isDevice, configurable: true, writable: true });

    ({ targets } = require('./supabaseTarget') as typeof import('./supabaseTarget'));
  });
  return targets;
}

/**
 * The Android emulator's own `127.0.0.1` refuses the connection outright — nothing is listening on
 * its loopback, unlike the iOS Simulator's, which really is the host's. `10.0.2.2` is its fixed
 * alias back to the host, confirmed by `adb shell` against the running emulator.
 */
it('patches the local URL to the Android emulator loopback alias', () => {
  expect(targetsIsolated('android', false).local.url).toBe('http://10.0.2.2:54321');
});

it('leaves the local URL alone for a real Android device', () => {
  expect(targetsIsolated('android', true).local.url).toBe('http://127.0.0.1:54321');
});

/**
 * The guard that matters most and is easiest to lose in a tidy-up: Metro substitutes
 * `process.env.EXPO_PUBLIC_*` by literal text match, so a key built from a suffix compiles, passes
 * review, and ships `undefined` to the device. Reading the four names back through a fresh module
 * registry is what proves they are still written out in full.
 */
it('reads each variable under its full literal name', () => {
  jest.isolateModules(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL_LOCAL = 'http://127.0.0.1:54321';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY_LOCAL = 'local-key';
    process.env.EXPO_PUBLIC_SUPABASE_URL_CLOUD = 'https://ref.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY_CLOUD = 'cloud-key';

    const { targets } = require('./supabaseTarget') as typeof import('./supabaseTarget');

    expect(targets).toEqual({
      local: { url: 'http://127.0.0.1:54321', anonKey: 'local-key' },
      cloud: { url: 'https://ref.supabase.co', anonKey: 'cloud-key' },
    });
  });
});
