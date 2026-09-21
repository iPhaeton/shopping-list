-- Every account gets a required, unique display name, set once after sign-in and editable after.
--
-- Nullable at the column level on purpose: `handle_new_user` (20260830000000_users.sql) mints a row
-- before any name exists, for both sign-in methods. "Required" is enforced by the client's gate, not
-- a NOT NULL constraint — see ai/suggestions/user-names.md for why Google's own name claim is not
-- seeded here (a collision there would abort the whole sign-up transaction). A `NULL` name does not
-- collide with another `NULL`: SQL unique constraints treat every `NULL` as distinct, so every
-- pre-gate account coexists fine until each sets one.
alter table public.users add column name text;
create unique index on public.users (lower(name));

-- The one write this feature needs. `security definer`, not a direct client grant on the column —
-- `rename_list`/`rename_item` already show this schema has moved off single-column client grants
-- even for an "own row" case, because only a definer function can turn a name collision into one
-- clean sentence instead of a raw constraint violation.
create function public.set_name(p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  trimmed text := trim(p_name);
begin
  if not public.session_still_valid() then
    raise exception using errcode = '42501', message = 'this device has been signed out';
  end if;

  if trimmed = '' then
    raise exception using errcode = '22023', message = 'please enter a name';
  end if;

  update public.users set name = trimmed where id = (select auth.uid());
exception
  -- A genuine collision with someone else's row, not this caller's own insert catching up with a
  -- retry the way `insertList` leans on 23505 — an UPDATE can't retry into a duplicate of itself the
  -- way an insert can. `verdictFor` in src/lib/listsApi.ts hard-codes `23505 -> 'applied'`, calibrated
  -- for that retried-insert case, so this is re-raised under a code that classifier has no special
  -- case for, carrying a message meant to be shown rather than swallowed.
  when unique_violation then
    raise exception using errcode = '22023', message = 'that name is taken';
end;
$$;

revoke execute on function public.set_name(text) from public, anon;
grant execute on function public.set_name(text) to authenticated;

-- `list_members_of` now also tells the sharing roster everyone's name. Its shape changes, so it is
-- dropped and recreated rather than `create or replace`d, and its grants — cleared by the drop — are
-- reissued.
drop function public.list_members_of(uuid);

create function public.list_members_of(p_list_id uuid)
returns table (user_id uuid, email text, name text, role public.list_role)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, u.email, u.name, m.role
    from public.list_members m
    join public.users u on u.id = m.user_id
   where m.list_id = p_list_id
     and exists (
       select 1 from public.list_members me
        where me.list_id = p_list_id and me.user_id = (select auth.uid())
     )
   order by m.created_at
$$;

revoke execute on function public.list_members_of(uuid) from public, anon;
grant execute on function public.list_members_of(uuid) to authenticated;

-- A new function PostgREST has not re-read the catalogue for is answered with "Could not find the
-- function in the schema cache" rather than with anything about the call.
notify pgrst, 'reload schema';
