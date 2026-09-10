# Suggestion — deleting lists and items, with tombstones

**Status:** proposal, not an approved step. Adopting it needs an
`ai/tasks/<n>/description-step-<n>.md` first, and it moves
[scope-boundaries](../kb/entries/scope-boundaries.md), which currently lists deletion as out —
deliberately, and twice over (the `writer` brief said "add and delete items" and the answer when it
was put was *no item deletion so far*).

**Date:** 2026-09-10

Backlog item 9, and it absorbs items 7 ("human readable errors: when a deleted list is updated") and
11 ("list rename endpoint should return errors") on the way past — see §3.3.

**The approach is decided, not open.** An earlier draft of this document proposed a hard delete plus
a clear error message, and listed tombstones as the expensive reserve option. The user chose
tombstones, with this shape:

> Deleted lists and items stay visible behind a checkbox. Owners can restore them. If an owner writes
> to something another owner deleted, they are offered a restore; a writer's write to the same thing
> just drops.

Everything below is that design. §1 records what the choice buys, because several problems the
hard-delete draft spent its length on simply cease to exist.

## 1. What the decision buys, and what it costs

**Four hard problems dissolve.**

- **"Zero rows means two things."** The hard-delete draft was organised around it: a refused write and
  a write to a vanished row are both zero rows, and neither PostgREST nor a `.select()` can tell them
  apart. With tombstones **the row never goes away**, so a write to a deleted thing matches a row that
  is visibly deleted. The ambiguity comes back only at purge time, for writes queued longer than the
  purge window (§7.9).
- **The "shelf".** Two turns of design went into a place to keep a user's typing when a refused write
  destroyed it. Not needed: the deleted thing is still in the app, behind the checkbox, and still
  restorable through the normal UI. A missed conflict prompt costs a tap, not data.
- **Sharing survives a delete.** Measured (I): with a hard delete, `list_members` cascades away, so a
  "restore" could never restore who the list was shared with. Nothing cascades now — restore is a
  real restore.
- **Confirmation stops being load-bearing.** A reversible delete does not need a modal guarding it,
  which sidesteps the fact that `Alert.alert` is a no-op on web (measurement 9).

**Two real costs, and the first is the one to plan for.**

- **Tombstones accumulate forever.** A shopping list is the worst case for soft delete: items are
  added and cleared constantly. Without a purge the fetch grows without bound and the read path the
  sharing migration spent a whole design on degrades. **A purge is part of this feature, not a
  follow-up** (§3.6, §7.1).
- **Every count and every list render must now ask "is this a tombstone?"** — and the places that
  forget will look right in a test and wrong in the app (§7.3).

## 2. Measurements

Local stack, PostgreSQL 17.6, 2026-09-10, in rolled-back transactions plus one HTTP probe that
created and removed a throwaway account. The stack was left as found — two pre-existing accounts, one
list ([supabase-local-stack](../kb/entries/supabase-local-stack.md)).

**Measurements that bear on the chosen design:**

| # | question | measured answer |
|---|---|---|
| H | Does a soft delete fire the **existing** realtime triggers, unchanged? | **Yes** — 1 nudge per member, for both an item and a list. A soft delete is an UPDATE, and `notify_on_item_change` is already `after insert or update`, `notify_on_list_rename` already `after update`. **Realtime needs no migration at all.** |
| I | Do `list_members` rows survive a soft delete? | **Yes** — both still there. Restore keeps the sharing intact. |
| J | Can a client write a newly added `deleted_at` directly? | **No, on either table** — `has_column_privilege` is false for `authenticated`. `items` had its whole update grant revoked; `lists` was revoked and re-granted `update (name)` only. A new column is un-writable by construction, so the RPC is forced with no extra revoke. |
| 6 | What does `set_item_done` do today for an item that is not there? | Raises **`42501 not allowed to change this item`** → 403 → `permanent` → red banner. Under tombstones this becomes "the item is in the bin", which is a different answer (§3.3). |
| 8 | What a queued write says when it lands on a list it may no longer touch | `item/added` → `403 new row violates row-level security policy for table "items"`; `set_item_done` → `403 not allowed to change this item`; `list/renamed` → `200 []`. **Two of three reach `ErrorBanner` as raw Postgres text.** |
| 9 | `Alert.alert` under react-native-web | **`static alert() {}`** — a no-op. Less critical now that delete is reversible, but still true for any future destructive confirm. |
| K | Is `pg_cron` usable for the purge? | **Yes.** It is in `shared_preload_libraries` on the local stack, `create extension` succeeds into `pg_catalog`, and `cron.schedule` registers a job running as `postgres` against `postgres`. Scheduling the **same job name twice upserts** — one row, jobid unchanged, newest schedule wins — so a migration survives `db reset`. `cron.timezone` is **GMT**. |

