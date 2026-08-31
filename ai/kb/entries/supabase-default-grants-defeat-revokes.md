---
id: supabase-default-grants-defeat-revokes
title: Revoking a privilege under Supabase's default grants — column-level revokes do nothing, and `from public` leaves anon
type: gotcha
status: current
tags: [supabase, postgres, migrations, security, grants]
sources: [ai/tasks/3/implementation-log-step-1.md, supabase/migrations/20260831000000_lists.sql]
last_verified: 2026-08-31
verify: grep -rq 'revoke execute on function public.set_item_done(uuid, boolean) from public, anon;' supabase/migrations && ! grep -rqE 'revoke +(update|select|insert) *\(' supabase/migrations
related: [server-stamps-done-at, list-data-scoped-by-rls, supabase-local-stack]
---

Both of these `revoke` statements succeed, print no warning, and change nothing. Each cost a cycle
while writing [the lists migration](../../../supabase/migrations/20260831000000_lists.sql).

**A column-level revoke cannot subtract from a table-level grant.** `revoke update (done_at) on
public.items from authenticated` is a no-op, because Supabase grants `anon` and `authenticated`
UPDATE on the *table*, and Postgres will not carve a column out of that. The only way to take the
column away is to take the table away — `revoke update on public.items from anon, authenticated` —
which costs every other column on it. Weigh that before designing around a column-level revoke:
here it also removed direct `title` updates, which nothing used.

**`revoke execute ... from public` does not stop `anon`.** Postgres grants EXECUTE to PUBLIC on
every new function, so the instinct is to revoke from PUBLIC. But Supabase *also* runs `alter
default privileges ... grant execute on functions to anon, authenticated, service_role`, so a fresh
function arrives with `anon` on its ACL **by name**. Revoking the implicit grant leaves the explicit
one standing, and `anon` can still call it. It has to be `from public, anon`, followed by an explicit
grant to whoever should have it.

**Read the ACL; do not trust the statement.** After `npx supabase db reset`, check
`information_schema.column_privileges` (zero UPDATE rows for `anon`/`authenticated` on the table) and
`pg_proc.proacl` for the function. A REST probe with an `anon` key confirms it from the outside —
[supabase-local-stack](supabase-local-stack.md) has the addresses. This is the only way to tell a
revoke that worked from one that was accepted and ignored.

**Knock-on:** once a table's UPDATE grant is gone, a `security invoker` function cannot write it
either — it runs as the caller. Locking a column down therefore forces `security definer`, which
bypasses RLS, which means the policy's predicate has to be repeated inside the function body. That
chain is why [server-stamps-done-at](server-stamps-done-at.md) looks the way it does; expect to pay
it again the next time a column is taken away from clients.

The `verify:` command asserts this repo's migrations still obey both rules: the one `revoke execute`
still names `anon` alongside `public`, and no column-level revoke has been added anywhere.
