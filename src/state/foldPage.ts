import type { Dispatch, MutableRefObject } from 'react';

import type { Action, WriteAction } from './types';

/**
 * A page is server truth, and what the screen shows is server truth with the outbox on top — so
 * the queue goes back over it, exactly as `replay` puts it over a fetch. Through `dispatch`
 * rather than `replay` because a page lands on whatever state holds *now*, and every write
 * action is idempotent by id: re-applying one to a row that already carries it changes nothing,
 * and applying it to a row the page just brought is the point.
 *
 * A plain function, not a hook: it closes over nothing render-scoped, so it is already stable
 * across renders and both `usePaging` and `useOutbox` can call it without adding it to a
 * dependency array.
 */
export function foldPage(
  dispatch: Dispatch<Action>,
  queue: MutableRefObject<WriteAction[]>,
  action: Extract<Action, { type: 'items/pageLoaded' } | { type: 'items/firstPageLoaded' }>
): void {
  dispatch(action);
  for (const queued of queue.current) dispatch(queued);
}
