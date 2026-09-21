import { resultFor, type Result } from './listsApi';
import { supabase } from './supabase';

type ProfileRow = { name: string | null };

/**
 * The signed-in account's own name. A plain read, not an RPC: the "read own row" policy on
 * `public.users` already scopes it, and there is no business logic here the way there is for
 * `set_name`'s uniqueness check. `name: null` means "not chosen yet" — the fact the gate exists to
 * close.
 */
export async function fetchProfile(
  userId: string
): Promise<{ name: string | null; error: string | null }> {
  const { data, error } = await supabase.from('users').select('name').eq('id', userId).maybeSingle();
  if (error) return { name: null, error: error.message };
  return { name: (data as ProfileRow | null)?.name ?? null, error: null };
}

/**
 * `set_name` is `security definer`, not a plain `.update()`: only the database can catch a
 * uniqueness collision and re-raise it as `'that name is taken'`. Answered synchronously, like the
 * membership RPCs in `membersApi.ts` — the caller is still looking at the screen that caused this
 * call, so the database's own words are kept rather than rewritten.
 */
export async function setName(name: string): Promise<Result> {
  const { error, status } = await supabase.rpc('set_name', { p_name: name.trim() });
  return resultFor(error, status);
}
