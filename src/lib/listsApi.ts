import type { BinCursor, Cursor, CursorOf, Item, List, ListCounts, Role, Stream } from '../state/types';
import { ITEMS_FULL, LIMIT_CODES, LISTS_FULL, OWNED_LISTS_FULL } from './limits';
import { supabase } from './supabase';

/**
 * Every read and write of list data, and the only place that knows the database's column names —
 * `done_at` becomes `doneAt` here, so no row shape leaks into `src/state/`.
 *
 * Errors are returned rather than thrown, matching `SessionContext`: the provider turns them into
 * something the screen can render.
 */
export type Result = {
  error: string | null;
  verdict: Verdict;
  outcome?: WriteOutcome;
  /**
   * True exactly when `session_still_valid()` refused this write because the device's session was
   * revoked elsewhere — distinguished from an ordinary `42501` by message text, since both share the
   * errcode. Set before `writeResult` calls `humanize()`, which would otherwise erase the distinction.
   */
  sessionRevoked?: boolean;
};

/**
 * How the outbox is meant to read a failure.
 *
 * - `applied` — the write is already in the database. A retry caught up with itself.
 * - `retryable` — nothing is wrong with the write; the network or the server is. Send it again.
 * - `permanent` — the database refused it and always will. Drop it and tell the user.
 */
export type Verdict = 'ok' | 'applied' | 'retryable' | 'permanent';

/**
 * What a successful write says about its target, from the database's `write_outcome` enum.
 *
 * `target_deleted` is **not** a failure and must not be classified as one: the request was accepted,
 * the caller was allowed to make it, and the write simply had nothing live to land on because
 * somebody put the list or the item in the bin. It arrives alongside `verdict: 'ok'` for exactly
 * that reason — the outbox is right to consider the request delivered, and it is the provider that
 * decides whether to offer a restore, from the role it already holds.
 */
export type WriteOutcome = 'applied' | 'target_deleted';

/**
 * PostgREST's `max_rows`, mirrored from `supabase/config.toml` (`[api] max_rows`) so the cap is
 * visible in the code that hits it. Keep the two equal by hand: the config value is a **silent**
 * ceiling — a request for more rows, top-level or embedded, comes back with exactly this many, no
 * error, no header — so nothing here can discover it at runtime. Every explicit limit below is
 * `<= MAX_ROWS` by construction, and both paged reads assert it rather than trust the caller.
 */
export const MAX_ROWS = 1000;

/**
 * Rows per page, from a budget of 100 kB per request: 100,000 B ÷ 239 B for the worst realistic
 * row (uuid, three timestamps, a 40-character title, as PostgREST serialises them) is 418, rounded
 * down. Typical rows are ~183 B, so a full page is ~73 kB. The budget assumes titles of ~40
 * characters or fewer — the column has no length check, so this is a promise about how the app is
 * used, not a guarantee the schema enforces. Bounded above by `MAX_ROWS` by construction.
 */
export const PAGE_SIZE = 400;

/**
 * Lists per page — the user's number (task 23). A list row is a name, a role and three
 * identifiers, far smaller than an item row, so this is nowhere near the item budget above; it is
 * about how many rows the Lists screen is worth drawing before a scroll asks for more. Bounded above
 * by `MAX_ROWS`, and asserted, exactly as `PAGE_SIZE` is.
 */
export const LIST_PAGE_SIZE = 100;

/** Structural, so this module stays the only one importing anything from supabase-js. */
type Failure = { message: string; code?: string | null } | null;

const ITEM_COLUMNS = 'id, title, done_at, deleted_at, created_at';

/**
 * Both list reads select this. `created_at` is the membership's — when you joined the list — and
 * is what lists are ordered and paged by; the list's own timestamps are not read at all.
 */
const MEMBERSHIP_COLUMNS = 'role, created_at, lists!inner ( id, name, deleted_at )';

type ItemRow = {
  id: string;
  title: string;
  done_at: string | null;
  deleted_at: string | null;
  created_at: string;
};
type ListRow = { id: string; name: string; deleted_at: string | null };
type MembershipRow = { role: Role; created_at: string; lists: ListRow };

