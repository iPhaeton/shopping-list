---
id: read-rooted-at-list-members
title: The read starts at list_members, and every policy predicate is an uncorrelated subquery — that is what survives a million lists
type: decision
status: current
tags: [supabase, postgres, rls, performance, persistence]
sources: [ai/tasks/7-list-sharing/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-2.md, ai/tasks/8-realtime/implementation-log-step-1.md, ai/tasks/9-deletion/implementation-log-step-1.md, ai/tasks/11-pagination/implementation-log-step-1.md, supabase/migrations/20260907000000_list_sharing.sql, src/lib/listsApi.ts]
last_verified: 2026-09-20
verify: grep -q "from('list_members')" src/lib/listsApi.ts && grep -q 'lists!inner' src/lib/listsApi.ts && grep -q 'create index on public.list_members (user_id, created_at);' supabase/migrations/20260907000000_list_sharing.sql && grep -A6 'create function public.my_memberships' supabase/migrations/20260907000000_list_sharing.sql | grep -q 'security invoker' && grep -A6 'create function public.my_memberships' supabase/migrations/20260907000000_list_sharing.sql | grep -q "set search_path = ''" && grep -q "from('items').select(ITEM_COLUMNS).eq('list_id', listId)" src/lib/listsApi.ts && grep -A3 "\.gte('created_at', after.createdAt)" src/lib/listsApi.ts | grep -Fq 'created_at.gt."${after.createdAt}",and(created_at.eq."${after.createdAt}",id.gt."${after.id}")' && grep -q "create index on public.items (list_id, created_at);" supabase/migrations/20260831000000_lists.sql
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
   `role, lists!inner ( ... )` from the membership table, so the top-level scan is over your ~20 rows
   and `lists` is reached by primary key. Rule 2 keeps the predicate cheap; rule 3 keeps the scan
   small. Neither substitutes for the other.

**What breaks it, in order of how tempting each is.** Re-rooting `fetchLists` at `lists` "because
that is the table we want" costs two orders of magnitude. Adding a `security definer` helper called
from a policy — `is_list_member(list_id, uid)`, which `ai/suggestions/supabase-persistence.md` still
proposes and which the old [list-data-scoped-by-rls](list-data-scoped-by-rls.md) promised sharing
would adopt — is worse: a definer function is opaque to the planner, never inlined, and called once
per row of `lists`. Adding an `or` to any policy, or an `.eq()` on an ownership column to the list
read, loses the index qual. All three were considered and rejected with measurements, not taste.

**`set search_path = ''` on a SQL function blocks inlining — and here that costs nothing.** Postgres
will not inline a SQL function carrying any `proconfig` setting, which is true and was easy to
over-read: on a scratch schema the clause flipped a `where id in (select … from my_memberships())`
into a hash join over a seq scan. At 1M rows with realistic statistics it makes **no difference at
all** — identical plans, identical buffers. The scratch run wrote the `in (subquery)` *directly in
the query*, where the planner may pull it up into a semi-join; **an RLS policy qual becomes a
`SubPlan` either way and is never pulled up.** So the clause stays, matching every other function in
the schema. The lesson worth keeping: a plan measured on a scratch table with a different query
shape is not evidence about a policy.

**If you re-measure, three seeding traps cost a cycle each.** Watch `n_distinct` on
`list_members.user_id`: the first seed gave one account 84% of the rows, and the planner sensibly
seq-scanned inside the RLS subplan — the numbers above needed the memberships spread over 10,000
accounts. `join lateral (… order by random() limit 1)` is *uncorrelated*, so Postgres evaluates
it once and hands one account every row; deterministic modulo assignment is what actually
distributes them. And since step 8 every insert and delete on list data fires the realtime fan-out
trigger — seed under `set session_replication_role = replica` (skips triggers and FK checks) or a
million rows write a million `realtime.messages`; a cascade delete without it fanned 10,020 out to
fake accounts. `analyze` afterwards, then `explain (analyze, buffers)` inside a role-switched psql
session ([supabase-local-stack](supabase-local-stack.md)). Drop the seed by marker (`name like
'seed-%'`, cascade) when the stack holds accounts you want to keep; `npx supabase db reset` otherwise.

