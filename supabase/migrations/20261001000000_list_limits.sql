-- Three limits (task 23 step 2): 100 lists a user owns, 1,000 lists a user is on in total, 1,000
-- items in a list. Nothing in the bin counts toward any of them: binning frees a slot at once, and
-- restoring takes one back.
--
-- The numbers are mirrored by hand in src/lib/limits.ts (`MAX_OWNED_LISTS`, `MAX_LISTS`,
-- `MAX_ITEMS`, and the three SQLSTATEs as `LIMIT_CODES`), which the app uses to warn before the tap
-- and to turn a refusal into a sentence. Keep the two equal, the way `MAX_ROWS` and config.toml are.
--
-- **No locks, and overshoot is accepted — the user's call.** Each check counts and then lets the
-- write through, under READ COMMITTED, so two writes at a limit at the same instant can both pass.
-- A restore checks only the caller, not the list's other members. Do not add `for update`, advisory
-- locks, counter columns or serializable isolation to close that: a list or two past the limit is
-- the price, and it was chosen. Existing rows are not touched either — an account already past a
-- limit keeps everything and cannot add more.
--
-- **Ownership, not creation, is the per-user cap.** An owner is a member by definition, so a user
-- removed from or demoted on a list stops counting it. Handing a list over (make someone else owner,
-- then leave) frees the slot; the recipient's own limit still applies.
--
-- **Every check must let an already-applied resend through.** The outbox resends a write whose
-- response was lost, though the database already holds it, and a check that counted that row would
-- turn a success into a refusal — and the outbox would then drop the write and everything queued
-- behind it. So:
--
--   - Both list limits live on `list_members`, never on `lists`. A resent `list/created` fails on
--     the `lists` primary key with 23505 (`applied` to the client), and the creator's membership is
--     minted by the AFTER-insert `on_list_created` trigger, which never fires when that insert
--     fails. A BEFORE-insert trigger on `lists` would fire ahead of the primary-key check: the resend
--     would be refused as over the limit, and `dropDependents` would drop every item queued into it.
--   - `add_item` skips the count when `p_id` is already there.
--   - The restores count only when the row is actually in the bin, so a resent restore is a no-op.
--
-- One SQLSTATE per limit, in a class PostgreSQL does not use (`LM`), which PostgREST answers with
-- 400 — measured, see ai/tasks/23-list-limits/implementation-log-step-2.md. It has to be a 4xx: the
-- client treats a 5xx as "send it again", and the outbox has no attempt cap, so a limit refusal
-- arriving as a 500 would retry every 30 s forever and stall every write behind it. The client
-- classifies the three codes by name anyway, so the code decides and the status does not.
--
-- The messages are written for the one place that shows them as they are: the Sharing screen, an
-- owner reading about someone else, in the house style of "that account no longer exists". The
-- queued writes that can hit the same codes (creating, restoring, adding) have their failure turned
-- into a sentence by the client, so one message serves both readers.

-- ---------------------------------------------------------------------------------------------
-- The two checks
-- ---------------------------------------------------------------------------------------------

