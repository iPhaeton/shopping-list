# Suggestion — share a list with other users at reader / writer / owner

**Status:** proposal, not an approved step. Sharing and deletion are both currently out of scope per
[scope-boundaries](../kb/entries/scope-boundaries.md); adopting this needs a new
`ai/tasks/<n>/description-step-<n>.md` first, and several KB entries rewritten afterwards by the
librarian (see "Knock-on to the knowledgebase" at the end).

**Date:** 2026-09-07

## What is being asked for

| role | may |
|---|---|
| `reader` | read the list and its items |
| `writer` | reader, plus add items and check/uncheck them |
| `owner` | writer, plus rename the list and manage who else has access |

**Deleting items is deliberately not part of this.** The brief for the `writer` role said "add and
delete items"; the answer when it was raised was *no item deletion so far*. Nothing in the app
deletes anything today, and there is no delete policy on `lists` or `items`
([scope-boundaries](../kb/entries/scope-boundaries.md)) — introducing the first one alongside
sharing would be two features in one step. It stays a one-line policy plus one `WriteAction` when it
is wanted; the two places that would have to change with it are marked below.

Plus a hard performance requirement: with **1,000,000 lists in the table**, "the lists I can see"
must still be fast. That requirement, not the roles, is what shapes the design below — the roles are
five policies, the performance is the whole architecture.

## The performance problem, stated precisely

Today `lists` has one owner and `fetchLists` issues `select ... from lists order by created_at`.
Row-level security appends `owner_id = auth.uid()`, and the index `lists (owner_id, created_at)`
turns that into an index scan over exactly your rows. Table size is irrelevant.

Add sharing naively and both properties are lost:

1. **The `owner_id OR member` shape.** If ownership stays on `lists.owner_id` *and* membership lives
   in a new table, every read policy becomes `owner_id = auth.uid() or exists (select 1 from
   list_members ...)`. An `OR` across two access paths is the classic way to lose an index: the
   planner can rarely satisfy both halves from one scan, so it falls back to scanning all 1M rows.
2. **The per-row `security definer` helper.** `ai/suggestions/supabase-persistence.md` proposes
   `is_list_member(list_id, user_id)` as a `security definer` function called from the policy, and
   [list-data-scoped-by-rls](../kb/entries/list-data-scoped-by-rls.md) says sharing is "the moment
   `is_list_member` earns its place". **Do not do this.** A `security definer` function is opaque to
   the planner and can never be inlined, so `using (is_list_member(lists.id, auth.uid()))` means one
   function call — one index lookup, one function-call frame, one RLS-bypass context switch — *per
   row of `lists`*. At 1M rows that is a multi-second query. It is correct and it is unusable.

Both are avoidable. The design below has **no `OR` in any policy and no `security definer` function
in any policy**, and its read path never scans `lists` at all.

## Three rules the design follows

1. **Membership is the only access path.** Every list gets exactly one `list_members` row per person
   who can see it, including its creator, whose row has `role = 'owner'`. `lists.owner_id` stops
   meaning anything — it becomes `created_by`, provenance only. One access path, one index, no `OR`.
2. **Every policy predicate is an *uncorrelated* `IN (subquery)`.** `id in (select list_id from
   my_memberships())` mentions no column of the outer row, so Postgres evaluates it **once per
   query**, hashes the result, and probes the hash per row. The cost of the predicate depends on how
   many lists *you* are in, never on how many lists *exist*.
3. **Reads are driven from `list_members`, not from `lists`.** The client asks "which memberships do
   I have, and what list hangs off each" rather than "which lists may I see". The top-level scan is
   then over your ~20 rows, and `lists`/`items` are reached by primary key. Rule 2 keeps the
   predicate cheap; rule 3 keeps the *scan* small. You need both.

## Schema

```sql
-- Ordered by declaration, so `role >= 'writer'` means writer-or-owner and reads like the spec.
create type public.list_role as enum ('reader', 'writer', 'owner');

create table public.list_members (
  list_id    uuid not null references public.lists on delete cascade,
  user_id    uuid not null references auth.users   on delete cascade,
  role       public.list_role not null,
  created_at timestamptz not null default now(),
  primary key (list_id, user_id)
);

-- THE index. It answers "my lists, in the order they entered my account" with no sort and no heap
-- access beyond the rows returned, and it is keyset-pageable if the app ever needs pages.
-- The primary key `(list_id, user_id)` does NOT serve a `user_id =` lookup, so this is not optional.
create index on public.list_members (user_id, created_at);
```

`list_members.created_at` — not `lists.created_at` — becomes the app's list order. For a list you
created the two are the same instant (the membership row is minted by the trigger below, in the same
statement), and for a list shared with you today, "where you'd expect a new thing to appear" is
better UX than "wherever the owner created it three years ago". It is also the only ordering the
index above can serve for free.

