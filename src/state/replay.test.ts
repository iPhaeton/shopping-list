import { replay } from './replay';
import type { List, WriteAction } from './types';

const MILK = { id: 'i1', title: 'Milk', doneAt: null };
const GROCERIES: List = { id: 'l1', name: 'Groceries', role: 'owner', items: [MILK] };

it('returns the fetched rows unchanged when nothing is queued', () => {
  expect(replay([GROCERIES], [])).toEqual([GROCERIES]);
});

it('puts a queued list back on top of what the database returned', () => {
  const create: WriteAction = { type: 'list/created', id: 'l2', name: 'Hardware' };

  expect(replay([GROCERIES], [create])).toEqual([
    GROCERIES,
    { id: 'l2', name: 'Hardware', role: 'owner', items: [] },
  ]);
});

/** In dispatch order, so an item still lands after the list insert it depends on. */
it('replays a list and its items together', () => {
  const ops: WriteAction[] = [
    { type: 'list/created', id: 'l2', name: 'Hardware' },
    { type: 'item/added', listId: 'l2', id: 'i2', title: 'Nails' },
  ];

  expect(replay([], ops)).toEqual([
    { id: 'l2', name: 'Hardware', role: 'owner', items: [{ id: 'i2', title: 'Nails', doneAt: null }] },
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
 * The reducer appends by id and does not dedupe, so replaying a write the fetched rows already
 * contain duplicates it. Nothing does that in practice — an op leaves the outbox the moment the
 * database acknowledges it, and `listCache` stores fetched rows rather than the replayed view — and
 * this test is here to state why both of those rules exist.
 */
it('duplicates a list if a write the fetch already contains is replayed anyway', () => {
  const create: WriteAction = { type: 'list/created', id: 'l1', name: 'Groceries' };

  expect(replay([GROCERIES], [create]).filter((list) => list.name === 'Groceries')).toHaveLength(2);
});

it('drops a queued write whose list is gone', () => {
  const add: WriteAction = { type: 'item/added', listId: 'gone', id: 'i9', title: 'Nails' };

  expect(replay([GROCERIES], [add])).toEqual([GROCERIES]);
});
