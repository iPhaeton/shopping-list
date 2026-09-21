import AsyncStorage from '@react-native-async-storage/async-storage';

import { readCachedName, writeCachedName } from './nameCache';

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('round-trips what it was given', async () => {
  await writeCachedName('u1', 'Alice');

  expect(await readCachedName('u1')).toBe('Alice');
});

it('drops a blob whose version does not match', async () => {
  await AsyncStorage.setItem('name:u1', JSON.stringify({ v: 999, name: 'Alice' }));

  expect(await readCachedName('u1')).toBeNull();
});

it('drops anything it cannot parse', async () => {
  await AsyncStorage.setItem('name:u1', '{not json');

  expect(await readCachedName('u1')).toBeNull();
});

it('reads nothing for a user that was never cached', async () => {
  expect(await readCachedName('u1')).toBeNull();
});
