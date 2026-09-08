-- Sharing a list with other people, at reader / writer / owner.
--
-- The roles are five policies. The architecture is a performance requirement: with 1,000,000 rows in
-- `lists`, "the lists I can see" must still be fast. Three rules follow from it, and every choice
-- below is one of them:
--
--   1. Membership is the ONLY access path. Every list gets exactly one `list_members` row per person
--      who can see it, its creator included. `lists.owner_id` stops meaning anything and becomes
--      `created_by`, provenance only. Had ownership stayed on `lists` while membership lived here,
--      every read policy would read `created_by = auth.uid() or exists (select 1 from
--      list_members ...)` — and an OR across two access paths is the classic way to lose an index.
--   2. Every policy predicate is an *uncorrelated* `in (subquery)`. It mentions no column of the
--      outer row, so Postgres evaluates it once per query and probes the result per row. The cost
--      depends on how many lists *you* are in, never on how many lists exist.
--   3. Reads are driven from `list_members`, not from `lists` — see `fetchLists` in
--      src/lib/listsApi.ts. The top-level scan is over your ~20 rows and `lists` is reached by
--      primary key. Rule 2 keeps the predicate cheap; rule 3 keeps the scan small. Both are needed.
--
-- Note what is deliberately absent: no `security definer` helper is called from any policy. Such a
-- function would be called *per row of `lists`* — one call, one index lookup, one RLS-bypass context
-- switch each — which is the cost rule 2 exists to avoid. The `my_memberships()` helper below is
-- `security invoker`, takes no arguments and returns a set precisely so that it is evaluated once.

create type public.list_role as enum ('reader', 'writer', 'owner');

create table public.list_members (
  list_id uuid not null references public.lists on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role public.list_role not null,
  -- The app's list order, in place of `lists.created_at`. For a list you created the two are the
  -- same instant (the trigger below mints this row in the same statement); for a list shared with
  -- you today, "where you'd expect a new thing to appear" beats "wherever the owner created it
  -- three years ago". It is also the only ordering the index below can serve for free.
  created_at timestamptz not null default now(),
  primary key (list_id, user_id)
);

-- THE index. It answers "my lists, in the order they entered my account" with no sort, and it is
-- keyset-pageable if the app ever needs pages. The primary key `(list_id, user_id)` does not serve
-- a `user_id =` lookup, so this is not optional.
create index on public.list_members (user_id, created_at);

-- `lists` loses its authorization role. The column keeps its `default auth.uid()`, so the client
-- still never sends it, but nothing reads it to decide anything.
alter table public.lists rename column owner_id to created_by;
alter table public.lists alter column created_by drop not null;

-- Was `on delete cascade`. Deleting an account must no longer delete lists that other people are
-- still in — it now anonymises the provenance and leaves the list to its remaining members.
alter table public.lists drop constraint lists_owner_id_fkey;
alter table public.lists add constraint lists_created_by_fkey
  foreign key (created_by) references auth.users on delete set null;

-- Every existing list keeps its creator, now as a member. `created_at` is carried across so current
-- users see their lists in exactly the order they saw them yesterday.
insert into public.list_members (list_id, user_id, role, created_at)
select id, created_by, 'owner', created_at
  from public.lists
 where created_by is not null;

-- Nothing reads lists by owner any more; rule 3 says the scan starts one table over.
drop index public.lists_owner_id_created_at_idx;

-- `items` is unchanged. Its `(list_id, created_at)` index is already the right one.

-- One helper, so the predicate lives in one place. Note what it is *not*: it takes no arguments, it
-- returns a set, and it is `security invoker`. That is the whole difference between this and the
-- per-row `is_list_member(list_id, user_id)` the older proposal carried.
--
-- **`set search_path = ''` blocks SQL-function inlining, and that was measured rather than assumed
-- to be harmless.** Postgres will not inline a function carrying any `proconfig` setting, so with the
-- clause this appears in plans as an opaque `Function Scan` instead of being folded into the policy.
-- On a scratch table that turned a nested loop into a `Seq Scan`, which looked alarming enough to
-- drop the clause. At 1,000,000 lists with realistic statistics it makes no difference at all: a
-- policy qual becomes a `SubPlan` either way and is never pulled up into a semi-join, so both
-- variants produced identical plans and identical buffer counts. The scratch measurement misled
-- because it wrote the `in (subquery)` directly in the query, where pull-up *is* available; a policy
-- is not that. What actually decides the cost is rule 3 — the same read is 1 ms rooted at
-- `list_members` and 254 ms rooted at `lists`, with or without this clause. So it stays, matching
-- every other function here.
--
-- `(select auth.uid())` rather than `auth.uid()`: the scalar subquery becomes an InitPlan evaluated
-- once, instead of a JWT parse per row.
create function public.my_memberships()
returns table (list_id uuid, role public.list_role)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.list_id, m.role from public.list_members m where m.user_id = (select auth.uid())
$$;

