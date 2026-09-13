---
id: realtime-is-a-nudge-to-a-per-user-inbox
title: Realtime is a nudge fanned out to each member's per-user inbox topic, answered by the fetch that already existed
type: decision
status: current
tags: [supabase, realtime, rls, security, state, architecture]
sources: [ai/tasks/8-realtime/implementation-log-step-1.md, ai/tasks/9-deletion/implementation-log-step-1.md, ai/tasks/11-pagination/implementation-log-step-3.md, ai/suggestions/realtime-sync.md, supabase/migrations/20260909000000_realtime.sql, src/lib/listsChannel.ts, src/state/ListsContext.tsx, src/state/useHydration.ts]
last_verified: 2026-09-13
verify: grep -q "realtime.topic() = 'user:' || (select auth.uid())::text" supabase/migrations/20260909000000_realtime.sql && test "$(grep -c 'create policy' supabase/migrations/20260909000000_realtime.sql)" = 1 && grep -q 'from public.list_members m where m.list_id = target_list' supabase/migrations/20260909000000_realtime.sql && grep -q '^  after update on public.lists$' supabase/migrations/20260909000000_realtime.sql && ! grep -rq "'postgres_changes'" src && grep -q '{ config: { private: true } }' src/lib/listsChannel.ts && grep -q "'broadcast', { event: 'list/changed' }" src/lib/listsChannel.ts && grep -q "onChange(typeof listId === 'string' ? listId : undefined);" src/lib/listsChannel.ts && grep -q 'return subscribeToChanges(userId, refreshSoon, refreshSoon);' src/state/ListsContext.tsx
related: [first-fetch-replaces-list-state, writes-retry-from-an-outbox, read-rooted-at-list-members, list-data-scoped-by-rls, server-stamps-done-at, supabase-client-module-boundary, deletion-is-a-tombstone, supabase-local-stack, scope-boundaries]
---

Step 8 made a change by one member reach every other member in about a second, with neither app
backgrounded. **The database fans a *nudge* out to each member's private inbox topic; the client
answers a nudge with the fetch it already had.** There is no new way for data to enter the app.

| piece | where |
|---|---|
| receive policy, `notify_list_members`, three triggers | [supabase/migrations/20260909000000_realtime.sql](../../../supabase/migrations/20260909000000_realtime.sql) |
| `subscribeToChanges(userId, onChange, onResubscribe)` | [src/lib/listsChannel.ts](../../../src/lib/listsChannel.ts) |
| `refreshSoon` (300 ms trailing debounce), `dirty` | [src/state/useHydration.ts](../../../src/state/useHydration.ts) |
| the subscription effect | [src/state/ListsContext.tsx](../../../src/state/ListsContext.tsx) |

**Decision 1: one topic per *user* (`user:<uid>`), not per list, and not Postgres Changes.** The
measurement that settles it: **channel authorization is evaluated once, at join, and cached for the
life of the connection** — a client with no membership is refused with `CHANNEL_ERROR` at join rather
than merely receiving nothing. So any topic whose audience can change mid-connection leaks: `list:<id>`
would keep delivering to somebody whose access was revoked until they happened to reconnect, and could
say nothing about a list you were *just* given access to, because you are not on its topic and do not
know it exists. With a per-user topic the **sender** picks the audience per write, so a revoke takes
effect on the same live socket, with no reconnect and no cache to invalidate. The receive policy
touches no table at all, which is what keeps joining flat as an account grows. Postgres Changes was
rejected outright: it makes Realtime evaluate the `lists`/`items` RLS policies per subscriber per
changed row — the per-row cost [read-rooted-at-list-members](read-rooted-at-list-members.md) spent a
migration avoiding, moved onto the write path — and its filters are one `eq`, so twenty lists would
need twenty subscriptions.

**`realtime.messages` has RLS enabled and, until this migration, zero policies.** That means no
authenticated client could receive anything on a private channel. The receive policy is not plumbing
around the feature, it *is* the switch. There is no insert policy and there must not be: clients never
broadcast, the database does. `private: true` on the client channel is what makes the server evaluate
the policy at all — without it the topic is a public room.

