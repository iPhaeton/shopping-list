-- Drops `share_list` (task 28 step 3, decision D1): nobody becomes a member of a list without
-- accepting. `share_list` added somebody straight to the roster, and upserted the role of somebody
-- already on it; kept, it would let an owner skip the invitee's consent that `invite_to_list` and
-- `accept_invitation` (20261008000000_invitations.sql) now ask for. An existing member's role changes
-- only through `set_member_role`, on Sharing's role picker.
--
-- Applied once nothing in the app called it: step 3's app invites through `invite_to_list`. An app
-- older than step 3 gets "function not found" from Share, and must update.
drop function public.share_list(uuid, uuid, public.list_role);

notify pgrst, 'reload schema';