-- The creator's own membership row is minted here rather than by the client, so `insertList` stays a
-- plain idempotent insert — which is what lets a retried `list/created` come back `23505` and be
-- classified `applied` by src/lib/listsApi.ts.
--
-- `security definer` is unavoidable and narrow: at the instant this runs the creator is not yet a
-- member, so the "owners add members" policy below would refuse them.
create function public.grant_creator_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is not null then
    insert into public.list_members (list_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict (list_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger on_list_created
  after insert on public.lists
  for each row execute function public.grant_creator_ownership();

-- A list must keep at least one owner. Without this an owner can demote or remove themselves and
-- strand the list: nobody could ever rename it or share it again, and there is no delete policy to
-- clean it up.
--
-- `security definer` because it has to see *other people's* membership rows to count the remaining
-- owners; under RLS an invoker would only ever see its own row and would conclude there were none.
create function public.keep_last_owner()
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

create trigger keep_last_owner
  before update or delete on public.list_members
  for each row execute function public.keep_last_owner();

alter table public.list_members enable row level security;

-- You see your own membership rows and nobody else's. This policy references no table at all, which
-- is what lets the policies on `lists` and `items` read `list_members` freely with no cycle to
-- break — and it is an index qual on (user_id, created_at), so `fetchLists` plans itself.
create policy "read your own memberships" on public.list_members
  for select using (user_id = (select auth.uid()));

create policy "owners add members" on public.list_members
  for insert with check (
    list_id in (select m.list_id from public.my_memberships() m where m.role = 'owner')
  );

-- **These next two reach only the caller's own row, and the reason is worth stating.** For UPDATE and
-- DELETE Postgres must first *read* the row the WHERE clause names, so SELECT policies apply to it
-- as well as the command's own USING clause — and the SELECT policy above shows you nothing but
-- yourself. Verified rather than reasoned: an owner's `delete ... where user_id = <someone else>`
-- reports `DELETE 0`, and reports `DELETE 1` the instant that SELECT policy is opened to `true`.
--
-- Broadening it is not an option. "Rows of lists I own" would have to read `list_members` from
-- inside a policy on `list_members` — infinite recursion — and an `or` alongside `user_id =
-- auth.uid()` would cost the index qual that rule 3's whole read path is built on. So managing
-- *other* people goes through the `security definer` RPCs at the end of this file, whose owner check
-- these two predicates duplicate; the policies stay because they are the rule those RPCs must keep
-- in step with, and because what they do reach is real: an owner demoting or removing themselves,
-- which is exactly what `keep_last_owner` above exists to police.
create policy "owners change roles" on public.list_members
  for update using (
    list_id in (select m.list_id from public.my_memberships() m where m.role = 'owner')
  ) with check (
    list_id in (select m.list_id from public.my_memberships() m where m.role = 'owner')
  );

-- Un-sharing. This is the first `for delete` policy in the schema, and it is on membership rather
-- than on list data: removing a member removes nobody's items. Lists and items still have no way to
-- be deleted at all.
create policy "owners remove members" on public.list_members
  for delete using (
    list_id in (select m.list_id from public.my_memberships() m where m.role = 'owner')
  );

-- `lists` — the three owner-only policies are replaced wholesale rather than extended.
drop policy "read own lists" on public.lists;
drop policy "create own lists" on public.lists;
drop policy "update own lists" on public.lists;

create policy "read lists you belong to" on public.lists
  for select using (id in (select m.list_id from public.my_memberships() m));

create policy "create your own lists" on public.lists
  for insert with check (created_by = (select auth.uid()));

create policy "owners rename lists" on public.lists
  for update using (
    id in (select m.list_id from public.my_memberships() m where m.role = 'owner')
  ) with check (
    id in (select m.list_id from public.my_memberships() m where m.role = 'owner')
  );

-- Rename means rename. `authenticated` holds UPDATE on every column of `lists` by default, so an
-- owner could otherwise rewrite `created_by` or `created_at` through the policy above. A
-- column-level revoke cannot subtract from a table grant — but dropping the table grant and
-- re-granting a single column can, and unlike `items` this leaves the policy reachable.
revoke update on public.lists from anon, authenticated;
grant update (name) on public.lists to authenticated;

-- `items` — the same predicate, one rung further down. Still no delete policy, so `writer` differs
-- from `owner` only in what it may do to the list itself.
drop policy "read items of own lists" on public.items;
drop policy "add items to own lists" on public.items;
drop policy "update items of own lists" on public.items;

create policy "read items of lists you belong to" on public.items
  for select using (list_id in (select m.list_id from public.my_memberships() m));

create policy "writers add items" on public.items
  for insert with check (
    list_id in (select m.list_id from public.my_memberships() m where m.role >= 'writer')
  );

-- Still unreachable — `revoke update on public.items` from the previous migration stands — and still
-- kept, for the same reason as before: it states the rule any future column grant would land on.
create policy "writers update items" on public.items
  for update using (
    list_id in (select m.list_id from public.my_memberships() m where m.role >= 'writer')
  ) with check (
    list_id in (select m.list_id from public.my_memberships() m where m.role >= 'writer')
  );

-- The only way to check an item off, and the predicate it repeats has changed from an ownership test
-- to a role test. It is `security definer`, so it bypasses RLS and has to say out loud what the
-- "writers update items" policy above says; the two must stay in step.
--
-- **The `raise` is new, and it closes a latent bug.** The old body reported nothing, so a refusal and
-- a success were indistinguishable: a reader's queued toggle would come back `ok`, be dropped from
-- the outbox as delivered, and stay on screen as a change that never happened. Silent divergence is
-- the one failure mode the offline design exists to prevent, and it could not bite while everyone
-- owned every list they could see — which is exactly why it was easy to miss on the way in.
create or replace function public.set_item_done(p_item_id uuid, p_done boolean)
returns void
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
     and exists (
       select 1 from public.list_members m
        where m.list_id = items.list_id
          and m.user_id = (select auth.uid())
          and m.role >= 'writer'
     );
  get diagnostics updated = row_count;

  -- Zero rows can only mean refused: a reader tried to check something off, or their access was
  -- downgraded while the write sat in the outbox. Nothing deletes items or lists, so the row cannot
  -- simply be gone. 42501 reaches PostgREST as 403, which `verdictFor` already classifies
  -- `permanent` — the outbox drops the write, banners it, and re-fetches.
  --
  -- If item deletion ever lands, this branch stops being unambiguous and has to tell "gone" (drop
  -- the write quietly) from "refused" (drop it loudly).
  if updated = 0 then
    raise exception using errcode = '42501', message = 'not allowed to change this item';
  end if;
end;
$$;

-- Sharing, and finding the person to share with.
--
-- `public.users` is readable only as your own row and stays that way: a general email-to-id lookup
-- is an account-enumeration endpoint. Sharing resolves the address server-side instead and never
-- hands the caller a directory.
create unique index on public.users (lower(email));

create function public.share_list(p_list_id uuid, p_email text, p_role public.list_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  if not exists (
    select 1 from public.list_members m
     where m.list_id = p_list_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'only an owner can share this list';
  end if;

  select u.id into target from public.users u where lower(u.email) = lower(trim(p_email));

  -- An honest v1: inviting an address that has no account yet needs a `list_invites` table claimed
  -- by `handle_new_user` at sign-up, which is a second feature.
  if target is null then
    raise exception using errcode = 'P0002', message = 'no account with that email yet';
  end if;

  if target = (select auth.uid()) then
    raise exception using errcode = '22023', message = 'you already have this list';
  end if;

  -- Re-sharing with someone who already has the list changes their role, so the share sheet needs no
  -- separate "promote" call.
  insert into public.list_members (list_id, user_id, role)
  values (p_list_id, target, p_role)
  on conflict (list_id, user_id) do update set role = excluded.role;
end;
$$;

-- The other two thirds of "manage who else has access". They exist as functions rather than as plain
-- DML for the reason spelled out beside the `list_members` update and delete policies: those policies
-- cannot see another person's row, so an owner acting on someone else has to go through a definer.
-- Both raise the same two codes as `share_list`, and both stay in step with the same owner predicate.
--
-- Neither can strand a list: `keep_last_owner` is a trigger, so it fires on these writes too.
create function public.set_member_role(p_list_id uuid, p_user_id uuid, p_role public.list_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
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

create function public.remove_member(p_list_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
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

-- What a share sheet renders, and the reason `public.users` needs no wider policy. Gated on the
-- caller's own membership, so a list you are not in returns nothing rather than its roster.
create function public.list_members_of(p_list_id uuid)
returns table (user_id uuid, email text, role public.list_role)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, u.email, m.role
    from public.list_members m
    join public.users u on u.id = m.user_id
   where m.list_id = p_list_id
     and exists (
       select 1 from public.list_members me
        where me.list_id = p_list_id and me.user_id = (select auth.uid())
     )
   order by m.created_at
$$;

-- Who may call them. `from public` alone is not enough: Postgres grants EXECUTE to PUBLIC on every
-- new function, and Supabase additionally runs `alter default privileges ... grant execute on
-- functions to anon, authenticated, service_role`, so a fresh function arrives with `anon` on its
-- ACL by name. Revoking the implicit grant leaves the explicit one standing.
--
-- `my_memberships` is deliberately not in this list. It is `security invoker` and returns only the
-- caller's own rows, and it is called from inside the `lists` and `items` policies — revoking `anon`
-- would turn an anonymous read of /rest/v1/lists from an empty array into a permission error on a
-- function the caller never named.
revoke execute on function public.share_list(uuid, text, public.list_role) from public, anon;
grant execute on function public.share_list(uuid, text, public.list_role) to authenticated;

revoke execute on function public.set_member_role(uuid, uuid, public.list_role) from public, anon;
grant execute on function public.set_member_role(uuid, uuid, public.list_role) to authenticated;

revoke execute on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

revoke execute on function public.list_members_of(uuid) from public, anon;
grant execute on function public.list_members_of(uuid) to authenticated;

revoke execute on function public.set_item_done(uuid, boolean) from public, anon;
grant execute on function public.set_item_done(uuid, boolean) to authenticated;