**One caveat on the headline claim.** Size-independence is read off the plan — no node's row count
tracks the table — rather than measured; a 10M-row run was never done. End to end over HTTP the gap
narrows to ~20 ms vs ~65 ms, because request overhead dominates once the query is a millisecond.

**Step 8 added the one read that wants the *primary key* instead, and it is worth knowing before
anyone tidies either index.** The realtime fan-out trigger does `select user_id from list_members
where list_id = ?` — a prefix scan of the `(list_id, user_id)` PK, not of the `(user_id, created_at)`
index this entry is built around
([realtime-is-a-nudge-to-a-per-user-inbox](realtime-is-a-nudge-to-a-per-user-inbox.md)). Two readers,
two access orders, both load-bearing; measured at ≈0.08 ms per member per change.

**Steps 9 and 11 left all three rules alone and changed what the read *carries*.** Deleted rows are
tombstones that stay in the table ([deletion-is-a-tombstone](deletion-is-a-tombstone.md)), and since
step 11 each list's items arrive as **two aliased embeds, `live` and `bin`, a first page of `PAGE_SIZE`
rows each** — filtered on `deleted_at`, ordered `(created_at, id)` and limited *two embeds deep*
(`lists.live.order=…`), which PostgREST accepts. Nothing about the *plan* moves — the scan is still over
your ~20 membership rows — and the rows per list are now bounded at 2 × `PAGE_SIZE` per fetch rather
than by everything anyone ever deleted. The purge bounds the *table*; paging bounds the *fetch*.

**Step 11 added the second read of list data, and it is rooted at `items` on purpose — measured, not
assumed.** `fetchItems(listId, stream, after)` is the keyset continuation of one stream: `.eq('list_id')`
picks the list (RLS still decides visibility; this is not the client filtering for authorisation),
the `or` is the `(created_at, id)` keyset, and **a redundant `created_at >= cursor` sits beside the
`or` — that clause, not an index, is what makes paging cheap.** At 1M items as `authenticated`, page
of 400, cursor mid-stream:

| shape | index cond | buffers | time |
|---|---|---|---|
| `or` only | `list_id` | 121 | 3.2 ms |
| `or` + `>=` | `list_id, created_at >=` | 23 | 0.40 ms |

The bare `or` walks the list from its first row and filters, so cost tracks the cursor's *position*
and a full scroll is quadratic in list length; the `gte` turns the index condition into a range from
the cursor, so cost tracks the page. The `(list_id, created_at)` index from step 3 is enough: a
three-column `(…, id)` index only removes a 27 kB incremental sort, and partial per-stream indexes save
three buffers. Neither earned a migration; the signal for the partials is a list whose bin dwarfs its
live rows *and* is paged often. `fetchItem(id)` by primary key is the third read, for the
blocked-write path ([writes-can-land-on-a-tombstone](writes-can-land-on-a-tombstone.md)). The full
plan table is in the step-11 log. Do not "simplify" the `gte` away, and do not re-root this read at
`list_members` for consistency — the rule is measure, and this one was.

**Rule 1 is also why your role costs nothing to read.** `fetchLists` already selects `role` off the
membership row it roots at, so step 7's role-gated UI needed no extra round trip, no extra state, and
works offline out of the cache. A new screen that wants "what may I do here" reads `list.role`; it
does not ask the database again.

**What to do:** treat rules 1–3 as the contract. A new policy on list data is another uncorrelated
`in (select ... from public.my_memberships() ...)`; a new read of list data starts at `list_members`
unless you have measured otherwise — `fetchItems` is the worked example of having measured. The
`verify:` command asserts the list read still roots there with an inner embed, that the items read
still carries `.eq('list_id')` and the `gte` beside its keyset `or`, that both indexes the plans
depend on still exist, and that `my_memberships()` is still `security invoker` with its
`search_path` clause intact.
