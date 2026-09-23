-- Share a list by name instead of email, with a live autocomplete suggesting at most 5 matches.
-- See ai/suggestions/share-by-name.md for the tradeoff (open search vs. scoped to co-members,
-- resolved as open search: authenticated only, capped rows, id+name only, no email).

-- Case-insensitive contains match — a leading wildcard, so the btree index
-- `create unique index on public.users (lower(name))` (20260921000000_user_names.sql) cannot serve
-- it; that index stays, doing only what it always did (enforce uniqueness). A trigram GIN index on
-- the same expression is what makes this query index-backed instead of a sequential scan.
create extension if not exists pg_trgm;

create index on public.users using gin (lower(name) gin_trgm_ops);

-- `public.users` stays unreadable directly — this RPC is the only access path, same as
-- `list_members_of`. No `session_still_valid()` check: it is a read, and that guard is reserved for
-- the ten write RPCs (see ai/kb/entries/session-still-valid-guards-writes.md).
create function public.search_users_by_name(p_query text)
returns table (user_id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.name
    from public.users u
   where u.name is not null
     and u.id <> (select auth.uid())
     and lower(u.name) like '%' || lower(
       -- Escape a typed wildcard character so it searches literally instead of matching more
       -- broadly than intended. Backslash first, so it doesn't interfere with the % / _ escaping
       -- that follows it.
       replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_')
     ) || '%' escape '\'
   order by u.name
   limit 5
$$;

revoke execute on function public.search_users_by_name(text) from public, anon;
grant execute on function public.search_users_by_name(text) to authenticated;

-- `share_list` changes shape: email -> id. Selecting a suggestion already resolves a concrete
-- user_id; re-resolving by email would be a step backward. A `drop function` + recreate, the same
-- move `list_members_of` made in the user-names migration when its return shape changed.
drop function public.share_list(uuid, text, public.list_role);

create function public.share_list(p_list_id uuid, p_user_id uuid, p_role public.list_role)
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

revoke execute on function public.share_list(uuid, uuid, public.list_role) from public, anon;
grant execute on function public.share_list(uuid, uuid, public.list_role) to authenticated;

-- A new function PostgREST has not re-read the catalogue for is answered with "Could not find the
-- function in the schema cache" rather than with anything about the call.
notify pgrst, 'reload schema';
