-- One-off LOCAL load test for task 18 (share by name): seeds 1,000,000
-- synthetic accounts into auth.users + public.users, rebuilds the two
-- `name`-related indexes, and runs EXPLAIN (ANALYZE, BUFFERS) against
-- search_users_by_name() as a simulated authenticated user, to confirm the
-- pg_trgm GIN index is actually used and stays fast at 1M rows.
--
-- LOCAL STACK ONLY. Never point this at the linked cloud project.
--
-- Run:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f ai/tasks/18-share-by-name/seed-1m-users.sql

\timing on

-- STEP 0: refuse to double-seed
do $$
begin
  if exists (select 1 from auth.users where email like '%@loadtest.invalid') then
    raise exception 'seed-1m-users: loadtest rows already present -- run the cleanup block at the bottom of this file first';
  end if;
end $$;

-- STEP 1: drop the two name-related indexes before the bulk load, found by
-- definition rather than a guessed default name.
do $$
declare
  idx record;
begin
  for idx in
    select indexname from pg_indexes
     where schemaname = 'public' and tablename = 'users'
       and indexdef ilike '%(lower(name)%'
  loop
    execute format('drop index if exists public.%I', idx.indexname);
  end loop;
end $$;

-- STEP 2: bulk insert 1,000,000 auth.users + matching public.users rows.
-- session_replication_role = replica stops handle_new_user() firing 1M times
-- and skips FK-enforcing triggers for the duration -- safe here because both
-- inserts derive id/email independently from the same deterministic formula.
begin;
set local session_replication_role = replica;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, confirmation_token, recovery_token,
  email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  phone_change, phone_change_token, email_change_token_current,
  email_change_confirm_status, reauthentication_token,
  is_sso_user, is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  ('00000000-1eed-1eed-1eed-' || lpad(to_hex(i), 12, '0'))::uuid,
  'authenticated', 'authenticated',
  'loadtest' || i || '@loadtest.invalid',
  'loadtest-not-a-real-password-hash', -- never a valid bcrypt hash: these accounts must never log in
  now(), '', '', '', '',
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  jsonb_build_object('seed', 'task-18-loadtest'),
  now(), now(),
  '', '', '', 0, '',
  false, false
from generate_series(1, 1000000) as g(i);

with params as (
  select
    array[
      'Olivia','Liam','Emma','Noah','Ava','Ethan','Sophia','Mason','Isabella','Logan',
      'Mia','Lucas','Charlotte','Jackson','Amelia','Aiden','Harper','Elijah','Evelyn','Grayson',
      'Abigail','Carter','Emily','Jayden','Ella','Wyatt','Scarlett','Luke','Grace','Owen',
      'Chloe','Gabriel','Victoria','Julian','Riley','Levi','Aria','Isaac','Lily','Henry',
      'Aubrey','Sebastian','Zoey','Jack','Penelope','Daniel','Layla','Matthew','Nora','Leo',
      'Hannah','Ezra','Lillian','Anthony','Addison','Dylan','Eleanor','Samuel','Natalie','Caleb',
      'Luna','Ryan','Savannah','Nathan','Brooklyn','Isaiah','Leah','Christian','Zoe','Adrian',
      'Stella','Aaron','Hazel','Ian','Ellie','Cameron','Paisley','Miles','Audrey','Thomas',
      'Skylar','Hunter','Violet','Charles','Claire','Josiah','Bella','Christopher','Aurora','Andrew',
      'Lucy','Jonathan','Anna','Colton','Samantha','Landon','Caroline','Jaxon','Genesis','Brayden',
      'Aaliyah','Elias','Kennedy','Robert','Sadie','Roman','Gabriella','Eli','Madeline','Angel',
      'Piper','Nolan','Adalynn','Maverick','Emery','Weston','Ariana','Xavier','Ruby','Silas',
      'Sarah','Ryder','Josephine','Damian','Naomi','Carson','Eliana','Axel','Alice','Beau',
      'Autumn','Blake','Ivy','Kai','Sophie','Jaxson','Melody','Declan','Vivian','Micah',
      'Iris','Asher','Maya','Jace','Willow','Cole','Alina','Dominic','Faith','Bennett'
    ]::text[] as first_names,
    array[
      'Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez',
      'Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin',
      'Lee','Perez','Thompson','White','Harris','Sanchez','Clark','Ramirez','Lewis','Robinson',
      'Walker','Young','Allen','King','Wright','Scott','Torres','Nguyen','Hill','Flores',
      'Green','Adams','Nelson','Baker','Hall','Rivera','Campbell','Mitchell','Carter','Roberts',
      'Gomez','Phillips','Evans','Turner','Diaz','Parker','Cruz','Edwards','Collins','Reyes',
      'Stewart','Morris','Morales','Murphy','Cook','Rogers','Gutierrez','Ortiz','Morgan','Cooper',
      'Peterson','Bailey','Reed','Kelly','Howard','Ramos','Kim','Cox','Ward','Richardson',
      'Watson','Brooks','Chavez','Wood','James','Bennett','Gray','Mendoza','Ruiz','Hughes',
      'Price','Alvarez','Castillo','Sanders','Patel','Myers','Long','Ross','Foster','Jimenez',
      'Powell','Jenkins','Perry','Russell','Sullivan','Bell','Coleman','Butler','Henderson','Barnes',
      'Gonzales','Fisher','Vasquez','Simmons','Romero','Jordan','Patterson','Alexander','Hamilton','Graham',
      'Reynolds','Griffin','Wallace','Moreno','West','Cole','Hayes','Bryant','Herrera','Gibson',
      'Ellis','Tran','Medina','Aguilar','Stevens','Murray','Ford','Castro','Marshall','Owens',
      'Harrison','Fernandez','Woods','Washington','Kennedy','Wells','Vargas','Henry','Chen','Freeman'
    ]::text[] as last_names
)
insert into public.users (id, email, name, created_at)
select
  ('00000000-1eed-1eed-1eed-' || lpad(to_hex(i), 12, '0'))::uuid,
  'loadtest' || i || '@loadtest.invalid',
  p.fn[1 + ((i - 1) % array_length(p.fn, 1))] || ' ' ||
    p.ln[1 + (((i - 1) / array_length(p.fn, 1)) % array_length(p.ln, 1))] || ' ' || i,
  now()
