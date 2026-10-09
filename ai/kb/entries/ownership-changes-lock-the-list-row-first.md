---
id: ownership-changes-lock-the-list-row-first
title: Every function that can take an owner from a list locks its `lists` row first (`for no key update`) — the RPCs before any read or write, `keep_last_owner` again — so owner changes to one list run in turn
type: decision
status: current
tags: [supabase, postgres, concurrency, sharing, account, deletion, invitations]
sources: [ai/tasks/25-account-deletion/implementation-log-step-2-locks.md, supabase/migrations/20261005100000_list_owner_locks.sql, ai/tasks/28-invitations/implementation-log-step-1.md, 47965d5, ai/tasks/28-invitations/implementation-log-step-3.md, 5ab9b85, ai/tasks/28-invitations/implementation-log-step-4-unblock.md, 2916e6e, supabase/migrations/20261008000000_invitations.sql, supabase/migrations/20261009000000_drop_share_list.sql, supabase/migrations/20261009100000_unblock_restores_invitations.sql]
last_verified: 2026-10-09
verify: ok=1; for f in 'keep_last_owner\(' 'leave_list\(' 'set_member_role\(' 'remove_member\(' 'delete_account\(' 'accept_invitation\(' 'decline_invitation\(' 'withdraw_invitation\(' 'unblock_user\('; do m=$(grep -lE "^create (or replace )?function public\.$f" supabase/migrations/*.sql | tail -1); test -n "$m" && sed -n -E "/^create (or replace )?function public\.$f/,/^\\\$\\\$;/p" "$m" | grep -v '^ *--' | grep -q 'for no key update' || ok=0; done; test $ok = 1 && m=$(grep -lE '^create (or replace )?function public\.accept_invitation\(' supabase/migrations/*.sql | tail -1) && sed -n -E '/^create (or replace )?function public\.accept_invitation\(/,/^\$\$;/p' "$m" | grep -v '^ *--' | awk '/for no key update/ && !l {l=NR} /insert into public\.list_members/ && !i {i=NR} END {exit !(l && i && l < i)}' && grep -q '^drop function public.share_list(uuid, uuid, public.list_role);' supabase/migrations/20261009000000_drop_share_list.sql
indexed: false
related: [list-data-scoped-by-rls, delete-account-locks-then-removes-sole-owned-lists, scope-boundaries, limit-checks-pass-an-applied-resend, supabase-default-grants-defeat-revokes]
---

**The rule: lock the list row, then read the owners, then write membership rows.** It holds in
[the locks migration](../../../supabase/migrations/20261005100000_list_owner_locks.sql) and in
[the invitations migration](../../../supabase/migrations/20261008000000_invitations.sql):

- `leave_list`, `set_member_role` and `remove_member` take
  `perform 1 from public.lists l where l.id = p_list_id for no key update;` right after the session
  guard, before the owner check;
- `accept_invitation` — the only way onto an existing list since `share_list` was dropped
  ([drop migration](../../../supabase/migrations/20261009000000_drop_share_list.sql)) — locks the
  invitation's list before it reads the invitation, the inviter's ownership or the caller's
  membership, and before it inserts the membership;
- `delete_account` locks every list the caller is on, of any role, in id order
  ([delete-account-locks-then-removes-sole-owned-lists](delete-account-locks-then-removes-sole-owned-lists.md));
- the `keep_last_owner` trigger locks the list again before it counts owners — placed after both
  cascade exemptions, since a cascade has no list row left to lock.

**Invitation state follows the same order: the list, then its rows.** Every function that changes an
invitation's state locks its list `for no key update` before touching it — `withdraw_invitation`,
`decline_invitation` (and `block_inviter`, which calls it first), `accept_invitation`, and
`unblock_user`, which locks the lists of every invitation it restores, in id order, before it deletes
the block or touches an invitation. These write no owner, but an answer's notification insert takes
`for key share` on the list, and an inviter's `delete_account` holds that list while its cascade
needs the invitation: holding the invitation first would close the cycle. 11 races were measured
with no `40P01`. `invite_to_list` takes no lock — a new invitation changes no ownership and
conflicts with nothing an account deletion holds.

**Why a lock is enough.** Under READ COMMITTED each statement in a plpgsql function takes a fresh
snapshot, so the waiter's next statement re-reads the owners as the other transaction committed
them. No retry loop and no isolation change are needed. Without it, two co-owners leaving at once,
or one leaving while the other deleted their account, each saw the other as the owner who stays,
and the list was left with none. Now the loser gets `23514` 'a list must keep at least one owner'.

**`for no key update`, never `for update`.** The foreign-key checks for inserting an item, a member,
an invitation or a notification take `for key share` on the list row, and only `for update` conflicts
with that. These locks wait only for each other and for updates of the list row: rename, bin and
restore. Adding items is never blocked by an owner change.

**The RPCs lock up front, and the trigger keeps a lock too.** A BEFORE ROW trigger runs after its
membership row is already locked. So a write that reaches the trigger's lock while holding a
departing user's membership row deadlocks with that user's `delete_account`, which holds the list
and whose cascade needs the row — measured as `40P01` (T6), and in that unordered case it is **the
account deletion** that fails. Locking first gives one global order: the list, then its membership
rows. The trigger's lock stays for direct table writes: `authenticated` holds DELETE and UPDATE on
`list_members` through Supabase's default grants
([supabase-default-grants-defeat-revokes](supabase-default-grants-defeat-revokes.md)), and the
policies let an owner write their own row.

**The lock sits before the owner check, at a known cost:** any authenticated caller can lock a list
row by id, even one they are not on, for the length of one call that then raises — through
`withdraw_invitation` too, which finds the list by invitation id alone. Accepted. Accept and decline
lock nothing for an invitation that is not the caller's: their lookup filters by invitee.

**Still open, all rare, none stranding a list.** Postgres aborts one side with `40P01` and the end
state is consistent:

- `purge_deleted` deletes lists in heap-scan order, so it can deadlock with an account deletion over
  two or more of the same binned lists at 03:30, or with an owner's direct table write to their own
  row on a list being purged (reasoned).
- An inviter who has already **left** the list deletes their account during a decline, block or
  unblock: `delete_account` locks only lists its caller is on, so it takes `auth.users` and then, by
  cascade, the invitation, while the answer holds the invitation and needs that user row for its
  notification's foreign key. Reproduced (X2: the decline was the victim).
- An invitee deletes their account while an owner withdraws their invitation: the two cascades reach
  the invitation and its notification in opposite orders (reasoned).
- A list the caller joins after `delete_account`'s lock statement is not locked.
- Not a deadlock: `invite_to_list` reads the block without locking it, so an invitation that read the
  block before an unblock committed and inserted after it stays suppressed with no block to lift.
  Closing it would mean locking the block row in `invite_to_list`.

All accepted, not fixed.

**Ownership only.** This lifts the old no-locks rule for ownership and invitation state and nothing
else. The list limits' "no locks, overshoot accepted" ([scope-boundaries](scope-boundaries.md),
[limit-checks-pass-an-applied-resend](limit-checks-pass-an-applied-resend.md)) is a separate
decision and is unchanged.

**What to do:** a new function that writes `list_members` rows of an existing list, or changes an
invitation's state, takes the same `for no key update` on that list's row before it reads owners or
writes. Redefining one with `create or replace` copies its latest body — keep the lock statement in
it. The `verify:` asserts that the latest definition of each of the nine still contains
`for no key update`, that `accept_invitation`'s comes before its membership insert, and that
`share_list` stays dropped.
