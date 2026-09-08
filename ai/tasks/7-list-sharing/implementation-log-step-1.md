# Implementation log — step 1: list sharing at the database level

**Date:** 2026-09-07. Description: [description-step-1.md](description-step-1.md). Plan:
[plan-step-1.md](plan-step-1.md). Source proposal:
[ai/suggestions/list-sharing.md](../../suggestions/list-sharing.md).

A list can now be shared with other people at `reader` / `writer` / `owner`, enforced entirely by
row-level security and a handful of functions. **No sharing UI was built** — that was the agreed cut
of "on the database level" — but sharing is fully working from the database's side, and the app's
read path was re-rooted so it stays fast. Confirmed end to end in the browser: two accounts, one
list, the second account seeing it and being correctly refused when it tried to write.

Scope was settled with the user before any code: all the SQL (including the sharing entry points),
plus the minimum client plumbing the design depends on; local stack only, with `npx supabase db push`
left to the user.

## What was built

| File | |
|---|---|
| `supabase/migrations/20260907000000_list_sharing.sql` | new — the whole feature |
| `src/lib/listsApi.ts` | `fetchLists` re-rooted at `list_members`; items sorted in `toList` |
| `src/state/types.ts` | new `Role`; `List` gains a required `role` |
| `src/state/listsReducer.ts` | `list/created` builds the list with `role: 'owner'` |
| `src/lib/listCache.ts` | `VERSION` 1 → 2 (`outbox.ts` deliberately left at 1) |
| `src/lib/listsApi.test.ts` | new — the re-rooted query shape and the item ordering |

Untouched, on purpose: `ListsContext`, `outbox`, `replay`, every screen, the navigator.

## The design, and the one line of it that is load-bearing

Membership is the **only** access path: `lists.owner_id` became `created_by` (provenance only, now
`on delete set null`), and every list gets one `list_members` row per person who can see it,
including its creator, minted by an `after insert` trigger. That keeps `insertList` a plain
idempotent insert, so a retried `list/created` still returns `23505` and is classified `applied`.

The performance requirement — 1,000,000 lists — is what dictates the shape, and it comes down to
**where the read starts**, not to the policies. Measured at 1M lists / 1.2M memberships / 1M items,
as `authenticated` with a real JWT claim:

| the same answer, two rootings | plan | buffers | time |
|---|---|---|---|
| `from list_members` + embed (shipped) | `Index Scan` on `list_members_user_id_created_at_idx` → nested loop → `lists_pkey` | 183 | **1.9 ms** |
| `from lists order by created_at` (what it did before) | `Seq Scan on lists`, 999,981 rows removed, then `Sort` | 10,318 | **254 ms** |

End to end over HTTP the gap narrows to ~20 ms vs ~65 ms, because HTTP and JWT verification dominate
once the query itself is a millisecond. `pg_stat_statements` puts the real PostgREST query at
**0.63 ms mean**. The plan contains no node whose row count tracks the table, which is the property
that makes it independent of table size — a 10M-row run was not performed, so treat size-independence
as read off the plan rather than measured.

## Four things that were wrong, or that the proposal got wrong

### 1. `set search_path = ''` on `my_memberships()` — a real effect, and a wrong conclusion

Postgres refuses to inline a SQL function carrying any `proconfig` setting. On a scratch two-table
schema this flipped `where id in (select list_id from my_memberships())` from a nested loop into
`lists_pkey` to a `Hash Join` over a `Seq Scan` — which looked decisive, and the clause was dropped.

**At 1M rows with realistic statistics it makes no difference at all**, and the migration now carries
the clause again:

| | rooted at `list_members` | bare read of `lists` |
|---|---|---|
| without `set search_path` | 0.999 ms, 94 buffers | 254 ms, 10,318 buffers |
| with `set search_path` | 0.483 ms, 94 buffers | 56 ms, 10,318 buffers |

Identical plans, identical buffer counts; the sub-millisecond differences are noise. The scratch
measurement misled because it wrote the `in (subquery)` **directly in the query**, where the planner
may pull it up into a semi-join. An RLS *policy* qual is not that: it becomes a `SubPlan` either way
and is never pulled up. So inlining buys nothing here, and the clause stays for consistency with
every other function in the schema. The lesson worth keeping: a plan measured on a scratch table with
a different query shape is not evidence about a policy.

### 2. The proposal's "owners remove members" policy cannot remove members

This is a genuine hole in `ai/suggestions/list-sharing.md`, not a transcription slip. For `UPDATE` and
`DELETE` Postgres must first *read* the target row, so **SELECT policies apply to it** in addition to
the command's own `USING` clause. The select policy on `list_members` is `user_id = auth.uid()` — you
see nobody but yourself — so an owner's `delete ... where user_id = <someone else>` matches zero rows.

Proven rather than reasoned: the delete reports `DELETE 0`, and reports `DELETE 1` the instant that
select policy is temporarily altered to `using (true)`.

Broadening the select policy is not available. "Rows of lists I own" would read `list_members` from
inside a policy *on* `list_members` (infinite recursion), and an `or` beside `user_id = auth.uid()`
would cost the index qual the whole read path is built on — rule 1 of the design, arriving from an
unexpected direction. So two `security definer` RPCs were added, `set_member_role(list, user, role)`
and `remove_member(list, user)`, and the policies were kept with a comment explaining that what they
*do* reach is real: an owner demoting or removing **themselves**, which is exactly what the
last-owner guard exists to police.

### 3. The last-owner guard would have blocked account deletion

