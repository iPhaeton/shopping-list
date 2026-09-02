import AsyncStorage from '@react-native-async-storage/async-storage';

import type { WriteAction } from '../state/types';
import { dropDependents, enqueue, loadOutbox, saveOutbox } from './outbox';

/**
 * The real AsyncStorage mock rather than a fake of this module's own storage: what is worth
 * asserting here is the round trip through disk, because surviving a restart is the whole point.
 */
const USER = 'u1';

const CREATE_GROCERIES: WriteAction = { type: 'list/created', id: 'l1', name: 'Groceries' };
const ADD_MILK: WriteAction = { type: 'item/added', listId: 'l1', id: 'i1', title: 'Milk' };
const TICK_MILK: WriteAction = {
  type: 'item/setDone',
  listId: 'l1',
  itemId: 'i1',
  doneAt: '2026-09-01T10:00:00.000Z',
};

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('survives a round trip through storage, in order', async () => {
  await saveOutbox(USER, [CREATE_GROCERIES, ADD_MILK]);

  expect(await loadOutbox(USER)).toEqual([CREATE_GROCERIES, ADD_MILK]);
});

it('has nothing queued for a user who has never written anything', async () => {
  expect(await loadOutbox(USER)).toEqual([]);
});

it('keeps one account out of the next account on the same device', async () => {
  await saveOutbox(USER, [CREATE_GROCERIES]);

  expect(await loadOutbox('u2')).toEqual([]);
});

it('appends writes in the order they were made', () => {
  const ops = enqueue(enqueue([], CREATE_GROCERIES), ADD_MILK);

  expect(ops).toEqual([CREATE_GROCERIES, ADD_MILK]);
});

/** Absolute values, so only the newest toggle of an item is worth sending. */
it('replaces a queued toggle of the same item, where it stands', () => {
  const untick: WriteAction = { ...TICK_MILK, doneAt: null };

  const ops = enqueue(enqueue([CREATE_GROCERIES, TICK_MILK, ADD_MILK], untick), untick);

  expect(ops).toEqual([CREATE_GROCERIES, untick, ADD_MILK]);
});

it('does not coalesce toggles of different items', () => {
  const tickBread: WriteAction = { ...TICK_MILK, itemId: 'i2' };

  expect(enqueue([TICK_MILK], tickBread)).toEqual([TICK_MILK, tickBread]);
});

/** Two inserts are two rows, however alike they look. */
it('does not coalesce inserts', () => {
  const addMilkAgain: WriteAction = { ...ADD_MILK, id: 'i2' };

  expect(enqueue([ADD_MILK], addMilkAgain)).toEqual([ADD_MILK, addMilkAgain]);
});

it('drops the items of a list the database refused, and nothing else', () => {
  const otherList: WriteAction = { type: 'list/created', id: 'l2', name: 'Hardware' };
  const addNails: WriteAction = { type: 'item/added', listId: 'l2', id: 'i2', title: 'Nails' };

  const ops = dropDependents([ADD_MILK, TICK_MILK, otherList, addNails], CREATE_GROCERIES);

  expect(ops).toEqual([otherList, addNails]);
});

it('drops the toggle of an item that was never inserted', () => {
  const tickOther: WriteAction = { ...TICK_MILK, itemId: 'i2' };

  expect(dropDependents([TICK_MILK, tickOther], ADD_MILK)).toEqual([tickOther]);
});

it('leaves the queue alone when a toggle is refused', () => {
  expect(dropDependents([ADD_MILK], TICK_MILK)).toEqual([ADD_MILK]);
});

/**
 * Unsent writes are the promise this feature makes. A blob that cannot be replayed is not something
 * to overwrite quietly — it is the user's data in a shape we failed to read.
 */
it('quarantines an unreadable outbox instead of dropping it', async () => {
  await AsyncStorage.setItem(`outbox:${USER}`, '{ this is not json');

  expect(await loadOutbox(USER)).toEqual([]);
  expect(await AsyncStorage.getItem(`outbox:${USER}:broken`)).toBe('{ this is not json');
  expect(await AsyncStorage.getItem(`outbox:${USER}`)).toBeNull();
});

it('quarantines an outbox written by a future version', async () => {
  const stored = JSON.stringify({ v: 99, ops: [CREATE_GROCERIES] });
  await AsyncStorage.setItem(`outbox:${USER}`, stored);

  expect(await loadOutbox(USER)).toEqual([]);
  expect(await AsyncStorage.getItem(`outbox:${USER}:broken`)).toBe(stored);
});
