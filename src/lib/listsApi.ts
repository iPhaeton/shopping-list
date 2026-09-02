import type { Item, List } from '../state/types';
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

type ItemRow = { id: string; title: string; done_at: string | null };
type ListRow = { id: string; name: string; items: ItemRow[] };

/**
 * One round trip: `items ( ... )` is an embedded resource, so each list arrives with its own items
 * nested. Row-level security scopes both tables to the signed-in owner, so there is no user filter
 * here — and none that a bug could get wrong.
 */
export async function fetchLists(): Promise<{ lists: List[] | null; error: string | null }> {
  const { data, error } = await supabase
    .from('lists')
    .select('id, name, items ( id, title, done_at )')
    .order('created_at')
    .order('created_at', { referencedTable: 'items' });

  if (error) return { lists: null, error: error.message };
  return { lists: (data as ListRow[]).map(toList), error: null };
}

/** `owner_id` is deliberately not sent: it defaults to `auth.uid()` in the database. */
export async function insertList(id: string, name: string): Promise<Result> {
  const { error, status } = await supabase.from('lists').insert({ id, name });
  return resultFor(error, status);
}

export async function insertItem(id: string, listId: string, title: string): Promise<Result> {
  const { error, status } = await supabase.from('items').insert({ id, list_id: listId, title });
  return resultFor(error, status);
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

function toList(row: ListRow): List {
  return { id: row.id, name: row.name, items: row.items.map(toItem) };
}

function toItem(row: ItemRow): Item {
  return { id: row.id, title: row.title, doneAt: row.done_at };
}
