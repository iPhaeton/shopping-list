-- A change reaches every member of a list as it happens.
--
-- The database fans a **nudge** out to each member's private inbox topic; the client answers a nudge
-- with the fetch it already has. The message carries a list id and nothing else — no row contents, no
-- delta. Five things follow from that, and the first two would be enough on their own:
--
--   1. The merge already exists. src/state/replay.ts folds the outbox back over fetched rows with the
--      reducer itself, and that is the only place that knows how server truth and pending writes
--      combine. A delta stream would be a second description of "a write" in the client.
--   2. A dropped message costs staleness; a mis-applied delta costs divergence. Realtime stays an
--      optimisation — if the socket never connects the app behaves exactly as it did before, because
--      the foreground re-fetch is still there.
--   3. Server-computed values arrive correct. `done_at` is this database's clock, and a fetch brings
--      the real one rather than whatever a trigger happened to serialise.
--   4. A nudge cannot leak. The receive policy below is topic-only — whatever is in the payload
--      reaches whoever is on that topic with no row-level check — so the payload is deliberately
--      something its recipient already has.
--   5. New columns, new tables and new write paths need no payload change.
--
-- Note what is deliberately absent: no `postgres_changes` subscription. That makes Realtime evaluate
-- the RLS policies on `lists`/`items` per subscriber per changed row, which is the per-row cost the
-- previous migration's rule 2 exists to avoid, re-introduced on the write path; and its filters are a
-- single `eq` on one column, so a client in twenty lists would need twenty subscriptions.

-- One topic per user, not one per list.
--
-- **Channel authorization is evaluated once, at join, and cached for the life of the connection** —
-- measured: a client with no membership is refused with CHANNEL_ERROR at join rather than merely
-- receiving nothing. A per-list topic would therefore keep delivering to someone whose access was
-- revoked until they happened to reconnect, and could say nothing about a list you have just been
-- given access to, because you are not on its topic yet and do not know it exists. With a per-user
-- topic the *sender* decides the audience per write, so a revoke takes effect on the same live
-- socket, with no reconnect and no cache to invalidate.
--
-- The predicate touches no table at all, which is what keeps joining flat as an account grows.
-- `(select auth.uid())` for the same reason as everywhere else: an InitPlan evaluated once.
--
-- `realtime.messages` has RLS enabled and — until this statement — **zero policies**, so no
-- authenticated client could receive anything on a private channel. This policy is not plumbing
-- around the feature; it is the switch.
--
-- There is no insert policy, and there should not be: clients never broadcast, the database does.
create policy "receive your own inbox" on realtime.messages
  for select to authenticated
  using (extension = 'broadcast' and realtime.topic() = 'user:' || (select auth.uid())::text);

-- The fan-out. `security definer` for both of the reasons `list_members_of` is: it has to read *other
-- people's* membership rows, which the "read your own memberships" policy hides, and `authenticated`
-- cannot insert into `realtime.messages` however the policy above is written.
--
-- `realtime.send` is a plain insert into `realtime.messages`, so a nudge is transactional: a write
-- that rolls back sends nothing. It also swallows its own failures — its body wraps the insert in
-- `exception when others then raise warning` — so a broadcast that cannot be written never aborts the
-- user's write. That failure direction is the right one, and it is one more reason the client must
-- treat a message as a hint to re-read rather than as the thing that makes a change real.
create function public.notify_list_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_list uuid;
  departed uuid;
  member uuid;
begin
  -- One branch per table shape, because there is no column all three share: `lists` names the list
  -- as `id`, the other two as `list_id`. Reading `old` explicitly on a DELETE rather than
  -- `coalesce(new.list_id, old.list_id)` — the latter does work (measured on PostgreSQL 17: `NEW` in
  -- a row-level DELETE trigger reads as null rather than raising), but a coalesce over a record that
  -- is null by definition reads like a fallback for something that could go either way, and this
  -- cannot.
  if tg_op = 'DELETE' then
    target_list := old.list_id;
  elsif tg_table_name = 'lists' then
    target_list := new.id;
  else
    target_list := new.list_id;
  end if;

  -- The one person the read below cannot find: someone who has just stopped being a member, and who
  -- is still looking at the list. They have to be told once, and never again.
  if tg_table_name = 'list_members' and tg_op = 'DELETE' then departed := old.user_id; end if;

  -- Served by the primary key. `list_members`'s PK is `(list_id, user_id)`, so `where list_id = ?` is
  -- a prefix scan — this is the one read in the system that wants the PK rather than the
  -- `(user_id, created_at)` index the read path was built around. Worth knowing before anyone
  -- "tidies" either of them.
  for member in
    select m.user_id from public.list_members m where m.list_id = target_list
    union
    select departed where departed is not null
  loop
    perform realtime.send(
      jsonb_build_object('listId', target_list, 'source', tg_table_name, 'op', tg_op),
      'list/changed',
      'user:' || member::text,
      true
    );
  end loop;

  return null;
end;
$$;

-- `update` covers checking an item off: `set_item_done` is a definer function that UPDATEs `items`,
-- so this row trigger fires normally and nothing extra is needed for toggles.
create trigger notify_on_item_change
  after insert or update on public.items
  for each row execute function public.notify_list_members();

-- **`after update`, not `after insert or update`, and the difference is not cosmetic.** Postgres
-- fires same-timing triggers in *name* order, and `notify_on_list_create` would sort before
-- `on_list_created` — so at the instant it ran the creator's `list_members` row would not exist yet
-- and the fan-out would find nobody to tell. Creation is covered anyway, one table over:
-- `on_list_created` inserts into `list_members`, which fires the membership trigger below.
create trigger notify_on_list_rename
  after update on public.lists
  for each row execute function public.notify_list_members();

-- `insert` is "a list was shared with you" — the new member is in `list_members` by the time this
-- runs, so the loop reaches them. `update` is a role change, which the client needs in order to hide
-- or restore the controls. `delete` is the un-share, and the only reason `departed` exists.
create trigger notify_on_membership_change
  after insert or update or delete on public.list_members
  for each row execute function public.notify_list_members();

-- No revoke/grant block, unlike the RPCs in the previous migration. A trigger function is never named
-- by a caller and needs no EXECUTE privilege to fire, which is why `grant_creator_ownership` and
-- `keep_last_owner` carry none either.
