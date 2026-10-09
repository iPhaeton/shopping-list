---
id: read-rooted-at-list-members
title: The read starts at list_members, and every policy predicate is an uncorrelated subquery — that is what survives a million lists
type: decision
status: current
tags: [supabase, postgres, rls, performance, persistence]
sources: [ai/tasks/7-list-sharing/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-2.md, ai/tasks/8-realtime/implementation-log-step-1.md, ai/tasks/9-deletion/implementation-log-step-1.md, ai/tasks/11-pagination/implementation-log-step-1.md, ai/tasks/18-share-by-name/implementation-log-step-1.md, ai/tasks/23-list-limits/implementation-log-step-1.md, ai/tasks/23-list-limits/implementation-log-step-2.md, ai/tasks/24-search-and-sort/implementation-log-step-2.md, supabase/migrations/20260907000000_list_sharing.sql, supabase/migrations/20261001000000_list_limits.sql, src/lib/listsApi.ts]
last_verified: 2026-10-09
verify: grep -q "from('list_members')" src/lib/listsApi.ts && grep -Fq "'role, created_at, lists!inner ( id, name, deleted_at )'" src/lib/listsApi.ts && test "$(grep -c 'select(MEMBERSHIP_COLUMNS)' src/lib/listsApi.ts)" -ge 2 && ! grep -A1 "from('lists')" src/lib/listsApi.ts | grep -q 'select(' && grep -q 'create index on public.list_members (user_id, created_at);' supabase/migrations/20260907000000_list_sharing.sql && grep -A6 'create function public.my_memberships' supabase/migrations/20260907000000_list_sharing.sql | grep -q 'security invoker' && grep -A6 'create function public.my_memberships' supabase/migrations/20260907000000_list_sharing.sql | grep -q "set search_path = ''" && grep -q "from('items').select(ITEM_COLUMNS).eq('list_id', listId)" src/lib/listsApi.ts && awk '/^create function public.my_list_counts/,/^\$\$;/' supabase/migrations/*.sql | grep -q 'security invoker' && awk '/^create function public.my_list_counts/,/^\$\$;/' supabase/migrations/*.sql | grep -q 'from public.list_members m'
related: [keyset-paging-in-the-order-shown, list-data-scoped-by-rls, select-policy-gates-update-and-delete, writes-retry-from-an-outbox, realtime-is-a-nudge-to-a-per-user-inbox, deletion-is-a-tombstone, supabase-local-stack]
---

Sharing had a hard performance requirement — 1,000,000 rows in `lists` and "the lists I can see" must
still be fast — and **that requirement, not the three roles, is what shaped the schema**. Measured on
the local stack at 1M lists / 1.2M memberships / 1M items, as `authenticated` with a real JWT claim:

| the same answer, two rootings | plan | time |
|---|---|---|
| `from list_members` + embed (shipped) | index scan on `list_members_user_id_created_at_idx` → nested loop → `lists_pkey` | **1.9 ms** |
| `from lists order by created_at` (what step 3 did) | `Seq Scan on lists`, 999,981 rows removed, then `Sort` | **254 ms** |

Three rules produce the top row, and all three are load-bearing:

1. **Membership is the only access path.** Every list has one `list_members` row per person who can
   see it, its creator included, minted by the `on_list_created` trigger. `lists.created_by` is
   provenance and decides nothing. Had ownership stayed on `lists`, every read policy would read
   `created_by = auth.uid() or exists (...)`, and an `or` across two access paths is the classic way
   to lose an index.
2. **Every policy predicate is an *uncorrelated* `in (select ... from public.my_memberships())`.** It
   mentions no column of the outer row, so it is evaluated once per query and probed per row: the
   cost tracks how many lists *you* are in, never how many exist. `my_memberships()` takes no
   arguments, returns a set, and is `security invoker` precisely so this holds.
3. **The read is rooted at `list_members`.** [fetchLists](../../../src/lib/listsApi.ts) selects
   `role, created_at, lists!inner ( ... )` from the membership table, so the top-level scan is over
   your own membership rows and `lists` is reached by primary key. Rule 2 keeps the predicate cheap;
   rule 3 keeps the scan small. Neither substitutes for the other.

**What breaks it, in order of how tempting each is.** Re-rooting `fetchLists` at `lists` "because
that is the table we want" costs two orders of magnitude. Adding a `security definer` helper called
from a policy — `is_list_member(list_id, uid)`, which `ai/suggestions/supabase-persistence.md` still
proposes — is worse: a definer function is opaque to the planner, never inlined, and called once per
row of `lists`. Adding an `or` to any policy, or an `.eq()` on an ownership column to the list read,
loses the index qual. All three were considered and rejected with measurements, not taste.

**`set search_path = ''` on a SQL function blocks inlining — and here that costs nothing.** At 1M
rows with realistic statistics it makes no difference at all: identical plans, identical buffers. A
scratch run that said otherwise wrote the `in (subquery)` directly in the query, where the planner
may pull it up into a semi-join; **an RLS policy qual becomes a `SubPlan` either way and is never
pulled up.** So the clause stays. A plan measured on a scratch table with a different query shape is
not evidence about a policy.

**Paging is its own decision:
[keyset-paging-in-the-order-shown](keyset-paging-in-the-order-shown.md).** Both streams of
`fetchLists` — live, and since task 24 step 2 the bin, ordered by the embed's `deleted_at` — keep
this root and this `!inner` embed. `fetchItems` is rooted at `items` on purpose, measured: it pages
one list's stream, `.eq('list_id')` picks the list, and RLS still decides visibility — the client is
not filtering for authorisation. `fetchItem(id)` by primary key serves the blocked-write path
([writes-can-land-on-a-tombstone](writes-can-land-on-a-tombstone.md)). **Neither lists read is an
ordered index walk:** `auth.uid()` is an InitPlan the planner cannot see through, so a page of lists
costs every membership after its cursor, and every page of the bin costs the whole account.

**`my_list_counts()` is rooted here too** (task 23 step 2): invoker, from `list_members`
with an explicit `user_id` predicate, beside page 1 on every full `hydrate` and costing about as much
(1,632 buffers / ~1 ms at 402 memberships). **The limit checks are `security definer`, and that does
not break the rule above**: `check_list_limits` counts somebody else's rows, once per membership
write from a trigger, never per row from a policy. At ~1,000 memberships its count flips to a hash
join over a seq scan of `lists` (24.8 ms at 200,000 lists), paid only at that limit. Accepted.

**The realtime fan-out wants the *primary key* instead — know that before tidying either index.** Its
`select user_id from list_members where list_id = ?` is a prefix scan of the `(list_id, user_id)` PK
([realtime-is-a-nudge-to-a-per-user-inbox](realtime-is-a-nudge-to-a-per-user-inbox.md)), ≈0.08 ms
per member per change. Two readers, two access orders, both load-bearing.

**Rule 1 is also why your role costs nothing to read.** `role` rides on the membership row the read
roots at, so role-gated UI needs no extra round trip and works offline out of the cache. A screen
that wants "what may I do here" reads `list.role`; it does not ask the database again.

**If you re-measure, each of these traps has cost a cycle.** A plan on the local stack's own few
thousand rows is a seq scan that says nothing about scale, so seed first. Watch `n_distinct` on
`list_members.user_id` and spread the seed over ~10,000 accounts by deterministic modulo: one account
holding 84% of rows made the planner seq-scan inside the RLS subplan, and `join lateral (… order by
random() limit 1)` is *uncorrelated*, so it runs once and hands one account every row. Seed under
`set session_replication_role = replica`, or the realtime fan-out trigger writes a `realtime.messages`
row per insert — **but that mode also skips FK cascades**, so delete a seed's `items` and
`list_members` before its `lists`. PostgREST's own SQL could not be captured here (three routes
tried, in the task-23 step-1 log), so measure hand-written SQL in its shape: an `!inner` embed is an
`INNER JOIN LATERAL` carrying the embed's filter. `analyze`, then `explain (analyze, buffers)` in a
role-switched psql session ([supabase-local-stack](supabase-local-stack.md)). Drop a seed by marker
(`name like 'seed-%'`) to keep other accounts, with `npx supabase db reset` otherwise.

**One caveat on the headline claim.** Size-independence is read off the plan — no node's row count
tracks the table — rather than measured; a 10M-row run was never done. Over HTTP the gap narrows to
~20 ms vs ~65 ms, because request overhead dominates once the query is a millisecond.

**What to do:** treat rules 1–3 as the contract. A new policy on list data is another uncorrelated
`in (select ... from public.my_memberships() ...)`; a new read of list data starts at `list_members`
unless you have measured otherwise — `fetchItems` is the worked example. The `verify:` command
asserts both lists reads still root at `list_members` with the inner embed and that nothing reads
from `lists` directly, that the `(user_id, created_at)` index still exists, that `my_memberships()`
is still `security invoker` with its `search_path` clause intact, that `fetchItems` still picks its
list by `list_id`, and that `my_list_counts()` is invoker and rooted at `list_members`.
