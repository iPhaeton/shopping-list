import { listsReducer } from './listsReducer';
import type { List, WriteAction } from './types';

/**
 * Server truth, with the writes the database has not seen yet folded back on top in the order they
 * were made.
 *
 * `lists/loaded` replaces the whole array, which is what makes a re-fetch a rollback — and what
 * would silently delete a write still sitting in the outbox. Replaying here, one level above the
 * reducer, keeps both properties: fetched rows win for everything settled, and an unsent write
 * survives until the database acknowledges it.
 *
 * The ops *are* reducer actions, so this is a fold rather than a second interpretation of what a
 * write means. A pending `item/added` therefore still lands after the pending `list/created` it
 * depends on, and an op the reducer cannot place — an item for a list that is gone — is dropped by
 * `updateList` exactly as it would have been live.
 */
export function replay(lists: List[], ops: WriteAction[]): List[] {
  return ops.reduce((state, op) => listsReducer(state, op), { lists }).lists;
}
