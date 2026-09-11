import type { Item, List, Role } from '../state/types';
import { supabase } from './supabase';

/**
 * Every read and write of list data, and the only place that knows the database's column names —
 * `done_at` becomes `doneAt` here, so no row shape leaks into `src/state/`.
 *
 * Errors are returned rather than thrown, matching `SessionContext`: the provider turns them into
 * something the screen can render.
 */
export type Result = { error: string | null; verdict: Verdict; outcome?: WriteOutcome };

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

/** Structural, so this module stays the only one importing anything from supabase-js. */
type Failure = { message: string; code?: string | null } | null;

type ItemRow = {
  id: string;
  title: string;
  done_at: string | null;
  deleted_at: string | null;
  created_at: string;
};
type ListRow = { id: string; name: string; deleted_at: string | null; items: ItemRow[] };
type MembershipRow = { role: Role; lists: ListRow };
type MemberRow = { user_id: string; email: string; role: Role };

/**
 * Somebody who has access to a list. Not part of `State`: the roster is not cached, the reducer
 * models no members, and there is nothing for `replay` to fold — so it lives here with `Result`,
 * as an API shape, and the sharing screen holds it in `useState`.
 */
export type Member = { userId: string; email: string; role: Role };

/**
 * One round trip, rooted at `list_members` rather than at `lists`.
 *
 * That rooting is the whole read path, not a stylistic choice. Asking `lists` "which of you may I
 * see" makes the top-level scan proportional to how many lists *exist*; asking `list_members`
 * "which memberships do I have, and what hangs off each" makes it proportional to how many lists
 * *you are in*, with `lists` and `items` reached by primary key from there. Row-level security
 * supplies `user_id = auth.uid()`, which is an index qual on `(user_id, created_at)` — so the client
 * still filters nothing, and none of this is a rule a bug here could get wrong.
 *
 * Items are ordered here rather than with a second `referencedTable` spec, because that would be an
 * order two embeds deep and sorting a handful of items in JS is not worth the doubt.
 *
 * **Deleted rows come back too, and that is the point.** There is no `deleted_at is null` filter
 * here and none in the policies: a member has to be able to see a tombstone to restore it, so the
 * bin ships in the same round trip and ticking "Show deleted" is instant. The screens decide what to
 * render, through `liveItems` / `liveLists`. The signal that this trade has stopped paying is a list
 * whose deleted rows outnumber its live ones; the answer then is a second query behind the
 * checkbox, not a policy change.
 */
export async function fetchLists(): Promise<{ lists: List[] | null; error: string | null }> {
  const { data, error } = await supabase
    .from('list_members')
    .select(
      'role, lists!inner ( id, name, deleted_at, items ( id, title, done_at, deleted_at, created_at ) )'
    )
    .order('created_at');

  if (error) return { lists: null, error: error.message };
  return { lists: (data as unknown as MembershipRow[]).map(toList), error: null };
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

// --- Who else has access ---------------------------------------------------------------------

/**
 * The roster, and the three ways to change it.
 *
 * All four are RPCs because the `list_members` select policy shows you exactly one row — your own —
 * and a select policy also gates what UPDATE and DELETE may touch, so an owner acting on somebody
 * else has to go through a `security definer` function. `list_members_of` is gated on the caller's
 * own membership, so a reader gets the full roster and a stranger gets nothing.
 *
 * None of these go through the outbox. `share_list` resolves the address server-side, so "no account
 * with that email yet" has to be answered while the user is still looking at the field they typed it
 * into — queued, it would arrive an hour later as an error about a stranger.
 */
export async function fetchMembers(
  listId: string
): Promise<{ members: Member[] | null; error: string | null }> {
  const { data, error } = await supabase.rpc('list_members_of', { p_list_id: listId });

  if (error) return { members: null, error: error.message };
  // `?? []` rather than a bare cast: a set-returning function with no rows to return can answer with
  // a null body, and an empty roster is a fine answer — a crash is not.
  return { members: ((data ?? []) as MemberRow[]).map(toMember), error: null };
}

export async function shareList(listId: string, email: string, role: Role): Promise<Result> {
  const { error, status } = await supabase.rpc('share_list', {
    p_list_id: listId,
    p_email: email.trim(),
    p_role: role,
  });
  return resultFor(error, status);
}

export async function setMemberRole(
  listId: string,
  userId: string,
  role: Role
): Promise<Result> {
  const { error, status } = await supabase.rpc('set_member_role', {
    p_list_id: listId,
    p_user_id: userId,
    p_role: role,
  });
  return resultFor(error, status);
}

export async function removeMember(listId: string, userId: string): Promise<Result> {
  const { error, status } = await supabase.rpc('remove_member', {
    p_list_id: listId,
    p_user_id: userId,
  });
  return resultFor(error, status);
}

function resultFor(error: Failure, status: number): Result {
  if (!error) return { error: null, verdict: 'ok' };
  return { error: error.message, verdict: verdictFor(error.code ?? '', status) };
}

/**
 * `resultFor` for the seven writes that go through the outbox, which differ from the rest in two ways:
 * they can report an outcome, and their failures reach a red banner minutes or days after the tap
 * that caused them.
 *
 * **Only these are rephrased.** The membership RPCs keep the database's own words and must: they are
 * answered while the user is still looking at the screen that caused them, and `share_list`'s "no
 * account with that email yet" is already the right sentence at the right moment. Rewriting those
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
 * lowercase and unpunctuated — and until now it went straight to the red banner. Both codes below
 * mean the same thing to the person holding the phone: a role that moved under their feet between
 * making a change and the queue getting it sent.
 */
function humanize(error: NonNullable<Failure>): string {
  switch (error.code) {
    // Row-level security, or a definer function repeating a policy's predicate.
    case '42501':
      return 'You no longer have permission to make that change.';

    // The only check constraint a queued write can reach is `length(trim(...)) > 0`.
    case '23514':
      return 'That change is no longer valid.';

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
  // server is having a moment, send it again". The sharing RPCs raise it for "no account with that
  // email yet", which is the most likely thing to go wrong on the share screen and will never
  // succeed on a retry. As with 23505, the code decides and the status does not.
  if (code === 'P0002') return 'permanent';

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

/**
 * Your role travels with the membership row; the list itself hangs off it.
 *
 * `?? null` on both timestamps rather than a bare read. A column missing from the select string
 * arrives `undefined`, and `undefined !== null` is `true` everywhere downstream — so a typo in the
 * embed above would silently render every row as deleted, which is the one failure the cache's
 * version check cannot save anybody from.
 */
function toList(row: MembershipRow): List {
  const items = [...row.lists.items].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  return {
    id: row.lists.id,
    name: row.lists.name,
    role: row.role,
    deletedAt: row.lists.deleted_at ?? null,
    items: items.map(toItem),
  };
}

function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    title: row.title,
    doneAt: row.done_at ?? null,
    deletedAt: row.deleted_at ?? null,
  };
}

function toMember(row: MemberRow): Member {
  return { userId: row.user_id, email: row.email, role: row.role };
}
