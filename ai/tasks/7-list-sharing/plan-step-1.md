# Task 7, step 1 — list sharing at the database level

## Context

[ai/tasks/7-list-sharing/description-step-1.md](ai/tasks/7-list-sharing/description-step-1.md) asks
for list sharing implemented **on the database level**, following
[ai/suggestions/list-sharing.md](ai/suggestions/list-sharing.md).

Today a list has one owner: `lists.owner_id`, three `auth.uid() = owner_id` policies, and items that
reach through to their list. Sharing needs three roles — `reader` (read), `writer` (reader + add
items + check them off), `owner` (writer + rename + manage access) — and it must stay fast with
**1,000,000 rows in `lists`**. That performance requirement, not the roles, is what shapes the
design: membership becomes the *only* access path (no `owner_id OR member` disjunction), every policy
predicate is an uncorrelated `IN (subquery)` costed by how many lists *you* are in, and the read is
re-rooted at `list_members` so the top-level scan is over your ~20 rows.

Confirmed with the user: all the SQL lands now (including the sharing entry points), plus the minimum
client plumbing the design depends on — the re-rooted read. **No sharing UI, no role guards in the
screens, no rename action.** Local stack only; the `npx supabase db push` to the cloud project is the
user's to run, matching the step-6 handoff.

## A correction to the suggestion, measured rather than assumed

The suggestion writes `my_memberships()` with `set search_path = ''`. **That single clause defeats
the whole design.** Postgres refuses to inline a SQL function carrying any `proconfig` setting, so
the policy predicate becomes an opaque `Function Scan` and `lists` is scanned in full — the exact
failure mode the suggestion set out to avoid. Measured on the local stack:

| `my_memberships()` | plan for `... from lists where id in (select list_id from my_memberships())` |
|---|---|
| with `set search_path = ''` | `Hash Join` ← **`Seq Scan on lists`** + `Function Scan` |
| without it | `Nested Loop` ← `HashAggregate on list_members` → **`Index Only Scan using lists_pkey`** |

The second row is verbatim the suggestion's own "Pass" criteria. So `my_memberships()` is created
**without** a `SET` clause. This is not a security relaxation: it is `security invoker`, so it runs
with the caller's rights either way, every name in its body is schema-qualified, and an inlined
predicate is exactly the predicate the existing policies already write out longhand. The `SET`
clause stays on every `security definer` function, where it is real hardening.

## The migration

One new file, `supabase/migrations/20260907000000_list_sharing.sql`. Existing migrations are never
edited — the cloud project has both applied. Written in this order, because the policies depend on
the function and the function depends on the table.

**1. Schema.**

- `create type public.list_role as enum ('reader', 'writer', 'owner')` — ordered by declaration, so
  `role >= 'writer'` means writer-or-owner and reads like the spec.
- `public.list_members (list_id, user_id, role, created_at)`, PK `(list_id, user_id)`, both FKs
  `on delete cascade`.
- `create index on public.list_members (user_id, created_at)` — **the** index. The PK does not serve
  a `user_id =` lookup, so this is not optional.
- `lists`: rename `owner_id` → `created_by` (the `default auth.uid()` moves with it), drop its
  `not null`, replace `lists_owner_id_fkey` (confirmed name, `confdeltype = 'c'`) with
  `lists_created_by_fkey ... on delete set null` — deleting an account must no longer delete lists
  other people are in. Backfill one `owner` membership per existing list carrying `lists.created_at`,
  so current users see their lists in unchanged order. Drop `lists_owner_id_created_at_idx`
  (confirmed name); nothing reads by owner any more.

**2. `my_memberships()`** — `language sql stable security invoker`, no arguments, returns a set,
`(select auth.uid())` so the uid is an InitPlan rather than a JWT parse per row. No `SET`, per above.

**3. `grant_creator_ownership()` + `on_list_created`** — `after insert on lists`, `security definer`,
mints the creator's `owner` row `on conflict do nothing`. Definer is unavoidable and narrow: at that
instant the creator is not yet a member, so the insert policy would refuse them. Guarded with
`if new.created_by is not null`. Doing this in a trigger rather than in the client is what keeps
`insertList` a plain idempotent insert, so a retried `list/created` still returns `23505` and is
classified `applied` by [listsApi](src/lib/listsApi.ts).

**4. Policies.** RLS on `list_members`; the old six on `lists`/`items` dropped and replaced.