**Measurements the *hard-delete* design needed, and which mostly stopped applying** — kept so nobody
re-runs them: every AFTER ROW trigger fires after the whole cascade completes, so a fan-out during a
cascade sees `members_visible = 0` and a cascaded delete of a 200-item list emits one nudge per member
rather than 1,000; a policy-refused `DELETE` asking for the row back returns `200 []`,
indistinguishable from success; and `DELETE` is granted to `authenticated` on both tables today,
blocked only by the missing policy.

**One of them turned out not to be moot at all.** With a hard delete, `keep_last_owner` does not abort
`delete from lists` — measured `DELETE 1`, because the trigger's cascade exemption already covers it.
The purge (§3.6) *is* a hard delete, so that measurement is exactly what says the nightly job will not
abort on a list somebody solely owns.

## 3. The design

### 3.1 Schema

```sql
alter table public.lists add column deleted_at timestamptz;
alter table public.items add column deleted_at timestamptz;

-- Partial, so they cost nothing until something is deleted. The `items` one serves the purge;
-- the `lists` one serves both the purge and "show me the bin".
create index on public.items (deleted_at) where deleted_at is not null;
create index on public.lists (deleted_at) where deleted_at is not null;
```

**Server-stamped, exactly like `done_at`, and now it matters far more.**
[server-stamps-done-at](../kb/entries/server-stamps-done-at.md) moved that value to Postgres's clock
and noted the point was "a *trustworthy* stored value, for the day something does compare them". This
is that day: `deleted_at` decides what the purge collects and what the bin shows as "deleted
yesterday". Measurement J says the grants already make it impossible for a client to write.

**No policy changes.** `read lists you belong to` and `read items of lists you belong to` stay exactly
as written — a tombstoned row is still a row, members still need to see it to restore it, and the
client decides what to render. The `in (select ... from my_memberships())` shape that
[read-rooted-at-list-members](../kb/entries/read-rooted-at-list-members.md) exists to protect is
untouched. **Do not be tempted to filter tombstones in `my_memberships()`** — the read policies share
it, and the bin needs those rows.

### 3.2 Delete and restore are one RPC each, taking a boolean

They mirror `set_item_done` deliberately: an absolute value, not a verb. That buys retry safety and
outbox coalescing for free, exactly as it does for a toggle
([update-list-identity-preserving](../kb/entries/update-list-identity-preserving.md)).

```sql
create function public.set_list_deleted(p_list_id uuid, p_deleted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated int;
begin
  update public.lists
     -- `coalesce` so a retry does not push the tombstone forward and reset the purge clock.
     set deleted_at = case when p_deleted then coalesce(deleted_at, now()) else null end
   where id = p_list_id
     and exists (
       select 1 from public.list_members m
        where m.list_id = lists.id and m.user_id = (select auth.uid()) and m.role = 'owner'
     );
  get diagnostics updated = row_count;

  if updated = 0 then
    raise exception using errcode = '42501',
      message = 'only an owner can delete or restore this list';
  end if;
end;
$$;
```

`set_item_deleted(p_item_id uuid, p_deleted boolean)` is the same shape one rung down:

```sql
     and exists (
       select 1 from public.list_members m
        where m.list_id = items.list_id
          and m.user_id = (select auth.uid())
          and m.role >= 'writer'
     );
```

**Whoever may delete a thing may restore it** — settled, and the reason to write it down is that the
first draft had it otherwise. An earlier version let a `writer` delete an item but reserved restoring
to an `owner`, which meant a writer could put something beyond their own reach with one tap. The rule
now is symmetric at both levels: `role >= 'writer'` deletes and restores an item, `role = 'owner'`
deletes and restores a list. One predicate per function, not a `case` on `p_deleted` — which is also
why the boolean stays a pure value rather than something the authorization reads.

### 3.3 Signalling "you wrote to something that is in the bin"

Write RPCs stop returning `void` and return an outcome:

