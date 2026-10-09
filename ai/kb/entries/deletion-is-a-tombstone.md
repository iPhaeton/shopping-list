---
id: deletion-is-a-tombstone
title: Deleting stamps `deleted_at` and leaves the row — the bin's first page ships with the fetch that opens the list, and only the nightly purges and account deletion remove anything
type: decision
status: current
tags: [supabase, postgres, persistence, state, deletion, ui]
sources: [ai/tasks/9-deletion/implementation-log-step-1.md, ai/tasks/11-pagination/implementation-log-step-1.md, ai/tasks/11-pagination/implementation-log-step-2.md, ai/tasks/14-account-screen/implementation-log-step-1.md, ai/tasks/23-list-limits/implementation-log-step-1.md, ai/tasks/23-list-limits/implementation-log-step-2.md, ai/tasks/24-search-and-sort/description-step-2.md, ai/tasks/24-search-and-sort/implementation-log-step-2.md, ai/tasks/24-search-and-sort/implementation-log-step-3.md, ai/suggestions/deletion.md, supabase/migrations/20260910000000_deletion.sql, supabase/migrations/20260910000001_purge_schedule.sql, ai/tasks/25-account-deletion/implementation-log-step-2.md, src/state/listsReducer.ts, src/lib/listsApi.ts, src/state/usePaging.ts, ai/tasks/28-invitations/implementation-log-step-1.md, 47965d5, supabase/migrations/20261008000000_invitations.sql, supabase/migrations/20261008000001_purge_notifications_schedule.sql]
last_verified: 2026-10-09
verify: grep -q 'return liveItems(list).filter' src/state/listsReducer.ts && grep -q 'liveLists(lists)' src/screens/ListsScreen.tsx && grep -q 'liveItems(list)' src/screens/ListDetailScreen.tsx && grep -q 'binLists(lists)' src/screens/ListsScreen.tsx && grep -q 'binItems(list)' src/screens/ListDetailScreen.tsx && grep -q 'binned > 0 || showDeleted' src/screens/ListsScreen.tsx && grep -q 'inBin > 0 || showDeleted' src/screens/ListDetailScreen.tsx && grep -q 'loaded && !showDeleted && arranged && list.nextLive !== null' src/screens/ListDetailScreen.tsx && grep -q "const shownQuery = binned ? '' : query;" src/screens/ListDetailScreen.tsx && ! grep -qE 'bin:items|live:items' src/lib/listsApi.ts && grep -q "fetchItems(listId, 'live', null)" src/state/usePaging.ts && grep -q "fetchItems(listId, 'bin', null)" src/state/usePaging.ts && test "$(grep -rl 'function public.my_memberships' supabase/migrations)" = supabase/migrations/20260907000000_list_sharing.sql && ! grep -A8 'function public.my_memberships' supabase/migrations/20260907000000_list_sharing.sql | grep -q deleted_at && test "$(grep -c 'deleted_at <= cutoff' supabase/migrations/20260910000000_deletion.sql)" = 2 && ! grep -q 'cron.schedule' supabase/migrations/20260910000000_deletion.sql && grep -q "cron.schedule('purge-deleted'" supabase/migrations/20260910000001_purge_schedule.sql && test "$(grep -c 'where created_at <= cutoff' supabase/migrations/20261008000000_invitations.sql)" = 2 && ! grep -q 'cron.schedule' supabase/migrations/20261008000000_invitations.sql && grep -q "cron.schedule('purge-notifications', '35 3 \* \* \*'" supabase/migrations/20261008000001_purge_notifications_schedule.sql
related: [keyset-paging-in-the-order-shown, writes-can-land-on-a-tombstone, list-data-scoped-by-rls, read-rooted-at-list-members, list-cache-holds-acknowledged-rows, server-stamps-done-at, realtime-is-a-nudge-to-a-per-user-inbox, scope-boundaries, supabase-local-stack, limit-checks-pass-an-applied-resend, delete-account-locks-then-removes-sole-owned-lists]
---

