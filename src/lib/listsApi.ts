import type { Item, List } from '../state/types';
import { supabase } from './supabase';

/**
 * Every read and write of list data, and the only place that knows the database's column names —
 * `done_at` becomes `doneAt` here, so no row shape leaks into `src/state/`.
 *
 * Errors are returned rather than thrown, matching `SessionContext`: the provider turns them into
 * something the screen can render.
 */
export type Result = { error: string | null };

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
  const { error } = await supabase.from('lists').insert({ id, name });
  return { error: error?.message ?? null };
}

export async function insertItem(id: string, listId: string, title: string): Promise<Result> {
  const { error } = await supabase.from('items').insert({ id, list_id: listId, title });
  return { error: error?.message ?? null };
}

/** An absolute value, never a flip — see the `done_at` comment in the migration. */
export async function setItemDone(itemId: string, doneAt: string | null): Promise<Result> {
  const { error } = await supabase.from('items').update({ done_at: doneAt }).eq('id', itemId);
  return { error: error?.message ?? null };
}

function toList(row: ListRow): List {
  return { id: row.id, name: row.name, items: row.items.map(toItem) };
}

function toItem(row: ItemRow): Item {
  return { id: row.id, title: row.title, doneAt: row.done_at };
}