The proposal specifies a trigger refusing to leave a list with no owner, and says nothing about
cascades. `list_members.user_id references auth.users on delete cascade`, so deleting an account
deletes its membership rows — and a naive guard turns that into "a list must keep at least one
owner", aborting the account deletion.

Both referential actions fire *after* the parent row is gone, so the guard skips itself when the
`auth.users` row (or the `lists` row) it is protecting no longer exists. Verified by actually deleting
an account that solely owned a list: the delete succeeds, the list survives with `created_by` null,
its items intact and zero members. Note the consequence, which is deliberate but worth knowing: such
a list becomes invisible to everyone forever, and there is no delete policy to clean it up. The
alternative — cascading and destroying lists other people are in — is worse.

### 4. `set_item_done` reported refusals as successes

The old function was `language sql` returning void: a refusal and a success were indistinguishable.
That could not bite while everyone owned every list they could see, which is why it survived three
steps. With `reader` it bites immediately — a queued toggle would come back `ok`, be dropped from the
outbox as delivered, and stay on screen as a change the database never made. Silent divergence is the
one failure mode the offline design exists to prevent.

It is now `plpgsql`, checks `row_count`, and raises `42501` → PostgREST 403 → `verdictFor`'s existing
`permanent`. **Seen in the browser**, which is the proof that matters: as a reader, ticking an item
produces the banner "not allowed to change this item" and the checkbox rolls back on the re-fetch.

## Client changes

`fetchLists` reads
`.from('list_members').select('role, lists!inner ( id, name, items ( id, title, done_at, created_at ) )').order('created_at')`.
RLS supplies `user_id = auth.uid()`, so the client still filters nothing. Item ordering moved out of
PostgREST into `toList` rather than risking an order spec two embeds deep; the list order is now
`list_members.created_at`, which for a list you created is the same instant the list was created (the
backfill carried `lists.created_at` across, so existing users' order is unchanged).

`List.role` is required rather than optional, which forced every construction site to state it — the
point of making it required. `listCache` went to `VERSION 2` so a pre-sharing blob is dropped instead
of rendering `role: undefined`; `outbox` stayed at `1`, because a version bump there moves the blob
aside as broken and discards unsent writes, and a v1 outbox holds only actions still valid.

## How it was verified

1. **Structure**, via `psql` on 54322 after `npx supabase db reset`: 12 policies and none of the old
   six; `information_schema.column_privileges` shows exactly one UPDATE row for `authenticated`
   (`lists.name`) and none on `items`; `pg_proc.proacl` shows no PUBLIC and no `anon` on
   `share_list`, `set_member_role`, `remove_member`, `list_members_of`, `set_item_done`. The ACL was
   read, not inferred from the statement.
2. **The role matrix**, scripted, with three accounts minted through the local admin API and each
   step run under `set local role authenticated` + `set local request.jwt.claims`. Reader, writer,
   owner, non-member and `anon` were each checked against every operation, including all three
   `share_list` refusals, both `set_member_role`/`remove_member` refusals, the last-owner guard on
   all four paths into it, and the account-deletion cascade.
3. **`my_memberships` keeps its default grants deliberately** — it is invoker, returns only your own
   rows, and is called from inside the `lists` policy, so revoking `anon` would turn an anonymous
   `GET /rest/v1/lists` from `[]` into a function-permission error. Checked: `anon` still gets `[]`.
4. **PostgREST**, directly: the embed returns `lists` as an object with `role` alongside, correct and
   different per account, `[]` for `anon`.
5. **The plans**, above, after discovering the first seeding attempt gave `list_members.user_id` an
   `n_distinct` of 2 — one account holding 84% of the rows — which made the planner seq-scan inside
   the RLS subplan. Redistributing across 10,000 accounts (`n_distinct` 10,016) is what produced the
   numbers above. A second attempt at that also failed silently: `join lateral (… order by random()
   limit 1)` is uncorrelated, so Postgres evaluated it **once** and gave one account all 1M rows.
   Deterministic modulo assignment fixed it. Watch for both when seeding for a planner test.
6. **`npm test`** (10 suites, 94 tests) and **`npm run typecheck`**, both clean.
7. **The browser**, `npm run web` driven with Playwright: signed in as Alice through Mailpit, saw her
   list and items in order; signed out; signed in as Bob, **an account that has never created a
   list**, and saw Alice's list — sharing working end to end through the real app. As Bob (reader),
   ticking an item and adding an item both produced the database's own refusal in the error banner
   and rolled back on re-fetch, with `psql` confirming nothing changed in the tables.

## What this leaves for later

- **No UI.** No share sheet, no role guards, no rename, no re-fetch on foreground. A reader currently
  sees an enabled "Add" button and gets an error banner when they use it — correct, and not pleasant.
  Staging steps 2 and 3 of the proposal are what close that.
- **`share_list` only works for addresses that already have an account** (`P0002` otherwise).
  Inviting a stranger needs a `list_invites` table claimed at sign-up.
- **Not pushed to cloud.** `npx supabase db push` is the user's to run. One thing to check first:
  `create unique index on public.users (lower(email))` will fail if the production project holds two
  addresses differing only in case.
- **`npm run kb:audit` fails on exactly one entry**, by design: `list-data-scoped-by-rls`'s
  `! grep -rqi 'for delete'`, tripped by "owners remove members". Un-sharing is a delete on
  `list_members`; no user-visible data gained a delete policy. That entry, plus `scope-boundaries`,
  `server-stamps-done-at` and `supabase-default-grants-defeat-revokes`, go to `/librarian deposit 7`.