```sql
create type public.write_outcome as enum ('applied', 'target_deleted');
```

This is the mechanism behind the user's rule, and note where the rule is actually enforced: **the
server says only "the target is deleted". The client decides whether to offer a restore**, based on
the role it already holds. That is exactly the existing convention — `src/state/roles.ts` chooses
which controls exist, never whether a write is allowed
([list-data-scoped-by-rls](../kb/entries/list-data-scoped-by-rls.md)) — and it means an owner sees
"Restore?" while a writer's write drops quietly, with no role logic duplicated into the RPC's return
value.

`set_item_done` becomes:

```sql
  update public.items
     set done_at = case when p_done then now() else null end
   where id = p_item_id
     and deleted_at is null
     and not exists (select 1 from public.lists l where l.id = items.list_id
                       and l.deleted_at is not null)
     and exists (
       select 1 from public.list_members m
        where m.list_id = items.list_id and m.user_id = (select auth.uid())
          and m.role >= 'writer'
     );
  get diagnostics updated = row_count;
  if updated = 1 then return 'applied'; end if;

  -- Zero rows now has three causes and they get three different answers.
  if not exists (select 1 from public.items i where i.id = p_item_id) then
    return 'target_deleted';   -- purged out from under a very old queued write (§7.9)
  end if;
  if exists (
    select 1 from public.items i
      join public.lists l on l.id = i.list_id
     where i.id = p_item_id and (i.deleted_at is not null or l.deleted_at is not null)
  ) then
    return 'target_deleted';
  end if;
  raise exception using errcode = '42501', message = 'not allowed to change this item';
```

**Two existing write paths have to become RPCs to carry an outcome**, and both were on the backlog
anyway:

- **`insertItem` → `add_item(p_id, p_list_id, p_title)`.** Not optional: with soft delete the
  existing `writers add items` policy would **accept** an item into a tombstoned list, because
  membership is intact and the policy never looks at `deleted_at` (§7.4). Keep the retry semantics
  with `on conflict (id) do nothing` returning `'applied'`, replacing today's reliance on `23505`.
- **`updateListName` → `rename_list(p_list_id, p_name)`.** This is backlog item 11, and it also fixes
  something measurement 8 exposed: today a rename refused for *any* reason returns `200 []` and the
  client says "You can no longer rename this list", which cannot tell **deleted** from **demoted**.
  It cannot be fixed client-side either — row-level security hides a list you were removed from
  exactly as thoroughly as one that is gone, so only a definer function can see the difference.

`insertList` stays a plain insert. Creating a list cannot land on a deleted target.

### 3.4 The client

**State** — `Item` and `List` each gain `deletedAt: string | null`, mapped from `deleted_at` in
`listsApi` like `doneAt` is.

**`listCache`'s `VERSION` goes to 3.** Not optional and not cosmetic: a v2 blob rehydrates with
`deletedAt: undefined`, and `undefined !== null` is **true**, so every cached item would render as
deleted. This is precisely the failure the version check exists to prevent
([list-cache-holds-acknowledged-rows](../kb/entries/list-cache-holds-acknowledged-rows.md)).
`outbox`'s `VERSION` stays `1` — new actions are additive and a v1 blob still replays.

**Two new actions**, mirroring `item/setDone`:

```ts
| { type: 'item/setDeleted'; listId: string; itemId: string; deletedAt: string | null }
| { type: 'list/setDeleted'; id: string; deletedAt: string | null }
```

- The reducer arms are ordinary `updateList` calls returning the original object on a no-op.
  **`list/setDeleted` goes through `updateList` too** — it changes a list in place rather than
  removing it from the array, which the hard-delete draft could not do.
- `supersedes` should coalesce both by id, exactly like a toggle: delete/restore/delete while offline
  is one write.
- `dropDependents` needs a `list/created` arm that drops a queued `list/setDeleted` for the refused
  list — **and note it names its list by `id`, not `listId`**, which is the exact compile error
  `list/renamed` hit. Let the exhaustive switch enumerate the sites.

**The outcome reaches the flush loop.** `Result` gains `outcome`, and in `ListsContext` a
`'target_deleted'` on an otherwise-`ok` response drops the write from the outbox (nothing more will
happen to it) and records a prompt rather than an error:

```ts
blocked: { op: WriteAction; listId: string } | null
```