from generate_series(1, 1000000) as g(i)
cross join (select first_names as fn, last_names as ln from params) p;

commit;

-- sanity check: these two counts must match
select
  (select count(*) from auth.users where email like '%@loadtest.invalid') as auth_rows,
  (select count(*) from public.users where email like '%@loadtest.invalid') as public_rows;

-- STEP 3: rebuild the name indexes, refresh planner stats
begin;
set local maintenance_work_mem = '512MB'; -- default 64MB on this stack
create unique index users_name_lower_unique on public.users (lower(name));
create index users_name_trgm_gin on public.users using gin (lower(name) gin_trgm_ops);
commit;

analyze public.users;

-- STEP 4: EXPLAIN ANALYZE the search
--
-- search_users_by_name() itself can't be EXPLAINed usefully: it's `language
-- sql security definer set search_path = ''`, and both `security definer`
-- and a `set` clause independently disqualify a SQL-language function from
-- being inlined -- calling it through EXPLAIN just shows an opaque
-- "Function Scan", never the plan inside. And since the function runs as its
-- owner (security definer, RLS-bypassing), the inline query below run as
-- postgres reproduces exactly what happens inside it -- no role switch
-- needed to see the real plan.
begin;

-- a) a 3+ char substring expected to hit many rows -- the GIN index's home turf
explain (analyze, buffers)
select u.id, u.name from public.users u
 where u.name is not null and u.id <> '00000000-1eed-1eed-1eed-000000000001'::uuid
   and lower(u.name) like '%' || lower('ann') || '%' escape '\'
 order by u.name limit 5;

-- b) a full "Firstname Lastname" query -- ~44 matches by construction, capped to 5
explain (analyze, buffers)
select u.id, u.name from public.users u
 where u.name is not null and u.id <> '00000000-1eed-1eed-1eed-000000000001'::uuid
   and lower(u.name) like '%' || lower('Olivia Smith') || '%' escape '\'
 order by u.name limit 5;

-- c) 2 characters -- the UI's actual minimum (UserAutocomplete's
-- MIN_QUERY_LENGTH); pg_trgm has no usable trigram this short for a LIKE
-- '%...%' pattern, so measure this exact case rather than a 1-char stand-in
explain (analyze, buffers)
select u.id, u.name from public.users u
 where u.name is not null and u.id <> '00000000-1eed-1eed-1eed-000000000001'::uuid
   and lower(u.name) like '%' || lower('an') || '%' escape '\'
 order by u.name limit 5;

-- d) same as (a), rerun so its warm-cache timing is comparable to (e) below
explain (analyze, buffers)
select u.id, u.name from public.users u
 where u.name is not null and u.id <> '00000000-1eed-1eed-1eed-000000000001'::uuid
   and lower(u.name) like '%' || lower('ann') || '%' escape '\'
 order by u.name limit 5;

-- e) counterfactual: same query as (d), index scans disabled, same warm
-- cache -- an apples-to-apples timing comparison proving the index is what
-- makes the difference, not just cache state
set local enable_bitmapscan = off;
set local enable_indexscan = off;
explain (analyze, buffers)
select u.id, u.name from public.users u
 where u.name is not null and u.id <> '00000000-1eed-1eed-1eed-000000000001'::uuid
   and lower(u.name) like '%' || lower('ann') || '%' escape '\'
 order by u.name limit 5;

rollback; -- read-only above

-- CLEANUP -- NOT run automatically. Uncomment and run separately when done:
-- delete from auth.users where email like '%@loadtest.invalid';
-- -- cascades to public.users via the id FK; nothing else references these
-- -- rows (they never created a list, session, or identity).
