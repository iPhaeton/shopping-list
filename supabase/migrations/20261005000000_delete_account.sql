-- Deleting your own account (task 25 step 2). One call removes the account and every list the caller
-- is the only owner of, live or binned, shared or not, in one transaction. The app calls it while the
-- user watches and never queues it in the outbox.
--
-- **An RPC, not an Edge Function calling `auth.admin.deleteUser`.** Every write in this schema is
-- already a guarded RPC, the project has no functions infrastructure, and only a database function
-- deletes the lists and the account in the same transaction. It works because `postgres`, which owns
-- this function, holds DELETE on `auth.users` (owned by `supabase_auth_admin`) and has `rolbypassrls`.
-- That table has row-level security on and `postgres` does not own it, so without the bypass the last
-- delete would quietly remove nothing and leave the account behind. Both checked true on the local
-- stack and on cloud, 2026-10-05. Any new environment must check both again before this migration
-- reaches it:
--   select has_table_privilege('postgres', 'auth.users', 'DELETE');
--   select rolbypassrls from pg_roles where rolname = 'postgres';
--
-- **The order of the two deletes is load-bearing.** Deleting the user first would cascade their
-- memberships away. The list delete would then find no list they own, and every list they solely
-- owned would be left with no owner at all, which is the outcome this function exists to remove.
--
-- What the cascades do, measured in ai/tasks/25-account-deletion/implementation-log-step-2.md:
--
--   - Deleting a list takes its items and memberships with it. `keep_last_owner` lets those
--     membership deletes through by its "the list is already gone" exemption, as it does for the
--     purge, and `notify_list_members` sends `list/changed` to each departing member. Every other
--     member's app re-fetches, and the list disappears.
--   - Deleting the user takes `public.users` (freeing the name), every session and identity (so every
--     device's refresh token dies with the account), and their memberships of the lists that
--     survive, through `keep_last_owner`'s "the user is already gone" exemption. The remaining
--     members of those lists are nudged. `lists.created_by` is set null rather than cascaded.
--
-- **That set-null scans all of `lists`.** Nothing reads lists by creator, so the sharing migration
-- dropped the index that would serve it, and this one does not bring it back: the scan was measured
-- cheap (same log). Add an index on `created_by` only if a measurement says otherwise.
--
-- **A second permanent delete, beside the nightly purge.** These lists are not tombstoned. Only an
-- owner can restore a list, so a binned one here could never come back, and it would hold the
-- departed user's data for 30 more days.
--
-- **Concurrent owner changes are serialized elsewhere.** 20261005100000_list_owner_locks.sql
-- redefines this function to lock every list the caller is on first, closing the co-owner race.
--
-- No heir is promoted, so the list-limit trigger never fires here. Nothing is returned either: the
-- app's warning is one general sentence, not a per-list preview.

create function public.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.session_still_valid() then
    raise exception using errcode = '42501', message = 'this device has been signed out';
  end if;

  delete from public.lists l
   where exists (select 1 from public.list_members m
                  where m.list_id = l.id and m.user_id = (select auth.uid()) and m.role = 'owner')
     and not exists (select 1 from public.list_members m
                      where m.list_id = l.id and m.user_id <> (select auth.uid()) and m.role = 'owner');

  delete from auth.users where id = (select auth.uid());
end;
$$;

revoke execute on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
