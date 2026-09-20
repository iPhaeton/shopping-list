-- Closing the "sign out of all devices" gap for writes: `auth.signOut({ scope: 'global' })` deletes
-- the caller's row from `auth.sessions` and revokes its refresh token, but the *access token*
-- already issued to it is a self-contained JWT, checked by signature and expiry only — it stays
-- "valid" for up to `jwt_expiry` (1h, supabase/config.toml) after a global sign-out, on any device,
-- online or not. Confirmed directly against the local stack: the same access token that unlocked a
-- `GET /rest/v1/lists` (200) kept unlocking it after `POST /auth/v1/logout?scope=global` (204) — its
-- `auth.sessions` row was gone, but nothing on a normal request checks that.
--
-- A realtime "kick" broadcast was considered and rejected: delivery is at-most-once
-- (see the receive-policy migration, 20260909000000_realtime.sql), so a device offline at the
-- moment of sign-out never receives it, and reconnecting afterward does not force a token refresh —
-- it just resumes on the same stale-but-valid token.
--
-- Scope is writes only: a revoked device may still *read* briefly-stale data until its token
-- naturally expires, but the instant it tries to change anything, the check below fails it.

-- One helper so the predicate lives in one place. `security definer`, not `invoker` (the shape
-- `my_memberships()` uses two migrations back) — `authenticated` holds no grant at all on
-- `auth.sessions` (only `postgres` does), so an invoker version would fail outright regardless of
-- whether the session is valid.
--
-- Zero arguments, referencing nothing about the row it is checked beside — evaluated once per
-- statement, the same InitPlan shape `(select auth.uid())` and `my_memberships()` already get, not
-- the per-row `is_list_member(list_id, uid)` shape the sharing migration rejected on cost grounds.
-- Measured directly against a live `auth.sessions` table with `explain (analyze, buffers)`: 0.25ms.
create function public.session_still_valid()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.sessions where id = (auth.jwt() ->> 'session_id')::uuid
  );
$$;

revoke execute on function public.session_still_valid() from public, anon;
grant execute on function public.session_still_valid() to authenticated;

-- The nine write RPCs, unchanged except for one guard each, first statement inside `begin`. Raising
-- the same 42501 every permission refusal in this schema already raises: `verdictFor` in
-- src/lib/listsApi.ts already classifies it `permanent`, so the outbox drops the write, banners it,
-- and re-fetches — no client change needed. The message differs from a role refusal on purpose, so
-- the banner tells the truth about what happened. `set_item_done` and `rename_item` each have a
-- second, later `auth.uid()` check in their "cause 2" branch (telling a genuine permission refusal
-- from a tombstone) — that branch is unchanged, since the guard at the top already covers the whole
-- call.

