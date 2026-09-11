import { canEditItems, canManageList } from './roles';
import type { List, WriteAction } from './types';

/** The write that is stuck, and the list it was aimed at. */
export type Blocked = { op: WriteAction; listId: string };

/**
 * What has to come out of the bin before a blocked write can land — in the order it has to happen.
 *
 * The database says only "the target is deleted". It does not say whether that was the item, the
 * list holding it, or both, and it deliberately says nothing about who is allowed to lift which:
 * roles decide *which controls exist*, never whether a write is allowed, and that division is kept
 * here as everywhere else. The tombstones travel in the same fetch as the live rows, so by the time
 * anything asks this question the answer is already in state.
 *
 * **An empty plan is the answer to two different questions**, and both end the same way. It means
 * the prompt must not be offered — the row was purged, or this account was demoted or removed
 * between making the change and the queue reaching it — *and* it means the blocked write has to be
 * discarded rather than left queued, because nothing will ever unblock it and the flush loop is
 * stopped while it sits there. That is the brief's "a writer's write to the same thing just drops".
 *
 * **Both tombstones, not just the outermost.** An item binned inside a binned list needs the list
 * lifted *and* the item lifted. Restoring only the list would block the retry all over again on the
 * item, and ask a user who has already said yes to say it a second time.
 */
export function restorePlan(lists: List[], blocked: Blocked): WriteAction[] {
  const list = lists.find((candidate) => candidate.id === blocked.listId);
  if (!list) return [];

  const itemId = itemIdOf(blocked.op);
  const item = itemId ? list.items.find((candidate) => candidate.id === itemId) : undefined;

  const plan: WriteAction[] = [];

  if (list.deletedAt !== null && canManageList(list.role)) {
    plan.push({ type: 'list/setDeleted', id: list.id, deletedAt: null });
  }

  if (item && item.deletedAt !== null && canEditItems(list.role)) {
    plan.push({ type: 'item/setDeleted', listId: list.id, itemId: item.id, deletedAt: null });
  }

  // A list that is binned and cannot be lifted by this account makes the whole plan void: restoring
  // the item alone would leave it inside a list still in the bin, and the write would block again.
  if (list.deletedAt !== null && !canManageList(list.role)) return [];

  return plan;
}

/** Whether the blocked write was about a whole list rather than one item in it. */
export function blockedList(lists: List[], blocked: Blocked): boolean {
  const list = lists.find((candidate) => candidate.id === blocked.listId);
  return list !== undefined && list.deletedAt !== null;
}

/**
 * Which list an action is about. Written as a `switch` rather than `'listId' in op ? … : op.id`
 * precisely because the latter compiles forever: `list/renamed` and `list/setDeleted` name the list
 * `id` while the item actions name it `listId`, and only the exhaustive form makes TypeScript point
 * here when the next action arrives.
 */
export function listIdOf(op: WriteAction): string {
  switch (op.type) {
    case 'list/created':
    case 'list/renamed':
    case 'list/setDeleted':
      return op.id;

    case 'item/added':
    case 'item/renamed':
    case 'item/setDone':
    case 'item/setDeleted':
      return op.listId;
  }
}

/**
 * Which item an action is about, or `null` for the ones that are about a whole list. Exported for
 * the provider, which uses it to notice that a blocked write's target is not in state — a
 * tombstone beyond the first page of the bin — and to read that one row before asking here.
 */
export function itemIdOf(op: WriteAction): string | null {
  switch (op.type) {
    case 'item/added':
      return op.id;

    case 'item/renamed':
    case 'item/setDone':
    case 'item/setDeleted':
      return op.itemId;

    case 'list/created':
    case 'list/renamed':
    case 'list/setDeleted':
      return null;
  }
}
