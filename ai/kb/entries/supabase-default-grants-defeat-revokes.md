---
id: supabase-default-grants-defeat-revokes
title: Revoking a privilege under Supabase's default grants — column-level revokes do nothing, and `from public` leaves anon
type: gotcha
status: current
tags: [supabase, postgres, migrations, security, grants]
sources: [ai/tasks/3/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-1.md, supabase/migrations/20260831000000_lists.sql, supabase/migrations/20260907000000_list_sharing.sql]
last_verified: 2026-09-07
verify: ! grep -rn 'revoke execute' supabase/migrations | grep -qv 'from public, anon;' && ! grep -rqE 'revoke +(update|select|insert) *\(' supabase/migrations && grep -q '^revoke update on public.lists from anon, authenticated;' supabase/migrations/20260907000000_list_sharing.sql && grep -q '^grant update (name) on public.lists to authenticated;' supabase/migrations/20260907000000_list_sharing.sql
related: [server-stamps-done-at, list-data-scoped-by-rls, select-policy-gates-update-and-delete, supabase-local-stack]
---

Both of these `revoke` statements succeed, print no warning, and change nothing. Each cost a cycle
while writing [the lists migration](../../../supabase/migrations/20260831000000_lists.sql).

**A column-level revoke cannot subtract from a table-level grant.** `revoke update (done_at) on
public.items from authenticated` is a no-op, because Supabase grants `anon` and `authenticated`
UPDATE on the *table*, and Postgres will not carve a column out of that. The only way to take the
column away is to take the table away — `revoke update on public.items from anon, authenticated` —
which costs every other column on it. Weigh that before designing around a column-level revoke:
here it also removed direct `title` updates, which nothing used.

**The move that *does* work is drop-the-table-grant-then-re-grant-one-column**, and step 7 used it on
`lists`: `revoke update on public.lists from anon, authenticated` followed by `grant update (name) on
public.lists to authenticated`, so an owner's rename cannot also rewrite `created_by` or
`created_at`. Note the asymmetry with `items`, which is the whole practical difference: `lists` keeps
a reachable UPDATE policy on one column, while `items` has no client-writable column left at all and
therefore needs an RPC for every write ([server-stamps-done-at](server-stamps-done-at.md)). Reach for
this shape whenever a table needs "clients may change exactly this field".

**`revoke execute ... from public` does not stop `anon`.** Postgres grants EXECUTE to PUBLIC on
every new function, so the instinct is to revoke from PUBLIC. But Supabase *also* runs `alter
default privileges ... grant execute on functions to anon, authenticated, service_role`, so a fresh
function arrives with `anon` on its ACL **by name**. Revoking the implicit grant leaves the explicit
one standing, and `anon` can still call it. It has to be `from public, anon`, followed by an explicit
grant to whoever should have it.

**But do not revoke a function a *policy* calls.** `my_memberships()` deliberately keeps the default
grants: it is `security invoker`, returns only the caller's own rows, and is evaluated inside the
`lists` and `items` select policies. Revoke `anon` and an anonymous `GET /rest/v1/lists` stops
returning `[]` and starts returning a permission error naming a function the caller never mentioned —
a worse leak of the schema than the grant it removed. Locking down a callable RPC and locking down a
policy helper are different jobs; only the first is in the list above.

**Read the ACL; do not trust the statement.** After `npx supabase db reset`, check
`information_schema.column_privileges` (after step 7, exactly one UPDATE row for `authenticated` —
`lists.name` — and none at all on `items`) and
`pg_proc.proacl` for the function. A REST probe with an `anon` key confirms it from the outside —
[supabase-local-stack](supabase-local-stack.md) has the addresses. This is the only way to tell a
revoke that worked from one that was accepted and ignored.

**Knock-on:** once a table's UPDATE grant is gone, a `security invoker` function cannot write it
either — it runs as the caller. Locking a column down therefore forces `security definer`, which
bypasses RLS, which means the policy's predicate has to be repeated inside the function body. That
chain is why [server-stamps-done-at](server-stamps-done-at.md) looks the way it does; expect to pay
it again the next time a column is taken away from clients.

The `verify:` command asserts this repo's migrations still obey all of it: **every** `revoke execute`
names `anon` alongside `public` (a new function revoked `from public` alone fails it), no
column-level revoke has been added anywhere, and the `lists` pair — table revoke plus single-column
grant — is intact.
