import AsyncStorage from '@react-native-async-storage/async-storage';

import type { List, ListCounts, ListCursors } from '../state/types';
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
  joinedAt: '2026-09-01T09:00:00+00:00',
  itemsLoaded: true,
  items: [{ id: 'i1', title: 'Milk', doneAt: null, deletedAt: null, createdAt: '2026-09-01T10:00:00Z' }],
  nextLive: { createdAt: '2026-09-01T10:00:00Z', id: 'i1' },
  nextBin: null,
};

/** How far each stream of lists was paged, so a cold start re-reads that many. */
const CURSORS: ListCursors = { live: { createdAt: '2026-09-01T09:00:00+00:00', id: 'l1' }, bin: null };

/** What the database last counted, so a cold start offline still knows whether to warn. */
const COUNTS: ListCounts = { owned: 100, total: 140 };

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('round-trips what it was given, both levels of cursors and the counts included', async () => {
  await writeCachedLists('u1', [GROCERIES], CURSORS, COUNTS);

  expect(await readCachedLists('u1')).toEqual({ lists: [GROCERIES], cursors: CURSORS, counts: COUNTS });
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

it('drops a blob from before lists were paged, which has no joinedAt and no list cursors', async () => {
  const { joinedAt: _joinedAt, ...v5List } = GROCERIES;
  await AsyncStorage.setItem('lists:u1', JSON.stringify({ v: 5, lists: [v5List] }));

  expect(await readCachedLists('u1')).toBeNull();
});

/** `undefined` would read as "there is more", so a blob without both cursors is not trusted. */
it('drops a blob whose list cursors are missing', async () => {
  await AsyncStorage.setItem(
    'lists:u1',
    JSON.stringify({ v: 7, lists: [GROCERIES], cursors: { live: null }, counts: COUNTS })
  );

  expect(await readCachedLists('u1')).toBeNull();
});

it('drops a blob from before the list limits, which has no counts', async () => {
  await AsyncStorage.setItem('lists:u1', JSON.stringify({ v: 6, lists: [GROCERIES], cursors: CURSORS }));

  expect(await readCachedLists('u1')).toBeNull();
});

/** `undefined >= 100` is `false`, so a blob without both numbers would hide a limit until a fetch. */
it('drops a blob whose counts are missing a number', async () => {
  await AsyncStorage.setItem(
    'lists:u1',
    JSON.stringify({ v: 7, lists: [GROCERIES], cursors: CURSORS, counts: { owned: 100 } })
  );

  expect(await readCachedLists('u1')).toBeNull();
});

it('drops anything it cannot parse', async () => {
  await AsyncStorage.setItem('lists:u1', '{not json');

  expect(await readCachedLists('u1')).toBeNull();
});