`lists` loses its authorization role:

```sql
alter table public.lists rename column owner_id to created_by;
alter table public.lists alter column created_by drop not null;

-- Was `on delete cascade`: deleting an account must no longer delete lists other people own.
alter table public.lists drop constraint lists_owner_id_fkey;
alter table public.lists add constraint lists_created_by_fkey
  foreign key (created_by) references auth.users on delete set null;

insert into public.list_members (list_id, user_id, role, created_at)
select id, created_by, 'owner', created_at from public.lists;

drop index public.lists_owner_id_created_at_idx;   -- confirm the generated name first
```

`items` is unchanged. Its `(list_id, created_at)` index is already the right one.

## Row-level security

The creator's own membership row is minted by a trigger rather than by the client, so the insert
stays a plain idempotent insert — which is what lets a retried `list/created` still return `23505`
and be classified `applied` by [`listsApi`](../../src/lib/listsApi.ts).

```sql
create function public.grant_creator_ownership()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.list_members (list_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict (list_id, user_id) do nothing;
  return new;
end;
$$;

create trigger on_list_created after insert on public.lists
  for each row execute function public.grant_creator_ownership();
```

`security definer` here is unavoidable and narrow: at the instant the trigger runs the creator is not
yet a member, so the `list_members` insert policy would refuse them.

One helper, so the predicate lives in one place. Note what it is **not**: it is `security invoker`,
it takes no arguments, and it returns a *set*. That is the whole difference from `is_list_member`.

```sql
create function public.my_memberships()
returns table (list_id uuid, role public.list_role)
language sql stable security invoker set search_path = ''
as $$
  select list_id, role from public.list_members where user_id = (select auth.uid())
$$;
```

`(select auth.uid())` rather than `auth.uid()` is the documented Supabase optimisation: the scalar
subquery becomes an InitPlan evaluated once instead of a JWT parse per row.

```sql
alter table public.list_members enable row level security;

-- You see your own membership rows and nobody else's. This is what breaks the recursion the old
-- proposal needed `is_list_member` for: the policy on `list_members` references no table at all, so
-- the policies on `lists` and `items` can read it freely without a cycle. It is also an index
-- qual on (user_id, created_at), so the read below plans itself.
create policy "read your own memberships" on public.list_members
  for select using (user_id = (select auth.uid()));

create policy "owners add members" on public.list_members
  for insert with check (list_id in (select list_id from public.my_memberships() where role = 'owner'));
create policy "owners change roles" on public.list_members
  for update using      (list_id in (select list_id from public.my_memberships() where role = 'owner'))
        with check      (list_id in (select list_id from public.my_memberships() where role = 'owner'));
create policy "owners remove members" on public.list_members
  for delete using      (list_id in (select list_id from public.my_memberships() where role = 'owner'));
```

`lists` — the three owner-only policies are replaced wholesale, as
[list-data-scoped-by-rls](../kb/entries/list-data-scoped-by-rls.md) predicted:

```sql
create policy "read lists you belong to" on public.lists
  for select using (id in (select list_id from public.my_memberships()));

create policy "create your own lists" on public.lists
  for insert with check (created_by = (select auth.uid()));

create policy "owners rename lists" on public.lists
  for update using (id in (select list_id from public.my_memberships() where role = 'owner'))
        with check (id in (select list_id from public.my_memberships() where role = 'owner'));

-- Rename means rename. `authenticated` holds UPDATE on every column of `lists` by default, so an
-- owner could otherwise rewrite `created_by` or `created_at`. A column-level revoke cannot subtract
-- from a table grant (see supabase-default-grants-defeat-revokes) — but dropping the table grant and
-- re-granting one column can, and unlike `items` this leaves the policy above reachable.
revoke update on public.lists from anon, authenticated;
grant  update (name) on public.lists to authenticated;
```

`items` — the same predicate, one rung further down. Still no delete policy, so `writer` differs from
`owner` only in what it may do to the list itself:

```sql
create policy "read items of lists you belong to" on public.items
  for select using (list_id in (select list_id from public.my_memberships()));

create policy "writers add items" on public.items
  for insert with check (list_id in (select list_id from public.my_memberships() where role >= 'writer'));

-- Still unreachable, still kept, for exactly the reason it was kept before: it states the rule any
-- future column grant would have to satisfy.
create policy "writers update items" on public.items
  for update using      (list_id in (select list_id from public.my_memberships() where role >= 'writer'))
        with check      (list_id in (select list_id from public.my_memberships() where role >= 'writer'));
```

`revoke update on public.items` stays, so `set_item_done` is still the only way to check an item off.
Its body repeats the policy predicate, and now the predicate has changed:

```sql
create or replace function public.set_item_done(p_item_id uuid, p_done boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare updated int;
begin
  update public.items set done_at = case when p_done then now() else null end
   where id = p_item_id
     and exists (select 1 from public.list_members m
                  where m.list_id = items.list_id
                    and m.user_id = (select auth.uid())
                    and m.role >= 'writer');
  get diagnostics updated = row_count;

  -- Zero rows can only mean refused: a reader tried to check something off, or their access was
  -- downgraded while the write sat in the outbox. Nothing deletes items or lists, so the row cannot
  -- simply be gone. 42501 reaches PostgREST as 403, which `verdictFor` already classifies
  -- `permanent` — the outbox drops the write, banners it, and re-fetches.
  --
  -- If item deletion ever lands, this branch stops being unambiguous and has to distinguish "gone"
  -- (drop the write quietly) from "refused" (drop it loudly). That is the first of the two places.
  if updated = 0 then
    raise exception using errcode = '42501', message = 'not allowed to change this item';
  end if;
end;
$$;
```

**That `raise` is the point of the rewrite, and it fixes a bug that is latent today.** The current
function reports nothing at all, so a refusal and a success are indistinguishable: a reader's queued
toggle would be reported `ok`, dropped from the outbox, and left on screen as a change that never
happened. Silent divergence is the one failure mode the offline design was built to avoid. This
cannot bite while everyone owns every list they can see — which is exactly why it is easy to miss on
the way in.

## Sharing, and finding the person to share with

`public.users` is readable only as your own row, and it should stay that way — a general email→id
lookup is an account-enumeration endpoint. Sharing goes through a `security definer` RPC instead,
which resolves the address server-side and never hands the caller a directory:

```sql
create unique index on public.users (lower(email));   -- makes the lookup a single probe

create function public.share_list(p_list_id uuid, p_email text, p_role public.list_role)
returns void language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  if not exists (select 1 from public.list_members
                  where list_id = p_list_id and user_id = (select auth.uid()) and role = 'owner')
  then raise exception using errcode = '42501', message = 'only an owner can share this list'; end if;

  select id into target from public.users where lower(email) = lower(trim(p_email));
  if target is null then
    raise exception using errcode = 'P0002', message = 'no account with that email yet';
  end if;
  if target = (select auth.uid()) then
    raise exception using errcode = '22023', message = 'you already have this list';
  end if;

  insert into public.list_members (list_id, user_id, role) values (p_list_id, target, p_role)
  on conflict (list_id, user_id) do update set role = excluded.role;
end;
$$;
```

A second RPC, `list_members_of(p_list_id uuid)`, returns `(user_id, email, role)` for any list the
caller is a member of — that is what the share sheet renders, and it is why `public.users` does not
need a wider policy.

Two guards worth building now rather than discovering later:

- **A list must keep at least one owner.** A `before update or delete on list_members` trigger that
  refuses when `old.role = 'owner'` and no other owner remains. Without it an owner can demote or
  remove themselves and strand the list: nobody can ever rename it or share it again, and there is no
  delete policy to clean it up.
- **`share_list` only works for addresses that already have an account.** Inviting a stranger needs a
  `list_invites (list_id, email, role)` table claimed by the `handle_new_user` trigger at sign-up.
  That is a genuine second feature; the error above is an honest v1.

## Client changes

**`src/state/types.ts`** — `List` gains `role: 'reader' | 'writer' | 'owner'`, and `WriteAction`
gains one member (the second place item deletion would touch is here, as `item/removed`):

```ts
| { type: 'list/renamed'; id: string; name: string }
```

**`src/lib/listsApi.ts`** — `fetchLists` is re-rooted, which is rule 3 in one diff:

```ts
supabase
  .from('list_members')
  .select('role, lists!inner ( id, name, items ( id, title, done_at, created_at ) )')
  .order('created_at');
```

RLS supplies `user_id = (select auth.uid())`, which is an index qual on `(user_id, created_at)`, so
the client still filters nothing — [list-data-scoped-by-rls](../kb/entries/list-data-scoped-by-rls.md)
holds unchanged. Sort items in `toList` from the selected `created_at` rather than reaching for a
second `referencedTable` ordering: whether PostgREST accepts an order spec two embeds deep is a
detail to verify, and sorting a handful of items in JS is not worth a round of doubt. Plus
`renameList`, `shareList`, `setMemberRole`, `removeMember`, `fetchMembers`.

**`src/lib/listCache.ts`** — bump `VERSION` to `2`. `List` gained a field, and the parser's `v` check
is what stops a stale blob rendering lists with `role: undefined` and a UI that guesses.

