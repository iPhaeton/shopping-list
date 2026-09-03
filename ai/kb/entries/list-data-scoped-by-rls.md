---
id: list-data-scoped-by-rls
title: Row-level security scopes lists to their owner — the client never filters, and never sends owner_id
type: constraint
status: current
tags: [supabase, postgres, rls, security, persistence]
sources: [ai/tasks/3/implementation-log-step-1.md, supabase/migrations/20260831000000_lists.sql]
last_verified: 2026-09-02
verify: test "$(grep -c 'enable row level security' supabase/migrations/20260831000000_lists.sql)" = 2 && ! grep -rqi 'for delete' supabase/migrations && ! grep -rq "eq('owner_id'" src && grep -q 'create policy "update items of own lists"' supabase/migrations/20260831000000_lists.sql && grep -q 'security definer' supabase/migrations/20260831000000_lists.sql
related: [writes-retry-from-an-outbox, server-stamps-done-at, supabase-default-grants-defeat-revokes, scope-boundaries, supabase-local-stack]
---

[supabase/migrations/20260831000000_lists.sql](../../../supabase/migrations/20260831000000_lists.sql)
creates `lists` and `items` with RLS on both. `lists` policies are plain `auth.uid() = owner_id`;
`items` policies reach through to their list. Three policies per table — select, insert, update —
though the `items` update policy no longer decides anything on its own; see the grants below.

**The client contributes nothing to this.** `fetchLists` selects with no user filter, because every
query already runs under the signed-in user's token and the policies decide what comes back. Adding
`.eq('owner_id', user.id)` in [src/lib/listsApi.ts](../../../src/lib/listsApi.ts) would be redundant
at best and, if it ever disagreed with the policy, a bug wearing the costume of a safeguard. Inserts
likewise omit `owner_id`: the column defaults to `auth.uid()`, and the `with check` means a forged
one is rejected rather than honoured. This was proven from the outside — a forged insert with the
anon key returns 401, "new row violates row-level security policy".

**Policies are only half the authorisation, though.** Table grants are the other half, and on
`items` they were cut: `revoke update on public.items from anon, authenticated` leaves no client able
to update the table at all, so the `update items of own lists` policy above is currently
**unreachable**. It is kept on purpose — it states the rule any future column grant would land on —
and it is not dead code to tidy away. The one write that still happens goes through the
`security definer` function `set_item_done`, which bypasses RLS and therefore **repeats that policy's
ownership test in its body**; the two must be changed together. See
[server-stamps-done-at](server-stamps-done-at.md) for why the column moved to the server, and
[supabase-default-grants-defeat-revokes](supabase-default-grants-defeat-revokes.md) for why a
narrower revoke was not an option. Before assuming a client write is allowed, check the grants as
well as the policies.

**Still no `is_list_member` helper, and still no membership table.** The proposal in
`ai/suggestions/supabase-persistence.md` carries that helper, and copying it here would be cargo
cult: it exists solely to break the policy recursion between `lists` and a `list_members` table, and
with no membership table nothing recurses. `lists` references no other table, so the `items`
subquery has no cycle to break. (`set_item_done` and the step-2 `users` trigger are `security
definer` for their own unrelated reasons — neither is a precedent for a policy helper.)

**No delete policy on either table.** Deletion has never been in scope, and a policy for an action
nothing performs is a policy nobody has thought through. Its absence is deliberate, not an oversight.

**A policy refusal is now the only thing that throws a write away.** Since step 4 every failed write
is queued and retried forever; the outbox drops one only on a `permanent` verdict, which is the 403
these policies return ([writes-retry-from-an-outbox](writes-retry-from-an-outbox.md)). Tightening a
policy therefore does not merely block a write — it deletes it from the user's device, with one
error banner to show for it.

**What to do:** when sharing arrives it will **replace** these owner-only policies rather than extend
them, and that is the moment `is_list_member` earns its place — see
[scope-boundaries](scope-boundaries.md) for what is still out. Until then, keep authorisation in the
migration and out of the app.

The `verify:` command asserts RLS is still enabled on both tables, that no delete policy has appeared
in any migration, that no client code filters by `owner_id`, and — because "unreachable" reads as
"deletable" to anyone tidying up — that the `update items of own lists` policy and the
`security definer` function are both still there. Note that the `for delete` half greps prose as well
as DDL, so writing that phrase in a SQL comment would trip it; phrase such a comment as "deleting
rows" instead. If a delete policy legitimately lands, this entry is what changed.
