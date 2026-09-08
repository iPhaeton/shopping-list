---
id: list-data-scoped-by-rls
title: Row-level security scopes list data to your membership row — the client never filters, and grants are still half the story
type: constraint
status: current
tags: [supabase, postgres, rls, security, persistence, sharing]
sources: [ai/tasks/3/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-2.md, supabase/migrations/20260831000000_lists.sql, supabase/migrations/20260907000000_list_sharing.sql]
last_verified: 2026-09-08
verify: test "$(grep -c 'enable row level security' supabase/migrations/20260831000000_lists.sql)" = 2 && grep -q 'alter table public.list_members enable row level security;' supabase/migrations/20260907000000_list_sharing.sql && ! grep -rEA1 'create policy .* on public\.(lists|items)' supabase/migrations | grep -qi 'for delete' && ! grep -rqE "\.eq\('(owner_id|created_by|user_id)'" src && grep -q 'create policy "writers update items"' supabase/migrations/20260907000000_list_sharing.sql && grep -q '^grant update (name) on public.lists to authenticated;' supabase/migrations/20260907000000_list_sharing.sql
related: [read-rooted-at-list-members, select-policy-gates-update-and-delete, refused-writes-return-zero-rows, writes-retry-from-an-outbox, server-stamps-done-at, supabase-default-grants-defeat-revokes, scope-boundaries, supabase-local-stack]
---

**Since step 7 the predicate is membership, not ownership, and this entry used to say the opposite** —
any advice you remember about `auth.uid() = owner_id` is out of date.
[The sharing migration](../../../supabase/migrations/20260907000000_list_sharing.sql) dropped all six
owner-only policies from step 3 and replaced them with ten across three tables: four on
`list_members`, three each on `lists` and `items`. `lists.owner_id` is now `created_by` — provenance,
read by nothing that decides anything.

| role | may |
|---|---|
| `reader` | read the list and its items |
| `writer` | reader, plus add items and check/uncheck them |
| `owner` | writer, plus rename the list and manage who else has access |

**The client contributes nothing to this, exactly as before.** `fetchLists` sends no user filter —
row-level security supplies `user_id = auth.uid()` on the membership row the read starts from — and
inserts still omit the owner column, which defaults to `auth.uid()` with a `with check` that rejects
a forged one rather than honouring it. Adding `.eq(...)` in
[src/lib/listsApi.ts](../../../src/lib/listsApi.ts) would be redundant at best and, if it ever
disagreed with the policy, a bug wearing the costume of a safeguard. It would also cost the plan —
see [read-rooted-at-list-members](read-rooted-at-list-members.md) for the shape the policies are
written in and why nothing may be added to them casually.

**Policies are only half the authorisation.** Table grants are the other half, and both tables are
cut:

- `items` — `revoke update on public.items from anon, authenticated` from step 3 still stands, so the
  `writers update items` policy is **unreachable**. It is kept on purpose: it states the rule any
  future column grant would land on, and it is the predicate the `set_item_done` function repeats.
  The two must change together ([server-stamps-done-at](server-stamps-done-at.md)).
- `lists` — new in step 7: the table grant is revoked and `update (name)` re-granted to
  `authenticated`, so "owners rename lists" means *rename* and not "rewrite `created_by`". Unlike
  `items`, the policy stays reachable, on one column — and since step 7's UI it is actually
  exercised: `updateListName` is the app's one direct `PATCH` of a table. Note what a *reader*'s
  rename does with that policy: it is filtered to zero rows, not refused, so the request has to ask
  for the row back to notice
  ([refused-writes-return-zero-rows](refused-writes-return-zero-rows.md)).

Before assuming a client write is allowed, read the grants as well as the policies
([supabase-default-grants-defeat-revokes](supabase-default-grants-defeat-revokes.md)).

**There is now one `for delete` policy in the schema, and it is not on list data.** `owners remove
members` deletes a **membership** row — un-sharing — and removes nobody's items. `lists` and `items`
still have no delete policy at all and nothing in the app deletes anything. The old blanket check
(`! grep -rqi 'for delete' supabase/migrations`) is what changed here, not the rule; the current one
asserts the narrower and truer thing.

**Deleting an *account* no longer deletes their lists.** `created_by` is `on delete set null`, so a
list other people are in survives its creator. Two consequences worth knowing before touching either:

- The `keep_last_owner` trigger (`before update or delete on list_members`, refusing to strand a list
  with no owner) **must exempt referential cascades**, or deleting an account aborts on a list that
  account solely owned. Both RI actions fire *after* the parent row is gone, so "the `auth.users` row
  no longer exists" is what tells a cascade from a member genuinely removing themselves. Any future
  guard trigger on a cascading FK needs the same escape hatch.
- A sole owner deleting their account therefore leaves an **ownerless list, invisible to everyone
  forever**, with no delete policy to clean it up. Deliberate: the alternative was cascading and
  destroying lists other people are in.

**`is_list_member` was still not adopted, and now for a stronger reason than "nothing recurses".**
The helper in `ai/suggestions/supabase-persistence.md` — and this entry's own former promise that
sharing was "the moment it earns its place" — is a `security definer` function called from a policy,
which means one opaque, non-inlinable call *per row of `lists`*. `my_memberships()` replaces it:
invoker, no arguments, set-returning, evaluated once.

**A policy refusal is the only thing that throws a write away, and refusals are now real.** Every
failed write is queued and retried forever; the outbox drops one only on a `permanent` verdict, which
is the 403 these policies return ([writes-retry-from-an-outbox](writes-retry-from-an-outbox.md)).
Until sharing, no user could provoke one; a `reader` provokes one by tapping Add. Tightening a policy
does not merely block a write — it deletes it from that device, with one error banner to show for it.

**What to do:** keep authorisation in the migration and out of the app, and add nothing to a policy
without reading the two entries linked above first. The `verify:` command asserts RLS on all three
tables, that no delete policy has appeared on `lists` or `items` (in either the two-line or one-line
form), that no client code filters by an ownership column, and that the `writers update items` policy
and the single-column `lists` grant — both of which read as tidy-able — are still there.
