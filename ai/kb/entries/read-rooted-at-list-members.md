---
id: read-rooted-at-list-members
title: The read starts at list_members, and every policy predicate is an uncorrelated subquery — that is what survives a million lists
type: decision
status: current
tags: [supabase, postgres, rls, performance, persistence]
sources: [ai/tasks/7-list-sharing/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-2.md, supabase/migrations/20260907000000_list_sharing.sql, src/lib/listsApi.ts]
last_verified: 2026-09-08
verify: grep -q "from('list_members')" src/lib/listsApi.ts && grep -q 'lists!inner' src/lib/listsApi.ts && grep -q 'create index on public.list_members (user_id, created_at);' supabase/migrations/20260907000000_list_sharing.sql && grep -A6 'create function public.my_memberships' supabase/migrations/20260907000000_list_sharing.sql | grep -q 'security invoker' && grep -A6 'create function public.my_memberships' supabase/migrations/20260907000000_list_sharing.sql | grep -q "set search_path = ''"
related: [list-data-scoped-by-rls, select-policy-gates-update-and-delete, writes-retry-from-an-outbox, supabase-local-stack]
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
per row of `lists`. Adding an `or` to any policy, or an `.eq()` filter in the client, loses the index
qual. All three were considered and rejected with measurements, not taste.

**`set search_path = ''` on a SQL function blocks inlining — and here that costs nothing.** Postgres
will not inline a SQL function carrying any `proconfig` setting, which is true and was easy to
over-read. On a scratch two-table schema the clause flipped `where id in (select list_id from
my_memberships())` from a nested loop into a hash join over a seq scan, which looked decisive enough
that the plan dropped it. At 1M rows with realistic statistics it makes **no difference at all**:
identical plans, identical buffer counts, sub-millisecond noise. The scratch measurement misled
because it wrote the `in (subquery)` *directly in the query*, where the planner may pull it up into a
semi-join; **an RLS policy qual is not that — it becomes a `SubPlan` either way and is never pulled
up.** So the clause stays, matching every other function in the schema, and the general lesson is the
one worth keeping: a plan measured on a scratch table with a different query shape is not evidence
about a policy.

**If you re-measure, two seeding traps cost a cycle each.** Watch `n_distinct` on
`list_members.user_id`: the first seed gave one account 84% of the rows, and the planner sensibly
seq-scanned inside the RLS subplan — the numbers above needed the memberships spread over 10,000
accounts. And `join lateral (… order by random() limit 1)` is *uncorrelated*, so Postgres evaluates
it once and hands one account every row; deterministic modulo assignment is what actually
distributes them. `analyze` afterwards, then `explain (analyze, buffers)` inside a role-switched psql
session ([supabase-local-stack](supabase-local-stack.md)), then `npx supabase db reset` to drop the
seed.

**One caveat on the headline claim.** Size-independence is read off the plan — no node's row count
tracks the table — rather than measured; a 10M-row run was never done. End to end over HTTP the gap
narrows to ~20 ms vs ~65 ms, because request overhead dominates once the query is a millisecond.

**Rule 1 is also why your role costs nothing to read.** `fetchLists` already selects `role` off the
membership row it roots at, so step 7's role-gated UI needed no extra round trip, no extra state, and
works offline out of the cache. A new screen that wants "what may I do here" reads `list.role`; it
does not ask the database again.

**What to do:** treat rules 1–3 as the contract. A new policy on list data is another uncorrelated
`in (select ... from public.my_memberships() ...)`; a new read of list data starts at `list_members`
unless you have measured otherwise. The `verify:` command asserts the client still roots there with
an inner embed, that the index the plan depends on still exists, and that `my_memberships()` is still
`security invoker` with its `search_path` clause intact.
