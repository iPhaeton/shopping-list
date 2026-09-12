import AsyncStorage from '@react-native-async-storage/async-storage';

import type { List } from '../state/types';
import { readCachedLists, writeCachedLists } from './listCache';

/**
 * The cache is disposable, and the version check is what makes it safe to be: a blob written by
 * an older build is dropped and re-fetched rather than rendered with fields it does not have.
 * Every bump so far has been for a field where `undefined !== null` would read as the wrong
 * answer — `deletedAt` as "deleted", `nextLive` as "there is more" — so the test writes the older
 * shape by hand and asserts it never comes back.
 */
const GROCERIES: List = {
  id: 'l1',
  name: 'Groceries',
  role: 'owner',
  deletedAt: null,
  itemsLoaded: true,
  items: [{ id: 'i1', title: 'Milk', doneAt: null, deletedAt: null, createdAt: '2026-09-01T10:00:00Z' }],
  nextLive: { createdAt: '2026-09-01T10:00:00Z', id: 'i1' },
  nextBin: null,
};

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('round-trips what it was given, cursors included', async () => {
  await writeCachedLists('u1', [GROCERIES]);

  expect(await readCachedLists('u1')).toEqual([GROCERIES]);
});

it('drops a blob from before pagination rather than reading its missing cursors as "more"', async () => {
  const { nextLive: _live, nextBin: _bin, ...v3List } = GROCERIES;
  await AsyncStorage.setItem('lists:u1', JSON.stringify({ v: 3, lists: [v3List] }));

  expect(await readCachedLists('u1')).toBeNull();
});

it('drops a blob from before items stopped riding along with fetchLists', async () => {
  const { itemsLoaded: _itemsLoaded, ...v4List } = GROCERIES;
  await AsyncStorage.setItem('lists:u1', JSON.stringify({ v: 4, lists: [v4List] }));

  expect(await readCachedLists('u1')).toBeNull();
});

it('drops anything it cannot parse', async () => {
  await AsyncStorage.setItem('lists:u1', '{not json');

  expect(await readCachedLists('u1')).toBeNull();
});
