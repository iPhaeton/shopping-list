---
id: keyset-paging-in-the-order-shown
title: Every paged read is keyset in the order its screen shows — live oldest first, the bin newest deletion first — and a redundant range bound beside the keyset `or` is what decides the plan
type: decision
status: current
tags: [supabase, postgres, postgrest, performance, pagination, persistence, deletion]
sources: [ai/tasks/11-pagination/implementation-log-step-1.md, ai/tasks/23-list-limits/implementation-log-step-1.md, ai/tasks/24-search-and-sort/description-step-2.md, ai/tasks/24-search-and-sort/implementation-log-step-2.md, src/lib/listsApi.ts, src/state/listsReducer.ts, supabase/migrations/20260831000000_lists.sql, supabase/migrations/20261002000000_items_bin_order.sql]
last_verified: 2026-10-02
verify: grep -Fq ".order('created_at').order('id').limit(limit)" src/lib/listsApi.ts && grep -Fq ".order('created_at').order('list_id').limit(limit)" src/lib/listsApi.ts && grep -A3 "\.gte('created_at', after.createdAt)" src/lib/listsApi.ts | grep -Fq 'created_at.gt."${after.createdAt}",and(created_at.eq."${after.createdAt}",id.gt."${after.id}")' && grep -A3 "\.gte('created_at', after.createdAt)" src/lib/listsApi.ts | grep -Fq 'and(created_at.eq."${after.createdAt}",list_id.gt."${after.id}")' && grep -Fq ".order('deleted_at', { ascending: false }).order('id', { ascending: false }).limit(limit)" src/lib/listsApi.ts && grep -A3 "\.lte('deleted_at', after.deletedAt)" src/lib/listsApi.ts | grep -Fq 'deleted_at.lt."${after.deletedAt}",and(deleted_at.eq."${after.deletedAt}",id.lt."${after.id}")' && grep -Fq ".order('lists(deleted_at)', { ascending: false })" src/lib/listsApi.ts && grep -A4 "\.lte('lists.deleted_at', after.deletedAt)" src/lib/listsApi.ts | grep -Fq "{ referencedTable: 'lists' }" && ! grep -B2 "referencedTable: 'lists'" src/lib/listsApi.ts | grep -q '\.order(' && grep -q 'create index on public.items (list_id, created_at);' supabase/migrations/20260831000000_lists.sql && grep -q '^create index items_bin_order_idx on public.items (list_id, deleted_at, id) where deleted_at is not null;$' supabase/migrations/20261002000000_items_bin_order.sql && grep -q 'byStamp(b.deletedAt, b.id, a.deletedAt, a.id)' src/state/listsReducer.ts && grep -q 'inDeletionOrder(bin)' src/screens/ListsScreen.tsx && grep -q 'inDeletionOrder(bin)' src/screens/ListDetailScreen.tsx
related: [read-rooted-at-list-members, max-rows-is-a-silent-ceiling, deletion-is-a-tombstone, realtime-is-a-nudge-to-a-per-user-inbox, first-fetch-replaces-list-state, list-cache-holds-acknowledged-rows, supabase-local-stack]
---

`fetchItems` and `fetchLists` ([src/lib/listsApi.ts](../../../src/lib/listsApi.ts)) read one stream
per request, a page at a time, keyset rather than offset — an offset skips a row whenever somebody
bins one mid-scroll — and **in the order the screen shows that stream**, so a page loaded on scroll
only ever lands below the rows already shown:

| read | keyset, order | redundant bound | index |
|---|---|---|---|
| items, live | `(created_at, id)` ascending | `gte` | `items (list_id, created_at)` |
| items, bin | `(deleted_at, id)` descending | `lte` | partial `items_bin_order_idx` |
| lists, live | the membership's `(created_at, list_id)` — when you joined | `gte` | `list_members (user_id, created_at)` |
| lists, bin | the list's `(deleted_at, id)` descending, through the embed | `lte` | none can serve it |

**Why the bin pages by `deleted_at` (task 24 step 2).** Had it kept paging by `created_at` while the
bin view sorts newest deletion first, page 2 could hold yesterday's deletion and push it *above* rows
already on screen. A sort the read does not follow breaks paging silently. The client sorts with
`inDeletionOrder` ([listsReducer](../../../src/state/listsReducer.ts)), the paging order mirrored.

