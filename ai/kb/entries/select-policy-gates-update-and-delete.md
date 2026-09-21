---
id: select-policy-gates-update-and-delete
title: A SELECT policy also gates the rows UPDATE and DELETE may touch, so self-only visibility makes an owner policy unreachable
type: gotcha
status: current
tags: [supabase, postgres, rls, security]
sources: [ai/tasks/7-list-sharing/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-2.md, supabase/migrations/20260907000000_list_sharing.sql]
last_verified: 2026-09-08
verify: grep -A1 'create policy "read your own memberships" on public.list_members' supabase/migrations/20260907000000_list_sharing.sql | grep -q 'for select using (user_id = (select auth.uid()));' && grep -A3 'create function public.set_member_role' supabase/migrations/20260907000000_list_sharing.sql | grep -q 'security definer' && grep -A3 'create function public.remove_member' supabase/migrations/20260907000000_list_sharing.sql | grep -q 'security definer'
related: [list-data-scoped-by-rls, read-rooted-at-list-members, supabase-default-grants-defeat-revokes, refused-writes-return-zero-rows]
indexed: false
---

For `UPDATE` and `DELETE` Postgres must first **read** the row the `WHERE` clause names, so the
table's **SELECT policies apply to it** on top of the command's own `USING` clause. A policy that
grants an action on rows you cannot see grants nothing.

That is exactly the shape
[the sharing migration](../../../supabase/migrations/20260907000000_list_sharing.sql) has on
`list_members`: the select policy is `user_id = (select auth.uid())` — you see nobody but yourself —
while `owners change roles` and `owners remove members` are scoped to lists you own. An owner's
`delete from list_members where list_id = … and user_id = <someone else>` therefore reports
**`DELETE 0`**. No error, no permission message, nothing in the log: the correct-looking statement
matches zero rows. Proven rather than reasoned — the same delete reports `DELETE 1` the instant that
select policy is temporarily altered to `using (true)`.

**Broadening the select policy is not available here**, which is why this is a design constraint and
not a bug to fix. "Rows of lists I own" would read `list_members` from inside a policy *on*
`list_members` (infinite recursion), and an `or` beside `user_id = auth.uid()` would cost the index
qual the whole read path is built on
([read-rooted-at-list-members](read-rooted-at-list-members.md)).

**So managing *other* people goes through `security definer` RPCs** — `set_member_role(list, user,
role)` and `remove_member(list, user)`, alongside `share_list` — each repeating in its body the owner
check its matching policy states, each raising `42501` when the caller is not an owner and `P0002`
when the person named is not there. The two
policies are kept anyway: what they *do* reach is real (an owner demoting or removing **themselves**,
which is what the `keep_last_owner` trigger exists to police), and they are the rule the RPCs must
stay in step with. Do not delete them as dead weight, and do not add a third way in.

**Over HTTP the same silence is worse, because it reaches the app.** A client `DELETE` filtered to
zero rows comes back `204` with no error and is read as success — measured for a non-owner trying to
remove their own membership, which is why there is no "Leave this list" button. See
[refused-writes-return-zero-rows](refused-writes-return-zero-rows.md) for what a client must do about
it.

**What to do:** when a role must act on rows it cannot see, reach for a definer function, not a
policy. And when testing a policy, assert the **row count**, not the absence of an error — `DELETE 0`
and `UPDATE 0` are how RLS says no to a write whose target it hid from you. The `verify:` command
asserts the trio this rests on: the membership select policy is still self-only, and both member
management RPCs are still `security definer`.
