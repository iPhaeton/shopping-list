---
id: list-data-scoped-by-rls
title: Row-level security scopes list data to your membership row — the client never filters, and grants are still half the story
type: constraint
status: current
tags: [supabase, postgres, rls, security, persistence, sharing]
sources: [ai/tasks/3/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-2.md, ai/tasks/8-realtime/implementation-log-step-1.md, ai/tasks/9-deletion/implementation-log-step-1.md, supabase/migrations/20260831000000_lists.sql, supabase/migrations/20260907000000_list_sharing.sql]
last_verified: 2026-09-10
verify: test "$(grep -c 'enable row level security' supabase/migrations/20260831000000_lists.sql)" = 2 && grep -q 'alter table public.list_members enable row level security;' supabase/migrations/20260907000000_list_sharing.sql && ! grep -rEA1 'create policy .* on public\.(lists|items)' supabase/migrations | grep -qi 'for delete' && ! grep -rqE "\.eq\('(owner_id|created_by|user_id)'" src && grep -q 'create policy "writers update items"' supabase/migrations/20260907000000_list_sharing.sql && grep -q '^grant update (name) on public.lists to authenticated;' supabase/migrations/20260907000000_list_sharing.sql && test "$(grep -c 'create policy' supabase/migrations/20260910000000_deletion.sql)" = 0
related: [read-rooted-at-list-members, select-policy-gates-update-and-delete, refused-writes-return-zero-rows, writes-retry-from-an-outbox, server-stamps-done-at, supabase-default-grants-defeat-revokes, realtime-is-a-nudge-to-a-per-user-inbox, deletion-is-a-tombstone, writes-can-land-on-a-tombstone, scope-boundaries, supabase-local-stack]
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
  `items`, the policy stays reachable, on one column. **Step 9 stopped exercising it, and this entry
  used to call `updateListName` the app's one direct `PATCH` of a table.** Renaming goes through the
  `rename_list` RPC now, so `listsApi` sends no `.update()` or `.delete()` at all and both the policy
  and the column grant are, like `writers update items`, a rule the function repeats rather than a
  path anything takes ([writes-can-land-on-a-tombstone](writes-can-land-on-a-tombstone.md)). Keep
  them: they are what a future column grant would land on, and what the RPC must stay in step with.

Before assuming a client write is allowed, read the grants as well as the policies
([supabase-default-grants-defeat-revokes](supabase-default-grants-defeat-revokes.md)).

**Step 8 added an eleventh policy, and it is not in `public` at all.** `receive your own inbox` is a
`for select` policy on **`realtime.messages`**, gating which broadcast topics an account may join
([realtime-is-a-nudge-to-a-per-user-inbox](realtime-is-a-nudge-to-a-per-user-inbox.md)). It touches
no table of this schema and changes nothing in the matrix above — but "all the policies" is now two
schemas' worth, so a policy inventory that greps only `on public.` will miss the one that decides who
hears about a change.

**There is now one `for delete` policy in the schema, and it is not on list data.** `owners remove
members` deletes a **membership** row — un-sharing — and removes nobody's items. `lists` and `items`
still have no delete policy at all. The old blanket check
(`! grep -rqi 'for delete' supabase/migrations`) is what changed here, not the rule; the current one
asserts the narrower and truer thing.

**Deletion arrived in step 9 and this entry used to say nothing in the app deletes anything — that
half is now false and the rest is untouched, which is the fact worth recording.** A delete stamps
`deleted_at` and leaves the row ([deletion-is-a-tombstone](deletion-is-a-tombstone.md)), so **the
deletion migration creates no policy at all** — the `verify:` command asserts that literally. Members
must be able to *see* a tombstone to restore it, so the read policies are exactly as step 7 wrote
them, and the one hard delete in the schema is `purge_deleted`, which runs as `postgres` and is out of
reach of `anon` and `authenticated` alike. Two writes moved *off* direct table access in the same step
(`add_item`, `rename_list`) for reasons that have nothing to do with authorisation, so the matrix
above is unchanged — but where `set_item_done` was once the only function on list data repeating a
policy's predicate in its body, there are now five (`set_item_done`, `set_item_deleted`,
`set_list_deleted`, `add_item`, `rename_list`). Every one of them must move when a policy does.

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
form), that no client code filters by an ownership column, that the `writers update items` policy and
the single-column `lists` grant — both of which read as tidy-able — are still there, and that the
deletion migration still creates no policy of its own.
