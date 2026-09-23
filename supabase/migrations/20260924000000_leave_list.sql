-- Task 19: a reader/writer can remove themselves from a list they don't own.
--
-- An owner could already do this — `remove_member` only checks that the *caller* is an owner, not
-- that the target differs from them, and `list_members`'s self-only SELECT policy means the caller's
-- own row is always visible to `security definer` code regardless of role. A reader or writer has no
-- such path: `remove_member` rejects a non-owner caller outright with 42501, and there is no DELETE
-- policy on `list_members` a non-owner acting on their own row could reach either (only "owners
-- remove members," scoped to an owner caller). See select-policy-gates-update-and-delete and
-- refused-writes-return-zero-rows in ai/kb/entries/ for the full shape of why a policy can't just be
-- widened here.
--
-- `leave_list` is the fourth membership RPC, same shape as the other three: session-guarded, deletes
-- exactly the caller's own row, raises on refusal rather than returning silently. No special-casing
-- for a sole owner is needed — `keep_last_owner` already fires on this `delete` exactly as it does on
-- `remove_member`'s, so the one case that must stay blocked stays blocked for free.

create function public.leave_list(p_list_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.session_still_valid() then
    raise exception using errcode = '42501', message = 'this device has been signed out';
  end if;

  delete from public.list_members
   where list_id = p_list_id and user_id = (select auth.uid());

  if not found then
    raise exception using errcode = 'P0002', message = 'you are not a member of this list';
  end if;
end;
$$;

revoke execute on function public.leave_list(uuid) from public, anon;
grant execute on function public.leave_list(uuid) to authenticated;
