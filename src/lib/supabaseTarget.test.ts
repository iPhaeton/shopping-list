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
