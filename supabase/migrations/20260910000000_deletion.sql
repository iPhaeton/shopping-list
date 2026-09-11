-- Deleting lists and items, as tombstones rather than as `delete`.
--
-- A deleted row keeps its place and grows a `deleted_at`. Nothing is removed until a nightly purge
-- collects it 30 days later. That choice was the user's, and four hard problems dissolve with it:
--
--   1. "Zero rows means two things." A hard delete makes a refused write and a write to a vanished
--      row indistinguishable — neither PostgREST nor a `.select()` can tell them apart. Here the row
--      never goes away, so a write to a deleted thing matches a row that is visibly deleted. The
--      ambiguity comes back only at purge time, for writes queued longer than the window.
--   2. Nowhere to put the user's typing when a write is refused. There is no need: the deleted thing
--      is still in the app, behind a checkbox, and still restorable through the normal UI.
--   3. Sharing survives. A hard delete cascades `list_members` away, so a "restore" could never
--      restore who the list was shared with. Nothing cascades now — restore is a real restore.
--   4. Confirmation stops being load-bearing. A reversible delete needs no modal guarding it, which
--      sidesteps `Alert.alert` being a no-op under react-native-web (measured).
--
-- The cost is that tombstones accumulate, and a shopping list is the worst case for it — items are
-- added and cleared every week, and they all ship on a read path the previous migration spent its
-- whole design keeping cheap. `purge_deleted` below is the mitigation, and it is part of this
-- feature rather than a follow-up.
--
-- Note what is deliberately absent: **no policy changes at all**. A tombstone is still a row,
-- members still have to see it to restore it, and the client decides what to render. Do not be
-- tempted to filter tombstones inside `my_memberships()` — the read policies share it and the bin
-- needs those rows. There is still no `for delete` policy on `lists` or `items`; the only hard
-- delete in the schema is the purge, which runs as `postgres`.

alter table public.lists add column deleted_at timestamptz;
alter table public.items add column deleted_at timestamptz;

-- Partial, so they cost nothing until something is actually deleted. The `items` one serves the
-- purge; the `lists` one serves both the purge and "show me the bin".
create index on public.items (deleted_at) where deleted_at is not null;
create index on public.lists (deleted_at) where deleted_at is not null;

-- Server-stamped, exactly like `done_at`, and here it matters far more: `deleted_at` decides what
-- the purge collects. No revoke is needed to enforce that. `revoke update on public.items from anon,
-- authenticated` (the lists migration) and `grant update (name) on public.lists` (the sharing one)
-- mean `authenticated` holds no UPDATE privilege that could reach a new column on either table —
-- measured with `has_column_privilege` after adding it. A new column is un-writable by construction,
-- so the RPCs below are forced rather than merely preferred.

-- What a write says when its target is in the bin.
--
-- The server reports only the *fact*. Whether to offer a restore is the client's decision, taken
-- from the role it already holds — the same division src/state/roles.ts already keeps, where roles
-- choose which controls exist and never whether a write is allowed. An owner is offered "restore and
-- keep my change"; a writer's write to a deleted list simply drops. Putting that rule in the return
-- value would duplicate authorization into a place that cannot enforce it.
create type public.write_outcome as enum ('applied', 'target_deleted');

-- ---------------------------------------------------------------------------------------------
-- Delete and restore
-- ---------------------------------------------------------------------------------------------

-- Both take a boolean rather than being a verb, mirroring `set_item_done` deliberately: an absolute
-- value is safe to retry and safe to coalesce, so the outbox can replace a queued delete with a
-- later restore and send one request instead of two.
--
-- **Whoever may delete a thing may restore it** — one predicate per function, not a `case` on
-- `p_deleted`. An earlier draft let a `writer` delete an item but reserved restoring to an `owner`,
-- which meant a writer could put something beyond their own reach with one tap.

