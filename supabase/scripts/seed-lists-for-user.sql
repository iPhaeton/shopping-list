-- LOCAL load test: gives one existing account `list_count` lists, each holding a random
-- `min_items`..`max_items` items (defaults: 1000 lists x 100-1000 items, ~550k items). The account
-- owns every list through a `list_members` row, exactly as if it had created them in the app.
--
-- LOCAL STACK ONLY. Never point this at the linked cloud project.
--
-- Run with the defaults below:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -f supabase/scripts/seed-lists-for-user.sql
--
-- Override any parameter without editing the file:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v user_id=00000000-1eed-1eed-1eed-000000000006 -v list_count=50 \
--        -v min_items=10 -v max_items=20 \
--        -f supabase/scripts/seed-lists-for-user.sql
--
-- Safe to run more than once: every run adds another `list_count` lists. The account must already
-- exist in auth.users (seed-1m-users.sql creates ...0001 through ...f4240).

\set ON_ERROR_STOP on
\timing on

-- PARAMETERS -- a `-v name=value` on the command line wins over the default here.
\if :{?user_id}
\else
  \set user_id '8d6d4eb9-db34-4adc-9277-b5e986f83a6d'
\endif
\if :{?list_count}
\else
  \set list_count 99
\endif
\if :{?min_items}
\else
  \set min_items 999
\endif
\if :{?max_items}
\else
  \set max_items 999
\endif

-- STEP 0: validate. psql does not substitute its variables inside a `$$` body, so they cross into
-- the `do` block as session settings.
set seed.user_id = :'user_id';
set seed.list_count = :'list_count';
set seed.min_items = :'min_items';
set seed.max_items = :'max_items';

do $$
declare
  uid uuid := current_setting('seed.user_id')::uuid;
  n int := current_setting('seed.list_count')::int;
  lo int := current_setting('seed.min_items')::int;
  hi int := current_setting('seed.max_items')::int;
begin
  -- Load-bearing, not politeness: step 1 switches foreign-key checks off, so a mistyped id would
  -- otherwise seed lists nobody can ever see.
  if not exists (select 1 from auth.users where id = uid) then
    raise exception 'seed-lists-for-user: no auth.users row with id %', uid;
  end if;
  if n < 1 then
    raise exception 'seed-lists-for-user: list_count must be at least 1, got %', n;
  end if;
  if lo < 1 or lo > hi then
    raise exception 'seed-lists-for-user: need 1 <= min_items <= max_items, got % and %', lo, hi;
  end if;
end $$;

-- STEP 1: bulk insert.
--
-- session_replication_role = replica skips every user trigger for the transaction. Without it
-- `notify_on_item_change` would call realtime.send once per item -- ~550k broadcasts -- and
-- `on_list_created` would mint the owner rows with `now()` rather than the list's own timestamp.
-- The owner rows are written explicitly below instead.
begin;
set local session_replication_role = replica;

-- Timestamps are spread out on purpose. `now()` is frozen for the whole transaction, and a list
-- whose items all share one `created_at` would defeat the `(created_at, id)` keyset that
-- `fetchItems` pages with. Lists are an hour apart (list 1 oldest), items a millisecond apart.
create temp table seed_lists on commit drop as
select
  gen_random_uuid() as id,
  i,
  now() - (:list_count - i + 1) * interval '1 hour' as created_at,
  :min_items + floor(random() * (:max_items - :min_items + 1))::int as item_count
from generate_series(1, :list_count) as g(i);

-- The 'Seed list ' prefix is what the cleanup block at the bottom matches on.
insert into public.lists (id, created_by, name, created_at)
select id, :'user_id'::uuid, 'Seed list ' || i, created_at
from seed_lists;

insert into public.list_members (list_id, user_id, role, created_at)
select id, :'user_id'::uuid, 'owner', created_at
from seed_lists;

with words as (
  select array[
    'Milk','Eggs','Bread','Butter','Cheese','Yogurt','Apples','Bananas','Oranges','Lemons',
    'Tomatoes','Potatoes','Onions','Garlic','Carrots','Cucumbers','Peppers','Spinach','Lettuce','Rice',
    'Pasta','Flour','Sugar','Salt','Coffee','Tea','Honey','Jam','Cereal','Oats',
    'Chicken','Beef','Salmon','Tuna','Beans','Lentils','Olive oil','Vinegar','Soap','Sponges'
  ]::text[] as w
)
insert into public.items (id, list_id, title, created_at)
select
  gen_random_uuid(),
  l.id,
  words.w[1 + (j - 1) % array_length(words.w, 1)] || ' ' || j,
  l.created_at + j * interval '1 millisecond'
from seed_lists l
cross join lateral generate_series(1, l.item_count) as s(j)
cross join words;

commit;

analyze public.lists, public.list_members, public.items;

-- STEP 2: summary of every seeded list this account now has, this run's and any earlier ones.
select
  count(*) as seeded_lists,
  sum(n) as seeded_items,
  min(n) as fewest_items_in_a_list,
  max(n) as most_items_in_a_list
from (
  select l.id, count(it.id) as n
    from public.lists l
    join public.list_members m on m.list_id = l.id and m.user_id = :'user_id'::uuid
    left join public.items it on it.list_id = l.id
   where l.name like 'Seed list %'
   group by l.id
) per_list;

-- CLEANUP -- NOT run automatically. Swap in the account's id and run separately when done:
-- delete from public.lists
--  where created_by = '00000000-1eed-1eed-1eed-000000000005' and name like 'Seed list %';
-- -- cascades to items and list_members; triggers stay on, so it sends one realtime nudge per
-- -- membership row (one per list), which is harmless.