/**
 * The next page of one stream of *lists* — live, or the bin — rooted at `list_members` rather than
 * at `lists`, list metadata only, no items.
 *
 * That rooting is the whole read path, not a stylistic choice. Asking `lists` "which of you may I
 * see" makes the top-level scan proportional to how many lists *exist*; asking `list_members`
 * "which memberships do I have, and what hangs off each" makes it proportional to how many lists
 * *you are in*, with `lists` reached by primary key from there. Row-level security supplies
 * `user_id = auth.uid()`, which is an index qual on `(user_id, created_at)` — so the client still
 * filters nothing, and none of this is a rule a bug here could get wrong.
 *
 * **The live stream is paged the way `fetchItems` pages it, keyset on `(created_at, list_id)` of the
 * membership** — when you joined, which is the order the Lists screen has always shown. The stream
 * is picked through the `!inner` embed's `deleted_at`, which filters the membership rows themselves,
 * not just the embed. The `gte` beside the keyset `or` is redundant in meaning and there for the
 * plan, as in `fetchItems`: it makes the index condition a range starting at the cursor.
 *
 * **The bin is paged newest deletion first, keyset on the list's `(deleted_at, id)`**, the order the
 * bin view shows. Both the order and the keyset go through the embed:
 * - `order=lists(deleted_at).desc` orders the *parent* rows by the to-one embed's column.
 *   `referencedTable` would order the embed's own rows instead, which does nothing for a to-one.
 * - The keyset `or` *is* given `referencedTable`. With `!inner`, an embed filter drops the parent row.
 *
 * No index can serve an order whose key is across the join, so every bin page — not only page 1 —
 * walks all of your memberships, joins `lists` by primary key, sorts and takes a page. That cost is
 * accepted, and measured in task 24 step 2: 1,638 buffers / ~1 ms at 402 memberships, 8,086 / ~5 ms
 * at 2,000. The `lte` is kept as the twin of the live `gte`, though nothing here can use it.
 *
 * `next` follows `fetchItems`' rule: the last row of a **full** page, `null` otherwise, which is why
 * `limit` is asserted against `MAX_ROWS` rather than trusted.
 *
 * **Items are not part of this read.** `fetchItems` reads a list's items — both streams, a page at
 * a time — once you actually enter that list, never for every row on this screen.
 */
export async function fetchLists<S extends Stream>(
  stream: S,
  after: CursorOf<S> | null,
  limit = LIST_PAGE_SIZE
): Promise<{ lists: List[] | null; next: CursorOf<S> | null; error: string | null }> {
  if (limit > MAX_ROWS) {
    throw new Error(`fetchLists: a page of ${limit} rows would be silently capped at ${MAX_ROWS}`);
  }

  const { data, error } = await (stream === 'live'
    ? liveListPage(after as Cursor | null, limit)
    : binListPage(after as BinCursor | null, limit));

  if (error) return { lists: null, next: null, error: error.message };
  const rows = data as unknown as MembershipRow[];
  const last = rows[rows.length - 1];
  const next =
    rows.length < limit
      ? null
      : stream === 'live'
        ? { createdAt: last.created_at, id: last.lists.id }
        : { deletedAt: last.lists.deleted_at as string, id: last.lists.id };
  return { lists: rows.map(toList), next: next as CursorOf<S> | null, error: null };
}

/** `fetchLists`' live stream: when you joined, oldest first. */
function liveListPage(after: Cursor | null, limit: number) {
  let query = supabase.from('list_members').select(MEMBERSHIP_COLUMNS).is('lists.deleted_at', null);
  if (after) {
    // Quoted, because a timestamp carries `:` and `+`, both reserved inside a logic tree.
    query = query
      .gte('created_at', after.createdAt)
      .or(
        `created_at.gt."${after.createdAt}",and(created_at.eq."${after.createdAt}",list_id.gt."${after.id}")`
      );
  }
  return query.order('created_at').order('list_id').limit(limit);
}

/** `fetchLists`' bin: when each list was deleted, newest first. */
function binListPage(after: BinCursor | null, limit: number) {
  let query = supabase
    .from('list_members')
    .select(MEMBERSHIP_COLUMNS)
    .not('lists.deleted_at', 'is', null);
  if (after) {
    query = query
      .lte('lists.deleted_at', after.deletedAt)
      .or(
        `deleted_at.lt."${after.deletedAt}",and(deleted_at.eq."${after.deletedAt}",id.lt."${after.id}")`,
        { referencedTable: 'lists' }
      );
  }
  return query
    .order('lists(deleted_at)', { ascending: false })
    .order('list_id', { ascending: false })
    .limit(limit);
}