create function public.set_list_deleted(p_list_id uuid, p_deleted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated int;
begin
  update public.lists
     -- `coalesce` so a retry does not push the tombstone forward and reset the purge clock.
     set deleted_at = case when p_deleted then coalesce(deleted_at, now()) else null end
   where id = p_list_id
     and exists (
       select 1 from public.list_members m
        where m.list_id = lists.id and m.user_id = (select auth.uid()) and m.role = 'owner'
     );
  get diagnostics updated = row_count;

  -- Raising rather than returning quietly: a definer RPC that reports a refusal as a success has the
  -- outbox drop a write it never delivered. See `set_item_done` for the bug that taught this.
  if updated = 0 then
    raise exception using errcode = '42501',
      message = 'only an owner can delete or restore this list';
  end if;
end;
$$;

create function public.set_item_deleted(p_item_id uuid, p_deleted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated int;
begin
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

-- ---------------------------------------------------------------------------------------------
-- The three write paths that can now land on a tombstone
-- ---------------------------------------------------------------------------------------------

-- Ticking an item off. **Replaced rather than `create or replace`d** — the return type changes from
-- `void`, which `create or replace` refuses — so its grants are dropped with it and re-issued below.
--
-- Zero rows used to mean exactly one thing, and the comment above the old version said so: it was
-- unambiguously a refusal *because nothing deleted items*. That is no longer true, and it now splits
-- three ways.
drop function public.set_item_done(uuid, boolean);

create function public.set_item_done(p_item_id uuid, p_done boolean)
returns public.write_outcome
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated int;
begin
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
  -- to refuse and nothing to restore, so the client drops it quietly. Keep this branch when someone
  -- later "simplifies" the three cases into two.
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

-- Adding an item. **This one is not optional.** The `writers add items` policy checks membership,
-- and membership is entirely intact after a soft delete — so without this function an item would be
-- accepted into a deleted list, which is the one place where doing nothing is actively wrong rather
-- than merely incomplete.
--
-- `on conflict (id) do nothing` keeps the retry semantics the direct insert had. The client mints
-- ids up front, so a request that succeeded and then failed to be heard is re-sent with the same id;
-- that used to come back as SQLSTATE 23505 and be classified `applied`, and now simply lands as a
-- no-op that still reports `applied`.
create function public.add_item(p_id uuid, p_list_id uuid, p_title text)
returns public.write_outcome
language plpgsql
security definer
set search_path = ''
as $$
declare
  list_deleted_at timestamptz;
begin
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

  -- Deliberately no `get diagnostics` here, and this looks like an omission: `on conflict do nothing`
  -- reports **zero rows** for a retry that finds its own earlier insert already committed. Reading
  -- the row count and calling zero a refusal would hand the user a red banner for a write that
  -- landed — strictly worse than the 23505 this replaced. Every refusal has already been raised
  -- above; reaching this line means the write is in.
  return 'applied';
end;
$$;

-- Renaming a list, which was the app's one direct `PATCH` of a table.
--
-- It moves here for a reason that predates tombstones: a rename refused for *any* reason was
-- filtered to zero rows and answered `200 []`, so the client could only ever say "you can no longer
-- rename this list" — unable to tell **deleted** from **demoted**. That cannot be fixed client-side
-- either, because row-level security hides a list you were removed from exactly as thoroughly as one
-- that is gone. Only a definer function can see the difference.
--
-- The `owners rename lists` policy and the `update (name)` column grant both stay. They are still
-- the rule this function repeats, exactly as `writers update items` is for `set_item_done`, and the
-- one thing the direct path now skips is the tombstone check — renaming something already in the bin
-- costs nothing.
create function public.rename_list(p_list_id uuid, p_name text)
returns public.write_outcome
language plpgsql
security definer
set search_path = ''
as $$
declare
  list_deleted_at timestamptz;
begin
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

-- ---------------------------------------------------------------------------------------------
-- The purge
-- ---------------------------------------------------------------------------------------------

-- Without this the fetch grows without bound and the read path degrades — silently and slowly, with
-- no error and no alert, just a response that gets bigger every month.
--
-- The interval is a parameter rather than a hardcoded 30 days for one reason above all: a test
-- cannot wait a month. `purge_deleted(interval '0 seconds')` collects everything tombstoned so far,
-- which is what makes this verifiable at all.
--
-- Split from its schedule, which lives in the next migration, so that the function is useful,
-- testable and runnable by hand whether or not the schedule ever exists.
create function public.purge_deleted(p_older_than interval default interval '30 days')
returns table (lists_purged bigint, items_purged bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff timestamptz := now() - p_older_than;
  n_items bigint;
  n_lists bigint;
begin
  -- `<=` rather than `<`, and it is not a rounding nicety. `now()` is the *transaction's* start
  -- time, frozen for its whole life, so a tombstone stamped by `set_item_deleted` and a cutoff of
  -- `now() - interval '0 seconds'` are the same instant when both happen in one transaction. With
  -- `<` the zero-interval call collects nothing — measured, and it makes the one call that proves
  -- this function works a silent no-op. At a real 30-day cutoff the two operators are the same.
  with gone as (delete from public.items where deleted_at <= cutoff returning 1)
  select count(*) into n_items from gone;

  with gone as (delete from public.lists where deleted_at <= cutoff returning 1)
  select count(*) into n_lists from gone;

  -- Counts rather than void: a job that silently destroys data should be able to say how much. The
  -- item count excludes rows carried off by a list's cascade, which is a fine distinction to know
  -- about before reading the numbers as a total.
  return query select n_lists, n_items;
end;
$$;

-- `keep_last_owner` does not abort this. Purging a list cascades to `list_members` and fires that
-- trigger, but its cascade exemption — "the parent row is already gone" — covers exactly this case,
-- measured as `DELETE 1`. A list whose only owner stopped using it still gets collected.
--
-- Purging a list also nudges its members, because the cascade fires the un-share arm of the realtime
-- trigger: at 03:30, about a row they cannot see, for a list that left their fetch 30 days ago.
-- Harmless — sockets are almost certainly down, delivery is at-most-once, and the client's 300 ms
-- debounce collapses a burst into one fetch. Worth recognising rather than debugging later.

-- ---------------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------------

-- `from public, anon` rather than `from public` alone: Supabase's default privileges put `anon` on a
-- new function's ACL *by name*, so revoking the implicit PUBLIC grant leaves the explicit one
-- standing. Read `pg_proc.proacl` back after a reset rather than trusting these statements.

revoke execute on function public.set_list_deleted(uuid, boolean) from public, anon;
grant execute on function public.set_list_deleted(uuid, boolean) to authenticated;

revoke execute on function public.set_item_deleted(uuid, boolean) from public, anon;
grant execute on function public.set_item_deleted(uuid, boolean) to authenticated;

-- Re-issued: the `drop function` above took the previous pair with it.
revoke execute on function public.set_item_done(uuid, boolean) from public, anon;
grant execute on function public.set_item_done(uuid, boolean) to authenticated;

revoke execute on function public.add_item(uuid, uuid, text) from public, anon;
grant execute on function public.add_item(uuid, uuid, text) to authenticated;

revoke execute on function public.rename_list(uuid, text) from public, anon;
grant execute on function public.rename_list(uuid, text) to authenticated;

-- Nobody calls the purge from the app, so it is the one function here that names `authenticated`
-- too: every other function in this schema is meant to be reachable by a signed-in client, and this
-- one is not. The scheduled job in the next migration runs as `postgres`, which owns the function, so
-- taking every client grant away costs the schedule nothing.
revoke execute on function public.purge_deleted(interval) from public, anon, authenticated;

-- A signature changed above (`set_item_done` returns an enum now, and two of its neighbours are
-- new), and PostgREST answers a call it has not re-read the catalogue for with "Could not find the
-- function in the schema cache" rather than with anything about the change.
notify pgrst, 'reload schema';