**`src/lib/outbox.ts`** — **do not** bump `VERSION` here. A version mismatch moves the blob aside as
broken, which throws away exactly the unsent writes this file exists to protect; and it is not
needed, because a v1 blob contains only actions that are still valid. What does change:
`enqueue` coalesces `list/renamed` per list id for the same reason it coalesces `item/setDone` (an
absolute value — only the newest one is worth sending), and `dropDependents` learns that a refused
`list/created` strands a queued `list/renamed` for the same list.

**`src/state/ListsContext.tsx`** — two additions:

- Refuse a write the role forbids before dispatching it. Not security (the database decides), but a
  reader whose optimistic item appears and then vanishes on the next fetch is a worse experience than
  a disabled button.
- **Re-fetch when the app comes to the front.** Today `refresh()` runs only on mount, which was fine
  when you were the only writer. With sharing, a list someone else changed an hour ago shows stale
  until a cold start — sharing that looks broken. The `AppState`/`online` listener that already
  triggers `flush` is the hook; realtime subscriptions remain out of scope.

**Screens** — `ListDetail` hides `AddBar` and renders non-interactive rows for a `reader`, and shows
rename + share only to an `owner`; `ListRow` marks lists that are shared with you. A new `Share`
screen takes navigation props like the others, and every control keeps its role/label/state props.

## Proving it, rather than believing it

The design is only as good as the plan Postgres actually picks, so measure before promoting this:

```sql
-- 1M lists, ~1.2M memberships, one test user in 20 of them.
insert into public.lists (id, created_by, name)
select gen_random_uuid(), '<some-uuid>', 'list ' || g from generate_series(1, 1000000) g;
analyze public.lists; analyze public.list_members; analyze public.items;

-- Run as the client does, not as postgres:
set local role authenticated;
set local request.jwt.claims = '{"sub":"<test-user-uuid>","role":"authenticated"}';
explain (analyze, buffers)
select role, list_id from public.list_members order by created_at;
```

**Pass:** an `Index Scan using list_members_user_id_created_at_idx`, no `Sort`, and a `Nested Loop`
into `lists_pkey` when the embed is included — a few dozen buffers, single-digit milliseconds,
unchanged if you seed 10M instead of 1M. **Fail:** any `Seq Scan on lists`, any `Sort`, or a row
count in the plan that tracks the table rather than the user. Re-run the same `explain` for
`ListDetail`'s items query and for one `insert into items`.

Two accounts are needed to test sharing at all, and they can only be had **on the local stack**:
production SMTP is still Resend's sandbox sender, which delivers only to the account owner's address
([scope-boundaries](../kb/entries/scope-boundaries.md), step 6 phase 1). Mailpit will hand you an OTP
for any address you invent, so sign in as A in one browser profile and B in another.

## Knock-on to the knowledgebase

Landing this **breaks `npm run kb:audit`**, by design rather than by accident:

- [list-data-scoped-by-rls](../kb/entries/list-data-scoped-by-rls.md) — its `verify:` command asserts
  `! grep -rqi 'for delete' supabase/migrations`, and **"owners remove members" trips it** even
  though no user-visible data gained a delete. Un-sharing is a `delete` on `list_members` and there
  is no way around that, so the entry has to distinguish "no delete policy on list data" from "no
  delete policy anywhere". Its "no membership table, no `is_list_member`" section also becomes
  wrong, and its replacement should say why the helper was still *not* adopted.
- [scope-boundaries](../kb/entries/scope-boundaries.md) — sharing moves in; deletion stays out, and
  is now out *by decision* rather than by never having been asked about.
- [supabase-default-grants-defeat-revokes](../kb/entries/supabase-default-grants-defeat-revokes.md) —
  gains the `lists` case: revoking a table grant and re-granting a single column is the move that
  works, as against carving a column out of a table grant, which is the move that silently does not.
- [server-stamps-done-at](../kb/entries/server-stamps-done-at.md) — `set_item_done` returns a boolean
  and raises 42501 now, and the predicate it duplicates is a role check rather than an ownership one.

Hand those to `/librarian deposit` after the step, not before.

## Staging

Each of these is verifiable on its own and leaves the app working:

1. **Membership without sharing.** The table, the trigger, the backfill, the rewritten policies, the
   re-rooted `fetchLists`, `role` on `List`. Nobody can share yet and every existing user still sees
   exactly their own lists. This is where the `explain` runs and where the performance question is
   settled — before any UI exists to make it hard to change.
2. **Roles enforced.** List rename, `set_item_done`'s new refusal, the client-side role guards and
   the read-only `ListDetail`.
3. **Sharing.** `share_list`, `list_members_of`, the last-owner trigger, the share screen, and
   re-fetch on foreground.