**Decision 2: the message is a nudge, and decoding one field of it is not "enriching" it.** The
payload is `{listId, source, op}`. Since step 11-3 the client decodes `listId` — used only to pick
*which list to re-read*, via `refreshSoon(listId)` — and still discards `source`/`op` entirely; a
missing or unparseable `listId` (a malformed payload, or `onResubscribe`, which can never know what it
missed) falls back to re-reading everything, exactly as every nudge did before this existed. `listId`
is never dispatched to the reducer and never trusted as the *value* of anything — it selects an input
to a fetch, not a fact about state. Four reasons the payload otherwise stays this thin, of which the
first two would be enough: [replay](../../../src/state/replay.ts) stays the one place that knows how
server truth and pending writes combine; a dropped message costs staleness where a mis-applied delta
would cost divergence; `done_at` arrives correct because it is read rather than serialised by a trigger
([server-stamps-done-at](server-stamps-done-at.md)); and the receive policy is **topic-only**, so
whatever is in a payload reaches everyone on that topic with no row-level check — a value used only to
choose what to re-fetch is safe under that policy precisely because the fetch itself is still
RLS-checked; a value trusted as the truth would not be. Do not add a field whose contents the client
would trust rather than merely re-read.

**Delivery is at-most-once, measured.** Anything sent while a socket was down is gone: no queue, no
ack, no redelivery (Realtime decodes `realtime.messages` through a *temporary* replication slot that
dies with its connection). Hence two callbacks rather than one — `onResubscribe` fires on every
`SUBSCRIBED`, reconnects included, and a re-read is the repair; it never carries a list id, since it
cannot know what it missed. `broadcast: { replay: { since, limit } }` exists and works, but redelivers
duplicates and is bounded by a limit and by three days of retention; one fetch is unbounded and already
written. **`realtime.send` also swallows its own failures**, so a nudge that cannot be written never
aborts the user's write — one more reason a message is a hint, never the thing that makes a change
real.

**Realtime is an optimisation over a path that already works, and the foreground re-fetch stays exactly
as it was.** A socket that never connects costs latency, not correctness. Do not delete the
`AppState`/`visibilitychange` effect as now-redundant
([first-fetch-replaces-list-state](first-fetch-replaces-list-state.md)); it is the belt to this
feature's braces, and it closes gaps this cannot.

**Three details in the migration that look tidyable and are not.**

- **`after update on public.lists`, never `after insert or update`.** Trigger name order would run
  `notify_on_list_create` before `on_list_created`, and at that instant the creator has no
  `list_members` row yet — creation is covered one table over, by the membership trigger.
- **The `delete` arm on `list_members` and its `departed` variable** are the un-share notification: the
  membership read cannot find someone who has just stopped being a member, and they are exactly the
  person still looking at the list.
- **The fan-out's `where list_id = ?` wants `list_members`'s primary key** `(list_id, user_id)`, not the
  `(user_id, created_at)` index the read path was built around.

**Deletion needed no migration or client change at all — measured.** A soft delete is an `UPDATE`
([deletion-is-a-tombstone](deletion-is-a-tombstone.md)), the item/list-rename triggers already fire on
update, and `list_members` rows survive a soft delete, so the fan-out finds everyone normally. One
artifact to recognise rather than debug: the nightly purge hard-deletes lists, whose cascade to
`list_members` fires the `departed` arm, so members are nudged at 03:30 about a row they cannot see for
a list that left their fetch 30 days ago — harmless, since delivery is at-most-once and sockets are
almost certainly down.

**What it does not solve.** Last-write-wins is unchanged — realtime makes it *visible*, not different.
One gap survives by design: socket up, a single message dropped in flight, nothing else changes that
list, app never backgrounded — the screen stays stale until a resubscribe or foreground. Echo
suppression and a "just updated" affordance were offered and declined; your own write nudges you back
in ~30 ms and that echo is the cheapest correct way to pick up server-stamped values.

**Schema-level proof on cloud, not delivery proof.** The migration was pushed and confirmed on
2026-09-10 (`npx supabase db dump --linked -s realtime` shows the receive policy; the `public` dump
shows the triggers — read back directly, not inferred from the push exiting 0, see
[supabase-local-stack](supabase-local-stack.md)). No client has connected to the cloud project's
realtime socket and no two-device run has happened; the ~1s latency figure above is a local-stack
measurement only. Do not read the cloud push as "realtime works on cloud" — read it as "nothing in the
schema is left to stop it".

**If you re-run the security probe, tag every message with its recipient.** A probe whose subjects
share one collector cannot answer "who received this" — the writer's own echo will count as a message
a removed member received, and the check will "fail" on a false positive.

The `verify:` command asserts the shape: the receive policy is still the topic-only predicate, there is
still exactly **one** policy on `realtime.messages`, the fan-out still reads membership at write time,
the `lists` trigger is still update-only, no `.on('postgres_changes', …)` subscription exists anywhere
in `src`, the channel is still `private`, the broadcast handler still decodes `listId` the same way,
and both callbacks still land on `refreshSoon`.
