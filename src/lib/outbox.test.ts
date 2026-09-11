import AsyncStorage from '@react-native-async-storage/async-storage';

import type { WriteAction } from '../state/types';
import { dropDependents, enqueue, loadOutbox, queueFirst, saveOutbox } from './outbox';

/**
 * The real AsyncStorage mock rather than a fake of this module's own storage: what is worth
 * asserting here is the round trip through disk, because surviving a restart is the whole point.
 */
const USER = 'u1';

const CREATE_GROCERIES: WriteAction = { type: 'list/created', id: 'l1', name: 'Groceries' };
const RENAME_GROCERIES: WriteAction = { type: 'list/renamed', id: 'l1', name: 'Weekly shop' };
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

/** A name is an absolute value too: renaming a list five times is still one request. */
it('replaces a queued rename of the same list, where it stands', () => {
  const renameAgain: WriteAction = { ...RENAME_GROCERIES, name: 'Big shop' };

  const ops = enqueue([RENAME_GROCERIES, ADD_MILK], renameAgain);

  expect(ops).toEqual([renameAgain, ADD_MILK]);
});

it('does not coalesce renames of different lists', () => {
  const renameOther: WriteAction = { type: 'list/renamed', id: 'l2', name: 'Hardware' };

  expect(enqueue([RENAME_GROCERIES], renameOther)).toEqual([RENAME_GROCERIES, renameOther]);
});

/** Two inserts are two rows, however alike they look. */
it('does not coalesce inserts', () => {
  const addMilkAgain: WriteAction = { ...ADD_MILK, id: 'i2' };

  expect(enqueue([ADD_MILK], addMilkAgain)).toEqual([ADD_MILK, addMilkAgain]);
});

/** A rename and a create carry the same id but are different writes; only the create is coalesced. */
it('does not let a rename replace the insert of the same list', () => {
  expect(enqueue([CREATE_GROCERIES], RENAME_GROCERIES)).toEqual([
    CREATE_GROCERIES,
    RENAME_GROCERIES,
  ]);
});

it('drops the items of a list the database refused, and nothing else', () => {
  const otherList: WriteAction = { type: 'list/created', id: 'l2', name: 'Hardware' };
  const addNails: WriteAction = { type: 'item/added', listId: 'l2', id: 'i2', title: 'Nails' };

  const ops = dropDependents([ADD_MILK, TICK_MILK, otherList, addNails], CREATE_GROCERIES);

  expect(ops).toEqual([otherList, addNails]);
});

/** A list the database never accepted cannot be renamed either — same refusal, same burst to avoid. */
it('drops a queued rename of a list the database refused', () => {
  const renameOther: WriteAction = { type: 'list/renamed', id: 'l2', name: 'Hardware' };

  const ops = dropDependents([RENAME_GROCERIES, renameOther], CREATE_GROCERIES);

  expect(ops).toEqual([renameOther]);
});

it('leaves the queue alone when a rename is refused', () => {
  expect(dropDependents([ADD_MILK, TICK_MILK], RENAME_GROCERIES)).toEqual([ADD_MILK, TICK_MILK]);
});

it('drops the toggle of an item that was never inserted', () => {
  const tickOther: WriteAction = { ...TICK_MILK, itemId: 'i2' };

  expect(dropDependents([TICK_MILK, tickOther], ADD_MILK)).toEqual([tickOther]);
});

it('leaves the queue alone when a toggle is refused', () => {
  expect(dropDependents([ADD_MILK], TICK_MILK)).toEqual([ADD_MILK]);
});

// --- Renaming an item ---------------------------------------------------------------------------

const RENAME_MILK: WriteAction = {
  type: 'item/renamed',
  listId: 'l1',
  itemId: 'i1',
  title: 'Oat milk',
};

/** An item title is an absolute value like a list name: renaming it five times is one request. */
it('replaces a queued rename of the same item, where it stands', () => {
  const renameAgain: WriteAction = { ...RENAME_MILK, title: 'Soy milk' };

  const ops = enqueue([RENAME_MILK, TICK_MILK], renameAgain);

  expect(ops).toEqual([renameAgain, TICK_MILK]);
});

it('does not coalesce renames of different items', () => {
  const renameBread: WriteAction = { ...RENAME_MILK, itemId: 'i2', title: 'Sourdough' };

  expect(enqueue([RENAME_MILK], renameBread)).toEqual([RENAME_MILK, renameBread]);
});

/** Like coalesces only with like: a rename, a toggle and a delete of one item are three writes. */
it('does not let a rename replace a queued toggle or delete of the same item', () => {
  const binMilk: WriteAction = { ...TICK_MILK, type: 'item/setDeleted', deletedAt: null };

  expect(enqueue([TICK_MILK, binMilk], RENAME_MILK)).toEqual([TICK_MILK, binMilk, RENAME_MILK]);
});

