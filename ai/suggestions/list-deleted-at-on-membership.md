# Suggestion — copy each list's `deleted_at` onto its `list_members` rows

**Status:** proposal, not an approved step. Adopting it needs an
`ai/tasks/<n>/description-step-<n>.md` first. It changes no scope, so
[scope-boundaries](../kb/entries/scope-boundaries.md) is unaffected. Several KB entries' `verify:`
lines pin the current query strings and would need the librarian afterwards (see the last section).

**Date:** 2026-10-04, written against commit `9e9e397`.

**Sourced from** a 2026-10-04 conversation that walked through how `fetchLists` reads both streams.
All numbers are from the task-24 step-2 measurements
([implementation log](../tasks/24-search-and-sort/implementation-log-step-2.md)), not re-run. The
local Docker stack was down. Nothing in this document's own design has been measured.

**Recommendation: don't build it yet.** Both list reads cost ~1–5 ms at 2,000 memberships, below
one HTTP round trip. Build it when an account with thousands of binned memberships measures slow,
which is the escalation [keyset-paging-in-the-order-shown](../kb/entries/keyset-paging-in-the-order-shown.md)
already names. The cheaper first move for refresh latency is the sequential page re-read (below).

## Current state

Both streams are `fetchLists` in [src/lib/listsApi.ts](../../src/lib/listsApi.ts)
(`liveListPage`, `binListPage`). Both are rooted at `list_members` with a `lists!inner` embed, and
both run the same plan:

```
Limit 100
  └─ Sort
       └─ Nested Loop
            ├─ Bitmap Index Scan on list_members (user_id, created_at)   ← every membership of yours
            └─ Index Scan on lists_pkey, Filter on lists.deleted_at       ← one lookup per membership
```

Neither read is a full table scan. Each reads **every membership of the caller**, never other
accounts' rows. What separates the two streams is the cursor:

| | live | bin |
|---|---|---|
| order / keyset | membership `(created_at, list_id)` asc | list's `(deleted_at, id)` desc, via `order=lists(deleted_at).desc` |
| page 1 | whole account: 1,632 buf @ 402 memberships, 8,080 buf / ~4 ms @ 2,000 | whole account: 1,638 buf / ~1 ms, 8,086 buf / ~5 ms |
| page 2+ | memberships after the cursor (`gte` is an index cond.): 849 vs 1,649 | **whole account again**: 1,632 @ 402, 8,080 / ~6 ms @ 2,000 |

**Why page 1 reads the whole account.** The RLS predicate `user_id = (select auth.uid())`
([list_sharing.sql:172](../../supabase/migrations/20260907000000_list_sharing.sql)) is an InitPlan
param, unknown at plan time. Even bare, `auth.uid()` is `STABLE` and is not folded. For
`user_id = $1` the planner estimates `reltuples / n_distinct(list_members.user_id)`, the
**average memberships per user**. That came to ~20 on the task-24 seed (≈204k memberships / ≈10k
accounts). Expecting ~20 rows, it picks bitmap + sort over an ordered walk with an early stop.
Statistics refresh by autovacuum after `50 + 10% × reltuples` modified rows (defaults; nothing in
`supabase/` overrides them), but fresher statistics change nothing here. The planner still uses an
average, because it never knows whose query it is.

**Why the bin can't page cheaply.** Its sort key is on `lists` and its root is `list_members`. No
index spans both tables, so the `lte` bound lands in the lateral join's filter and bounds nothing.

**Why each stream pays for the other.** The stream filter is `lists.deleted_at`, applied after the
PK lookup. The live read fetches and discards every binned list. The bin read does the same with
up to 1,000 live ones. Binned memberships don't count toward `MAX_LISTS`
([limits.ts](../../src/lib/limits.ts)), so only the 30-day purge bounds them, and it has never run
on cloud.

**`lists (deleted_at) where deleted_at is not null`** serves only the purge. It covers every
account's deletions, so the bin read can't use it. The migration comment calling it the index for
"show me the bin" ([deletion.sql:31-32](../../supabase/migrations/20260910000000_deletion.sql)) is
wrong.

## The change

1. `alter table public.list_members add column list_deleted_at timestamptz;` — a copy of
   `lists.deleted_at`, kept equal by triggers (§Issues it creates, 2).
