-- Renaming an item. Writers and owners, exactly the people who may add one.
--
-- An RPC and not a `grant update (title) on public.items`, for two reasons, either of which would
-- do on its own. The lists migration revoked UPDATE on `items` from every client role so that
-- `done_at` could only ever be stamped by the database's clock, and re-granting a single column
-- would reopen the `writers update items` policy for the first time — a policy that has been kept
-- as a statement of the rule rather than as something reachable. And a direct `PATCH` filtered to
-- zero rows answers `204` with no error, which cannot tell a refused write from one that landed on
-- something in the bin; only a `security definer` function can see which happened, and say so.
--
-- The body is `set_item_done` with `title` in place of `done_at`, and the three-way zero-row split
-- is copied **in the same order**, because the order is a security decision rather than a style:
-- the permission check comes before the last tombstone branch, so a stranger holding an item id is
-- refused and never learns that a row they cannot see is in the bin.
--
-- Realtime needs nothing here. `notify_on_item_change` fires on any UPDATE of `items`, so the
-- rename fans out to every member of the list the same way a tick does.

create function public.rename_item(p_item_id uuid, p_title text)
returns public.write_outcome
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated int;
begin
  -- No `trim` here, matching `add_item`: the client sends the title the row should have, and the
  -- table's own `check (length(trim(title)) > 0)` refuses a blank with 23514.
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

  -- Cause 1: purged out from under a write queued for longer than the bin holds. Nothing to refuse
  -- and nothing to restore, so the client drops it quietly.
  if not exists (select 1 from public.items i where i.id = p_item_id) then
    return 'target_deleted';
  end if;

  -- Cause 2: a genuine permission refusal, tested *before* the tombstone check on purpose.
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

-- `from public, anon` rather than `from public` alone: Supabase's default privileges put `anon` on a
-- new function's ACL *by name*, so revoking the implicit PUBLIC grant leaves the explicit one
-- standing. Read `pg_proc.proacl` back rather than trusting these statements.
revoke execute on function public.rename_item(uuid, text) from public, anon;
grant execute on function public.rename_item(uuid, text) to authenticated;

-- A new function PostgREST has not re-read the catalogue for is answered with "Could not find the
-- function in the schema cache" rather than with anything about the call.
notify pgrst, 'reload schema';