-- `security definer` because a check on somebody else — the person being shared with or promoted —
-- has to count rows the caller's own RLS would hide. That is also why neither is callable from
-- outside: as an RPC it would tell anyone whether a given account is at a limit.
--
-- Total first, then owned, and the client's warning follows the same order (`listLimitSentence`).
create function public.check_list_limits(p_user_id uuid, p_owner boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  owned int;
  total int;
begin
  select count(*) filter (where m.role = 'owner'), count(*)
    into owned, total
    from public.list_members m
    join public.lists l on l.id = m.list_id
   where m.user_id = p_user_id
     and l.deleted_at is null;

  if total >= 1000 then
    raise exception using errcode = 'LM002', message = 'they are already on 1,000 lists';
  end if;

  if p_owner and owned >= 100 then
    raise exception using errcode = 'LM001', message = 'they already own 100 lists';
  end if;
end;
$$;

revoke execute on function public.check_list_limits(uuid, boolean) from public, anon, authenticated;

create function public.check_item_limit(p_list_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    select count(*) from public.items i where i.list_id = p_list_id and i.deleted_at is null
  ) >= 1000 then
    raise exception using errcode = 'LM003', message = 'this list already has 1,000 items';
  end if;
end;
$$;

revoke execute on function public.check_item_limit(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- The list limits, on membership
-- ---------------------------------------------------------------------------------------------

-- Every way onto a list is an insert into `list_members`, and every way to ownership is either that
-- or an update of `role` — so one trigger sees them all: creating a list (`grant_creator_ownership`,
-- always `owner`), `share_list` to someone new, and promotion through `set_member_role` or
-- `share_list`'s upsert.
--
-- **An insert whose `(list_id, user_id)` already exists passes untouched.** `share_list` is an
-- `insert … on conflict do update`, and Postgres fires BEFORE INSERT triggers ahead of the conflict
-- check: a re-share is really a role change, so the update branch below judges it instead. Counting
-- here would refuse re-sharing an existing member who is at 1,000, which changes nothing.
--
-- An update is checked only when it makes someone an owner. A demotion, or any other update, never
-- is — demoting is how an owned slot is freed.
create function public.limit_list_memberships()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if exists (
      select 1 from public.list_members m
       where m.list_id = new.list_id and m.user_id = new.user_id
    ) then
      return new;
    end if;

    perform public.check_list_limits(new.user_id, new.role = 'owner');
  elsif old.role <> 'owner' and new.role = 'owner' then
    perform public.check_list_limits(new.user_id, true);
  end if;

  return new;
end;
$$;

create trigger limit_list_memberships
  before insert or update on public.list_members
  for each row execute function public.limit_list_memberships();

-- ---------------------------------------------------------------------------------------------
-- The three RPCs that can add to a count
-- ---------------------------------------------------------------------------------------------

-- Each is its previous body (20260920000000_session_revocation.sql) with one check added, after
-- `session_still_valid()` and after the permission and tombstone checks, so a caller without access
-- learns nothing about counts.

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

  -- Skipped for an id already here: that is the outbox resending an insert whose response was
  -- lost, and counting the row it already made would refuse a write that has succeeded.
  if not exists (select 1 from public.items i where i.id = p_id) then
    perform public.check_item_limit(p_list_id);
  end if;

  insert into public.items (id, list_id, title)
  values (p_id, p_list_id, p_title)
  on conflict (id) do nothing;

  return 'applied';
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
  target_list uuid;
begin
  if not public.session_still_valid() then
    raise exception using errcode = '42501', message = 'this device has been signed out';
  end if;

  -- A restore takes a slot — but only one that would actually happen: the item is in the bin and the
  -- caller may restore it. Anything else falls through to the update, which refuses or no-ops it
  -- exactly as before, so a resent restore is never counted.
  if not p_deleted then
    select i.list_id into target_list
      from public.items i
     where i.id = p_item_id
       and i.deleted_at is not null
       and exists (
         select 1 from public.list_members m
          where m.list_id = i.list_id
            and m.user_id = (select auth.uid())
            and m.role >= 'writer'
       );
    if found then perform public.check_item_limit(target_list); end if;
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

-- Only an owner can restore a list, so the caller always counts toward both list limits.
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

  -- As in `set_item_deleted`: counted only when the restore would actually happen.
  if not p_deleted and exists (
    select 1 from public.lists l
     where l.id = p_list_id
       and l.deleted_at is not null
       and exists (
         select 1 from public.list_members m
          where m.list_id = l.id and m.user_id = (select auth.uid()) and m.role = 'owner'
       )
  ) then
    perform public.check_list_limits((select auth.uid()), true);
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

-- ---------------------------------------------------------------------------------------------
-- The counts the app warns from
-- ---------------------------------------------------------------------------------------------

-- Read during every full re-read, beside page 1 of the lists: once lists are paged the client no
-- longer holds them all, so it cannot count them. Rooted at `list_members` like every list read
-- (ai/kb/entries/read-rooted-at-list-members.md), `security invoker` so row-level security still
-- decides what is counted. The explicit `user_id` predicate repeats the select policy, as
-- `my_memberships()` does. A read, so no `session_still_valid()`.
--
-- Approximate by design: other members' writes and the accepted overshoot move the real numbers
-- under it, and the database's own checks above are the authority.
create function public.my_list_counts()
returns table (owned integer, total integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select (count(*) filter (where m.role = 'owner'))::integer, count(*)::integer
    from public.list_members m
    join public.lists l on l.id = m.list_id
   where m.user_id = (select auth.uid())
     and l.deleted_at is null
$$;

revoke execute on function public.my_list_counts() from public, anon;
grant execute on function public.my_list_counts() to authenticated;

-- A new function PostgREST has not re-read the catalogue for is answered with "Could not find the
-- function in the schema cache" rather than with anything about the call.
notify pgrst, 'reload schema';
