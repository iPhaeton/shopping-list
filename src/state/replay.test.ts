import { replay } from './replay';
import type { List, WriteAction } from './types';

const MILK = { id: 'i1', title: 'Milk', doneAt: null, deletedAt: null, createdAt: null };
const GROCERIES: List = { id: 'l1', name: 'Groceries', role: 'owner', deletedAt: null, itemsLoaded: true, items: [MILK], nextLive: null, nextBin: null };

it('returns the fetched rows unchanged when nothing is queued', () => {
  expect(replay([GROCERIES], [])).toEqual([GROCERIES]);
});

it('puts a queued list back on top of what the database returned', () => {
  const create: WriteAction = { type: 'list/created', id: 'l2', name: 'Hardware' };

  expect(replay([GROCERIES], [create])).toEqual([
    GROCERIES,
    { id: 'l2', name: 'Hardware', role: 'owner', deletedAt: null, itemsLoaded: true, items: [], nextLive: null, nextBin: null },
  ]);
});

/** In dispatch order, so an item still lands after the list insert it depends on. */
it('replays a list and its items together', () => {
  const ops: WriteAction[] = [
    { type: 'list/created', id: 'l2', name: 'Hardware' },
    { type: 'item/added', listId: 'l2', id: 'i2', title: 'Nails' },
  ];

  expect(replay([], ops)).toEqual([
    { id: 'l2', name: 'Hardware', role: 'owner', deletedAt: null, itemsLoaded: true, items: [{ id: 'i2', title: 'Nails', doneAt: null, deletedAt: null, createdAt: null }], nextLive: null, nextBin: null },
  ]);
});

it('keeps a queued toggle that the fetched row does not have yet', () => {
  const tick: WriteAction = {
    type: 'item/setDone',
    listId: 'l1',
    itemId: 'i1',
    doneAt: '2026-09-01T10:00:00.000Z',
  };

  expect(replay([GROCERIES], [tick])[0].items[0].doneAt).toBe('2026-09-01T10:00:00.000Z');
});

/**
 * **This used to duplicate, and the test used to say so.** The reducer appended by id without
 * deduping, which was safe only because a row cannot be in the fetched set *and* still in the outbox
 * — the provider never lets a fetch and a flush overlap. Realtime fetches far more often, so that
 * invariant went from incidental to load-bearing and the reducer was made idempotent instead.
 *
 * The rules it used to justify have not gone away: an op still leaves the outbox the moment the
 * database acknowledges it, and `listCache` still stores fetched rows rather than the replayed view,
 * for its own separate reason.
 */
it('yields one row when a write the fetch already contains is replayed anyway', () => {
  const create: WriteAction = { type: 'list/created', id: 'l1', name: 'Groceries' };

  expect(replay([GROCERIES], [create])).toEqual([GROCERIES]);
});

it('yields one item when an add the fetch already contains is replayed anyway', () => {
  const add: WriteAction = { type: 'item/added', listId: 'l1', id: 'i1', title: 'Milk' };

  expect(replay([GROCERIES], [add])).toEqual([GROCERIES]);
});

/** The pending write still wins where the two disagree — that is what `replay` is for. */
it('keeps the queued name over the fetched one', () => {
  const rename: WriteAction = { type: 'list/created', id: 'l1', name: 'Weekly shop' };

  expect(replay([GROCERIES], [rename])).toEqual([{ ...GROCERIES, name: 'Weekly shop' }]);
});

it('keeps the queued item title over the fetched one', () => {
  const rename: WriteAction = { type: 'item/renamed', listId: 'l1', itemId: 'i1', title: 'Oat milk' };

  expect(replay([GROCERIES], [rename])).toEqual([
    { ...GROCERIES, items: [{ ...MILK, title: 'Oat milk' }] },
  ]);
});

it('drops a queued write whose list is gone', () => {
  const add: WriteAction = { type: 'item/added', listId: 'gone', id: 'i9', title: 'Nails' };

  expect(replay([GROCERIES], [add])).toEqual([GROCERIES]);
});