/**
 * The next page of one stream of one list — the one read rooted at `items` rather than at
 * `list_members`, and measured for it: as `authenticated` at 1M rows the plan is an index scan on
 * `(list_id, created_at)` whose cost tracks *this page*, never the table. The `.eq('list_id')` is
 * not the client filtering for authorization — row-level security still decides what is visible —
 * it picks the list.
 *
 * **Keyset, not offset, and the tie-break is not optional.** An offset drifts: the live stream
 * loses rows while you scroll — somebody bins one — and page 3 skips a row. `(created_at, id)`
 * skips nothing. The `or` is the keyset itself; the `gte` beside it is redundant in meaning and
 * decisive in the plan, since it is what turns the index condition into a range starting at the
 * cursor rather than at the first row of the list (measured: 23 buffers against 121).
 *
 * **The bin is read newest deletion first, keyset on `(deleted_at, id)` descending**, and its `lte`
 * is the descending twin of that `gte`. Its index is the partial `items_bin_order_idx` on
 * `(list_id, deleted_at, id)`. With it, page 1 — the page every list open and every re-read asks
 * for — is a backward walk of this list's bin that stops after one page. Without it, page 1 walked
 * every list's deletions, newest first.
 *
 * `next` is the last row when the page came back **full**, and `null` otherwise: a short page is
 * the last page. That rule is why a page must never be silently shortened by the cap, so `limit`
 * is asserted against `MAX_ROWS` rather than trusted.
 */
export async function fetchItems<S extends Stream>(
  listId: string,
  stream: S,
  after: CursorOf<S> | null,
  limit = PAGE_SIZE
): Promise<{ items: Item[] | null; next: CursorOf<S> | null; error: string | null }> {
  if (limit > MAX_ROWS) {
    throw new Error(`fetchItems: a page of ${limit} rows would be silently capped at ${MAX_ROWS}`);
  }

  const { data, error } = await (stream === 'live'
    ? liveItemPage(listId, after as Cursor | null, limit)
    : binItemPage(listId, after as BinCursor | null, limit));

  if (error) return { items: null, next: null, error: error.message };
  const rows = data as unknown as ItemRow[];
  return { items: rows.map(toItem), next: cursorAfter(rows, stream, limit), error: null };
}

/** `fetchItems`' live stream: when each row was added, oldest first. */
function liveItemPage(listId: string, after: Cursor | null, limit: number) {
  let query = supabase.from('items').select(ITEM_COLUMNS).eq('list_id', listId).is('deleted_at', null);
  if (after) {
    // Quoted, because a timestamp carries `:` and `+`, both reserved inside a logic tree.
    query = query
      .gte('created_at', after.createdAt)
      .or(
        `created_at.gt."${after.createdAt}",and(created_at.eq."${after.createdAt}",id.gt."${after.id}")`
      );
  }
  return query.order('created_at').order('id').limit(limit);
}

/** `fetchItems`' bin: when each row was deleted, newest first. */
function binItemPage(listId: string, after: BinCursor | null, limit: number) {
  let query = supabase
    .from('items')
    .select(ITEM_COLUMNS)
    .eq('list_id', listId)
    .not('deleted_at', 'is', null);
  if (after) {
    query = query
      .lte('deleted_at', after.deletedAt)
      .or(
        `deleted_at.lt."${after.deletedAt}",and(deleted_at.eq."${after.deletedAt}",id.lt."${after.id}")`
      );
  }
  return query.order('deleted_at', { ascending: false }).order('id', { ascending: false }).limit(limit);
}

/**
 * One row by primary key, for the provider's blocked-write path: the tombstone a queued write
 * landed on may be beyond the first page of the bin, and `restorePlan` can only offer what is in
 * state. A row the caller may not see comes back `null` — purged, or the account was removed —
 * which is the right answer there, since the plan is empty for the same reason either way.
 */
export async function fetchItem(
  itemId: string
): Promise<{ item: Item | null; error: string | null }> {
  const { data, error } = await supabase
    .from('items')
    .select(ITEM_COLUMNS)
    .eq('id', itemId)
    .maybeSingle();

  if (error) return { item: null, error: error.message };
  return { item: data ? toItem(data as unknown as ItemRow) : null, error: null };
}

