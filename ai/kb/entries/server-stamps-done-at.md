---
id: server-stamps-done-at
title: The database stamps done_at — the client sends a boolean and holds no update grant on items
type: decision
status: current
tags: [supabase, postgres, persistence, state, security]
sources: [ai/tasks/3/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-2.md, supabase/migrations/20260907000000_list_sharing.sql, src/lib/listsApi.ts, src/state/ListsContext.tsx]
last_verified: 2026-09-08
verify: grep -q "rpc('set_item_done'" src/lib/listsApi.ts && grep -q 'done_at = case when p_done then now() else null end' supabase/migrations/20260907000000_list_sharing.sql && grep -A30 'function public.set_item_done' supabase/migrations/20260907000000_list_sharing.sql | grep -q 'if updated = 0 then' && grep -q '^revoke update on public.items from anon, authenticated;' supabase/migrations/20260831000000_lists.sql && ! grep -qE "from\('items'\)[^;]*\.update\(" src/lib/listsApi.ts
related: [writes-retry-from-an-outbox, list-data-scoped-by-rls, supabase-default-grants-defeat-revokes, refused-writes-return-zero-rows, ids-minted-outside-reducer, first-fetch-replaces-list-state]
---

Ticking an item goes through `set_item_done(p_item_id uuid, p_done boolean)`.
[src/lib/listsApi.ts](../../../src/lib/listsApi.ts) calls it with `supabase.rpc`, and
[the function](../../../supabase/migrations/20260907000000_list_sharing.sql) writes
`done_at = case when p_done then now() else null end`. `revoke update on public.items from anon,
authenticated` means there is no other way in: a direct `PATCH` of `done_at` — or of `title` —
returns 403. **Step 7 replaced the function with `create or replace`, so it now lives in the sharing
migration** rather than the step-3 one; read the newest definition, not the first.

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
when it updated nothing — PostgREST 403, which `verdictFor` already classifies `permanent`, so the
write is dropped loudly with a banner and a re-fetch
([writes-retry-from-an-outbox](writes-retry-from-an-outbox.md)). **The general rule: a definer RPC
that returns void must raise on refusal, or the outbox reports a lie as delivered.** Zero rows is
unambiguously a refusal only because nothing deletes items; if item deletion ever lands, this branch
has to tell "gone" from "refused".

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
the client too; nothing does that today, and a rename feature needs its own function rather than a
re-granted column — unlike `lists`, where step 7 did re-grant a single column. See
[supabase-default-grants-defeat-revokes](supabase-default-grants-defeat-revokes.md) for why neither
could be dodged, and [list-data-scoped-by-rls](list-data-scoped-by-rls.md) for the whole
authorization picture.

**What to do:** a new write to `items` is a function in the migration plus a `supabase.rpc` call,
never a `.update()`. Argument keys must match the parameter names exactly (`p_item_id`, `p_done`):
PostgREST resolves an RPC by argument name, so a typo comes back as "function not found" rather
than as a bad argument.

The `verify:` command asserts all five halves — the client calls the RPC, the current definition
stamps the time with `now()`, it still raises on a zero-row update, the update grant is still
revoked, and `listsApi` has not grown a direct update of `items`.
