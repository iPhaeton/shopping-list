---
id: server-stamps-done-at
title: The database stamps done_at — the client sends a boolean and holds no update grant on items
type: decision
status: current
tags: [supabase, postgres, persistence, state, security]
sources: [ai/tasks/3/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-2.md, ai/tasks/9-deletion/implementation-log-step-1.md, ai/tasks/10-rename-item/implementation-log-step-1.md, supabase/migrations/20260910000000_deletion.sql, supabase/migrations/20260911000000_rename_item.sql, src/lib/listsApi.ts, src/state/ListsContext.tsx]
last_verified: 2026-09-11
verify: grep -q "rpc('set_item_done'" src/lib/listsApi.ts && D="$(grep -rl 'function public.set_item_done' supabase/migrations | sort | tail -1)" && grep -q 'done_at = case when p_done then now() else null end' "$D" && grep -A6 'create function public.set_item_done' "$D" | grep -q 'returns public.write_outcome' && grep -A50 'create function public.set_item_done' "$D" | grep -q "raise exception using errcode = '42501'" && grep -q '^revoke update on public.items from anon, authenticated;' supabase/migrations/20260831000000_lists.sql && ! grep -rqE '^grant update[^;]*on public\.items' supabase/migrations && grep -q "rpc('rename_item'" src/lib/listsApi.ts && ! grep -qE "from\('items'\)[^;]*\.update\(" src/lib/listsApi.ts
related: [writes-retry-from-an-outbox, list-data-scoped-by-rls, supabase-default-grants-defeat-revokes, refused-writes-return-zero-rows, ids-minted-outside-reducer, first-fetch-replaces-list-state, writes-can-land-on-a-tombstone, deletion-is-a-tombstone]
---

Ticking an item goes through `set_item_done(p_item_id uuid, p_done boolean)`.
[src/lib/listsApi.ts](../../../src/lib/listsApi.ts) calls it with `supabase.rpc`, and
[the function](../../../supabase/migrations/20260910000000_deletion.sql) writes
`done_at = case when p_done then now() else null end`. `revoke update on public.items from anon,
authenticated` means there is no other way in: a direct `PATCH` of `done_at` — or of `title` —
returns 403. **The function has been rewritten twice and lives in the newest migration that names
it** — step 7's sharing migration, then step 9's deletion migration; this entry's `verify:` finds it
by sorting the migrations rather than naming one, and so should you. Step 9 could not use
`create or replace`: the return type changed from `void`, which that statement refuses, so the
function is **dropped and recreated** — which takes its grants with it, hence the re-issued
`revoke`/`grant` pair below it, and hence the `notify pgrst, 'reload schema'` ending the migration,
because a signature change is exactly when PostgREST answers "could not find the function in the
schema cache".

**Decision: a device's clock does not get to say when an item was checked off.** `done_at` was
minted on the device until a review asked what happens when a phone's clock is a year out. The row
mixed a server clock in `created_at` with a device clock in `done_at`, and a later step that
resolved conflicts by comparing timestamps would have handed every conflict to the fastest clock.
The value is now Postgres's `now()`, on every write, from every device.

**This did not fix a convergence bug, because there was not one — the earlier reasoning was just
loose.** Nothing compares `done_at`: the update is unconditional and the winner is whichever
statement commits last. What makes a repeated or reordered write safe is that it carries an
*absolute value* — "be done", not "flip" — and that property holds whatever the timestamp says (see
[writes-retry-from-an-outbox](writes-retry-from-an-outbox.md)). Sending a boolean rather than a
string is the same decision expressed more exactly. What the move buys is a *trustworthy* stored
value, for the day something does compare them.

**Step 4 leans on this harder.** A toggle now sits in an outbox and may be sent minutes or days
after it was tapped, possibly several times; the boolean is derived at send time from the queued
action's `doneAt !== null`, and a queued toggle for the same item is *replaced* by a newer one rather
than appended. Both are only safe because the value is absolute and the timestamp is the database's.