/**
 * One list's own metadata — the read a realtime nudge that names a list uses instead of asking
 * `fetchLists` for every page again, and the one the provider uses for a list it needs but has not
 * paged to: a blocked write's target, or the list a screen has open. Same root and columns as
 * `fetchLists`, filtered to one list via `list_members`'s own `list_id` column; row-level security
 * still supplies `user_id = auth.uid()`.
 *
 * `{ list: null, error: null }` means "not visible to me" — unshared, or the list is gone
 * (`list_members` cascades on `lists` delete) — and RLS cannot tell those apart any more than a row
 * simply missing from `fetchLists` can. **Not** the soft-delete case: the `lists` select policy
 * carries no `deleted_at` condition, so a list you are still a member of but that has been binned
 * comes back non-null, with `deletedAt` set, exactly as `fetchLists` has always returned it.
 */
export async function fetchList(
  listId: string
): Promise<{ list: List | null; error: string | null }> {
  const { data, error } = await supabase
    .from('list_members')
    .select(MEMBERSHIP_COLUMNS)
    .eq('list_id', listId)
    .maybeSingle();

  if (error) return { list: null, error: error.message };
  return { list: data ? toList(data as unknown as MembershipRow) : null, error: null };
}

/**
 * How many live lists you own and are on in total — the two numbers the database's list limits
 * count, from `my_list_counts()`, read beside page 1 of the lists on every full re-read. A paged
 * client cannot count them itself: it holds only the pages it has loaded.
 *
 * Rooted at `list_members` like both list reads, and `security invoker`, so row-level security
 * decides what is counted. A set-returning function, so PostgREST answers with a one-row array.
 */
export async function fetchListCounts(): Promise<{
  counts: ListCounts | null;
  error: string | null;
}> {
  const { data, error } = await supabase.rpc('my_list_counts');

  if (error) return { counts: null, error: error.message };
  // An aggregate always answers one row; `?? []` and the zeros are for a null body, as in
  // `fetchMembers`, rather than a crash.
  const [row] = (data ?? []) as ListCounts[];
  return { counts: { owned: row?.owned ?? 0, total: row?.total ?? 0 }, error: null };
}

/** `created_by` is deliberately not sent: it defaults to `auth.uid()` in the database. */
export async function insertList(id: string, name: string): Promise<Result> {
  const { error, status } = await supabase.from('lists').insert({ id, name });
  return writeResult(error, status);
}

/**
 * An RPC rather than a table insert, and the reason is soft delete.
 *
 * The `writers add items` policy checks *membership*, and membership is completely intact after a
 * list is binned — so a plain insert would be **accepted** into a deleted list. `add_item` is the
 * only place that can see the tombstone and say so.
 *
 * Retrying is still safe: the function inserts `on conflict (id) do nothing` and reports `applied`
 * either way, which replaces the SQLSTATE `23505` this used to lean on. (`insertList` still leans on
 * it — creating a list cannot land on a deleted target, so it stays a plain insert.)
 */
export async function addItem(id: string, listId: string, title: string): Promise<Result> {
  const { data, error, status } = await supabase.rpc('add_item', {
    p_id: id,
    p_list_id: listId,
    p_title: title,
  });
  return writeResult(error, status, data);
}

/**
 * Also an RPC now, and this one was owed regardless of deletion.
 *
 * It used to be the app's one direct `PATCH` of a table, with a `.select('id')` to notice that
 * row-level security had filtered a refused rename to *zero rows* — which PostgREST answers as
 * `204 No Content` and no error, indistinguishable from success. That worked, but zero rows could
 * only ever produce one sentence, and it could not tell **deleted** from **demoted**. Nor could any
 * amount of client code: RLS hides a list you were removed from exactly as thoroughly as one that is
 * gone, so only a `security definer` function can see which happened.
 */
export async function renameList(id: string, name: string): Promise<Result> {
  const { data, error, status } = await supabase.rpc('rename_list', {
    p_list_id: id,
    p_name: name,
  });
  return writeResult(error, status, data);
}

/**
 * Renaming an item, at the writer rung rather than the owner one.
 *
 * An RPC for the reason `set_item_done` is: the client holds no UPDATE privilege on `items` at all,
 * and a definer function is also the only thing that can tell a binned target from a refusal. Like
 * every other write here the value is absolute — the title the row should have — so a retry is
 * harmless and the outbox can replace a queued rename with a newer one.
 */
