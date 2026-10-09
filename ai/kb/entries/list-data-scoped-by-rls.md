---
id: list-data-scoped-by-rls
title: Row-level security scopes list data to your membership row — the client never filters, and grants are still half the story
type: constraint
status: current
tags: [supabase, postgres, rls, security, persistence, sharing, invitations]
sources: [ai/tasks/3/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-2.md, ai/tasks/8-realtime/implementation-log-step-1.md, ai/tasks/9-deletion/implementation-log-step-1.md, ai/tasks/10-rename-item/implementation-log-step-1.md, ai/tasks/18-share-by-name/implementation-log-step-1.md, ai/tasks/25-account-deletion/implementation-log-step-2.md, ai/tasks/25-account-deletion/implementation-log-step-2-locks.md, ai/tasks/28-invitations/implementation-log-step-1.md, 47965d5, supabase/migrations/20261005100000_list_owner_locks.sql, supabase/migrations/20260831000000_lists.sql, supabase/migrations/20260907000000_list_sharing.sql, supabase/migrations/20261008000000_invitations.sql]
last_verified: 2026-10-09
verify: test "$(grep -c 'enable row level security' supabase/migrations/20260831000000_lists.sql)" = 2 && grep -q 'alter table public.list_members enable row level security;' supabase/migrations/20260907000000_list_sharing.sql && ! grep -rEA1 'create policy .* on public\.(lists|items)' supabase/migrations | grep -qi 'for delete' && ! grep -rqE "\.eq\('(owner_id|created_by|user_id)'" src && grep -q 'create policy "writers update items"' supabase/migrations/20260907000000_list_sharing.sql && grep -q '^grant update (name) on public.lists to authenticated;' supabase/migrations/20260907000000_list_sharing.sql && test "$(cat supabase/migrations/2026091*.sql | grep -c 'create policy')" = 0 && test "$(grep -cE '^alter table public\.(list_invitations|notifications|user_blocks) enable row level security;' supabase/migrations/20261008000000_invitations.sql)" = 3 && grep -q '^revoke all on public.list_invitations, public.notifications, public.user_blocks from anon, authenticated;' supabase/migrations/20261008000000_invitations.sql && ! grep -rqE 'create policy .* on public\.(list_invitations|notifications|user_blocks)' supabase/migrations && ! grep -rqiE '^grant .* on (table )?public\.(list_invitations|notifications|user_blocks)' supabase/migrations
related: [read-rooted-at-list-members, select-policy-gates-update-and-delete, refused-writes-return-zero-rows, writes-retry-from-an-outbox, server-stamps-done-at, supabase-default-grants-defeat-revokes, realtime-is-a-nudge-to-a-per-user-inbox, deletion-is-a-tombstone, writes-can-land-on-a-tombstone, scope-boundaries, supabase-local-stack, session-still-valid-guards-writes, delete-account-locks-then-removes-sole-owned-lists, ownership-changes-lock-the-list-row-first]
---

**The predicate is membership, not ownership** — any advice you remember about
`auth.uid() = owner_id` is out of date. [The sharing migration](../../../supabase/migrations/20260907000000_list_sharing.sql)
holds ten policies across three tables: four on `list_members`, three each on `lists` and `items`.
`lists.owner_id` is now `created_by` — provenance, read by nothing that decides anything.

| role | may |
|---|---|
| `reader` | read the list and its items |
| `writer` | reader, plus add items, rename them and check/uncheck them |
| `owner` | writer, plus rename the list itself and manage who else has access |

**The client contributes nothing to this.** `fetchLists` sends no user filter — row-level security
supplies `user_id = auth.uid()` on the membership row the read starts from — and inserts omit the
owner column, which defaults to `auth.uid()` with a `with check` that rejects a forged one. Adding
`.eq(...)` in [src/lib/listsApi.ts](../../../src/lib/listsApi.ts) would be redundant at best and, if
it ever disagreed with the policy, a bug wearing the costume of a safeguard. It would also cost the
plan — see [read-rooted-at-list-members](read-rooted-at-list-members.md) for the shape the policies
are written in and why nothing may be added to them casually.

**Policies are only half the authorisation.** Table grants are the other half, and both tables are
cut:

- `items` — `revoke update on public.items from anon, authenticated` still stands, so the
  `writers update items` policy is **unreachable**. It is kept on purpose: it states the rule any
  future column grant would land on, and it is the predicate the `set_item_done` function repeats.
  The two must change together ([server-stamps-done-at](server-stamps-done-at.md)).
- `lists` — the table grant is revoked and `update (name)` re-granted to `authenticated`, so "owners
  rename lists" means *rename* and not "rewrite `created_by`". The policy stays reachable, on one
  column — but nothing takes it: renaming goes through the `rename_list` RPC, so `listsApi` sends no
  `.update()` or `.delete()` at all, and both the policy and the column grant are a rule the function
  repeats ([writes-can-land-on-a-tombstone](writes-can-land-on-a-tombstone.md)). Keep them.