**Deleting deletes nothing.** `lists` and `items` each grew a `deleted_at
timestamptz`; a delete stamps it, a restore nulls it, and the row keeps its place, its id, its
`list_members` rows and its history. Two statements actually remove list data: `purge_deleted`,
run nightly as `postgres` on tombstones older than 30 days
([the migration](../../../supabase/migrations/20260910000000_deletion.sql)), and `delete_account`,
which hard-deletes every list a departing account solely owns, binned or not
([delete-account-locks-then-removes-sole-owned-lists](delete-account-locks-then-removes-sole-owned-lists.md)) — never a
user's delete of a list or item. Invitations and notifications are never tombstoned; a second
nightly job hard-deletes them by age (below).

The choice was the user's: a write to a deleted thing matches a row that is *visibly* deleted rather
than being indistinguishable from a refusal ([writes-can-land-on-a-tombstone](writes-can-land-on-a-tombstone.md));
sharing survives, since nothing cascades, so a restore is a real restore; and a reversible delete
needs no confirmation modal, which sidesteps `Alert.alert` being a **no-op under react-native-web**
(measured). An irreversible action confirms with an inline `Cancel`/confirm row instead — Account's
"Sign out of all devices" is the shape to copy.

**No policy changed, and that is the fact worth carrying.** A tombstone is still a row, a member has
to *see* it to restore it, and the client decides what to render. The read policies still say
`in (select … from public.my_memberships())` and `lists`/`items` still have no `for delete` policy at
all ([list-data-scoped-by-rls](list-data-scoped-by-rls.md),
[read-rooted-at-list-members](read-rooted-at-list-members.md)). **Filtering tombstones inside
`my_memberships()` is the tempting shortcut and would make the bin unreachable** — the read policies
share that function. The `verify:` command asserts it stays clean.

**Nothing client-side may write `deleted_at`, and no new revoke was needed.** `revoke update on
public.items from anon, authenticated` (step 3) and `grant update (name) on public.lists` (step 7)
mean `authenticated` holds no UPDATE privilege that a new column could land in —
`has_column_privilege` is false for it on both tables, measured after adding it. A new column on
either table is un-writable by construction, so the RPCs are forced rather than merely preferred
([supabase-default-grants-defeat-revokes](supabase-default-grants-defeat-revokes.md)).

**Whoever may delete a thing may restore it.** `set_item_deleted` takes `role >= 'writer'`,
`set_list_deleted` takes `role = 'owner'`, each one predicate applied to both directions rather than a
`case` on the boolean — an earlier draft let a writer put an item beyond their own reach with one tap.
Both take a boolean rather than being a verb, so the value is absolute: a retry is harmless and the
outbox coalesces delete/restore/delete into one request, exactly as it does a toggle
([writes-retry-from-an-outbox](writes-retry-from-an-outbox.md)). Both `raise 42501` when they change
nothing; neither returns an outcome, because a delete cannot itself land on a deleted target. A
restore can be refused at a limit: nothing in the bin counts toward one
([limit-checks-pass-an-applied-resend](limit-checks-pass-an-applied-resend.md)).

**"Show deleted" switches a screen to its bin, and nothing else** — the user's call. Bin mode shows
binned rows only, newest deletion first, paged by `(deleted_at, id)` descending ([keyset-paging-in-the-order-shown](keyset-paging-in-the-order-shown.md)).
Its sentence takes the Create / Add bar's slot, over the sort buttons' 44 pt of sky when entered from
search — a reader's too, whose read-only line stays below it. The bin is never searched, sorted
another way, or loaded in full ([scope-boundaries](scope-boundaries.md)): `ListDetailScreen`'s
`needsCompleting` is false there, so `loadAllItems` is aborted or never starts, and never holds the
list's paging guard against the bin's own scroll paging. **A binned list is not the bin view**: its
query is forced to `''`, but its stored item sort applies, and a non-default one over a partial list
does complete it, with the coverage line under the notice card.