export async function renameItem(itemId: string, title: string): Promise<Result> {
  const { data, error, status } = await supabase.rpc('rename_item', {
    p_item_id: itemId,
    p_title: title,
  });
  return writeResult(error, status, data);
}

/**
 * Putting a list or an item in the bin, and taking it back out.
 *
 * A boolean rather than two verbs, exactly like `set_item_done`: the value is absolute, so a retry
 * is harmless and the outbox can replace a queued delete with a later restore and send one request.
 * The database stamps `deleted_at` from its own clock and no client holds the privilege to write
 * that column, which is what makes the purge's 30-day cutoff mean anything.
 *
 * Neither returns an outcome. Both raise `42501` when they change nothing, because "you may not do
 * this" is the only way they can fail — a delete cannot itself land on a deleted target.
 */
export async function setListDeleted(listId: string, deleted: boolean): Promise<Result> {
  const { error, status } = await supabase.rpc('set_list_deleted', {
    p_list_id: listId,
    p_deleted: deleted,
  });
  return writeResult(error, status);
}

export async function setItemDeleted(itemId: string, deleted: boolean): Promise<Result> {
  const { error, status } = await supabase.rpc('set_item_deleted', {
    p_item_id: itemId,
    p_deleted: deleted,
  });
  return writeResult(error, status);
}

/**
 * Sends what the item should *be*, never a flip, so a retry cannot double-apply.
 *
 * Through an RPC rather than an update because the client is not allowed to write `done_at` — the
 * database stamps the time from its own clock. The argument keys have to match the function's
 * parameter names exactly: PostgREST resolves the call by name, and a typo reads as "function not
 * found" rather than as a bad argument.
 */
export async function setItemDone(itemId: string, done: boolean): Promise<Result> {
  const { data, error, status } = await supabase.rpc('set_item_done', {
    p_item_id: itemId,
    p_done: done,
  });
  return writeResult(error, status, data);
}

/**
 * Shared with `membersApi.ts` and `notificationsApi.ts`, the online-only RPCs' seams: those calls
 * are answered while the user is still looking at the screen that caused them, so they keep the
 * database's own words rather than the rewritten sentences `writeResult` below gives the seven
 * outbox writes — all but a limit refusal at `acceptInvitation`, which is about the person holding
 * the phone and is rephrased there.
 */
export function resultFor(error: Failure, status: number): Result {
  if (!error) return { error: null, verdict: 'ok' };
  return {
    error: error.message,
    verdict: verdictFor(error.code ?? '', status),
    sessionRevoked: error.code === '42501' && error.message === SESSION_REVOKED_MESSAGE,
  };
}

/** The exact message `session_still_valid()` raises in `20260920000000_session_revocation.sql`. */
const SESSION_REVOKED_MESSAGE = 'this device has been signed out';

/**
 * `resultFor` for the seven writes that go through the outbox, which differ from the rest in two ways:
 * they can report an outcome, and their failures reach a red banner minutes or days after the tap
 * that caused them.
 *
 * **Only these are rephrased.** The membership RPCs keep the database's own words and must: they are
 * answered while the user is still looking at the screen that caused them, and `invite_to_list`'s
 * "that account no longer exists" is already the right sentence at the right moment. Rewriting those
 * would replace a specific, useful message with a vague one.
 */
function writeResult(error: Failure, status: number, data?: unknown): Result {
  const result = resultFor(error, status);
  if (error) return { ...result, error: humanize(error) };

  // `target_deleted` rides along with `ok`, not as a failure: the request was accepted and the
  // caller was allowed to make it — there was just nothing live left for it to land on.
  return data === 'target_deleted' ? { ...result, outcome: 'target_deleted' } : result;
}

/**
 * A sentence for the failures a person can actually cause, instead of the database's own words.
 *
 * The raw text is written for whoever is reading a log — *"not allowed to change this item"*,
 * lowercase and unpunctuated — and until now it went straight to the red banner. The first two codes
 * below mean the same thing to the person holding the phone: a role that moved under their feet
 * between making a change and the queue getting it sent. The last three are a limit, reached by a
 * write the app did not warn about — a count gone stale, a restore, or the item limit, which it
 * never warns about.
 */