Before assuming a client write is allowed, read the grants as well as the policies
([supabase-default-grants-defeat-revokes](supabase-default-grants-defeat-revokes.md)).

**Three tables are RPC-only: `list_invitations`, `notifications`, `user_blocks`**
([the invitations migration](../../../supabase/migrations/20261008000000_invitations.sql)). RLS on,
**no policy**, and `revoke all … from anon, authenticated` — read back, only `postgres` and
`service_role` hold anything. Every read and write of them needs a row the caller's own policies
would hide (the inviter's name, a list the invitee is not on yet), so each is a `security definer`
function that decides what the caller may see. The revoke is not decoration: with the default grants
and RLS alone, a client read would answer an empty set rather than a refusal. The consequence that
bites in testing: a subquery in a test call runs as `authenticated` and is refused with `42501
permission denied for table list_invitations` — read these tables as `postgres`, or through the RPCs.
Do not "fix" that with a policy or a grant.

**One more policy is not in `public` at all.** `receive your own inbox` is a `for select` policy on
**`realtime.messages`**, gating which broadcast topics an account may join
([realtime-is-a-nudge-to-a-per-user-inbox](realtime-is-a-nudge-to-a-per-user-inbox.md)). A policy
inventory that greps only `on public.` will miss the one that decides who hears about a change.

**There is one `for delete` policy in the schema, and it is not on list data.** `owners remove
members` deletes a **membership** row — un-sharing — and removes nobody's items. `lists` and `items`
have no delete policy at all.

**A delete stamps `deleted_at` and leaves the row** ([deletion-is-a-tombstone](deletion-is-a-tombstone.md)),
so the deletion migration creates no policy — the `verify:` asserts that literally. Members must be
able to *see* a tombstone to restore it, so the read policies are unchanged, and no policy deletes
from `lists` or `items`: the hard deletes are `purge_deleted`, which runs as `postgres` out of reach
of `anon` and `authenticated` alike, and the definer RPC `delete_account`. Six functions on list data
repeat a policy's predicate in their bodies (`set_item_done`, `set_item_deleted`, `set_list_deleted`,
`add_item`, `rename_list`, `rename_item`); every one of them must move when a policy does.

**Deleting an account deletes the lists it solely owns, and only those.** `created_by` is `on delete
set null`, so a list with another owner survives its creator; `delete_account` hard-deletes every
list the caller is the only owner of *before* deleting the user, so none is left ownerless
([delete-account-locks-then-removes-sole-owned-lists](delete-account-locks-then-removes-sole-owned-lists.md)).

**Owner changes lock the list row first.** Any function that writes `list_members` rows of an
existing list locks that list's `lists` row first (`for no key update`), and `keep_last_owner` locks
it again before counting owners — so two owner changes to one list run in turn and neither can
strand it ownerless. A new membership function must do the same
([ownership-changes-lock-the-list-row-first](ownership-changes-lock-the-list-row-first.md)).

- The `keep_last_owner` trigger (`before update or delete on list_members`, refusing to strand a list
  with no owner) **must exempt referential cascades**, or both of those deletes abort. Both RI actions
  fire *after* the parent row is gone, so "the list is already gone" and "the `auth.users` row is
  already gone" are what tell a cascade from a member genuinely removing themselves. Any future guard
  trigger on a cascading FK needs the same escape hatch.

**`is_list_member` is not adopted.** The helper in `ai/suggestions/supabase-persistence.md` is a
`security definer` function called from a policy, which means one opaque, non-inlinable call *per
row of `lists`*. `my_memberships()` replaces it: invoker, no arguments, set-returning, evaluated once.

**A policy refusal is the only thing that throws a write away.** Every failed write is queued and
retried forever; the outbox drops one only on a `permanent` verdict, which is the 403 these policies
return ([writes-retry-from-an-outbox](writes-retry-from-an-outbox.md)). A `reader` provokes one by
tapping Add. Tightening a policy does not merely block a write — it deletes it from that device, with
one error banner to show for it.

**There is a fourth gate, beside grants and policies rather than inside either.** Every write RPC
also raises `42501` when `public.session_still_valid()` is false — a device whose session was revoked
elsewhere, still holding an unexpired JWT. It appears in no policy and no grant, only as the first
statement each guarded write function repeats — the list lock, where there is one, comes right after
it (reads such as `search_users_by_name` and `my_list_counts()` do not carry it); the read side
(`list_members_of`, the SELECT policies) is deliberately untouched
([session-still-valid-guards-writes](session-still-valid-guards-writes.md)).

**What to do:** keep authorisation in the migration and out of the app, and add nothing to a policy
without reading the two entries linked above first. The `verify:` asserts RLS on the three list
tables, no delete policy on `lists` or `items`, no client filter by an ownership column, the
`writers update items` policy and the single-column `lists` grant — both of which read as tidy-able —
no policy in the migrations since realtime, and the three invitation tables RLS-on with no policy and
no grant.