- `list_members` select — `user_id = (select auth.uid())`. References no table, so nothing recurses
  and `lists`/`items` may read it freely; it is also an index qual on the new index.
- `list_members` insert/update/delete — `list_id in (select list_id from public.my_memberships() where role = 'owner')`.
- `lists` — select: member; insert: `created_by = (select auth.uid())`; update: owner.
- `items` — select: member; insert and update: `role >= 'writer'`.
- The `items` update policy stays unreachable-but-stated, for the reason
  [list-data-scoped-by-rls](ai/kb/entries/list-data-scoped-by-rls.md) already gives.

**5. Grants.** `revoke update on public.lists from anon, authenticated` then
`grant update (name) on public.lists to authenticated`, so "owners rename lists" means *rename* and
not "rewrite `created_by`". Per
[supabase-default-grants-defeat-revokes](ai/kb/entries/supabase-default-grants-defeat-revokes.md)
this is the shape that works — dropping the table grant and re-granting one column — as against
carving a column out of a table grant, which is silently ignored. `revoke update on public.items`
stays as is.

**6. `set_item_done()` rewritten.** Predicate becomes the `role >= 'writer'` membership test, and —
the point of the rewrite — it now `raise`s `42501` when it updates zero rows. Today a refusal and a
success are indistinguishable, so a reader's queued toggle would be reported `ok`, dropped from the
outbox, and left on screen as a change that never happened. `42501` reaches PostgREST as 403, which
`verdictFor` already classifies `permanent`. Nothing deletes items, so zero rows is unambiguously a
refusal.

**7. Sharing entry points.**

- `create unique index on public.users (lower(email))` — makes the lookup a single probe.
- `share_list(p_list_id, p_email, p_role)`, `security definer`: owner check (`42501`), resolve the
  address server-side, `P0002` for an unknown address, `22023` for yourself, then upsert the
  membership. Definer so `public.users` needs no wider policy — a general email→id lookup would be
  an account-enumeration endpoint.
- `list_members_of(p_list_id)` → `(user_id, email, role)` for any list the caller is a member of.
- `keep_last_owner()` — `before update or delete on list_members`, refuses to strand a list with no
  owner. **The suggestion does not address the cascade case and it has to be handled:** when an
  account is deleted, the FK cascade deletes that person's membership rows, and a naive guard would
  abort the account deletion. The RI action fires after the parent row is gone, so the guard skips
  itself when `not exists (select 1 from auth.users where id = old.user_id)`. This is verified by
  actually deleting a sole-owner account, not by believing the paragraph.
- Callable `security definer` functions get `revoke execute ... from public, anon` + an explicit
  `grant ... to authenticated`. `from public` alone leaves `anon` standing by name. **Exception:**
  `my_memberships()` keeps the default grants — it is invoker, returns only your own rows, and is
  called from inside the `lists` policy, so revoking `anon` would turn an anonymous read of
  `/rest/v1/lists` from an empty array into a function-permission error.

## Client changes — the re-rooted read, and nothing more

**[src/lib/listsApi.ts](src/lib/listsApi.ts)** — `fetchLists` reads from `list_members`, which is
rule 3 in one diff:

```ts
supabase
  .from('list_members')
  .select('role, lists!inner ( id, name, items ( id, title, done_at, created_at ) )')
  .order('created_at');
```

RLS supplies `user_id = (select auth.uid())`, an index qual on `(user_id, created_at)`, so the client
still filters nothing and [list-data-scoped-by-rls](ai/kb/entries/list-data-scoped-by-rls.md) holds
unchanged. Items are sorted in `toList` from the selected `created_at` rather than with a second
`referencedTable` order two embeds deep — sorting a handful of items in JS is not worth a round of
doubt about what PostgREST accepts. The list order becomes `list_members.created_at`; for a list you
created that is the same instant, and for a shared list "where you'd expect a new thing to appear"
beats "wherever the owner created it three years ago". `insertList`'s comment updates to name
`created_by`.

**[src/state/types.ts](src/state/types.ts)** — `List` gains `role: 'reader' | 'writer' | 'owner'`,
required rather than optional so every construction site has to say it.

**[src/state/listsReducer.ts](src/state/listsReducer.ts)** — `list/created` builds the list with
`role: 'owner'`, which is what the trigger will have written.

**[src/lib/listCache.ts](src/lib/listCache.ts)** — `VERSION` → `2`. `List` gained a field, and the
`v` check is what stops a stale blob rendering lists with `role: undefined`. **`outbox.ts`'s
`VERSION` is deliberately left at 1** — a mismatch there moves the blob aside as broken, throwing
away exactly the unsent writes it exists to protect, and a v1 blob holds only actions still valid.

