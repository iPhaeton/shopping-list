---
id: deletion-is-a-tombstone
title: Deleting stamps `deleted_at` and leaves the row — the bin's first page ships with the fetch that opens the list, and a nightly purge is what actually removes anything
type: decision
status: current
tags: [supabase, postgres, persistence, state, deletion, ui]
sources: [ai/tasks/9-deletion/implementation-log-step-1.md, ai/tasks/11-pagination/implementation-log-step-1.md, ai/tasks/11-pagination/implementation-log-step-2.md, ai/suggestions/deletion.md, supabase/migrations/20260910000000_deletion.sql, supabase/migrations/20260910000001_purge_schedule.sql, src/state/listsReducer.ts, src/lib/listsApi.ts, src/state/ListsContext.tsx]
last_verified: 2026-09-12
verify: grep -q 'return liveItems(list).filter' src/state/listsReducer.ts && grep -q 'liveLists(lists)' src/screens/ListsScreen.tsx && grep -q 'liveItems(list)' src/screens/ListDetailScreen.tsx && ! grep -qE 'bin:items|live:items' src/lib/listsApi.ts && grep -q "fetchItems(listId, 'live', null)" src/state/ListsContext.tsx && grep -q "fetchItems(listId, 'bin', null)" src/state/ListsContext.tsx && test "$(grep -rl 'function public.my_memberships' supabase/migrations)" = supabase/migrations/20260907000000_list_sharing.sql && ! grep -A8 'function public.my_memberships' supabase/migrations/20260907000000_list_sharing.sql | grep -q deleted_at && test "$(grep -c 'deleted_at <= cutoff' supabase/migrations/20260910000000_deletion.sql)" = 2 && ! grep -q 'cron.schedule' supabase/migrations/20260910000000_deletion.sql && grep -q "cron.schedule('purge-deleted'" supabase/migrations/20260910000001_purge_schedule.sql
related: [writes-can-land-on-a-tombstone, list-data-scoped-by-rls, read-rooted-at-list-members, list-cache-holds-acknowledged-rows, server-stamps-done-at, realtime-is-a-nudge-to-a-per-user-inbox, scope-boundaries, supabase-local-stack]
---

Step 9 added deletion, and **it deletes nothing**. `lists` and `items` each grew a `deleted_at
timestamptz`; a delete stamps it, a restore nulls it, and the row keeps its place, its id, its
`list_members` rows and its history. The only statement in the schema that actually removes list data
is `purge_deleted`, which runs nightly as `postgres` and collects tombstones older than 30 days
([the migration](../../../supabase/migrations/20260910000000_deletion.sql)).

The choice was the user's, and four hard problems dissolve with it: a write to a deleted thing matches
a row that is *visibly* deleted rather than being indistinguishable from a refusal
([writes-can-land-on-a-tombstone](writes-can-land-on-a-tombstone.md)); there is nowhere to keep a
user's typing because nothing was destroyed; sharing survives, since nothing cascades, so a restore is
a real restore; and a reversible delete needs no confirmation modal, which sidesteps `Alert.alert`
being a **no-op under react-native-web** (measured) — still true for any future destructive confirm.

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
nothing; neither returns an outcome, because a delete cannot itself land on a deleted target.

**The bin arrives with the live stream the moment a list is opened, not with `fetchLists` — since
step 11-2 — and the client is what hides it.** `fetchLists` is list metadata only (`id, name,
deleted_at`); it carries no items at all any more. Opening a list runs `loadListItems`
([src/state/ListsContext.tsx](../../../src/state/ListsContext.tsx)), which fetches both streams from
`null` via `Promise.all` and folds them into state together as one `items/firstPageLoaded`, each
capped at `PAGE_SIZE` server-side; the policies add no filter, and `fetchItems(listId, 'bin',
cursor)` reads the rest of the bin on scroll
([read-rooted-at-list-members](read-rooted-at-list-members.md)). The `deleted_at` filters in
`listsApi` split the two streams; they hide nothing — every row of either stream is visible to every
member. So ticking "Show deleted" is instant for any bin that fits in a page, once the list has been
opened — which is most of why this reads better than a separate trash screen. The consequence is the
trap:

