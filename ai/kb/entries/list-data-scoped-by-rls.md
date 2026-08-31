---
id: list-data-scoped-by-rls
title: Row-level security scopes lists to their owner — the client never filters, and never sends owner_id
type: constraint
status: current
tags: [supabase, postgres, rls, security, persistence]
sources: [ai/tasks/3/implementation-log-step-1.md, supabase/migrations/20260831000000_lists.sql]
last_verified: 2026-08-31
verify: test "$(grep -c 'enable row level security' supabase/migrations/20260831000000_lists.sql)" = 2 && ! grep -rqi 'for delete' supabase/migrations && ! grep -rq "eq('owner_id'" src
related: [optimistic-list-writes, scope-boundaries, supabase-local-stack]
---

[supabase/migrations/20260831000000_lists.sql](../../../supabase/migrations/20260831000000_lists.sql)
creates `lists` and `items` with RLS on both. `lists` policies are plain `auth.uid() = owner_id`;
`items` policies reach through to their list. Three policies per table — select, insert, update.

**The client contributes nothing to this.** `fetchLists` selects with no user filter, because every
query already runs under the signed-in user's token and the policies decide what comes back. Adding
`.eq('owner_id', user.id)` in [src/lib/listsApi.ts](../../../src/lib/listsApi.ts) would be redundant
at best and, if it ever disagreed with the policy, a bug wearing the costume of a safeguard. Inserts
likewise omit `owner_id`: the column defaults to `auth.uid()`, and the `with check` means a forged
one is rejected rather than honoured. This was proven from the outside — a forged insert with the
anon key returns 401, "new row violates row-level security policy".

**No `is_list_member` helper, and no `security definer` function.** The proposal in
`ai/suggestions/supabase-persistence.md` carries one, and copying it here would be cargo cult: that
helper exists solely to break the policy recursion between `lists` and a `list_members` table, and
with no membership table nothing recurses. `lists` references no other table, so the `items`
subquery has no cycle to break. (The `users` migration from step 2 *does* have a `security definer`
trigger, for an unrelated reason — its presence is not a precedent for adding one here.)

**No delete policy on either table.** Deletion has never been in scope, and a policy for an action
nothing performs is a policy nobody has thought through. Its absence is deliberate, not an oversight.

**What to do:** when sharing arrives it will **replace** these owner-only policies rather than extend
them, and that is the moment `is_list_member` earns its place — see
[scope-boundaries](scope-boundaries.md) for what is still out. Until then, keep authorisation in the
migration and out of the app.

The `verify:` command asserts RLS is still enabled on both tables, that no delete policy has appeared
in any migration, and that no client code filters by `owner_id`. Note that the `for delete` half
greps prose as well as DDL, so writing that phrase in a SQL comment would trip it; phrase such a
comment as "deleting rows" instead. If a delete policy legitimately lands, this entry is what
changed.
