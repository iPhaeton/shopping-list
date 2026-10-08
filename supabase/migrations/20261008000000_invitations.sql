-- Invitations, notifications and blocks (task 28 step 1). An owner invites someone found by name; the
-- invitee sees it on a Notifications screen and accepts or declines it, or declines and blocks the
-- inviter; the inviter is told of the answer. The design and the user's decisions D1–D8 are in
-- ai/tasks/28-invitations/description-step-1.md.
--
-- **The database only.** `share_list` stays until step 3 drops it, so the shipped app keeps adding
-- people directly while this lands. Every function below is written for the app that step 3 ships.
--
-- **All three tables are RPC-only, like `apple_tokens`:** row-level security on, no policy, no grant.
-- Every read and write needs a row the caller's own policies would hide — the inviter's name, a list
-- the invitee is not on yet, another owner's invitation — so each is a `security definer` function
-- that decides for itself what the caller may see. Supabase's default privileges grant every new
-- `public` table to `anon` and `authenticated`, and RLS alone would answer their reads with an empty
-- set rather than a refusal, so the grants are revoked explicitly
-- (ai/kb/entries/supabase-default-grants-defeat-revokes.md).
--
-- **Lock order: the list, then its rows.** Every function that changes an invitation's state locks
-- the invitation's `lists` row `for no key update` before it touches the invitation, as the
-- membership RPCs do (20261005100000_list_owner_locks.sql). The deadlock it prevents is concrete: an
-- inviter's `delete_account` holds the list and its cascade needs the invitation, so a function
-- holding the invitation and then waiting for anything that account deletion holds would close the
-- cycle. The notification an answer inserts takes `for key share` on the list, which is exactly such
-- a wait.
--
-- Two rare cases stay open. Each ends with Postgres aborting one side with 40P01 and nothing left
-- inconsistent:
--
--   1. An inviter who has already *left* the list deletes their account while the invitee declines
--      or blocks. `delete_account` locks only the lists its caller is on, so it takes the inviter's
--      `auth.users` row and then, by cascade, the invitation, while the decline holds the invitation
--      and then needs that `auth.users` row for its notification's foreign key.
--   2. An invitee deletes their account while an owner withdraws their invitation: the two cascades
--      reach the invitation and its notification in opposite orders.
--
-- **Error codes.** Never 23505: `verdictFor` in src/lib/listsApi.ts reads it as `applied`, so a
-- refusal would be reported as success. "Already" refusals are 22023, as `share_list`'s are; a
-- missing or closed target is P0002; a permission refusal is 42501. The messages are exact, because
-- the app shows them as they are.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create type public.invitation_status as enum ('pending', 'accepted', 'declined');
create type public.notification_kind as enum ('list_invitation', 'invitation_accepted', 'invitation_declined');

-- An offer of a role on a list, from one of its owners to someone who is not on it yet. Nobody becomes
-- a member without accepting one (D1, from step 3 on).
--
-- `suppressed` marks an invitation sent while the invitee blocks the inviter, or still pending when
-- they blocked (D2). The inviter sees it as *Invited* like any other, so a block is never revealed.
-- The invitee has no notification for it and cannot act on it. Unblocking does not bring it back: it
-- stays pending, invisible, until an owner withdraws it or the purge expires it.
--
-- An answered invitation keeps its row until the purge, so the invitee's notification can still show
-- what they answered. Nothing else reads it.
create table public.list_invitations (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists on delete cascade,
  inviter_id uuid not null references auth.users on delete cascade,
  invitee_id uuid not null references auth.users on delete cascade,
  role public.list_role not null,
  status public.invitation_status not null default 'pending',
  suppressed boolean not null default false,
  created_at timestamptz not null default now(),
  check (inviter_id <> invitee_id)
);

