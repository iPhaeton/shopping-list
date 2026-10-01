---
id: read-rooted-at-list-members
title: The read starts at list_members, and every policy predicate is an uncorrelated subquery — that is what survives a million lists
type: decision
status: current
tags: [supabase, postgres, rls, performance, persistence]
sources: [ai/tasks/7-list-sharing/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-2.md, ai/tasks/8-realtime/implementation-log-step-1.md, ai/tasks/9-deletion/implementation-log-step-1.md, ai/tasks/11-pagination/implementation-log-step-1.md, ai/tasks/18-share-by-name/implementation-log-step-1.md, ai/tasks/23-list-limits/implementation-log-step-1.md, supabase/migrations/20260907000000_list_sharing.sql, src/lib/listsApi.ts]
last_verified: 2026-10-01
verify: grep -q "from('list_members')" src/lib/listsApi.ts && grep -Fq "'role, created_at, lists!inner ( id, name, deleted_at )'" src/lib/listsApi.ts && grep -Fq ".order('created_at').order('list_id').limit(limit)" src/lib/listsApi.ts && grep -A3 "\.gte('created_at', after.createdAt)" src/lib/listsApi.ts | grep -Fq 'and(created_at.eq."${after.createdAt}",list_id.gt."${after.id}")' && grep -q 'create index on public.list_members (user_id, created_at);' supabase/migrations/20260907000000_list_sharing.sql && grep -A6 'create function public.my_memberships' supabase/migrations/20260907000000_list_sharing.sql | grep -q 'security invoker' && grep -A6 'create function public.my_memberships' supabase/migrations/20260907000000_list_sharing.sql | grep -q "set search_path = ''" && grep -q "from('items').select(ITEM_COLUMNS).eq('list_id', listId)" src/lib/listsApi.ts && grep -A3 "\.gte('created_at', after.createdAt)" src/lib/listsApi.ts | grep -Fq 'created_at.gt."${after.createdAt}",and(created_at.eq."${after.createdAt}",id.gt."${after.id}")' && grep -q "create index on public.items (list_id, created_at);" supabase/migrations/20260831000000_lists.sql
related: [list-data-scoped-by-rls, select-policy-gates-update-and-delete, writes-retry-from-an-outbox, realtime-is-a-nudge-to-a-per-user-inbox, deletion-is-a-tombstone, supabase-local-stack]
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

**`fetchItems` is rooted at `items` on purpose — measured, not assumed.** It is the keyset
continuation of one stream of one list: `.eq('list_id')` picks the list (RLS still decides
visibility; this is not the client filtering for authorisation), the `or` is the `(created_at, id)`
keyset, and **a redundant `created_at >= cursor` beside the `or` is what makes paging cheap.** At 1M
items as `authenticated`, page of 400, cursor mid-stream:

| shape | index cond | buffers | time |
|---|---|---|---|
| `or` only | `list_id` | 121 | 3.2 ms |
| `or` + `>=` | `list_id, created_at >=` | 23 | 0.40 ms |

The bare `or` walks the list from its first row, so a full scroll is quadratic in list length; the
`gte` turns the index condition into a range from the cursor. The `(list_id, created_at)` index is
enough: a `(…, id)` index only removes a 27 kB incremental sort, and partial per-stream indexes save
three buffers — the signal for those is a list whose bin dwarfs its live rows *and* is paged often.
The step-11 log has the full table.
`fetchItem(id)` by primary key serves the blocked-write path
([writes-can-land-on-a-tombstone](writes-can-land-on-a-tombstone.md)).

**`fetchLists` is paged the same way since task 23**, keyset on the membership's `(created_at,
list_id)` — when you joined — with the same redundant `gte`, one stream per request (live or bin,
through the embed's `deleted_at`). It carries no items. **Its plan is not an ordered index walk that
stops at 100:** `auth.uid()` is an InitPlan the planner cannot see through, so it assumes the average
~20 memberships per account and picks a Bitmap Index Scan on `(user_id, created_at)`, the nested loop
into `lists_pkey`, then a top-N sort. **So cost tracks your memberships after the cursor, for either
stream, and page 1 costs the whole account** — 1,649 buffers / ~2 ms at 402 memberships, 8,097 /
~7 ms at 2,000, about what the old single read cost. The `gte` lands in the index cond and is what
bounds a continuation (849 buffers against 1,649). No index was added; the signal for one is accounts
with thousands of memberships. The step-23 log has the full table.

**The realtime fan-out wants the *primary key* instead — know that before tidying either index.** Its
`select user_id from list_members where list_id = ?` is a prefix scan of the `(list_id, user_id)` PK
([realtime-is-a-nudge-to-a-per-user-inbox](realtime-is-a-nudge-to-a-per-user-inbox.md)), ≈0.08 ms
per member per change. Two readers, two access orders, both load-bearing.

**Rule 1 is also why your role costs nothing to read.** `role` rides on the membership row the read
roots at, so role-gated UI needs no extra round trip and works offline out of the cache. A screen
that wants "what may I do here" reads `list.role`; it does not ask the database again.

**If you re-measure, each of these traps has cost a cycle.** Watch `n_distinct` on
`list_members.user_id` and spread the seed over ~10,000 accounts by deterministic modulo — one
account holding 84% of rows made the planner seq-scan inside the RLS subplan, and `join lateral (… order by random() limit 1)` is *uncorrelated*, so it
runs once and hands one account every row. Seed under `set session_replication_role = replica`, or
the realtime fan-out trigger writes a `realtime.messages` row per insert — **but that mode also skips
FK cascades**, so delete a seed's `items` and `list_members` explicitly before its `lists`. PostgREST's
own SQL could not be captured on this stack (`postgres` cannot set `log_statement`, the db container's
`docker logs` showed nothing new, `PGRST_DB_PLAN_ENABLED` is unset), so measure hand-written SQL in its
shape: an `!inner` embed is an `INNER JOIN LATERAL` carrying the embed's filter. `analyze`, then
`explain (analyze, buffers)` in a role-switched psql session ([supabase-local-stack](supabase-local-stack.md)).
Drop a seed by marker (`name like 'seed-%'`) when the stack holds accounts you want to keep, with
`npx supabase db reset` otherwise.

**One caveat on the headline claim.** Size-independence is read off the plan — no node's row count
tracks the table — rather than measured; a 10M-row run was never done. Over HTTP the gap narrows to
~20 ms vs ~65 ms, because request overhead dominates once the query is a millisecond.

**What to do:** treat rules 1–3 as the contract. A new policy on list data is another uncorrelated
`in (select ... from public.my_memberships() ...)`; a new read of list data starts at `list_members`
unless you have measured otherwise — `fetchItems` is the worked example. Keep the `gte` in both
keyset reads. The `verify:` command asserts the list read still roots at `list_members` with an inner
embed and its `(created_at, list_id)` keyset, that both keyset reads keep the `gte`, that both indexes
the plans depend on still exist, and that `my_memberships()` is still `security invoker` with its
`search_path` clause intact.
