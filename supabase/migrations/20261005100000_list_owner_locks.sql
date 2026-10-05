-- Concurrent owner changes (task 25 step 2, follow-up). Every function that can take an owner away
-- from a list now locks that list's `lists` row first, so two such changes to one list run one after
-- the other.
--
-- **The race this closes.** `keep_last_owner` and `delete_account` both ask "does another owner
-- remain?", and under READ COMMITTED neither sees the other's uncommitted change. Two co-owners
-- leaving at once, one leaving while the other deletes their account, or both deleting their accounts:
-- each saw the other as the owner who stays, and the list was left with none. Reproduced before this
-- migration as a list with zero owners and zero members (ai/tasks/25-account-deletion/
-- implementation-log-step-2-locks.md, R0).
--
-- **Why a lock is enough.** Each statement in a plpgsql function takes a fresh snapshot under READ
-- COMMITTED, so whoever waited counts the owners again as the other transaction left them. A leave or
-- a demotion is refused with 23514 ("a list must keep at least one owner"), a removal of someone
-- already gone with P0002, and an account deletion that now finds itself the only owner deletes the
-- list along with the account.
--
-- **`for no key update`, not `for update`.** Adding an item or a member takes `for key share` on the
-- list row for its foreign key, and only `for update` conflicts with that. This lock waits only for
-- another owner change or for an edit of the list row itself (rename, bin, restore).
--
-- **The RPCs lock before they write, not only in the trigger.** The trigger runs once its membership
-- row is already locked. A call holding a departing user's row that then waits in the trigger for the
-- list deadlocks with that user's `delete_account`, which holds the list and whose cascade needs the
-- row: measured as 40P01 (same log, T6). So each membership RPC takes the list first, and the order is
-- always the list, then its membership rows. The trigger keeps its own lock for writes made straight
-- to the table, which the policies allow an owner to make on their own row.
--
-- **`delete_account` locks every list the caller is on, owner or not, in id order.** Its cascade
-- writes the caller's membership row on each of them, so each list must be locked first, and the fixed
-- order makes two account deletions over the same lists wait for each other rather than deadlock. That
-- deadlock predates this migration: each deletion's list cascade reached the other's membership row.
-- One user is on at most 1,000 lists.
--
-- **Still open, both rare.** A list the caller joins after `delete_account` has taken its locks is not
-- locked; stranding it needs a share and then a leave to land inside that one call. And
-- `purge_deleted` deletes lists in its own scan order, so it can still deadlock with an account
-- deletion, or with an owner's direct write to the table, over the same binned lists at the same
-- instant. Postgres then aborts one of the two, and no list is stranded.
--
-- **The list limits stay lock-free.** These locks are per list and guard ownership only. The limits'
-- accepted overshoot (20261001000000_list_limits.sql) is a separate decision and is unchanged.
--
-- Each body below is its latest definition with one statement added. `create or replace` keeps every
-- grant and the trigger binding.

create or replace function public.keep_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only an owner row leaving — by demotion or by removal — can strand anything.
  if tg_op = 'UPDATE' then
    if old.role <> 'owner' or new.role = 'owner' then return new; end if;
  elsif old.role <> 'owner' then
    return old;
  end if;

  -- A cascade is not a stranding, and refusing one would abort the delete that caused it: an account
  -- deletion would fail rather than the list surviving its creator. Both referential actions fire
  -- after the parent row is already gone, so its absence is what distinguishes them from a member
  -- genuinely removing themselves.
  if not exists (select 1 from auth.users u where u.id = old.user_id)
     or not exists (select 1 from public.lists l where l.id = old.list_id) then
    return old;
  end if;

  -- Wait for any other owner change on this list, so the count below sees it committed.
  perform 1 from public.lists l where l.id = old.list_id for no key update;

  if not exists (
    select 1 from public.list_members m
     where m.list_id = old.list_id and m.user_id <> old.user_id and m.role = 'owner'
  ) then
    -- 23514 reaches PostgREST as 400, which `verdictFor` classifies `permanent`. Another attempt
    -- would be refused identically.
    raise exception using errcode = '23514', message = 'a list must keep at least one owner';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.leave_list(p_list_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.session_still_valid() then
    raise exception using errcode = '42501', message = 'this device has been signed out';
  end if;

  perform 1 from public.lists l where l.id = p_list_id for no key update;

  delete from public.list_members
   where list_id = p_list_id and user_id = (select auth.uid());

  if not found then
    raise exception using errcode = 'P0002', message = 'you are not a member of this list';
  end if;
end;
$$;

create or replace function public.set_member_role(p_list_id uuid, p_user_id uuid, p_role public.list_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.session_still_valid() then
    raise exception using errcode = '42501', message = 'this device has been signed out';
  end if;

  perform 1 from public.lists l where l.id = p_list_id for no key update;

  if not exists (
    select 1 from public.list_members m
     where m.list_id = p_list_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'only an owner can change roles on this list';
  end if;

  update public.list_members set role = p_role
   where list_id = p_list_id and user_id = p_user_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'that person is not a member of this list';
  end if;
end;
$$;

create or replace function public.remove_member(p_list_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.session_still_valid() then
    raise exception using errcode = '42501', message = 'this device has been signed out';
  end if;

  perform 1 from public.lists l where l.id = p_list_id for no key update;

  if not exists (
    select 1 from public.list_members m
     where m.list_id = p_list_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'only an owner can remove members from this list';
  end if;

  delete from public.list_members where list_id = p_list_id and user_id = p_user_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'that person is not a member of this list';
  end if;
end;
$$;

-- Its upsert can demote an owner, so it takes the same lock.
create or replace function public.share_list(p_list_id uuid, p_user_id uuid, p_role public.list_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.session_still_valid() then
    raise exception using errcode = '42501', message = 'this device has been signed out';
  end if;

  perform 1 from public.lists l where l.id = p_list_id for no key update;

  if not exists (
    select 1 from public.list_members m
     where m.list_id = p_list_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'only an owner can share this list';
  end if;

  if p_user_id = (select auth.uid()) then
    raise exception using errcode = '22023', message = 'you already have this list';
  end if;

  -- Defence in depth for a race (target deleted between search and share), not a normal path — the
  -- UI only ever calls this with an id a search result just returned.
  if not exists (select 1 from public.users u where u.id = p_user_id) then
    raise exception using errcode = 'P0002', message = 'that account no longer exists';
  end if;

  insert into public.list_members (list_id, user_id, role)
  values (p_list_id, p_user_id, p_role)
  on conflict (list_id, user_id) do update set role = excluded.role;
end;
$$;

create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.session_still_valid() then
    raise exception using errcode = '42501', message = 'this device has been signed out';
  end if;

  perform 1 from public.lists l
   where l.id in (select m.list_id from public.list_members m where m.user_id = (select auth.uid()))
   order by l.id
   for no key update;

  delete from public.lists l
   where exists (select 1 from public.list_members m
                  where m.list_id = l.id and m.user_id = (select auth.uid()) and m.role = 'owner')
     and not exists (select 1 from public.list_members m
                      where m.list_id = l.id and m.user_id <> (select auth.uid()) and m.role = 'owner');

  delete from auth.users where id = (select auth.uid());
end;
$$;