**The redundant bound is what makes paging cheap — keep it in every keyset read.** The bare `or` is
the keyset. A `created_at >= cursor` beside it means nothing new, but it turns the index condition
into a range that starts at the cursor rather than at the list's first row. At 1M items as
`authenticated`, page of 400, cursor mid-stream: `or` alone 121 buffers / 3.2 ms, `or` + `>=` 23 /
0.40 ms. Without it a full scroll is quadratic in list length. A `(…, id)` index would only remove a
27 kB incremental sort. `fetchItems` is rooted at `items` on purpose, measured: `.eq('list_id')`
picks the list, and RLS still decides visibility
([read-rooted-at-list-members](read-rooted-at-list-members.md)).

**The item bin's partial index fixes page 1, not a deep page of a huge bin.**
`items_bin_order_idx (list_id, deleted_at, id) where deleted_at is not null`, partial so live writes
never touch it. Page 1 is the hot path, read on every list open and every re-read. It is now a
backward walk that stops after a page: 413 buffers / 3.8 ms on a 40,000-row bin. Before, it walked
the purge's `items (deleted_at)` index through *every* list's recent deletions: 2,183 / 7.1 ms.
**A continuation deep in a very large bin still gets bitmap + sort**, ≤ ~27 ms at 40k. The planner
estimates 27–197 rows after the cursor where there are 10,000–39,600, because it multiplies the
list's selectivity by global ones. With `enable_bitmapscan = off` the same read is the walk (412 /
1.4 ms), so the index can serve it. `create statistics (mcv) on list_id, (deleted_at is null)` was
tried and did not change the estimate. Accepted, since typical bins (hundreds) do get the walk. The
full tables are in the task-24 step-2 log.

**The lists bin orders the parent rows by a column of the embed** — PostgREST v14.5, checked with
`curl` against the local stack:

- `.order('lists(deleted_at)', { ascending: false })` emits `order=lists(deleted_at).desc`, which
  orders the **`list_members` rows** by the to-one embed's column.
- **Never pass `referencedTable` to that order.** It emits `lists.order=`, which orders the embed's
  own rows and does nothing for a to-one.
- The keyset `or` **does** take `{ referencedTable: 'lists' }` (`lists.or=(…)`). With `!inner`, an
  embed filter drops the parent row, so no null embeds come back.

**Neither lists read is an ordered index walk that stops at 100.** `auth.uid()` is an InitPlan the
planner cannot see through, so it assumes ~20 memberships per account. It picks a Bitmap Index Scan
on `(user_id, created_at)`, a nested loop into `lists_pkey`, then a sort.

- **Live:** cost tracks your memberships after the cursor, so page 1 costs the whole account. That is
  1,649 buffers / ~2 ms at 402 memberships and 8,097 / ~7 ms at 2,000. The `gte` lands in the index
  condition and bounds a continuation (849 against 1,649).
- **Bin:** no index can serve an order whose key is across the join, so **every** page costs page 1.
  That is 1,638 / ~1 ms at 402 memberships and 8,086 / ~5 ms at 2,000. Its `lte` buys nothing and is
  kept as the live `gte`'s twin.
- **Escalate only if measured slow**, for an account with tens of thousands of binned memberships.
  The plan is to denormalise the stamp onto `list_members`, maintained by `set_list_deleted`, with a
  partial index on `(user_id, …)`. Not built.

**What to do:** a new sort or stream pages keyset in exactly the order it is shown in, with the
redundant bound beside its `or`, and is measured with
[read-rooted-at-list-members](read-rooted-at-list-members.md)' seeding method before it ships.
Every page stays guarded against the silent row cap
([max-rows-is-a-silent-ceiling](max-rows-is-a-silent-ceiling.md)). The `verify:` pins both live
keysets with their `gte`, the item bin's keyset with its `lte` and descending order, the lists bin's
embed order and its `referencedTable` filter (and none on an order), both item indexes, and the
client sorting the bin in the same direction.