-- One *open* invitation per person per list. A declined one is closed, so an owner may invite again
-- after a decline; Block is the invitee's answer to an owner who keeps doing so. `invite_to_list`
-- infers this index in its `on conflict`, which is how a second invitation is refused without ever
-- raising 23505.
create unique index list_invitations_open_idx on public.list_invitations (list_id, invitee_id)
  where status = 'pending';

-- `pending_invitations_of` reads by list, and the cascade from `lists` finds rows by it.
create index on public.list_invitations (list_id);

-- What the Notifications screen shows, and the only place read state lives. Three kinds: an
-- invitation, to the invitee; its answer, accepted or declined, to the inviter.
--
-- `invitation_id` is set for `list_invitation` only, and the check holds that. Withdrawing or purging
-- the invitation cascades to its notification. An answer points at no invitation, so it outlives the
-- invitation's purge and is purged on its own date. The invitation's state is read through the join,
-- never copied here, so there is one truth about whether it is still open.
--
-- The cascades cover account deletion with no change to `delete_account`. Its delete of a solely owned
-- list takes the list's invitations and notifications; its delete of `auth.users` takes the departing
-- account's invitations, notifications and blocks, whichever side of each they were on.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users on delete cascade,
  kind public.notification_kind not null,
  actor_id uuid not null references auth.users on delete cascade,
  list_id uuid not null references public.lists on delete cascade,
  invitation_id uuid references public.list_invitations on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check ((kind = 'list_invitation') = (invitation_id is not null))
);

-- The screen's keyset, newest first (D8), and the unread count's prefix.
create index on public.notifications (recipient_id, created_at desc, id desc);

-- The cascade from `list_invitations`, and the read marking in `accept_invitation`.
create index on public.notifications (invitation_id) where invitation_id is not null;

