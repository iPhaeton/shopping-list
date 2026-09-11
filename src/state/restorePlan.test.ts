import { blockedList, restorePlan, type Blocked } from './restorePlan';
import type { List, Role, WriteAction } from './types';

const DELETED_AT = '2026-09-10T09:00:00.000Z';

const TICK_MILK: WriteAction = {
  type: 'item/setDone',
  listId: 'l1',
  itemId: 'i1',
  doneAt: '2026-09-10T10:00:00.000Z',
};

const RENAME: WriteAction = { type: 'list/renamed', id: 'l1', name: 'Weekly shop' };

const blockedOn = (op: WriteAction): Blocked => ({ op, listId: 'l1' });

function listWith({
  role = 'owner',
  listDeleted = false,
  itemDeleted = false,
}: { role?: Role; listDeleted?: boolean; itemDeleted?: boolean } = {}): List[] {
  return [
    {
      id: 'l1',
      name: 'Groceries',
      role,
      deletedAt: listDeleted ? DELETED_AT : null,
      items: [
        { id: 'i1', title: 'Milk', doneAt: null, deletedAt: itemDeleted ? DELETED_AT : null },
      ],
    },
  ];
}

describe('what has to come out of the bin', () => {
  it('lifts the list when the list is what was binned', () => {
    expect(restorePlan(listWith({ listDeleted: true }), blockedOn(RENAME))).toEqual([
      { type: 'list/setDeleted', id: 'l1', deletedAt: null },
    ]);
  });

  it('lifts the item when the item is what was binned', () => {
    expect(restorePlan(listWith({ itemDeleted: true }), blockedOn(TICK_MILK))).toEqual([
      { type: 'item/setDeleted', listId: 'l1', itemId: 'i1', deletedAt: null },
    ]);
  });

  /**
   * The case that makes this a *plan* rather than a lookup. Restoring only the list would block the
   * retry all over again on the item, and ask a user who has already said yes to say it a second
   * time. The list has to come first, so the item is restored into a list that exists.
   */
  it('lifts both, list first, when the item is binned inside a binned list', () => {
    expect(
      restorePlan(listWith({ listDeleted: true, itemDeleted: true }), blockedOn(TICK_MILK))
    ).toEqual([
      { type: 'list/setDeleted', id: 'l1', deletedAt: null },
      { type: 'item/setDeleted', listId: 'l1', itemId: 'i1', deletedAt: null },
    ]);
  });

  it('ignores an item tombstone the blocked write was not about', () => {
    expect(restorePlan(listWith({ itemDeleted: true }), blockedOn(RENAME))).toEqual([]);
  });

  /** An item rename names its item by `itemId`, like a toggle, and its list by `listId`. */
  it('lifts the item when a rename of it was what was blocked', () => {
    const renameMilk: WriteAction = {
      type: 'item/renamed',
      listId: 'l1',
      itemId: 'i1',
      title: 'Oat milk',
    };

    expect(restorePlan(listWith({ itemDeleted: true }), blockedOn(renameMilk))).toEqual([
      { type: 'item/setDeleted', listId: 'l1', itemId: 'i1', deletedAt: null },
    ]);
  });
});

/**
 * An empty plan means two things at once, and both end the same way: do not offer the prompt, and
 * discard the write rather than leaving it queued — the flush loop is stopped while it sits there.
 */
describe('when there is nothing this account may lift', () => {
  it('offers a writer nothing for a list only an owner may restore', () => {
    expect(restorePlan(listWith({ role: 'writer', listDeleted: true }), blockedOn(TICK_MILK))).toEqual(
      []
    );
  });

  /** Restoring the item alone would leave it inside a list still in the bin. */
  it('offers a writer nothing even for their own item, inside a binned list', () => {
    expect(
      restorePlan(
        listWith({ role: 'writer', listDeleted: true, itemDeleted: true }),
        blockedOn(TICK_MILK)
      )
    ).toEqual([]);
  });

  it('lets a writer lift their own item when the list itself is live', () => {
    expect(
      restorePlan(listWith({ role: 'writer', itemDeleted: true }), blockedOn(TICK_MILK))
    ).toEqual([{ type: 'item/setDeleted', listId: 'l1', itemId: 'i1', deletedAt: null }]);
  });

  it('offers a reader nothing at all', () => {
    expect(restorePlan(listWith({ role: 'reader', itemDeleted: true }), blockedOn(TICK_MILK))).toEqual(
      []
    );
  });

  /** The row was purged, or the account was removed from the list — the list is simply not there. */
  it('offers nothing for a list that has left the fetch', () => {
    expect(restorePlan([], blockedOn(TICK_MILK))).toEqual([]);
  });

  it('offers nothing when nothing is actually in the bin', () => {
    expect(restorePlan(listWith(), blockedOn(TICK_MILK))).toEqual([]);
  });
});

describe('blockedList', () => {
  it('is what picks the wording, so it tracks the list tombstone and not the item', () => {
    expect(blockedList(listWith({ listDeleted: true }), blockedOn(TICK_MILK))).toBe(true);
    expect(blockedList(listWith({ itemDeleted: true }), blockedOn(TICK_MILK))).toBe(false);
  });
});