Rendered as a banner for an owner — *"That list is in the bin. Restore it and keep your change?"* —
and ignored entirely for a writer, per the brief. **"Restore and keep my change" is two queued
writes**: `list/setDeleted(id, null)` followed by re-enqueuing the original op. The outbox is serial
and ordered, so the restore lands first and the original write then succeeds. No new machinery.

### 3.5 Realtime: nothing

Measurement H. A soft delete is an UPDATE, both triggers already cover UPDATE, and `list_members`
rows survive so the fan-out finds everyone normally. **No migration, no trigger change, no client
change.** The `departed` special case stays what it was built for — un-sharing.

### 3.6 Purge — a `pg_cron` job over one plain function

Not optional (§7.1). **The bin holds 30 days**, settled. Two pieces: a function that does the work,
and a schedule that calls it. They are separable on purpose — the function is useful, testable and
runnable by hand whether or not the schedule ever exists.

```sql
-- The interval is a parameter rather than a hardcoded 30 days for one reason above all: a test
-- cannot wait a month. `purge_deleted(interval '0 seconds')` collects everything tombstoned so far,
-- which is what makes this verifiable at all.
create function public.purge_deleted(p_older_than interval default interval '30 days')
returns table (lists_purged bigint, items_purged bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff timestamptz := now() - p_older_than;
  n_items bigint;
  n_lists bigint;
begin
  -- Items first. A list purged below cascades its items away regardless, but an item deleted inside
  -- a *live* list has no other collector — and those are the overwhelming majority.
  with gone as (delete from public.items where deleted_at < cutoff returning 1)
  select count(*) into n_items from gone;

  with gone as (delete from public.lists where deleted_at < cutoff returning 1)
  select count(*) into n_lists from gone;

  -- Counts rather than void: a job that silently destroys data should be able to say how much. The
  -- item count excludes rows carried off by a list's cascade, which is a fine distinction to know
  -- about before reading the numbers as a total.
  return query select n_lists, n_items;
end;
$$;

-- Nobody calls this from the app. Supabase's default privileges put `anon` and `authenticated` on a
-- new function's ACL by name, so `from public` alone would leave them there.
revoke execute on function public.purge_deleted(interval) from public, anon, authenticated;
```

The schedule, in the same migration:

```sql
create extension if not exists pg_cron;

-- 03:30 **GMT** — measured: `cron.timezone` is GMT, not the server's local zone.
-- Re-running this migration is safe: scheduling an existing job *name* upserts it (measured — one
-- row, same jobid, newest schedule wins), so `supabase db reset` does not accumulate duplicates.
select cron.schedule('purge-deleted', '30 3 * * *', $$select public.purge_deleted()$$);
```

**Why `pg_cron` and not the alternatives.**

- **An Edge Function on a schedule** is the other Supabase-native answer, and it is strictly more
  moving parts for this: `pg_cron` + `pg_net` + a deployed function + a service key, to run one
  `delete`. The work is pure SQL and has no business leaving the database.
- **An external scheduler** (a GitHub Action holding the service key) puts a piece of this system
  outside the repo, where `db push` cannot carry it and nothing in `ai/` describes it.
- **A lazy purge** — collecting old tombstones as a side effect of the next delete — needs no
  scheduler at all and has a genuinely nice property: the garbage collector is driven by the same
  activity that makes the garbage, so a database nobody deletes from never runs it and never needs
  to. It is the fallback if `pg_cron` turns out to be unavailable on the cloud project. It is not the
  first choice because it puts unpredictable latency inside a user's tap, and because "why was that
  delete slow" is a worse question to debug than "did the nightly job run".

**Three consequences worth knowing before this ships.**

- **The job runs as `postgres`** (measured), which owns these functions, so the `security definer` and
  the revoke above are consistent — nothing needs granting to make the schedule work.
- **`keep_last_owner` does not abort it.** The purge hard-deletes lists, which cascades to
  `list_members` and fires that trigger; its cascade exemption covers exactly this, measured as
  `DELETE 1`. A list whose only owner has stopped using it still gets collected.
- **Purging a list nudges its members.** The cascade to `list_members` fires the un-share arm of the
  realtime trigger, so every member's app is told to re-fetch — at 03:30, about a row they could not
  see, for a list that left their fetch 30 days ago. Harmless (sockets are almost certainly down, and
  delivery is at-most-once), and the client's 300 ms debounce collapses a burst of them into one
  fetch. Worth recognising rather than debugging later.

