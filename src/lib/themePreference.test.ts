import AsyncStorage from '@react-native-async-storage/async-storage';

import { readThemePreference, writeThemePreference } from './themePreference';

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('defaults to day when nothing was ever chosen', async () => {
  expect(await readThemePreference()).toBe('day');
});

it('round-trips a stored choice', async () => {
  await writeThemePreference('night');

  expect(await readThemePreference()).toBe('night');
});

it('falls back to day for anything it cannot parse', async () => {
  await AsyncStorage.setItem('theme-preference', '{not json');

  expect(await readThemePreference()).toBe('day');
});

it('falls back to day for a blob whose version does not match', async () => {
  await AsyncStorage.setItem('theme-preference', JSON.stringify({ v: 999, preference: 'night' }));

  expect(await readThemePreference()).toBe('day');
});

it('falls back to day for a value this version does not know', async () => {
  await AsyncStorage.setItem('theme-preference', JSON.stringify({ v: 1, preference: 'sepia' }));

  expect(await readThemePreference()).toBe('day');
});

it('falls back to day when storage cannot be read at all', async () => {
  jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk on fire'));

  expect(await readThemePreference()).toBe('day');
});
