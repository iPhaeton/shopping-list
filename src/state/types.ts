export type Item = {
  id: string;
  title: string;
  /** ISO timestamp of when the item was checked off; `null` while it is still to do. */
  doneAt: string | null;
  /**
   * ISO timestamp of when the item was put in the bin; `null` while it is live. A deleted row is
   * still here — nothing is removed until the database's nightly purge collects it 30 days later —
   * so every count and every list must ask about this rather than assume.
   *
   * Required rather than optional on purpose. Made optional it would arrive `undefined` from any
   * older cached blob, and `undefined !== null` is `true`, so every item would render as deleted.
   */
  deletedAt: string | null;
};

/**
 * What you may do with a list you can see. `reader` reads it, `writer` also adds items and checks
 * them off, `owner` also renames it and manages who else has access.
 *
 * The database decides — every rule here is a row-level security policy — so this is for showing the
 * right controls, never for authorization.
 */
export type Role = 'reader' | 'writer' | 'owner';

export type List = {
  id: string;
  name: string;
  /** Your role on this list, from your `list_members` row. */
  role: Role;
  /** As on `Item`, and independent of it: restoring a list does not restore the items in its bin. */
  deletedAt: string | null;
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
 * absolute value applied twice is the same result. `list/renamed` carries one for the same reason,
 * and so do the two `setDeleted` actions — which is why deleting, restoring and deleting again
 * while offline coalesces into a single request.
 *
 * Note that neither delete action *removes* anything. `list/setDeleted` changes a list in place
 * rather than taking it out of the array: a binned list is still readable, still shared with the
 * same people, and one tap from being restored.
 */
export type Action =
  | { type: 'lists/loaded'; lists: List[] }
  | { type: 'list/created'; id: string; name: string }
  | { type: 'list/renamed'; id: string; name: string }
  | { type: 'list/setDeleted'; id: string; deletedAt: string | null }
  | { type: 'item/added'; listId: string; id: string; title: string }
  | { type: 'item/setDone'; listId: string; itemId: string; doneAt: string | null }
  | { type: 'item/setDeleted'; listId: string; itemId: string; deletedAt: string | null };

/**
 * The six actions that owe the database a write. They are the outbox's entries as well as the
 * reducer's actions — `src/lib/outbox.ts` stores exactly these — which is what lets a pending write
 * be folded back over fetched rows with the reducer itself (`src/state/replay.ts`).
 */
export type WriteAction = Exclude<Action, { type: 'lists/loaded' }>;