-- Who an account has blocked. A block governs invitations only (D5): it removes nobody from a shared
-- list and hides nobody from name search. While it stands, every notification from the blocked
-- account is hidden from the blocker, and every invitation from them arrives suppressed.
--
-- The primary key serves the existence checks in `invite_to_list` and `my_notifications`; the index
-- serves the Blocked people screen's keyset, newest block first.
create table public.user_blocks (
  blocker_id uuid not null references auth.users on delete cascade,
  blocked_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index on public.user_blocks (blocker_id, created_at desc, blocked_id desc);

alter table public.list_invitations enable row level security;
alter table public.notifications enable row level security;
alter table public.user_blocks enable row level security;
revoke all on public.list_invitations, public.notifications, public.user_blocks from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------------------------

-- Each raises its refusals in the order written, the first that applies.

-- No list lock: inviting changes no ownership. No limit check either: the invitee meets the limits at
-- accept, when their count actually moves.
--
-- An invitation from someone the invitee blocks is still inserted, suppressed and with no
-- notification. That absence is what hides it, and its presence is what keeps the inviter's view
-- ordinary.
create function public.invite_to_list(p_list_id uuid, p_user_id uuid, p_role public.list_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  blocked boolean;
  invitation uuid;
begin
  if not public.session_still_valid() then
    raise exception using errcode = '42501', message = 'this device has been signed out';
  end if;

  if not exists (
    select 1 from public.list_members m
     where m.list_id = p_list_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'only an owner can invite people to this list';
  end if;

  if exists (select 1 from public.lists l where l.id = p_list_id and l.deleted_at is not null) then
    raise exception using errcode = 'P0002', message = 'this list is in the bin';
  end if;

  if p_user_id = (select auth.uid()) then
    raise exception using errcode = '22023', message = 'you already have this list';
  end if;

  if not exists (select 1 from public.users u where u.id = p_user_id) then
    raise exception using errcode = 'P0002', message = 'that account no longer exists';
  end if;

  if exists (
    select 1 from public.list_members m where m.list_id = p_list_id and m.user_id = p_user_id
  ) then
    raise exception using errcode = '22023', message = 'they already have this list';
  end if;

  blocked := exists (
    select 1 from public.user_blocks b
     where b.blocker_id = p_user_id and b.blocked_id = (select auth.uid())
  );

  insert into public.list_invitations (list_id, inviter_id, invitee_id, role, suppressed)
  values (p_list_id, (select auth.uid()), p_user_id, p_role, blocked)
  on conflict (list_id, invitee_id) where status = 'pending' do nothing
  returning id into invitation;

  if invitation is null then
    raise exception using errcode = '22023', message = 'they have already been invited';
  end if;

  if not blocked then
    insert into public.notifications (recipient_id, kind, actor_id, list_id, invitation_id)
    values (p_user_id, 'list_invitation', (select auth.uid()), p_list_id, invitation);
  end if;
end;
$$;

-- Any owner may withdraw, not only the inviter. The invitee's notification goes with it by cascade.
-- One refusal covers a bad id, a caller who is not an owner, and an invitation already answered.
create function public.withdraw_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_list uuid;
begin
  if not public.session_still_valid() then
    raise exception using errcode = '42501', message = 'this device has been signed out';
  end if;

  select i.list_id into target_list from public.list_invitations i where i.id = p_invitation_id;
  perform 1 from public.lists l where l.id = target_list for no key update;

  delete from public.list_invitations i
   where i.id = p_invitation_id
     and i.status = 'pending'
     and exists (
       select 1 from public.list_members m
        where m.list_id = i.list_id and m.user_id = (select auth.uid()) and m.role = 'owner'
     );

  if not found then
    raise exception using errcode = 'P0002', message = 'this invitation is no longer open';
  end if;
end;
$$;

-- Marks exactly the ids passed, so a notification that arrived between the app's read and this call
-- keeps its dot (D4, per page under D8). Ids that are unknown, someone else's or already read are
-- skipped without a word.
--
-- Each row marked sends its own `notifications/changed` to the caller's topic, through the trigger
-- below. The app debounces them.
create function public.mark_notifications_read(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.session_still_valid() then
    raise exception using errcode = '42501', message = 'this device has been signed out';
  end if;

  update public.notifications n
     set read_at = now()
   where n.id = any(p_ids)
     and n.recipient_id = (select auth.uid())
     and n.read_at is null;
end;
$$;

-- Returns the list id, so the app can open the list it has just joined.
--
-- The list is locked before the invitation is, so this waits behind a withdrawal, a demotion of the
-- inviter, or the inviter's account deletion, and then reads what they left. An invitation that is not
-- the caller's locks nothing in the first statement, and the second refuses it.
--
-- **The membership is inserted only if the caller is not already a member.** `on conflict do nothing`
-- would not do: `limit_list_memberships` is a BEFORE trigger, so it counts ahead of the conflict check
-- and would refuse someone at a limit for a list they are already on
-- (ai/kb/entries/limit-checks-pass-an-applied-resend.md). That case is real while `share_list` exists:
-- an owner can add someone directly who also holds a pending invitation. When the trigger does raise
-- LM001 or LM002 here, the refusal is the caller's own, and the app rephrases it.
--
-- `coalesce` rather than `where read_at is null`: the update always touches the invitee's
-- notification, so their other devices are nudged and re-read the new status.
--
-- Only the inviter is told, not the list's other owners.
create function public.accept_invitation(p_invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_list uuid;
  invitation record;
begin
  if not public.session_still_valid() then
    raise exception using errcode = '42501', message = 'this device has been signed out';
  end if;

  select i.list_id into target_list
    from public.list_invitations i
   where i.id = p_invitation_id and i.invitee_id = (select auth.uid());
  perform 1 from public.lists l where l.id = target_list for no key update;

  select i.id, i.list_id, i.inviter_id, i.role into invitation
    from public.list_invitations i
   where i.id = p_invitation_id
     and i.invitee_id = (select auth.uid())
     and i.status = 'pending'
     and not i.suppressed
     for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'this invitation is no longer open';
  end if;

  if exists (
    select 1 from public.lists l where l.id = invitation.list_id and l.deleted_at is not null
  ) then
    raise exception using errcode = 'P0002', message = 'this list has been deleted';
  end if;

  if not exists (
    select 1 from public.list_members m
     where m.list_id = invitation.list_id and m.user_id = invitation.inviter_id and m.role = 'owner'
  ) then
    raise exception using errcode = 'P0002', message = 'this invitation is no longer valid';
  end if;

  if not exists (
    select 1 from public.list_members m
     where m.list_id = invitation.list_id and m.user_id = (select auth.uid())
  ) then
    insert into public.list_members (list_id, user_id, role)
    values (invitation.list_id, (select auth.uid()), invitation.role);
  end if;

  update public.list_invitations set status = 'accepted' where id = invitation.id;

  update public.notifications n
     set read_at = coalesce(n.read_at, now())
   where n.invitation_id = invitation.id and n.recipient_id = (select auth.uid());

  insert into public.notifications (recipient_id, kind, actor_id, list_id)
  values (invitation.inviter_id, 'invitation_accepted', (select auth.uid()), invitation.list_id);

  return invitation.list_id;
end;
$$;

-- The same lock order as accepting. It adds no member, but its notification takes `for key share` on
-- the list, and that would wait on an inviter's `delete_account` that is itself waiting on the
-- invitation row this function holds.
--
-- No check that the inviter is still an owner: telling them of a decline is harmless either way.
create function public.decline_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_list uuid;
  inviter uuid;
begin
  if not public.session_still_valid() then
    raise exception using errcode = '42501', message = 'this device has been signed out';
  end if;

  select i.list_id into target_list
    from public.list_invitations i
   where i.id = p_invitation_id and i.invitee_id = (select auth.uid());
  perform 1 from public.lists l where l.id = target_list for no key update;

  update public.list_invitations i
     set status = 'declined'
   where i.id = p_invitation_id
     and i.invitee_id = (select auth.uid())
     and i.status = 'pending'
     and not i.suppressed
  returning i.inviter_id into inviter;

  if not found then
    raise exception using errcode = 'P0002', message = 'this invitation is no longer open';
  end if;

  update public.notifications n
     set read_at = coalesce(n.read_at, now())
   where n.invitation_id = p_invitation_id and n.recipient_id = (select auth.uid());

  insert into public.notifications (recipient_id, kind, actor_id, list_id)
  values (inviter, 'invitation_declined', (select auth.uid()), target_list);
end;
$$;

-- Takes an invitation, not a user id. Blocking is only ever offered on an invitation, and this way a
-- caller can neither block an arbitrary id nor then read its name back from the Blocked people screen.
--
-- It is a decline first — the same function, so the same refusals — and the inviter is told of the
-- decline as of any other (D2). The block itself is never told. Then every other pending invitation
-- from that inviter is suppressed and its notification deleted, so nothing from them is left to act
-- on. Only the pressed invitation's list is locked: suppressing writes no member and no key column.
create function public.block_inviter(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inviter uuid;
begin
  if not public.session_still_valid() then
    raise exception using errcode = '42501', message = 'this device has been signed out';
  end if;

  perform public.decline_invitation(p_invitation_id);

  -- Declined a moment ago by this transaction, so the row is held and cannot have moved.
  select i.inviter_id into inviter from public.list_invitations i where i.id = p_invitation_id;

  update public.list_invitations i
     set suppressed = true
   where i.inviter_id = inviter
     and i.invitee_id = (select auth.uid())
     and i.status = 'pending'
     and not i.suppressed;

  delete from public.notifications n
   where n.recipient_id = (select auth.uid())
     and n.invitation_id in (
       select i.id from public.list_invitations i
        where i.inviter_id = inviter and i.invitee_id = (select auth.uid()) and i.status = 'pending'
     );

  insert into public.user_blocks (blocker_id, blocked_id)
  values ((select auth.uid()), inviter)
  on conflict do nothing;
end;
$$;

-- Idempotent. The blocked account's notifications show again, read through the same filter; the
-- invitations suppressed while the block stood stay suppressed.
--
-- No nudge: nothing here writes `notifications`. The device that unblocks re-reads on its own, and
-- the account's other devices catch up at their next read.
create function public.unblock_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.session_still_valid() then
    raise exception using errcode = '42501', message = 'this device has been signed out';
  end if;

  delete from public.user_blocks b
   where b.blocker_id = (select auth.uid()) and b.blocked_id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------------------------

-- Reads are `stable` and unguarded, like `list_members_of`.

-- The Sharing screen's *Invited* section. Suppressed invitations are included: to the inviter a
-- block looks like no answer yet (D2). Anyone but an owner gets nothing.
create function public.pending_invitations_of(p_list_id uuid)
returns table (invitation_id uuid, user_id uuid, name text, role public.list_role, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.invitee_id, u.name, i.role, i.created_at
    from public.list_invitations i
    join public.users u on u.id = i.invitee_id
   where i.list_id = p_list_id
     and i.status = 'pending'
     and exists (
       select 1 from public.list_members m
        where m.list_id = p_list_id and m.user_id = (select auth.uid()) and m.role = 'owner'
     )
   order by i.created_at, i.id
$$;

-- One page of the Notifications screen, newest first (D8). No cursor returns page 1; a cursor (the
-- last row's `created_at` and `id`) returns the rows after it. `id` is part of the key because rows
-- written in one transaction share `created_at`: `now()` is frozen per transaction.
--
-- **The cursor bound is `coalesce`d, not guarded by `p_before_at is null or …`.** A `security
-- definer` SQL function is never inlined, and Postgres 17 plans its body once without the argument
-- values. Under an `or` on an argument, the bound cannot become an index condition, so every page
-- would walk the index from the newest row and filter its way down to the cursor. With the `coalesce`
-- it is a plain comparison: page 1 reads `<= infinity`, and a later page starts its walk at the
-- cursor. Measured both ways in ai/tasks/28-invitations/implementation-log-step-1.md. The `<=` is the
-- redundant bound of ai/kb/entries/keyset-paging-in-the-order-shown.md; the `or` is the keyset.
--
-- A blocked actor's rows are skipped (D5) and come back on unblock. The limit is clamped to 1..1000:
-- PostgREST's `max_rows` would otherwise cut a larger answer without saying so
-- (ai/kb/entries/max-rows-is-a-silent-ceiling.md).
--
-- `invitation_id`, `role`, `status` and `available` are null for the two answer kinds. `available`
-- says the list is not in the bin and the inviter still owns it, which matters only while `pending`.
-- A generic row on purpose: a later kind is one enum value and a `case` in the app.
create function public.my_notifications(
  p_before_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  kind public.notification_kind,
  created_at timestamptz,
  read_at timestamptz,
  actor_id uuid,
  actor_name text,
  list_id uuid,
  list_name text,
  invitation_id uuid,
  role public.list_role,
  status public.invitation_status,
  available boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.kind, n.created_at, n.read_at,
         n.actor_id, a.name,
         n.list_id, l.name,
         n.invitation_id, i.role, i.status,
         case
           when n.invitation_id is null then null
           else l.deleted_at is null and exists (
             select 1 from public.list_members m
              where m.list_id = i.list_id and m.user_id = i.inviter_id and m.role = 'owner'
           )
         end
    from public.notifications n
    join public.users a on a.id = n.actor_id
    join public.lists l on l.id = n.list_id
    left join public.list_invitations i on i.id = n.invitation_id
   where n.recipient_id = (select auth.uid())
     and not exists (
       select 1 from public.user_blocks b
        where b.blocker_id = (select auth.uid()) and b.blocked_id = n.actor_id
     )
     and n.created_at <= coalesce(p_before_at, 'infinity')
     and (n.created_at < coalesce(p_before_at, 'infinity') or n.id < p_before_id)
   order by n.created_at desc, n.id desc
   limit least(greatest(p_limit, 1), 1000)
$$;

-- The bell's dot. The same filter as `my_notifications`, unread only, with no limit.
create function public.unread_notification_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.notifications n
   where n.recipient_id = (select auth.uid())
     and n.read_at is null
     and not exists (
       select 1 from public.user_blocks b
        where b.blocker_id = (select auth.uid()) and b.blocked_id = n.actor_id
     )
$$;

-- One page of the Blocked people screen, newest block first, paged exactly as `my_notifications` is:
-- the key is `(created_at, blocked_id)` descending, and the cursor is the last row's `blocked_at` and
-- `user_id`.
create function public.my_blocked_users(
  p_before_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 100
)
returns table (user_id uuid, name text, blocked_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select b.blocked_id, u.name, b.created_at
    from public.user_blocks b
    join public.users u on u.id = b.blocked_id
   where b.blocker_id = (select auth.uid())
     and b.created_at <= coalesce(p_before_at, 'infinity')
     and (b.created_at < coalesce(p_before_at, 'infinity') or b.blocked_id < p_before_id)
   order by b.created_at desc, b.blocked_id desc
   limit least(greatest(p_limit, 1), 1000)
$$;

-- ---------------------------------------------------------------------------------------------
-- Name search, scoped to a list (backlog #23)
-- ---------------------------------------------------------------------------------------------

-- Dropped and recreated rather than overloaded: PostgREST must never have two candidates for one
-- call. The shipped app calls it with `p_query` alone, and the default keeps that call working.
--
-- The body is 20260922000000_share_by_name.sql's plus one filter. When the caller owns `p_list_id`,
-- the list's members and anyone with a pending invitation to it are left out, *before* `limit 5`, so
-- the filter never shrinks the five suggestions. When the caller does not own it, the parameter is
-- ignored: otherwise anyone holding a list id could probe its roster.
--
-- The ownership test mentions no column of `u`, so it runs once. `not in` over two non-null id
-- columns becomes one hashed subplan, built once from the list's own rows and probed per name match.
drop function public.search_users_by_name(text);

create function public.search_users_by_name(p_query text, p_list_id uuid default null)
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
       -- Escape a typed wildcard character so it searches literally. Backslash first, so it doesn't
       -- interfere with the % / _ escaping that follows it.
       replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_')
     ) || '%' escape '\'
     and (
       not exists (
         select 1 from public.list_members o
          where o.list_id = p_list_id and o.user_id = (select auth.uid()) and o.role = 'owner'
       )
       or u.id not in (
         select m.user_id from public.list_members m where m.list_id = p_list_id
         union all
         select i.invitee_id from public.list_invitations i
          where i.list_id = p_list_id and i.status = 'pending'
       )
     )
   order by u.name
   limit 5
$$;

-- ---------------------------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------------------------

-- A second event on the same per-user topic: `notifications/changed`, to the notification's recipient,
-- on every insert, update and delete. A nudge only, like `list/changed`: the payload carries nothing
-- the app trusts, and the app answers it with the reads above
-- (ai/kb/entries/realtime-is-a-nudge-to-a-per-user-inbox.md). The receive policy is topic-only and
-- event-agnostic, so it needs no change.
--
-- `security definer` for the reason `notify_list_members` is: `authenticated` cannot write
-- `realtime.messages`. Push notifications (D6, out of scope) would attach here later.
create function public.notify_recipient()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;

  perform realtime.send(
    jsonb_build_object('source', 'notifications', 'op', tg_op),
    'notifications/changed',
    'user:' || r.recipient_id::text,
    true
  );

  return null;
end;
$$;

create trigger notify_on_notification_change
  after insert or update or delete on public.notifications
  for each row execute function public.notify_recipient();

-- `notify_list_members` is reused unchanged: its last branch reads `list_id`, which this table has.
-- It refreshes the *Invited* section on every owner's Sharing screen. A suppressed invitation nudges
-- the list's members like any other, which tells the invitee nothing: they are not a member.
create trigger notify_on_invitation_change
  after insert or update or delete on public.list_invitations
  for each row execute function public.notify_list_members();

-- No grant block for `notify_recipient`, as for the other trigger functions: a trigger function is
-- never named by a caller and needs no EXECUTE privilege to fire.

-- ---------------------------------------------------------------------------------------------
-- Expiry (D3)
-- ---------------------------------------------------------------------------------------------

-- Every invitation and every notification is deleted 30 days after it was created, answered or not,
-- read or not. An invitation still pending then has expired: the inviter's *Invited* row goes, and
-- the invitee's notification goes with it by cascade. Modelled on `purge_deleted`, and split from its
-- schedule (the next migration) for the same reason.
--
-- `<=`, not `<`: `now()` is frozen per transaction, so `<` would make the zero-interval call that
-- proves this function works a silent no-op.
--
-- The counts exclude the notifications an invitation's purge carries off by cascade. Each delete is a
-- sequential scan, since no index leads with `created_at`; the 30 days bound both tables. The
-- cascade's deletes nudge their recipients at 03:35, which is harmless for the reasons the deletion
-- migration gives for its own purge.
create function public.purge_notifications(p_older_than interval default interval '30 days')
returns table (invitations_purged bigint, notifications_purged bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff timestamptz := now() - p_older_than;
  n_invitations bigint;
  n_notifications bigint;
begin
  with gone as (delete from public.list_invitations where created_at <= cutoff returning 1)
  select count(*) into n_invitations from gone;

  with gone as (delete from public.notifications where created_at <= cutoff returning 1)
  select count(*) into n_notifications from gone;

  return query select n_invitations, n_notifications;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------------

-- `from public, anon`, then a grant to `authenticated`: Supabase's default privileges name `anon` on
-- a new function's ACL, so the implicit PUBLIC grant is not the only one.

revoke execute on function public.invite_to_list(uuid, uuid, public.list_role) from public, anon;
grant execute on function public.invite_to_list(uuid, uuid, public.list_role) to authenticated;

revoke execute on function public.withdraw_invitation(uuid) from public, anon;
grant execute on function public.withdraw_invitation(uuid) to authenticated;

revoke execute on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

revoke execute on function public.accept_invitation(uuid) from public, anon;
grant execute on function public.accept_invitation(uuid) to authenticated;

revoke execute on function public.decline_invitation(uuid) from public, anon;
grant execute on function public.decline_invitation(uuid) to authenticated;

revoke execute on function public.block_inviter(uuid) from public, anon;
grant execute on function public.block_inviter(uuid) to authenticated;

revoke execute on function public.unblock_user(uuid) from public, anon;
grant execute on function public.unblock_user(uuid) to authenticated;

revoke execute on function public.pending_invitations_of(uuid) from public, anon;
grant execute on function public.pending_invitations_of(uuid) to authenticated;

revoke execute on function public.my_notifications(timestamptz, uuid, integer) from public, anon;
grant execute on function public.my_notifications(timestamptz, uuid, integer) to authenticated;

revoke execute on function public.unread_notification_count() from public, anon;
grant execute on function public.unread_notification_count() to authenticated;

revoke execute on function public.my_blocked_users(timestamptz, uuid, integer) from public, anon;
grant execute on function public.my_blocked_users(timestamptz, uuid, integer) to authenticated;

-- Re-issued: the drop above took the previous pair with it.
revoke execute on function public.search_users_by_name(text, uuid) from public, anon;
grant execute on function public.search_users_by_name(text, uuid) to authenticated;

-- Nobody calls the purge from the app. The scheduled job runs as `postgres`, which owns it.
revoke execute on function public.purge_notifications(interval) from public, anon, authenticated;

-- A new function PostgREST has not re-read the catalogue for is answered with "Could not find the
-- function in the schema cache" rather than with anything about the call.
notify pgrst, 'reload schema';
