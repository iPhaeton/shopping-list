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
  -- A timestamp rather than a boolean: the client sends an absolute value ("done at 14:02" or "not
  -- done") instead of a flip, so a retry cannot double-apply and two clients converge on the later
  -- write. It also records *when* an item was checked off, for free.
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

create policy "update items of own lists" on public.items
  for update using (
    exists (select 1 from public.lists where lists.id = items.list_id and lists.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.lists where lists.id = items.list_id and lists.owner_id = auth.uid())
  );