2. Two partial indexes whose order matches each stream exactly:

   ```sql
   create index list_members_live_idx on public.list_members (user_id, created_at, list_id)
     where list_deleted_at is null;
   create index list_members_bin_idx on public.list_members (user_id, list_deleted_at, list_id)
     where list_deleted_at is not null;
   ```

   Keep `list_members (user_id, created_at)`. `my_memberships()`, which every policy calls, needs
   **all** of a user's memberships, binned ones included, or the bin becomes unreachable
   ([deletion-is-a-tombstone](../kb/entries/deletion-is-a-tombstone.md)). Open: whether one index
   `(user_id, list_deleted_at, created_at, list_id)` could serve all three readers. Not measured.
3. `fetchLists` filters, orders and pages on the root column:
   - live: `.is('list_deleted_at', null)`;
   - bin: `.not('list_deleted_at', 'is', null)`, `.order('list_deleted_at', { ascending: false })`,
     and a keyset `or`/`lte` on `list_deleted_at`/`list_id` with **no** `referencedTable`.

   The `lists!inner` embed stays for `name` and for the `lists` RLS policy. `deletedAt` keeps its
   meaning, so no cache `VERSION` bump
   ([list-cache-holds-acknowledged-rows](../kb/entries/list-cache-holds-acknowledged-rows.md)).

## What it fixes

- **Bin page 2+ costs the whole account.** Fixed. The bin cursor becomes an index range on
  `list_members_bin_idx`, as the live `gte` already is on today's index.
- **Each stream pays for the other's rows.** Fixed, **only if** the live read also moves its
  filter to `list_deleted_at` and gets its own partial index. The KB's escalation plan names only
  the bin index. With the bin index alone, the live read still walks binned memberships, though it
  skips their `lists` lookups.
- **Page 1 gets cheaper, unevenly.** It reads the whole *stream* instead of the whole *account*:
  - bin page 1: large gain (from live + binned down to binned only);
  - live page 1: small gain (binned memberships are usually few).
- **Side benefit, found while drafting, unmeasured.** `check_list_limits` and `my_list_counts`
  ([list_limits.sql](../../supabase/migrations/20261001000000_list_limits.sql)) join `lists` only
  to test `deleted_at is null`. With the copy they count from `list_members` alone, which removes
  the hash join over a seq scan of `lists` that `check_list_limits` flips to at ~1,000 memberships
  (24.8 ms at 200k lists, per
  [read-rooted-at-list-members](../kb/entries/read-rooted-at-list-members.md)).
  `my_list_counts` runs on every full `hydrate`.

## What it doesn't fix

- **Page 1 still reads the whole stream, not 100 rows.** The cause is the average-based row
  estimate, not where `deleted_at` lives. An index in the exact sort order makes an ordered walk
  with an early stop *possible*, but today's live read already has a nearly matching index and
  still gets bitmap + sort. Whether the planner switches has to be measured.
- **Three whole-account (now whole-stream) reads per full refresh.** `hydrate`
  ([useHydration.ts](../../src/state/useHydration.ts)) still runs live page 1, bin page 1 and
  `my_list_counts()` together. Each gets cheaper, but the count stays the same.
- **Refresh re-reads scrolled pages one request at a time.** `reloadListPages`
  ([reloadPages.ts](../../src/state/reloadPages.ts)) refetches each stream from page 1 until it
  holds what it held before. The bin pages get cheaper. The round trips (~20 ms each over HTTP)
  don't change, and they dominate. This is the better first target.

## Issues it creates, with fixes

1. **Realtime fan-out goes from N to N + N² per delete or restore.**
   `notify_on_membership_change` ([realtime.sql:124](../../supabase/migrations/20260909000000_realtime.sql))
   fires after **every** update of a `list_members` row, and `notify_list_members` messages every
   member of the list. Stamping N member rows therefore sends N × N messages, on top of the N from
   `notify_on_list_rename` on `lists`. That's 110 for 10 members, 2,550 for 50, 10,100 for 100,
   and nothing caps members per list.
   - Phones barely notice: `refreshSoon`'s 300 ms trailing debounce collapses the burst into one
     fetch.
   - The cost is server-side. Each `realtime.send` inserts into `realtime.messages` (~0.08 ms per
     member per change) **inside the owner's delete transaction**, so ~0.2 s at 50 members and
     ~0.8 s at 100. Each insert is also a delivered message against the plan's realtime quota.
   - **Fix:** fire only on role changes, the only update the trigger exists for:

     ```sql
     drop trigger notify_on_membership_change on public.list_members;
     create trigger notify_on_membership_change
       after insert or delete or update of role on public.list_members
       for each row execute function public.notify_list_members();
     ```

     `share_list`'s `on conflict do update set role` still fires it. Apply this **before** the
     backfill (issue 2), or the backfill itself sends N² messages per binned list.