**The provider still dispatches a `doneAt` string, and it is now a placeholder.** `toggleItem`
computes `new Date().toISOString()` for the optimistic row alone; the real instant is whatever
Postgres wrote, and it only reaches state at the next hydration (see
[first-fetch-replaces-list-state](first-fetch-replaces-list-state.md)). Nothing renders it today —
`ItemRow` asks only `doneAt !== null` — so the discrepancy is invisible. Do not display a `doneAt`
held in state as a time without re-fetching first, and note that the reducer convention is unchanged:
the value still arrives on the action rather than being read from a clock inside it
([ids-minted-outside-reducer](ids-minted-outside-reducer.md)).

**Since step 7 it also `raise`s on refusal, and that closed a latent bug.** The old body was
`language sql` returning void, so a refusal and a success were indistinguishable: the update matched
zero rows, no error came back, and `resultFor` read that as `ok`. That could not bite while everyone owned every list they could see, which is why it
survived three steps; with a `reader` it bites immediately, and silently, in the worst place: a
queued toggle would come back `ok`, be dropped from the outbox as delivered, and sit on screen as a
change the database never made. The function is `plpgsql` now, checks `row_count`, and raises `42501`
when it genuinely refused — PostgREST 403, which `verdictFor` already classifies `permanent`, so the
write is dropped loudly with a banner and a re-fetch
([writes-retry-from-an-outbox](writes-retry-from-an-outbox.md)). **The general rule: a definer RPC
that returns void must raise on refusal, or the outbox reports a lie as delivered.**

**This entry used to add "zero rows is unambiguously a refusal only because nothing deletes items",
and step 9 collected on it.** The function returns `public.write_outcome` rather than void now, and
its zero-row branch splits three ways: row missing → `target_deleted`, caller not a writer →
`raise 42501`, otherwise → `target_deleted`. The order is a security decision and the reasoning lives
in [writes-can-land-on-a-tombstone](writes-can-land-on-a-tombstone.md). Raising is still what a
*refusal* does; what changed is that not every zero-row update is one.

**Step 7's UI found the same bug one table over, arriving through PostgREST rather than through a
function.** A `reader`'s plain `PATCH` of `lists.name` is filtered to zero rows and answers `204`
with no error — again read as `ok`, again dropped from the outbox as delivered. The fix there is
`.select()` rather than `raise`, because the write is a table update and not an RPC. Read the pair
together: **an RPC has to fail loudly; a direct write has to be asked what it did**
([refused-writes-return-zero-rows](refused-writes-return-zero-rows.md)).

**What it cost, both parts deliberate.** The function has to be `security definer` — an invoker
function would be denied by the very revoke that makes this worth doing — so it bypasses RLS and
repeats the authorization test in its body. **That predicate is a role test now**
(`list_members … role >= 'writer'`), not an ownership one, and it must stay in step with the
`writers update items` policy. And the revoke is table-wide, so renaming an item is impossible from
the client too: step 10's `rename_item`
([migration](../../../supabase/migrations/20260911000000_rename_item.sql)) is its own definer
function rather than a re-granted `title` column — unlike `lists`, where step 7 did re-grant a single
column — and it repeats the same `role >= 'writer'` predicate, so two function bodies now move with
that policy. See [supabase-default-grants-defeat-revokes](supabase-default-grants-defeat-revokes.md)
for why neither could be dodged, and [list-data-scoped-by-rls](list-data-scoped-by-rls.md) for the
whole authorization picture.

**What to do:** a new write to `items` is a function in the migration plus a `supabase.rpc` call,
never a `.update()`. Argument keys must match the parameter names exactly (`p_item_id`, `p_done`):
PostgREST resolves an RPC by argument name, so a typo comes back as "function not found" rather
than as a bad argument. `rename_item` is the worked example — `set_item_done` with `title` for
`done_at`, three-way split in the same order, **copied rather than factored into a shared helper**:
migrations are append-only, so each function has to read on its own in the file that defines it.
Do not "tidy" the duplication into a helper.

The `verify:` command resolves the newest migration defining `set_item_done` and asserts against
*that*, which is the part the previous version got wrong: it named step 7's file, kept passing
against a definition the database no longer had, and went green over prose that had stopped being
true. It checks that the client calls the RPC, that the live definition stamps the time with `now()`,
that it returns `public.write_outcome`, that it still raises `42501` somewhere in its body, that the
update grant is still revoked and no later migration re-granted any column of `items` (anchored to
the line start, because the rename migration's *comment* names the grant it refused to make), that
`rename_item` is called as an RPC, and that `listsApi` has not grown a direct update of `items`.