function humanize(error: NonNullable<Failure>): string {
  switch (error.code) {
    // Row-level security, or a definer function repeating a policy's predicate.
    case '42501':
      return 'You no longer have permission to make that change.';

    // The only check constraint a queued write can reach is `length(trim(...)) > 0`.
    case '23514':
      return 'That change is no longer valid.';

    // The three limits. The database's words are about somebody else — they are written for an
    // owner promoting a member on the Sharing screen, which shows them as they are — so a list you
    // created or restored, or an item you added, is told about in the second person instead.
    case LIMIT_CODES.ownedLists:
      return OWNED_LISTS_FULL;
    case LIMIT_CODES.lists:
      return LISTS_FULL;
    case LIMIT_CODES.items:
      return ITEMS_FULL;

    default:
      return error.message;
  }
}

/**
 * Classified from the status and the SQLSTATE, never from the message text — those two are the
 * stable signals, and postgrest-js retries nothing but GET/HEAD/OPTIONS, so every write here gets
 * exactly one attempt unless the outbox gives it another.
 *
 * The default direction is deliberate: a retry of a doomed write costs a spin, while dropping one
 * that would have succeeded costs the user their data. So `permanent` is a short list of things the
 * database has actually refused, and everything else — including anything unrecognised — is sent
 * again.
 */
function verdictFor(code: string, status: number): Exclude<Verdict, 'ok'> {
  // A duplicate key is this client's own insert catching up with itself: the row is already there,
  // under the id it minted. This is what makes a retried insert safe rather than a second row.
  if (code === '23505') return 'applied';

  // PostgREST answers `P0002` with 500 — measured, 2026-09-08 — and a 500 otherwise means "the
  // server is having a moment, send it again". The invitation RPCs raise it for "that account no
  // longer exists" and "this invitation is no longer open", neither of which will ever succeed on
  // a retry. As with 23505, the code decides and the status does not.
  if (code === 'P0002') return 'permanent';

  // A limit. These do arrive as 400 — measured, 2026-10-01 — but they are named rather than left to
  // the status rule below, for the reason `P0002` is: a limit refusal classified `retryable` would
  // be resent every 30 s forever, since the outbox has no attempt cap, and stall every write queued
  // behind it. The status a SQLSTATE gets is PostgREST's choice, not this schema's.
  if (isLimitCode(code)) return 'permanent';

  // Status 0 is how postgrest-js reports a failed fetch — no signal, DNS, TLS, a dropped socket.
  // In other words: offline, the case this whole feature exists for.
  if (status === 0 || status >= 500) return 'retryable';

  // An expired JWT. supabase-js refreshes the token, and the next attempt goes through.
  if (status === 401) return 'retryable';

  // 403 is row-level security refusing, and the rest of the 4xx family is constraint violations.
  // Neither improves with another attempt.
  if (status >= 400) return 'permanent';

  return 'retryable';
}

function isLimitCode(code: string): boolean {
  return (Object.values(LIMIT_CODES) as string[]).includes(code);
}

/**
 * Your role and when you joined travel with the membership row; the list itself hangs off it.
 *
 * `?? null` on the timestamps rather than a bare read. A column missing from the select string
 * arrives `undefined`, and `undefined !== null` is `true` everywhere downstream — so a typo in the
 * select above would silently render every list as deleted, which is the one failure the cache's
 * version check cannot save anybody from.
 *
 * `itemsLoaded: false` for every list, always: this read never carries items, so nothing here can
 * say otherwise. `fetchItems` is what fills a list in, once it is opened.
 */
function toList(row: MembershipRow): List {
  return {
    id: row.lists.id,
    name: row.lists.name,
    role: row.role,
    deletedAt: row.lists.deleted_at ?? null,
    joinedAt: row.created_at ?? null,
    itemsLoaded: false,
    items: [],
    nextLive: null,
    nextBin: null,
  };
}

function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    title: row.title,
    doneAt: row.done_at ?? null,
    deletedAt: row.deleted_at ?? null,
    createdAt: row.created_at,
  };
}

/**
 * Where the page after `rows` starts, in `stream`'s own key — or `null` when a short page says the
 * stream has ended.
 */
function cursorAfter<S extends Stream>(rows: ItemRow[], stream: S, limit: number): CursorOf<S> | null {
  if (rows.length < limit) return null;
  const last = rows[rows.length - 1];
  const next: Cursor | BinCursor =
    stream === 'live'
      ? { createdAt: last.created_at, id: last.id }
      : { deletedAt: last.deleted_at as string, id: last.id };
  return next as CursorOf<S>;
}
