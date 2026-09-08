import type { Item, List, Role } from '../state/types';
import { supabase } from './supabase';

/**
 * Every read and write of list data, and the only place that knows the database's column names —
 * `done_at` becomes `doneAt` here, so no row shape leaks into `src/state/`.
 *
 * Errors are returned rather than thrown, matching `SessionContext`: the provider turns them into
 * something the screen can render.
 */
export type Result = { error: string | null; verdict: Verdict };

/**
 * How the outbox is meant to read a failure.
 *
 * - `applied` — the write is already in the database. A retry caught up with itself.
 * - `retryable` — nothing is wrong with the write; the network or the server is. Send it again.
 * - `permanent` — the database refused it and always will. Drop it and tell the user.
 */
export type Verdict = 'ok' | 'applied' | 'retryable' | 'permanent';

/** Structural, so this module stays the only one importing anything from supabase-js. */
type Failure = { message: string; code?: string | null } | null;

type ItemRow = { id: string; title: string; done_at: string | null; created_at: string };
type ListRow = { id: string; name: string; items: ItemRow[] };
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
 */
export async function fetchLists(): Promise<{ lists: List[] | null; error: string | null }> {
  const { data, error } = await supabase
    .from('list_members')
    .select('role, lists!inner ( id, name, items ( id, title, done_at, created_at ) )')
    .order('created_at');

  if (error) return { lists: null, error: error.message };
  return { lists: (data as unknown as MembershipRow[]).map(toList), error: null };
}

/** `created_by` is deliberately not sent: it defaults to `auth.uid()` in the database. */
export async function insertList(id: string, name: string): Promise<Result> {
  const { error, status } = await supabase.from('lists').insert({ id, name });
  return resultFor(error, status);
}

export async function insertItem(id: string, listId: string, title: string): Promise<Result> {
  const { error, status } = await supabase.from('items').insert({ id, list_id: listId, title });
  return resultFor(error, status);
}

/**
 * `.select()` is not decoration, and asking for the row back is the whole point of this function.
 *
 * Row-level security filters a refused rename down to *zero rows* rather than refusing it, and
 * PostgREST answers that with `204 No Content` and no error — measured against the local stack, as
 * a reader, on 2026-09-08. `resultFor` would read that as `ok`, the outbox would drop the write as
 * delivered, the new name would sit on screen looking saved, and the old one would come back at the
 * next fetch with nothing to explain it.
 *
 * Asking for the representation is what turns a silent no into a loud one — exactly what
 * `set_item_done`'s `raise` does one table over.
 */
export async function updateListName(id: string, name: string): Promise<Result> {
  const { data, error, status } = await supabase
    .from('lists')
    .update({ name })
    .eq('id', id)
    .select('id');

  if (error) return resultFor(error, status);
  if (data?.length) return { error: null, verdict: 'ok' };
  return { error: 'You can no longer rename this list.', verdict: 'permanent' };
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
  const { error, status } = await supabase.rpc('set_item_done', {
    p_item_id: itemId,
    p_done: done,
  });
  return resultFor(error, status);
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

/** Your role travels with the membership row; the list itself hangs off it. */
function toList(row: MembershipRow): List {
  const items = [...row.lists.items].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  return { id: row.lists.id, name: row.lists.name, role: row.role, items: items.map(toItem) };
}

function toItem(row: ItemRow): Item {
  return { id: row.id, title: row.title, doneAt: row.done_at };
}

function toMember(row: MemberRow): Member {
  return { userId: row.user_id, email: row.email, role: row.role };
}