> **Every count and every render must go through `liveItems(list)` or `liveLists(lists)`**
> ([src/state/listsReducer.ts](../../../src/state/listsReducer.ts)). A tombstone reads exactly like a
> live row otherwise, so the mistake is invisible in any test that does not delete something first.
> `liveLists` keeps a binned list out of the Lists screen; `liveItems` drives
> `ListDetailScreen`'s "Nothing on this list" empty state and its sort. `ListRow`'s "N of M done" is
> gone as of step 11-2 — a row shows only its name now, a deliberate product trade-off (see
> [scope-boundaries](scope-boundaries.md)), not a bug — so `countDone` (still exported, still tested)
> has no caller left in app code.

Both helpers return a fresh array, so a screen handing one to a `FlatList` memoises it.
`ShowDeletedToggle` renders **only when the bin is non-empty**, since a toggle that reveals nothing
is noise.

**The purge is part of the feature, not a follow-up.** A shopping list is the worst case for soft
delete — items are added and cleared weekly, and every dead row ships on a read path a whole migration
went into keeping cheap. Three things about it are easy to break:

- **`deleted_at <= cutoff`, not `<`.** `now()` is the *transaction's* start time, frozen for its whole
  life, so a tombstone stamped by `set_item_deleted` and a cutoff of `now() - interval '0 seconds'`
  are the same instant inside one transaction. With `<` the zero-interval call collects nothing —
  which makes the one call that proves the function works a silent no-op. At a real 30-day cutoff the
  operators are identical.
- **The interval is a parameter** so a test need not wait a month, and the function returns counts
  rather than void. The item count **excludes** rows carried off by a list's cascade.
- **The `cron.schedule` half is a separate migration file on purpose.** A migration is one
  transaction, so a refused `create extension pg_cron` would roll the whole feature back; split, it
  costs the schedule only. The price is that an **unapplied** migration wedges every later `db push`
  — the CLI retries from the earliest unapplied file forward — so "one file failed" and "migrations
  are stuck" are the same event, and `npx supabase migration repair --status applied 20260910000001`
  is the way out.

The job is `purge-deleted` at **03:30 GMT** (`cron.timezone` is GMT, measured), running as `postgres`,
which owns the function — so `purge_deleted` is revoked from `anon` *and* `authenticated` and the
schedule still works. Re-scheduling the same job *name* upserts, so `db reset` accumulates no
duplicates. `keep_last_owner` does not abort it: its cascade exemption covers exactly this, measured.
Purging a list also nudges its members at 03:30 about a row they cannot see
([realtime-is-a-nudge-to-a-per-user-inbox](realtime-is-a-nudge-to-a-per-user-inbox.md)) — harmless,
and worth recognising rather than debugging.

**What it does not solve.** Restoring a list does **not** restore its items — the two tombstones are
independent, which is correct and confusing enough to have earned a line of copy on the binned-list
screen. The first page of the bin is still fetched even when hidden, now on opening the list rather
than on every list fetch — **bounded** at `PAGE_SIZE` rows per list per fetch, not minimised; the
follow-up, if fetch size ever matters, is to read the bin only on the first tick of the checkbox,
never to filter it in a policy.
**The purge has never run on cloud, and neither migration has been pushed there** —
`create extension pg_cron` is the one statement that may be refused
([supabase-local-stack](supabase-local-stack.md)). Nothing has yet read `cron.job_run_details` after a
real 03:30 run; that failure mode is silent and slow, so check it once after deploying and again a
week later.

The `verify:` command asserts the parts a refactor would quietly undo: both screens still filter
through the live helpers, `fetchLists` still carries no item embed at all and `loadListItems` still
fetches both streams the moment a list is opened, `my_memberships()` is still defined once and still
free of any tombstone test, the purge still uses `<=` on both tables, and the schedule is still in
its own file.