**Not verified: the cloud project.** `pg_cron` is available and installable on Supabase's hosted
plans, but everything in measurement K is the local Docker stack, and `supabase db push` is the
user's to run ([supabase-local-stack](../kb/entries/supabase-local-stack.md)). If `create extension`
is refused there, the schedule is the only part that fails — the function still works, and the lazy
fallback above is still open.

### 3.7 UI

| where | control |
|---|---|
| `ListsScreen` | a **Show deleted** checkbox; deleted lists render muted with a `Deleted` tag |
| `ListDetailScreen` | the same checkbox for items |
| a deleted row | **Restore** — owner only |
| a live row | **Delete** — writer+ for an item, owner for a list |

The checkbox is `accessibilityRole="checkbox"` with a `checked` state, asserted with RNTL 14's
`toBeChecked()` ([rntl-14-api-changes](../kb/entries/rntl-14-api-changes.md)). Deleted content ships
in the same fetch, so ticking it is instant — no spinner and no round trip, which is a large part of
why this design feels better than a "trash" screen.

**Per-screen local state, decided.** Not a stored preference and not a global setting: no new storage
key, no version to bump, nothing to migrate, and it resets to hidden every time you arrive — which is
the right default, since the bin is somewhere you visit deliberately. The cost is re-ticking it on
each screen, accepted.

## 4. Staging

1. **Schema and RPCs.** Columns, indexes, `write_outcome`, `set_list_deleted`, `set_item_deleted`,
   the `set_item_done` rewrite, `add_item`, `rename_list`, `purge_deleted`, grants. Nothing visible.
2. **State.** `deletedAt` on both types, cache `VERSION` 3, two actions, reducer arms, `supersedes`,
   `dropDependents`, and the counting fixes (§7.3). Still nothing visible.
3. **API and provider.** The RPC wrappers, `outcome` on `Result`, `send()`, `setListDeleted` /
   `setItemDeleted`, the `blocked` prompt.
4. **Error messages** (§7.6) — lands with 3.
5. **UI.** The checkbox, the delete and restore controls, the conflict banner, and a two-browser
   verification of the owner-vs-writer split.
6. **Purge.** `purge_deleted` ships with step 1 — it is pure SQL and testable immediately with
   `interval '0 seconds'`. The `cron.schedule` half can follow, and is the only part that might not
   survive the trip to the cloud project.

## 5. Settled, having been open

These three were put to the user and answered. They are recorded because each one had a defensible
alternative, and a later reader should not have to re-derive which way it went.

1. **Whoever may delete may restore.** No owner-only restore. §3.2.
2. **The bin holds 30 days**, collected by a nightly `pg_cron` job. §3.6.
3. **"Show deleted" is a per-screen toggle**, in local component state — not a stored preference and
   not a global setting. §3.7.

## 6. What this does not solve

- **No happens-before.** The rule is "who you are" (owner vs writer), not "whose change was first".
  An owner is offered a restore whether their edit predated the delete by a second or a week. Real
  causal ordering needs version vectors, and at that point the answer is a sync engine — PowerSync,
  not half of one hand-rolled.
- Last-write-wins is unchanged for concurrent edits to the same field.
- Still out: leaving a list you do not own (backlog 10), invites.
- **Not measured:** cloud, two real devices, and the client — §3.4 and §3.7 are design, and the
  compile errors will be the first real feedback.

## 7. Issues, ranked

1. **Tombstones grow without bound, and this domain is the worst case for it.** Items get added and
   cleared every week; a year of one household's shopping is thousands of dead rows, all shipped on
   every fetch, on a read path deliberately engineered to stay cheap. §3.6 is the mitigation, and the
   part of it that can quietly not happen is the **schedule** — the function is easy to write, easy to
   test, and worth nothing if nothing ever calls it. The failure mode is silent and slow: no error,
   no alert, just a fetch that gets bigger every month. Check `cron.job_run_details` once after
   deploying, and again a week later.
2. **`deletedAt: undefined !== null` is `true`.** A cached blob written before this feature would
   render every item as deleted. Bumping `listCache`'s `VERSION` to 3 is what prevents it; forgetting
   is a silent, total corruption of the first screen after upgrade.
3. **Every count has to learn about tombstones.** `countDone` and the `list.items.length` beside it
   feed `ListRow`'s "2 of 5 done" — unfixed, a list reads "2 of 47 done" with 42 in the bin. Same for
   the "Nothing on this list" empty state, which would stop appearing once a list has ever held
   anything. These look right in every unit test that does not delete something first.
