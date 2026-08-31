export type Item = {
  id: string;
  title: string;
  /** ISO timestamp of when the item was checked off; `null` while it is still to do. */
  doneAt: string | null;
};

export type List = {
  id: string;
  name: string;
  items: Item[];
};

export type State = {
  lists: List[];
};

/**
 * Ids and timestamps are carried on the action rather than generated inside the reducer, so the
 * reducer stays pure and deterministic. `ListsContext` mints them at dispatch time.
 *
 * `item/setDone` carries an absolute value rather than asking for a flip: a flip applied twice —
 * by a retried request, or by a second device — lands back where it started, while the same
 * absolute value applied twice is the same result.
 */
export type Action =
  | { type: 'lists/loaded'; lists: List[] }
  | { type: 'list/created'; id: string; name: string }
  | { type: 'item/added'; listId: string; id: string; title: string }
  | { type: 'item/setDone'; listId: string; itemId: string; doneAt: string | null };
