import AsyncStorage from '@react-native-async-storage/async-storage';

import type { WriteAction } from '../state/types';
import { inOrder } from './storageQueue';

/**
 * Writes the database has not acknowledged yet, on disk, in the order they were made.
 *
 * The entries are the reducer's own actions rather than a second vocabulary for "a write", which is
 * what lets `src/state/replay.ts` fold them back over fetched rows with the reducer itself.
 *
 * Order is load-bearing: `items.list_id` is a foreign key, so an item insert must never overtake
 * the list insert it depends on. The flush loop in `ListsContext` sends the head and stops on the
 * first failure it cannot resolve.
 */
const VERSION = 1;

const keyFor = (userId: string) => `outbox:${userId}`;

export async function loadOutbox(userId: string): Promise<WriteAction[]> {
  const raw = await AsyncStorage.getItem(keyFor(userId));
  if (!raw) return [];

  const ops = parse(raw);
  if (ops) return ops;

  // Unsent writes are the promise this feature makes, so a blob that cannot be replayed is moved
  // aside where it can still be recovered by hand — never silently overwritten.
  await inOrder(async () => {
    await AsyncStorage.setItem(`${keyFor(userId)}:broken`, raw);
    await AsyncStorage.removeItem(keyFor(userId));
  });
  return [];
}

export function saveOutbox(userId: string, ops: WriteAction[]): Promise<void> {
  return inOrder(() => AsyncStorage.setItem(keyFor(userId), JSON.stringify({ v: VERSION, ops })));
}

/**
 * Appends — except for a write that supersedes one already waiting, which replaces it where it
 * stands. Those writes carry absolute values, so only the newest one is worth sending: ticking a
 * checkbox five times on a train is one request, and so is renaming a list five times. Inserts are
 * never coalesced; their ids are unique by construction, and each one is a different row.
 */
export function enqueue(ops: WriteAction[], op: WriteAction): WriteAction[] {
  const index = ops.findIndex((candidate) => supersedes(op, candidate));
  if (index === -1) return [...ops, op];

  const next = [...ops];
  next[index] = op;
  return next;
}

/**
 * Puts `op` at the **front**, for the one caller that needs to overtake what is already queued: a
 * restore offered because the write at the head of the queue landed on something in the bin. That
 * write is still queued and still first, so appending the restore would send it *after* the thing it
 * was meant to unblock, and the same refusal would come back.
 *
 * Deliberately not folded into `enqueue` as a flag. Every ordinary write appends; this is the
 * exception, and it should look like one at the call site.
 */
export function queueFirst(ops: WriteAction[], op: WriteAction): WriteAction[] {
  return [op, ...ops.filter((candidate) => !supersedes(op, candidate))];
}

/**
 * Whether sending `op` makes `queued` pointless: the same absolute value, about the same thing.
 *
 * **Note the `default`, which is why this one does not defend itself.** The other switches over
 * `WriteAction` in this file and in the provider are exhaustive, so a new action breaks the build
 * until every one of them has been considered. This arm silently answers "no" instead, so a new
 * absolute-valued write coalesces only if someone remembers to add it here.
 */
function supersedes(op: WriteAction, queued: WriteAction): boolean {
  switch (op.type) {
    case 'item/setDone':
      return queued.type === 'item/setDone' && queued.itemId === op.itemId;

    case 'item/setDeleted':
      return queued.type === 'item/setDeleted' && queued.itemId === op.itemId;

    case 'list/renamed':
      return queued.type === 'list/renamed' && queued.id === op.id;

    case 'list/setDeleted':
      return queued.type === 'list/setDeleted' && queued.id === op.id;

    default:
      return false;
  }
}

/**
 * Drops what a permanently refused write leaves stranded: an item cannot be inserted into a list
 * the database rejected, and a toggle cannot reach an item that was never inserted. Without this,
 * one refusal becomes a burst of error banners — each a foreign key complaining about the first.
 */
export function dropDependents(ops: WriteAction[], failed: WriteAction): WriteAction[] {
  switch (failed.type) {
    case 'list/created':
      return ops.filter((op) => {
        // Every other list insert stands; a rename and a delete both name the list by `id`,
        // everything else by `listId`. All of them are about a list the database says does not
        // exist. The two `id` cases have to be spelled out — leaving either to the final line is a
        // type error, which is the union earning its keep.
        if (op.type === 'list/created') return true;
        if (op.type === 'list/renamed') return op.id !== failed.id;
        if (op.type === 'list/setDeleted') return op.id !== failed.id;
        return op.listId !== failed.id;
      });

    case 'item/added':
      // Both of the item's own writes are stranded by a refused insert. Note that this arm is a
      // filter predicate rather than a `switch`, so nothing here breaks the build when a new item
      // action appears — it just silently keeps it.
      return ops.filter(
        (op) =>
          (op.type !== 'item/setDone' || op.itemId !== failed.id) &&
          (op.type !== 'item/setDeleted' || op.itemId !== failed.id)
      );

    // None of these strand anything: the list and the item both still exist, and the write that was
    // refused was only ever about their contents. A refused *delete* leaves the row exactly as it
    // was, so anything queued behind it is still perfectly sendable.
    case 'list/renamed':
    case 'list/setDeleted':
    case 'item/setDone':
    case 'item/setDeleted':
      return ops;
  }
}

function parse(raw: string): WriteAction[] | null {
  try {
    const stored = JSON.parse(raw) as { v?: unknown; ops?: unknown };
    if (stored.v !== VERSION || !Array.isArray(stored.ops)) return null;
    return stored.ops as WriteAction[];
  } catch {
    return null;
  }
}
