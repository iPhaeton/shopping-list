---
id: ownership-changes-lock-the-list-row-first
title: Every function that can take an owner from a list locks its `lists` row first (`for no key update`) — the RPCs before any read or write, `keep_last_owner` again — so owner changes to one list run in turn
type: decision
status: current
tags: [supabase, postgres, concurrency, sharing, account, deletion]
sources: [ai/tasks/25-account-deletion/implementation-log-step-2-locks.md, supabase/migrations/20261005100000_list_owner_locks.sql]
last_verified: 2026-10-05
verify: ok=1; for f in 'keep_last_owner\(' 'leave_list\(' 'set_member_role\(' 'remove_member\(' 'share_list\(p_list_id uuid, p_user_id uuid' 'delete_account\('; do m=$(grep -lE "^create (or replace )?function public\.$f" supabase/migrations/*.sql | tail -1); test -n "$m" && sed -n -E "/^create (or replace )?function public\.$f/,/^\\\$\\\$;/p" "$m" | grep -v '^ *--' | grep -q 'for no key update' || ok=0; done; test $ok = 1
indexed: false
related: [list-data-scoped-by-rls, delete-account-locks-then-removes-sole-owned-lists, scope-boundaries, limit-checks-pass-an-applied-resend, supabase-default-grants-defeat-revokes]
---

**The rule: lock the list row, then read the owners, then write membership rows.** Six functions
follow it ([the migration](../../../supabase/migrations/20261005100000_list_owner_locks.sql)):

- `leave_list`, `set_member_role`, `remove_member` and `share_list(uuid, uuid, list_role)` take
  `perform 1 from public.lists l where l.id = p_list_id for no key update;` right after the session
  guard, before the owner check;
- `delete_account` locks every list the caller is on, of any role, in id order
  ([delete-account-locks-then-removes-sole-owned-lists](delete-account-locks-then-removes-sole-owned-lists.md));
- the `keep_last_owner` trigger locks the list again before it counts owners — placed after both
  cascade exemptions, since a cascade has no list row left to lock.

**Why a lock is enough.** Under READ COMMITTED each statement in a plpgsql function takes a fresh
snapshot, so the waiter's next statement re-reads the owners as the other transaction committed
them. No retry loop and no isolation change are needed. Before this, two co-owners leaving at once,
or one leaving while the other deleted their account, each saw the other as the owner who stays,
and the list was left with none. Now the loser gets `23514` 'a list must keep at least one owner'.
That closes a race which predates task 25 too: two owners leaving at once (T4, C stays owner).

**`for no key update`, never `for update`.** The foreign-key checks for inserting an item or a
member take `for key share` on the list row, and only `for update` conflicts with that. These locks
wait only for each other and for updates of the list row: rename, bin and restore. Adding items is
never blocked by an owner change.

**The RPCs lock up front, and the trigger keeps a lock too.** A BEFORE ROW trigger runs after its
membership row is already locked. So a write that reaches the trigger's lock while holding a
departing user's membership row deadlocks with that user's `delete_account`, which holds the list
and whose cascade needs the row — measured as `40P01` (T6), and in that unordered case it is **the
account deletion** that fails. Locking first gives one global order: the list, then its membership
rows. The trigger's lock stays for direct table writes: `authenticated` holds DELETE and UPDATE on
`list_members` through Supabase's default grants
([supabase-default-grants-defeat-revokes](supabase-default-grants-defeat-revokes.md)), and the
policies let an owner write their own row.

**`share_list` is included** because its `on conflict … do update set role` can demote an existing
owner.

**The lock sits before the owner check, at a known cost:** any authenticated caller can lock a list
row by id, even one they are not on, for the length of one call that then raises. Accepted.

**Still open, both reasoned rather than run.** `purge_deleted` deletes lists in heap-scan order, so
it can still deadlock with an account deletion over two or more of the same binned lists at 03:30,
or with an owner's direct table write to their own row on a list being purged. Postgres aborts one
of the two; no list is stranded. And a list the caller joins after `delete_account`'s lock statement
is not locked.

**Ownership only.** This lifts the old no-locks rule for ownership and nothing else. The list
limits' "no locks, overshoot accepted" ([scope-boundaries](scope-boundaries.md),
[limit-checks-pass-an-applied-resend](limit-checks-pass-an-applied-resend.md)) is a separate
decision and is unchanged.

**What to do:** a new function that writes `list_members` rows of an existing list takes the same
`for no key update` on that list's row before it reads owners or writes. Redefining one of the six
with `create or replace` copies its latest body — keep the lock statement in it. The `verify:`
asserts that the latest definition of each of the six still contains `for no key update`.