create or replace function public.set_list_deleted(p_list_id uuid, p_deleted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated int;
begin
  if not public.session_still_valid() then
    raise exception using errcode = '42501', message = 'this device has been signed out';
  end if;

  update public.lists
     -- `coalesce` so a retry does not push the tombstone forward and reset the purge clock.
     set deleted_at = case when p_deleted then coalesce(deleted_at, now()) else null end
   where id = p_list_id
     and exists (
       select 1 from public.list_members m
        where m.list_id = lists.id and m.user_id = (select auth.uid()) and m.role = 'owner'
     );
  get diagnostics updated = row_count;

  if updated = 0 then
    raise exception using errcode = '42501',
      message = 'only an owner can delete or restore this list';
  end if;
end;
$$;

create or replace function public.set_item_deleted(p_item_id uuid, p_deleted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated int;
begin
  if not public.session_still_valid() then
    raise exception using errcode = '42501', message = 'this device has been signed out';
  end if;

  update public.items
     set deleted_at = case when p_deleted then coalesce(deleted_at, now()) else null end
   where id = p_item_id
     and exists (
       select 1 from public.list_members m
        where m.list_id = items.list_id
          and m.user_id = (select auth.uid())
          and m.role >= 'writer'
     );
  get diagnostics updated = row_count;

  if updated = 0 then
    raise exception using errcode = '42501', message = 'not allowed to change this item';
  end if;
end;
$$;

create or replace function public.set_item_done(p_item_id uuid, p_done boolean)
returns public.write_outcome
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated int;
begin
  if not public.session_still_valid() then
    raise exception using errcode = '42501', message = 'this device has been signed out';
  end if;

  update public.items
     set done_at = case when p_done then now() else null end
   where id = p_item_id
     and deleted_at is null
     and not exists (
       select 1 from public.lists l where l.id = items.list_id and l.deleted_at is not null
     )
     and exists (
       select 1 from public.list_members m
        where m.list_id = items.list_id
          and m.user_id = (select auth.uid())
          and m.role >= 'writer'
     );
  get diagnostics updated = row_count;

  if updated = 1 then return 'applied'; end if;

  -- Cause 1: purged out from under a write queued for longer than the bin holds. There is nothing
  -- to refuse and nothing to restore, so the client drops it quietly.
  if not exists (select 1 from public.items i where i.id = p_item_id) then
    return 'target_deleted';
  end if;

  -- Cause 2: a genuine permission refusal. Tested *before* the tombstone check on purpose, so this
  -- function never tells a non-member whether a row they cannot see is in the bin.
  if not exists (
    select 1 from public.items i
      join public.list_members m on m.list_id = i.list_id
     where i.id = p_item_id and m.user_id = (select auth.uid()) and m.role >= 'writer'
  ) then
    raise exception using errcode = '42501', message = 'not allowed to change this item';
  end if;

  -- Cause 3: the caller may write here, so the only thing left is a tombstone — on the item itself
  -- or on the list holding it.
  return 'target_deleted';
end;
$$;

create or replace function public.add_item(p_id uuid, p_list_id uuid, p_title text)
returns public.write_outcome
language plpgsql
security definer
set search_path = ''
as $$
declare
  list_deleted_at timestamptz;
begin
  if not public.session_still_valid() then
    raise exception using errcode = '42501', message = 'this device has been signed out';
  end if;

  select l.deleted_at into list_deleted_at from public.lists l where l.id = p_list_id;
  if not found then return 'target_deleted'; end if;

  if not exists (
    select 1 from public.list_members m
     where m.list_id = p_list_id and m.user_id = (select auth.uid()) and m.role >= 'writer'
  ) then
    raise exception using errcode = '42501', message = 'not allowed to add to this list';
  end if;

  if list_deleted_at is not null then return 'target_deleted'; end if;

  insert into public.items (id, list_id, title)
  values (p_id, p_list_id, p_title)
  on conflict (id) do nothing;

  return 'applied';
end;
$$;

create or replace function public.rename_list(p_list_id uuid, p_name text)
returns public.write_outcome
language plpgsql
security definer
set search_path = ''
as $$
declare
  list_deleted_at timestamptz;
begin
  if not public.session_still_valid() then
    raise exception using errcode = '42501', message = 'this device has been signed out';
  end if;

  select l.deleted_at into list_deleted_at from public.lists l where l.id = p_list_id;
  if not found then return 'target_deleted'; end if;

  if not exists (
    select 1 from public.list_members m
     where m.list_id = p_list_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'only an owner can rename this list';
  end if;

  if list_deleted_at is not null then return 'target_deleted'; end if;

  update public.lists set name = p_name where id = p_list_id;
  return 'applied';
end;
$$;

create or replace function public.rename_item(p_item_id uuid, p_title text)
returns public.write_outcome
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated int;
begin
  if not public.session_still_valid() then
    raise exception using errcode = '42501', message = 'this device has been signed out';
  end if;

  update public.items
     set title = p_title
   where id = p_item_id
     and deleted_at is null
     and not exists (
       select 1 from public.lists l where l.id = items.list_id and l.deleted_at is not null
     )
     and exists (
       select 1 from public.list_members m
        where m.list_id = items.list_id
          and m.user_id = (select auth.uid())
          and m.role >= 'writer'
     );
  get diagnostics updated = row_count;

  if updated = 1 then return 'applied'; end if;

  if not exists (select 1 from public.items i where i.id = p_item_id) then
    return 'target_deleted';
  end if;

  if not exists (
    select 1 from public.items i
      join public.list_members m on m.list_id = i.list_id
     where i.id = p_item_id and m.user_id = (select auth.uid()) and m.role >= 'writer'
  ) then
    raise exception using errcode = '42501', message = 'not allowed to change this item';
  end if;

  return 'target_deleted';
end;
$$;

create or replace function public.share_list(p_list_id uuid, p_email text, p_role public.list_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  if not public.session_still_valid() then
    raise exception using errcode = '42501', message = 'this device has been signed out';
  end if;

  if not exists (
    select 1 from public.list_members m
     where m.list_id = p_list_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'only an owner can share this list';
  end if;

  select u.id into target from public.users u where lower(u.email) = lower(trim(p_email));

  if target is null then
    raise exception using errcode = 'P0002', message = 'no account with that email yet';
  end if;

  if target = (select auth.uid()) then
    raise exception using errcode = '22023', message = 'you already have this list';
  end if;

  insert into public.list_members (list_id, user_id, role)
  values (p_list_id, target, p_role)
  on conflict (list_id, user_id) do update set role = excluded.role;
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