Not touched: `ListsContext`, `outbox`, `replay`, the screens, the navigator.

## Tests

- New `src/lib/listsApi.test.ts`, mocking `./supabase` at the module seam
  ([supabase-client-module-boundary](ai/kb/entries/supabase-client-module-boundary.md)): the
  membership row shape maps to a `List` carrying its `role`, and items come back sorted by
  `created_at` — the ordering that just moved from PostgREST into JS is real new logic.
- Existing fixtures in `ListsContext.test.tsx`, `listsReducer.test.ts`, `replay.test.ts` gain
  `role` — required-field churn, a handful of lines.

## Verification

Local stack, in this order. `npm run web` in the browser is the path that has actually been driven
end to end ([supabase-local-stack](ai/kb/entries/supabase-local-stack.md)).

1. `npx supabase stop && npx supabase start && npx supabase db reset` — the containers do not pick up
   a new migration otherwise, and PostgREST needs the new table in its schema cache.
2. **Structure, via psql on 54322:** `pg_policies` shows the new set and none of the old; zero UPDATE
   rows in `information_schema.column_privileges` for `anon`/`authenticated` on `lists` except
   `name`; `pg_proc.proacl` shows `anon` off the definer functions. Read the ACL — do not trust the
   statement.
3. **Roles, with two accounts** created through the local admin API, then exercised in psql under
   `set local role authenticated; set local request.jwt.claims = '{"sub":"…","role":"authenticated"}'`
   — the faithful way to test RLS without a browser. Assert the full matrix: a reader can select but
   not insert items and gets `42501` from `set_item_done`; a writer can do both but cannot rename;
   an owner can rename and share; a non-member sees nothing at all. `share_list` raises on an unknown
   address, on yourself, and from a non-owner.
4. **The last-owner guard**, both halves: an owner demoting or removing themselves is refused, and
   deleting a sole-owner *account* still succeeds and leaves the list ownerless rather than aborting.
5. **`npm test` and `npm run typecheck`.**
6. **Browser, with Playwright:** sign in as A through Mailpit (http://127.0.0.1:54324), create a list
   with items, `share_list` it to B, then sign in as B in a separate context and confirm the list
   appears with its items. `psql` on the tables is the check on what actually landed.
7. **Performance, last, because it seeds 1M rows.** Seed 1M lists (the trigger mints the memberships)
   plus ~20 for the test user, `analyze`, then `explain (analyze, buffers)` under a role-switched
   session for: the re-rooted `fetchLists` query, `ListDetail`'s items query, and one
   `insert into items`. **Pass:** `Index Scan using list_members_user_id_created_at_idx`, no `Sort`,
   a nested loop into `lists_pkey`, single-digit milliseconds, unchanged if seeded to 10M. **Fail:**
   any `Seq Scan on lists`, any `Sort`, or a row count that tracks the table rather than the user.
   Then `npx supabase db reset` to drop the seed.
8. **`npm run kb:audit`** — expect **exactly one** failure: `list-data-scoped-by-rls`'s
   `! grep -rqi 'for delete'`, tripped by "owners remove members". Un-sharing is a delete on
   `list_members` and there is no way around it. Any *other* failure is a real regression.

## Afterwards

- Copy the approved plan to `ai/tasks/7-list-sharing/plan-step-1.md` (tasks 4 and 6 keep theirs).
- Write `ai/tasks/7-list-sharing/implementation-log-step-1.md` — decisions, the inlining measurement
  with both plans, the cascade case, and how each claim was verified.
- Run `/librarian deposit 7`. Four entries need rewriting and only the librarian may touch them:
  `list-data-scoped-by-rls` (must now distinguish "no delete policy on list data" from "no delete
  policy anywhere", and say why `is_list_member` was still not adopted), `scope-boundaries` (sharing
  in; deletion out by decision rather than by never being asked), `server-stamps-done-at`
  (`set_item_done` raises now, and its predicate is a role check), and
  `supabase-default-grants-defeat-revokes` (gains the `lists` case). The inlining finding is a new
  gotcha candidate.
- Tell the user the migration is committed but **not pushed** — `npx supabase db push` is theirs to
  run. Flag one thing to check before they do: `create unique index on public.users (lower(email))`
  fails if the cloud project holds two addresses differing only in case.
