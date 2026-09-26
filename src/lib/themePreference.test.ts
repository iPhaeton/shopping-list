import AsyncStorage from '@react-native-async-storage/async-storage';

import { readThemePreference, writeThemePreference } from './themePreference';

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('defaults to auto when nothing was ever chosen', async () => {
  expect(await readThemePreference()).toBe('auto');
});

it.each(['auto', 'day', 'night'] as const)('round-trips a stored %s', async (preference) => {
  await writeThemePreference(preference);

  expect(await readThemePreference()).toBe(preference);
});

it.each(['day', 'night'])('keeps a %s stored before auto existed', async (preference) => {
  await AsyncStorage.setItem('theme-preference', JSON.stringify({ v: 1, preference }));

  expect(await readThemePreference()).toBe(preference);
});

it('falls back to auto for anything it cannot parse', async () => {
  await AsyncStorage.setItem('theme-preference', '{not json');

  expect(await readThemePreference()).toBe('auto');
});

it('falls back to auto for a blob whose version does not match', async () => {
  await AsyncStorage.setItem('theme-preference', JSON.stringify({ v: 999, preference: 'night' }));

  expect(await readThemePreference()).toBe('auto');
});

it('falls back to auto for a value this version does not know', async () => {
  await AsyncStorage.setItem('theme-preference', JSON.stringify({ v: 1, preference: 'sepia' }));

  expect(await readThemePreference()).toBe('auto');
});

it('falls back to auto when storage cannot be read at all', async () => {
  jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk on fire'));

  expect(await readThemePreference()).toBe('auto');
});
