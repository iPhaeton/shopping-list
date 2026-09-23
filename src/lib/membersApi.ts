import type { Role } from '../state/types';
import { resultFor, type Result } from './listsApi';
import { supabase } from './supabase';

type MemberRow = { user_id: string; email: string; name: string | null; role: Role };

/**
 * Somebody who has access to a list. Not part of `State`: the roster is not cached, the reducer
 * models no members, and there is nothing for `replay` to fold — so it lives here with `Result`,
 * as an API shape, and the sharing screen holds it in `useState`.
 *
 * `name` is `null` for an account that hasn't cleared the name gate yet (pre-migration rows) — the
 * sharing screen falls back to `email` for those, never the reverse.
 */
export type Member = { userId: string; email: string; name: string | null; role: Role };

/**
 * The roster, and the three ways to change it.
 *
 * All four are RPCs because the `list_members` select policy shows you exactly one row — your own —
 * and a select policy also gates what UPDATE and DELETE may touch, so an owner acting on somebody
 * else has to go through a `security definer` function. `list_members_of` is gated on the caller's
 * own membership, so a reader gets the full roster and a stranger gets nothing.
 *
 * None of these go through the outbox. `shareList` takes an id a `searchUsers` suggestion already
 * resolved, so there is nothing left to answer while the user is looking at the screen — but the
 * roster it changes is still uncached and online-only, like the rest of this file.
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

/** Somebody a search-by-name turned up — enough to show and to share with, nothing else. */
export type UserSuggestion = { userId: string; name: string };

type UserSuggestionRow = { user_id: string; name: string };

/**
 * At most 5 other named accounts whose name contains `query`, for `UserAutocomplete`'s live search.
 * A failure here resolves quietly to `null` rather than throwing: a search that comes up empty is
 * not something worth an error banner mid-keystroke.
 */
export async function searchUsers(
  query: string
): Promise<{ users: UserSuggestion[] | null; error: string | null }> {
  const { data, error } = await supabase.rpc('search_users_by_name', { p_query: query });

  if (error) return { users: null, error: error.message };
  return { users: ((data ?? []) as UserSuggestionRow[]).map(toSuggestion), error: null };
}

export async function shareList(listId: string, userId: string, role: Role): Promise<Result> {
  const { error, status } = await supabase.rpc('share_list', {
    p_list_id: listId,
    p_user_id: userId,
    p_role: role,
  });
  return resultFor(error, status);
}

export async function setMemberRole(listId: string, userId: string, role: Role): Promise<Result> {
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

function toMember(row: MemberRow): Member {
  return { userId: row.user_id, email: row.email, name: row.name, role: row.role };
}

function toSuggestion(row: UserSuggestionRow): UserSuggestion {
  return { userId: row.user_id, name: row.name };
}
