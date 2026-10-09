-- Unblocking brings the blocked person's invitations back (task 28, a follow-up to step 4, at the
-- user's request). This reverses D2's "unblocking does not bring it back" and supersedes what
-- 20261008000000_invitations.sql says of `list_invitations.suppressed` and of `unblock_user`.
--
-- **What comes back.** Every invitation from that person still `pending` and `suppressed`: the ones
-- pending when the block was made, and the ones sent while it stood. Each is unsuppressed, so it can
-- be answered again, and gets a new `list_invitation` notification, unread. `block_inviter` deleted
-- the first kind's notifications and `invite_to_list` never wrote the second kind's, so nothing is
-- left to un-hide; a card read before the block comes back unread.
--
-- **Dated when it was sent.** The notification takes its invitation's `created_at`, so the restored
-- card sits in send order with a true age, not at the top as just now. It expires with its
-- invitation, which `purge_notifications` deletes on that same date.
--
-- An invitation whose list is now in the bin, or whose inviter no longer owns it, comes back too, as
-- the unavailable card any invitation shows then.
--
-- The rest is as before. The pressed invitation stays declined, the blocked person's other
-- notifications show again through `my_notifications`' filter, and the inviter sees no change: to
-- them the restored invitations were *Invited* all along.

-- **Each restored notification nudges the caller** through `notify_recipient`, so their other
-- devices re-read. The notifications that were only hidden come back with no nudge, so the app still
-- re-reads the bell's count itself.
--
-- **The lists are locked first, in id order**, as `delete_account` locks its own
-- (20261005100000_list_owner_locks.sql). The notification insert takes `for key share` on each list,
-- and holding the invitation while waiting for that deadlocks with an inviter's `delete_account`
-- (20261008000000_invitations.sql, "Lock order"). Rare case 1 of that header stays open here too: an
-- inviter who has left the list deletes their account during the unblock, and Postgres aborts one of
-- the two with 40P01.
--
-- **Still open, rare.** `invite_to_list` reads the block without locking it. An invitation whose call
-- read the block just before an unblock committed, and inserted just after, stays suppressed with no
-- block to lift. Closing it would mean locking the block row in `invite_to_list`.
create or replace function public.unblock_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.session_still_valid() then
    raise exception using errcode = '42501', message = 'this device has been signed out';
  end if;

  perform 1 from public.lists l
   where l.id in (
     select i.list_id from public.list_invitations i
      where i.inviter_id = p_user_id
        and i.invitee_id = (select auth.uid())
        and i.status = 'pending'
        and i.suppressed
   )
   order by l.id
   for no key update;

  delete from public.user_blocks b
   where b.blocker_id = (select auth.uid()) and b.blocked_id = p_user_id;

  -- Idempotent: a second call finds nothing suppressed, so it adds no second notification.
  with restored as (
    update public.list_invitations i
       set suppressed = false
     where i.inviter_id = p_user_id
       and i.invitee_id = (select auth.uid())
       and i.status = 'pending'
       and i.suppressed
    returning i.id, i.list_id, i.created_at
  )
  insert into public.notifications (recipient_id, kind, actor_id, list_id, invitation_id, created_at)
  select (select auth.uid()), 'list_invitation', p_user_id, r.list_id, r.id, r.created_at
    from restored r;
end;
$$;

-- Repairs the unblocks made before this migration. A pending suppressed invitation whose invitee no
-- longer blocks its inviter can only be left by the old `unblock_user`, so each is restored now as
-- the new one would have.
with restored as (
  update public.list_invitations i
     set suppressed = false
   where i.status = 'pending'
     and i.suppressed
     and not exists (
       select 1 from public.user_blocks b
        where b.blocker_id = i.invitee_id and b.blocked_id = i.inviter_id
     )
  returning i.id, i.list_id, i.inviter_id, i.invitee_id, i.created_at
)
insert into public.notifications (recipient_id, kind, actor_id, list_id, invitation_id, created_at)
select r.invitee_id, 'list_invitation', r.inviter_id, r.list_id, r.id, r.created_at
  from restored r;

notify pgrst, 'reload schema';