4. **Adding an item to a deleted list currently *succeeds*.** The `writers add items` policy checks
   membership, and membership is intact after a soft delete. This is the one place where doing nothing
   is actively wrong rather than merely incomplete, and it is why `insertItem` has to become an RPC.
5. **Restoring a list does not restore its items**, because the two tombstones are independent. An
   owner who deletes a list, then restores it, gets it back whole; an owner who deleted six items
   first gets back a list missing six items, with no hint that they are one checkbox away. Correct,
   simple, and confusing — worth a line of copy at least.
6. **Raw Postgres text still reaches the red banner** (measurement 8). Fewer paths reach it now, but
   `42501` on a genuine permission refusal still shows *"not allowed to change this item"*, and
   backlog item 7 is still owed a small SQLSTATE-to-sentence map in `listsApi`.
7. **The KB audit will give a false green here.**
   [writes-retry-from-an-outbox](../kb/entries/writes-retry-from-an-outbox.md)'s `verify:` ends
   `! grep -qE "removed'|deleted'" src/state/types.ts`, guarding its claim that no delete action
   exists. `'item/setDeleted'` does not match `deleted'` — the capital `D` slips past a
   case-sensitive grep — so the check **passes while the claim it protects becomes false**. The entry
   needs revising by hand; the audit will not catch this one.
8. **The restore-and-keep prompt can loop.** If the restore is itself refused — the user is no longer
   an owner — the re-queued write hits `'target_deleted'` again and prompts again. Offer it once per
   op, or check the restore's own result before re-enqueuing.
9. **The purge re-opens the ambiguity, narrowly.** Once a tombstone is collected the row really is
   gone, so a write queued longer than the purge window finds nothing. `set_item_done` above already
   treats "no such row" as `'target_deleted'`, which drops it quietly — the right answer, and worth
   keeping when someone later "simplifies" that branch.
10. **The bin is fetched even when it is not shown.** One query and instant toggling is the right
    trade at this size, and the wrong one at some larger size. The signal to switch is a list whose
    deleted rows outnumber its live ones; the fix is a second query behind the checkbox, not a policy
    change.
11. **`Alert.alert` is a no-op on web** (measurement 9). It matters less now — delete is reversible,
    so confirmation is optional — but any future destructive confirm built on it will pass a native
    check and silently do nothing in the browser, which is where this project verifies its work.

## 8. KB impact — hand these to the librarian, do not edit the entries

| entry | what changes |
|---|---|
| [scope-boundaries](../kb/entries/scope-boundaries.md) | deletion moves in, as a soft delete with a bin and a restore |
| [writes-retry-from-an-outbox](../kb/entries/writes-retry-from-an-outbox.md) | "no inverse of any write" becomes false; a fifth and sixth `WriteAction` land; the `verify:` command **passes anyway** and must be rewritten (§7.7) |
| [server-stamps-done-at](../kb/entries/server-stamps-done-at.md) | its prediction lands, but not as it expected: the zero-row branch splits three ways, and the function now returns an outcome instead of void. Its `verify:` greps for `if updated = 0 then`, which this rewrite removes |
| [list-data-scoped-by-rls](../kb/entries/list-data-scoped-by-rls.md) | "nothing in the app deletes anything" becomes false; the policies are unchanged, which is itself the fact worth recording; `add_item` and `rename_list` move off direct table access |
| [refused-writes-return-zero-rows](../kb/entries/refused-writes-return-zero-rows.md) | its `verify:` pairs `.update(`/`.delete(` with `.select(`; `updateListName` — the only direct table write in the app — becomes an RPC, so the rule survives with nothing left to apply to |
| [realtime-is-a-nudge-to-a-per-user-inbox](../kb/entries/realtime-is-a-nudge-to-a-per-user-inbox.md) | "a nudge can never mean gone" becomes false, with **no migration** behind it (measurement H) |
| [list-cache-holds-acknowledged-rows](../kb/entries/list-cache-holds-acknowledged-rows.md) | cache `VERSION` 2 → 3, with §7.2 as the worked reason |

A likely new entry: *a write can land on a tombstone*, holding the `write_outcome` contract, the rule
that the server reports the fact and the client decides by role, and the three-way split of a
zero-row update.