**Its first page arrives before anyone asks, and the client is what hides it.** Opening a list runs
`loadListItems` ([src/state/usePaging.ts](../../../src/state/usePaging.ts)), which fetches page 1 of
both streams from `null` via `Promise.all` and folds them in as one `items/firstPageLoaded`. Page 1
of the lists bin rides on every `hydrate`, beside the live one. Scrolling asks only for the stream on
screen (`loadMore(listId, stream)`, `loadMoreLists(stream)`). `fetchLists` carries no items at all.
The `deleted_at` filters in `listsApi` split the streams and hide nothing: every row of either is
visible to every member. So the switch is instant and works offline. The consequence is the trap:

> **Every count and every render goes through `liveItems`/`liveLists`, or `binItems`/`binLists` in
> the bin view** ([src/state/listsReducer.ts](../../../src/state/listsReducer.ts)) — never the raw
> array, which holds both streams. A tombstone reads exactly like a live row otherwise, so the
> mistake is invisible in any test that does not delete something first. `liveItems` drives
> `ListDetailScreen`'s "Nothing on this list" empty state and its sort. A list row shows only its
> name, a product trade-off ([scope-boundaries](scope-boundaries.md)), so `countDone` has no caller.

`ShowDeletedToggle` renders while the bin has rows **or while it is checked**. An empty bin hides it
as noise, but restoring the bin's last row must leave the only way back, above `The bin is empty`.

**The purge is part of the feature, not a follow-up.** A shopping list is the worst case for soft
delete — items are added and cleared weekly, and every dead row ships on the read path. Three things
about it are easy to break:

- **`deleted_at <= cutoff`, not `<`.** `now()` is frozen for the whole transaction, so a tombstone
  stamped in it and a cutoff of `now() - interval '0 seconds'` are the same instant: with `<` the
  zero-interval call that proves the function works is a silent no-op.
- **The interval is a parameter** so a test need not wait a month, and the function returns counts.
  The item count **excludes** rows carried off by a list's cascade.
- **The `cron.schedule` half is a separate migration file on purpose.** A migration is one
  transaction, so a refused `create extension pg_cron` would roll the whole feature back; split, it
  costs the schedule only. The price: an **unapplied** migration wedges every later `db push`, and
  `npx supabase migration repair --status applied 20260910000001` is the way out.

The job is `purge-deleted` at **03:30 GMT** (`cron.timezone` is GMT, measured), running as
`postgres`, which owns the function — so it is revoked from `anon` *and* `authenticated` and the
schedule still works. Re-scheduling a job *name* upserts, so `db reset` accumulates no duplicates.
`keep_last_owner`'s cascade exemption lets it through, measured; its members' nudges are harmless.

**The second nightly hard delete is `purge_notifications(interval default 30 days)`**, job
`purge-notifications` at **03:35 GMT** ([the migration](../../../supabase/migrations/20261008000000_invitations.sql),
its schedule split off the same way). It deletes invitations, then notifications, with
`created_at <=` the cutoff — answered or not, read or not; a pending invitation simply expires. Same
`<=`, counts that exclude the cascade, `postgres`-only grant; each delete is a sequential scan,
bounded by the 30 days. `delete_account` needs no change for these tables: its `auth.users` delete
cascades to every invitation, notification and block of the departing account, either side (S16).

**What it does not solve.** Restoring a list does **not** restore its items — the two tombstones are
independent, which is correct and confusing enough to have earned a line of copy on the binned-list
screen. Each bin's first page is fetched even while hidden — **bounded**, not minimised, on purpose:
the switch reads it to decide whether to render, and it keeps the bin readable offline.
**The purge has never run on cloud, and neither migration has been pushed there** —
`create extension pg_cron` is the one statement that may be refused
([supabase-local-stack](supabase-local-stack.md)). Nothing has yet read `cron.job_run_details` after
a real run; that failure is silent and slow, so check it after deploying and again a week later.

The `verify:` asserts what a refactor would quietly undo: the live/bin helpers, bin mode's guards,
both streams on open, a tombstone-free `my_memberships()`, `<=` in both purges, both schedules split.
