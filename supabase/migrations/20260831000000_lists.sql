-- Shopping lists and their items, one owner each.
--
-- Sharing is a later step, so "you own it" is the whole visibility rule here. There is deliberately
-- no membership table and no `is_list_member` helper: that helper exists only to break the policy
-- recursion between `lists` and a `list_members` table, and nothing recurses yet.

create table public.lists (
  id uuid primary key,
  -- Minted by the client (expo-crypto) rather than by `gen_random_uuid()`, so a new list can be
  -- rendered before the insert comes back and a retried insert is idempotent.
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

-- Insertion order is the app's list order, and every read is scoped to one owner.
create index on public.lists (owner_id, created_at);

create table public.items (
  id uuid primary key,
  list_id uuid not null references public.lists on delete cascade,
  title text not null check (length(trim(title)) > 0),
  -- A timestamp rather than a boolean, so the row records *when* an item was checked off. The
  -- client cannot write it: it calls set_item_done() below with done or not-done, and this column
  -- is stamped from the database's clock. Sending a state rather than a flip is also what stops a
  -- retry double-applying. Note that nothing compares these values to decide anything — an update
  -- is unconditional, and the last one to commit wins.
  done_at timestamptz,
  created_at timestamptz not null default now()
);

create index on public.items (list_id, created_at);

alter table public.lists enable row level security;
alter table public.items enable row level security;

-- `owner_id` defaults to auth.uid(), so the client never sends it; the `with check` means it could
-- not forge one if it tried. No delete policy: deleting lists is not a feature yet, and a policy
-- for an action nothing performs is a policy nobody has thought through.
create policy "read own lists" on public.lists
  for select using (auth.uid() = owner_id);

create policy "create own lists" on public.lists
  for insert with check (auth.uid() = owner_id);

create policy "update own lists" on public.lists
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Items inherit their list's visibility. The subquery is itself subject to the policies above, but
-- `lists` references no other table, so there is no cycle to break.
create policy "read items of own lists" on public.items
  for select using (
    exists (select 1 from public.lists where lists.id = items.list_id and lists.owner_id = auth.uid())
  );

create policy "add items to own lists" on public.items
  for insert with check (
    exists (select 1 from public.lists where lists.id = items.list_id and lists.owner_id = auth.uid())
  );

-- Kept although the revoke below currently makes it unreachable: it states the rule any future
-- column grant would have to satisfy, so re-granting one cannot accidentally open the table up.
create policy "update items of own lists" on public.items
  for update using (
    exists (select 1 from public.lists where lists.id = items.list_id and lists.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.lists where lists.id = items.list_id and lists.owner_id = auth.uid())
  );

-- No client may write items directly. `done_at` has to be stamped by the database's clock: a
-- device's own clock can be wrong by a year, and a timestamp that records when a phone *thinks* an
-- item was checked off is a value nothing downstream can trust — least of all a later step that
-- resolves conflicts by comparing them.
--
-- Table-level, because a column-level revoke cannot subtract from a table-level grant, and
-- anon/authenticated hold this one on every column. Nothing else updates items today.
revoke update on public.items from anon, authenticated;

-- `security definer` so the update can happen at all now the grant is gone. That bypasses the
-- policies as well, which is why the ownership test is repeated here: this predicate and the
-- "update items of own lists" policy above say the same thing and must stay in step.
create function public.set_item_done(p_item_id uuid, p_done boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.items
     set done_at = case when p_done then now() else null end
   where id = p_item_id
     and exists (
       select 1 from public.lists
        where lists.id = items.list_id and lists.owner_id = auth.uid()
     );
$$;

-- Who may call it. anon would match no rows anyway (auth.uid() is null), but a `security definer`
-- function should name its callers rather than inherit them.
--
-- `from public` alone is not enough: Postgres grants EXECUTE to PUBLIC on every new function, and
-- Supabase *additionally* runs `alter default privileges ... grant execute on functions to anon,
-- authenticated, service_role`, so a fresh function arrives with anon already on its ACL by name.
-- Revoking the implicit grant leaves the explicit one standing.
revoke execute on function public.set_item_done(uuid, boolean) from public, anon;
grant execute on function public.set_item_done(uuid, boolean) to authenticated;