2. **Two copies of one fact can drift.** A missed path shows a list in the wrong stream for one
   member. Both writers of `lists.deleted_at` and every insert path must be covered:
   - `set_list_deleted` (latest definition in `list_limits.sql`) for delete and restore. The purge
     hard-deletes and cascades, so it needs nothing.
   - `share_list` (latest in `share_by_name.sql`) does **not** refuse a binned list, so a new member
     of one must start stamped. `grant_creator_ownership` always inserts under a live list.
   - **Fix:** triggers rather than edits to each function. Both `security definer` with
     `set search_path = ''`, like every function here.

     ```sql
     -- lists → members, on delete and restore
     create trigger copy_list_deleted_at
       after update of deleted_at on public.lists
       for each row when (old.deleted_at is distinct from new.deleted_at)
       execute function public.copy_list_deleted_at();
       -- body: update public.list_members set list_deleted_at = new.deleted_at
       --        where list_id = new.id; return null;

     -- every new membership takes the list's current stamp (overwrites any client value)
     create trigger stamp_new_membership
       before insert on public.list_members
       for each row execute function public.stamp_new_membership();
       -- body: new.list_deleted_at := (select l.deleted_at from public.lists l
       --        where l.id = new.list_id); return new;
     ```

     `set_list_deleted`'s `coalesce` makes a retried delete a no-op on `deleted_at`, and the `when`
     clause then skips the copy. Then backfill:
     `update public.list_members m set list_deleted_at = l.deleted_at from public.lists l
     where l.id = m.list_id and l.deleted_at is not null;`

3. **Clients could write the copy directly.** `list_members` has no grant or revoke of its own,
   so it keeps Supabase's default UPDATE grant, limited only by the "owners change roles" policy.
   An owner could PATCH `list_deleted_at` on any member row of their lists. The client writes
   memberships only through RPCs ([membersApi.ts](../../src/lib/membersApi.ts)).
   - **Fix:** the `lists` precedent. A column-level revoke cannot subtract from a table grant
     ([supabase-default-grants-defeat-revokes](../kb/entries/supabase-default-grants-defeat-revokes.md)):

     ```sql
     revoke update on public.list_members from anon, authenticated;
     grant update (role) on public.list_members to authenticated;
     ```

     Confirm with `has_column_privilege` afterwards. A forged value on INSERT needs no grant change,
     because `stamp_new_membership` overwrites it.

4. **Delete and restore write N rows instead of 1.** Each row means up to three index updates on
   `list_members` (the full index, plus the old and new partials), plus the per-row BEFORE UPDATE
   triggers `keep_last_owner` and `limit_list_memberships`. Both return early unless `role`
   changes. Small at realistic N. Optionally narrow both to `update of role` as well.

5. **Two more indexes on every membership insert and role change.** List creation, sharing and
   promotion each pay a little more. Accepted cost.

## Measure before building

With the seeding method in
[read-rooted-at-list-members](../kb/entries/read-rooted-at-list-members.md) (spread over ~10k
accounts, `analyze` by hand after seeding), on an account at the limit, e.g. 1,000 live + 3,000
binned memberships:

- page 1 and a deep page of both streams, before and after;
- whether either stream now gets an ordered walk with an early stop;
- `check_list_limits` and `my_list_counts` before and after;
- `set_list_deleted` on a list with 50 and 100 members, counting rows added to `realtime.messages`.

## KB knock-on (for the librarian, after a step lands)

- `keyset-paging-in-the-order-shown`: its table, the "lists bin" paragraphs and its `verify:`,
  which pins `.order('lists(deleted_at)'` and the `referencedTable: 'lists'` keyset.
- `read-rooted-at-list-members`: its `verify:` pins `MEMBERSHIP_COLUMNS` verbatim, and its
  "neither lists read is an ordered index walk" claim may change.
- `realtime-is-a-nudge-to-a-per-user-inbox`: the membership trigger's events.
- `list-data-scoped-by-rls`: the new `list_members` column grant.
- `deletion-is-a-tombstone`: the copy, and that `my_memberships()` still must not filter on it.
