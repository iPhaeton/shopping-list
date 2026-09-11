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
  /**
   * When the database created the row, stamped by its clock. `null` only for an optimistic row the
   * database has not acknowledged — the reducer mints no timestamps, and carrying one on
   * `item/added` would change the outbox's stored shape for nothing. Rows are ordered by this, and
   * `null` sorts last, which is where an appended row lands anyway.
   */
  createdAt: string | null;
};

/**
 * Where the next page of a stream starts: the `(created_at, id)` of the last row loaded. Keyset
 * rather than an offset, because the live stream loses rows while you scroll — somebody bins one —
 * and an offset would then skip a row. The `id` tie-break is what makes it exact.
 */
export type Cursor = { createdAt: string; id: string };

/** A list's items arrive as two streams, paged independently: the live rows and the bin. */
export type Stream = 'live' | 'bin';

/**
 * What you may do with a list you can see. `reader` reads it, `writer` also adds items, renames
 * them and checks them off, `owner` also renames the list itself and manages who else has access.
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
  /**
   * Every row loaded so far, both streams, plus any optimistic rows. Fetched rows carry
   * `createdAt`; a page is inserted before the first row that does not, so the live view stays in
   * creation order with an item added offline still last.
   */
  items: Item[];
  /**
   * Where the next page of live rows starts. `null` means every live row is in `items`, which is
   * also what makes the "N of M done" summary exact.
   *
   * Required, like `deletedAt`: an older cached blob would rehydrate it as `undefined`, and
   * `undefined !== null` reads as "there is more", so the first scroll would ask for a page after
   * a cursor that does not exist.
   */
  nextLive: Cursor | null;
  /** The same for the bin. */
  nextBin: Cursor | null;
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
 * absolute value applied twice is the same result. The two renames carry one for the same reason,
 * and so do the two `setDeleted` actions — which is why deleting, restoring and deleting again
 * while offline coalesces into a single request.
 *
 * Note that neither delete action *removes* anything. `list/setDeleted` changes a list in place
 * rather than taking it out of the array: a binned list is still readable, still shared with the
 * same people, and one tap from being restored.
 */
export type Action =
  | { type: 'lists/loaded'; lists: List[] }
  /**
   * A page of one list's rows, read from the database. Idempotent by id — a row already here is
   * left alone, since its `doneAt` or `deletedAt` may have moved since — and the new ones go in
   * before the first optimistic row. `stream` moves that stream's cursor; omitted, the cursors
   * stay where they are, which is what a single-row read (the target of a blocked write) wants.
   * Not a write: nothing is owed to the database, so it never enters the outbox.
   */
  | {
      type: 'items/pageLoaded';
      listId: string;
      items: Item[];
      stream?: { name: Stream; next: Cursor | null };
    }
  | { type: 'list/created'; id: string; name: string }
  | { type: 'list/renamed'; id: string; name: string }
  | { type: 'list/setDeleted'; id: string; deletedAt: string | null }
  | { type: 'item/added'; listId: string; id: string; title: string }
  | { type: 'item/renamed'; listId: string; itemId: string; title: string }
  | { type: 'item/setDone'; listId: string; itemId: string; doneAt: string | null }
  | { type: 'item/setDeleted'; listId: string; itemId: string; deletedAt: string | null };

/**
 * The seven actions that owe the database a write. They are the outbox's entries as well as the
 * reducer's actions — `src/lib/outbox.ts` stores exactly these — which is what lets a pending write
 * be folded back over fetched rows with the reducer itself (`src/state/replay.ts`). The two reads
 * are excluded: neither owes anything, so neither is queued and neither is folded.
 */
export type WriteAction = Exclude<Action, { type: 'lists/loaded' } | { type: 'items/pageLoaded' }>;
