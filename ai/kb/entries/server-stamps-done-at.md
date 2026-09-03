---
id: server-stamps-done-at
title: The database stamps done_at — the client sends a boolean and holds no update grant on items
type: decision
status: current
tags: [supabase, postgres, persistence, state, security]
sources: [ai/tasks/3/implementation-log-step-1.md, supabase/migrations/20260831000000_lists.sql, src/lib/listsApi.ts, src/state/ListsContext.tsx]
last_verified: 2026-09-02
verify: grep -q "rpc('set_item_done'" src/lib/listsApi.ts && grep -q 'done_at = case when p_done then now() else null end' supabase/migrations/20260831000000_lists.sql && grep -q '^revoke update on public.items from anon, authenticated;' supabase/migrations/20260831000000_lists.sql && ! grep -qE "from\('items'\)[^;]*\.update\(" src/lib/listsApi.ts
related: [writes-retry-from-an-outbox, list-data-scoped-by-rls, supabase-default-grants-defeat-revokes, ids-minted-outside-reducer, first-fetch-replaces-list-state]
---

Ticking an item goes through `set_item_done(p_item_id uuid, p_done boolean)`.
[src/lib/listsApi.ts](../../../src/lib/listsApi.ts) calls it with `supabase.rpc`, and
[the migration](../../../supabase/migrations/20260831000000_lists.sql) writes
`done_at = case when p_done then now() else null end`. `revoke update on public.items from anon,
authenticated` means there is no other way in: a direct `PATCH` of `done_at` — or of `title` —
returns 403.

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

**What it cost, both parts deliberate.** The function has to be `security definer` — an invoker
function would be denied by the very revoke that makes this worth doing — so it bypasses RLS and
repeats the ownership test in its body, and that predicate must stay in step with the `update items
of own lists` policy. And the revoke is table-wide, so renaming an item is impossible from the
client too; nothing does that today, and a rename feature needs its own function rather than a
re-granted column. See
[supabase-default-grants-defeat-revokes](supabase-default-grants-defeat-revokes.md) for why neither
could be dodged, and [list-data-scoped-by-rls](list-data-scoped-by-rls.md) for the whole
authorization picture.

**What to do:** a new write to `items` is a function in the migration plus a `supabase.rpc` call,
never a `.update()`. Argument keys must match the parameter names exactly (`p_item_id`, `p_done`):
PostgREST resolves an RPC by argument name, so a typo comes back as "function not found" rather
than as a bad argument.

The `verify:` command asserts all four halves — the client calls the RPC, the database stamps the
time with `now()`, the update grant is still revoked, and `listsApi` has not grown a direct update
of `items`.
