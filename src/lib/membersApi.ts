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
 * The roster, and the three ways to change it — plus inviting somebody onto it, which changes it
 * only once they accept (task 28, D1: nobody becomes a member without saying yes).
 *
 * All of these are RPCs because the `list_members` select policy shows you exactly one row — your
 * own — and a select policy also gates what UPDATE and DELETE may touch, so an owner acting on
 * somebody else has to go through a `security definer` function. `leaveList` needs no such
 * function-per-target reasoning — it only ever touches the caller's own row, which the select
 * policy already always shows them — but it stays an RPC anyway, for the session guard and to raise
 * loudly rather than answer a refusal with a silent zero-row `204`. `list_members_of` is gated on
 * the caller's own membership, so a reader gets the full roster and a stranger gets nothing; the
 * invitation tables have no policy at all, so `pending_invitations_of` answers an owner and gives
 * everyone else an empty list.
 *
 * None of these go through the outbox. `inviteToList` takes an id a `searchUsers` suggestion already
 * resolved, so there is nothing left to answer while the user is looking at the screen — but the
 * roster and the invitations it changes are uncached and online-only, like the rest of this file.
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

/** Somebody a search-by-name turned up — enough to show and to invite, nothing else. */
export type UserSuggestion = { userId: string; name: string };

type UserSuggestionRow = { user_id: string; name: string };

/**
 * At most 5 other named accounts whose name contains `query`, for `UserAutocomplete`'s live search.
 * A failure here resolves quietly to `null` rather than throwing: a search that comes up empty is
 * not something worth an error banner mid-keystroke.
 *
 * With `listId`, an owner of that list is not offered its members or anyone already invited to it —
 * filtered before the five are picked, so the filter never shrinks the suggestions. The database
 * ignores a list the caller does not own, so a list id is no way to probe somebody else's roster.
 */
export async function searchUsers(
  query: string,
  listId?: string
): Promise<{ users: UserSuggestion[] | null; error: string | null }> {
  const { data, error } = await supabase.rpc(
    'search_users_by_name',
    listId === undefined ? { p_query: query } : { p_query: query, p_list_id: listId }
  );

  if (error) return { users: null, error: error.message };
  return { users: ((data ?? []) as UserSuggestionRow[]).map(toSuggestion), error: null };
}

/**
 * An open invitation to a list, as an owner of it sees one on Sharing. Suppressed ones are included
 * on purpose: an invitee who blocked the inviter stays *Invited* on this side until the invitation
 * expires (D2), so nothing here tells a block apart from a person who has not answered yet.
 */
export type PendingInvitation = {
  invitationId: string;
  userId: string;
  name: string;
  role: Role;
  createdAt: string;
};

type PendingInvitationRow = {
  invitation_id: string;
  user_id: string;
  name: string;
  role: Role;
  created_at: string;
};

/** A list's open invitations, oldest first — empty for anyone who is not an owner of it. */
export async function fetchInvitations(
  listId: string
): Promise<{ invitations: PendingInvitation[] | null; error: string | null }> {
  const { data, error } = await supabase.rpc('pending_invitations_of', { p_list_id: listId });

  if (error) return { invitations: null, error: error.message };
  // A null body is an empty list, as `fetchMembers` reads one.
  return { invitations: ((data ?? []) as PendingInvitationRow[]).map(toInvitation), error: null };
}

/**
 * Asks somebody onto a list with `role`. Nothing changes on the roster until they accept, and the
 * list limits are theirs to meet then, not the owner's now. "Already" refusals — they are a member,
 * or already invited — come back as `22023`, never `23505`, which `verdictFor` would read as
 * `applied`.
 */
export async function inviteToList(listId: string, userId: string, role: Role): Promise<Result> {
  const { error, status } = await supabase.rpc('invite_to_list', {
    p_list_id: listId,
    p_user_id: userId,
    p_role: role,
  });
  return resultFor(error, status);
}

/** Any owner of the list may withdraw an open invitation, not only whoever sent it. */
export async function withdrawInvitation(invitationId: string): Promise<Result> {
  const { error, status } = await supabase.rpc('withdraw_invitation', {
    p_invitation_id: invitationId,
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

/** A reader or writer removing their own membership — the one case `removeMember` can't reach. */
export async function leaveList(listId: string): Promise<Result> {
  const { error, status } = await supabase.rpc('leave_list', { p_list_id: listId });
  return resultFor(error, status);
}

function toMember(row: MemberRow): Member {
  return { userId: row.user_id, email: row.email, name: row.name, role: row.role };
}

function toSuggestion(row: UserSuggestionRow): UserSuggestion {
  return { userId: row.user_id, name: row.name };
}

function toInvitation(row: PendingInvitationRow): PendingInvitation {
  return {
    invitationId: row.invitation_id,
    userId: row.user_id,
    name: row.name,
    role: row.role,
    createdAt: row.created_at,
  };
}