it('does not let a rename replace the insert of the same item', () => {
  expect(enqueue([ADD_MILK], RENAME_MILK)).toEqual([ADD_MILK, RENAME_MILK]);
});

/**
 * The `item/added` arm of `dropDependents` is a filter predicate, not a `switch`, so a new item
 * action is silently kept unless it is spelled out there. This is the test that notices.
 */
it('drops a queued rename of an item that was never inserted', () => {
  const renameOther: WriteAction = { ...RENAME_MILK, itemId: 'i2' };

  expect(dropDependents([RENAME_MILK, renameOther], ADD_MILK)).toEqual([renameOther]);
});

it('drops a queued item rename when the list itself was refused', () => {
  const renameNails: WriteAction = { ...RENAME_MILK, listId: 'l2', itemId: 'i2' };

  expect(dropDependents([RENAME_MILK, renameNails], CREATE_GROCERIES)).toEqual([renameNails]);
});

/** A refused rename leaves the row exactly as it was; nothing behind it is stranded. */
it('leaves the queue alone when an item rename is refused', () => {
  expect(dropDependents([ADD_MILK, TICK_MILK], RENAME_MILK)).toEqual([ADD_MILK, TICK_MILK]);
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

// --- The bin ------------------------------------------------------------------------------------

const BIN_MILK: WriteAction = {
  type: 'item/setDeleted',
  listId: 'l1',
  itemId: 'i1',
  deletedAt: '2026-09-10T09:00:00.000Z',
};

const BIN_GROCERIES: WriteAction = {
  type: 'list/setDeleted',
  id: 'l1',
  deletedAt: '2026-09-10T09:00:00.000Z',
};

/**
 * Deleting and restoring carry an absolute value, exactly as a toggle does — so binning something,
 * changing your mind and binning it again on a train is one request, not three.
 */
it('replaces a queued item delete with a later one for the same item', () => {
  const restore: WriteAction = { ...BIN_MILK, deletedAt: null };

  expect(enqueue(enqueue([ADD_MILK, BIN_MILK], restore), BIN_MILK)).toEqual([ADD_MILK, BIN_MILK]);
});

it('does not coalesce deletes of different items', () => {
  const binBread: WriteAction = { ...BIN_MILK, itemId: 'i2' };

  expect(enqueue([BIN_MILK], binBread)).toEqual([BIN_MILK, binBread]);
});

it('replaces a queued list delete with a later one for the same list', () => {
  const restore: WriteAction = { ...BIN_GROCERIES, deletedAt: null };

  expect(enqueue([BIN_GROCERIES], restore)).toEqual([restore]);
});

/** A delete and a toggle are different writes about the same item; only like coalesces with like. */
it('does not let a delete replace a queued toggle of the same item', () => {
  expect(enqueue([TICK_MILK], BIN_MILK)).toEqual([TICK_MILK, BIN_MILK]);
});

/**
 * A list delete names its list `id` where an item action names it `listId`. Getting that wrong is a
 * compile error rather than a silent miss, which is the whole reason the arm spells both out.
 */
it('drops a queued delete of a list the database refused', () => {
  const ops = dropDependents([BIN_GROCERIES, ADD_MILK], CREATE_GROCERIES);

  expect(ops).toEqual([]);
});

it('drops a queued delete of an item that was never inserted', () => {
  const binOther: WriteAction = { ...BIN_MILK, itemId: 'i2' };

  expect(dropDependents([BIN_MILK, binOther], ADD_MILK)).toEqual([binOther]);
});

/** A refused delete leaves the row exactly as it was, so nothing queued behind it is stranded. */
it('leaves the queue alone when a delete is refused', () => {
  expect(dropDependents([ADD_MILK, TICK_MILK], BIN_MILK)).toEqual([ADD_MILK, TICK_MILK]);
  expect(dropDependents([ADD_MILK, TICK_MILK], BIN_GROCERIES)).toEqual([ADD_MILK, TICK_MILK]);
});

/**
 * `queueFirst` exists for one caller: the restore offered when the write at the head of the queue
 * landed on something in the bin. Appending it would send the blocked write first and earn the same
 * refusal a second time.
 */
describe('queueFirst', () => {
  it('puts the write at the front, ahead of what is already queued', () => {
    const restore: WriteAction = { ...BIN_GROCERIES, deletedAt: null };

    expect(queueFirst([ADD_MILK, TICK_MILK], restore)).toEqual([restore, ADD_MILK, TICK_MILK]);
  });

  it('still coalesces, so a restore does not race a delete of the same thing', () => {
    const restore: WriteAction = { ...BIN_GROCERIES, deletedAt: null };

    expect(queueFirst([BIN_GROCERIES, ADD_MILK], restore)).toEqual([restore, ADD_MILK]);
  });
});
