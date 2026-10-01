import { initialState, listsReducer } from './listsReducer';
import type { List, State, WriteAction } from './types';

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
 *
 * Lists only, not the list cursors or counts: the fold starts from the empty ones, for a caller that
 * dispatches no counts of its own. One that read counts from the server folds with `replayState`.
 */
export function replay(lists: List[], ops: WriteAction[]): List[] {
  return replayState({ ...initialState, lists }, ops).lists;
}

/**
 * `replay` over a whole state, for a read that brought the list counts too: a pending create or bin
 * moves them exactly as it moves the lists, and — because each write action is idempotent by id —
 * one the fetched rows already reflect moves neither. No write action reads or moves the cursors,
 * so they come out as they went in.
 */
export function replayState(state: State, ops: WriteAction[]): State {
  return ops.reduce((folded, op) => listsReducer(folded, op), state);
}
