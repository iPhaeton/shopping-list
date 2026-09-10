# Suggestion — realtime: a change reaches every member as it happens

**Status:** proposal, not an approved step. Adopting it needs an
`ai/tasks/<n>/description-step-<n>.md` first, and it moves
[scope-boundaries](../kb/entries/scope-boundaries.md), which currently lists realtime as out.

**Date:** 2026-09-09

## Where this starts

Propagation today is a poll disguised as an event. `ListsContext` re-fetches when the app comes to
the front — `AppState` going `active`, `visibilitychange` and `online` on web — and `SharingScreen`
re-fetches after a membership change. Nothing else. Two people with the app open in front of them see
each other's edits only when one of them backgrounds the app and comes back
([first-fetch-replaces-list-state](../kb/entries/first-fetch-replaces-list-state.md)).

Everything else the feature needs already exists and does not change:

1. **The merge is written and tested.** [replay](../../src/state/replay.ts) folds the outbox back
   over fetched rows with the reducer itself. "Server truth with pending writes on top" is already
   the definition of what is on screen.
2. **The fetch is one round trip and cheap** — ~20 ms end to end, rooted at `list_members`
   ([read-rooted-at-list-members](../kb/entries/read-rooted-at-list-members.md)).
3. **Membership is the only access path.** That is rule 1 of the sharing schema, and it is what makes
   "who must be told" a primary-key lookup rather than a design problem.

So this document is mostly about *when to call `refresh()`*, and about the one question that has no
existing answer: what a pending local write means once somebody else's change arrives.

## Measurements, taken before designing anything

Run against the local stack on 2026-09-09: three throwaway accounts through the admin API, one
temporary RLS policy on `realtime.messages`, one temporary fan-out trigger, driven by a Node script
using the project's own `@supabase/supabase-js` 2.112.4. All scaffolding, accounts, lists and
broadcast rows were dropped afterwards; the stack was left exactly as it was found (the two
pre-existing test accounts and `bob list`, untouched).

### 1. What the stack already has

| | |
|---|---|
| `realtime.send(jsonb, text, text, boolean)` | exists, `security invoker` — payload, event, topic, private |
| `realtime.broadcast_changes(text, text, text, text, text, record, record, text)` | exists (packages OLD/NEW into the message; **not** what this proposes) |
| `realtime.topic()` | exists — the topic the client is joining, for use in a policy |
| `realtime.messages` | daily-partitioned, RLS **enabled**, and **zero policies exist today** |
| `[realtime] enabled = true` in `supabase/config.toml` | already on, local and (by inheritance) production |
| supabase-js 2.112.4 | calls `realtime.setAuth` itself on `SIGNED_IN` / `TOKEN_REFRESHED` / `SIGNED_OUT` |

The zero-policies row is the load-bearing one: with RLS on and no policy, **no authenticated client
can receive anything on a private channel**. The first migration of this feature is therefore not
optional plumbing — it is the whole switch.

### 2. The probe

| what was done | what happened |
|---|---|
| carol (not a member of anything) joins topic `user:<bob>` | refused **at join**: `CHANNEL_ERROR: Unauthorized: You do not have permissions to …` |
| alice shares a list with bob; bob is subscribed to `user:<bob>` | message delivered in **14 ms** |
| bob adds an item; alice is subscribed to `user:<alice>` | message delivered in **30 ms** |
| the writer's own inbox | also receives it — a write echoes back to its author |
| bob is removed, alice writes again, bob's socket still `joined` | bob receives **0** — the fan-out reads `list_members` at write time |
| 200 item inserts, 3 members, warm | **53–64 ms** with the trigger vs **11–15 ms** without → ≈ **0.08 ms per member per change** |
| `global: { headers: { 'x-client-id': … } }` on `createClient` | readable in Postgres as `current_setting('request.headers', true)::json->>'x-client-id'` |

### 3. Delivery is at-most-once, measured

A subscriber was disconnected, a message was sent while it was down, and it reconnected:

| | |
|---|---|
| sent while joined | received |
| sent while the socket was down, then a plain reconnect | **never received** — no queue, no ack, no redelivery |
| the same, reconnecting with `broadcast: { replay: { since, limit } }` | received, **along with the message it had already seen** |

So a broadcast reaches whoever is joined at that instant and nobody else. `replay` is a real opt-in
escape hatch — the rows are in `realtime.messages` for three days — but it redelivers duplicates and
is bounded by a limit and by that retention. A single fetch is unbounded, always current, and already
written. That is the argument for §3's refresh-on-resubscribe over adopting `replay`.

Worth knowing alongside it: **`realtime.send` swallows its own failures.** Its body wraps the insert
in `exception when others then raise warning`, so a broadcast that cannot be written does not abort
the user's write. The failure direction is right, and it is one more reason the client must never
treat a message as the thing that makes a change real.

**And there is no queue anywhere in the delivery path — measured.** Realtime picks messages up by
logical decoding: `realtime.send` inserts into `realtime.messages`, and Realtime streams the
`supabase_realtime_messages_publication` publication through a slot named
`supabase_realtime_messages_replication_slot_`, created lazily when the first client connects. That
slot is **temporary** (`pg_replication_slots.temporary = t`), so it dies with Realtime's connection
and retains no WAL after it. Stopping the Realtime container, writing 5,000 messages, and starting it
again produced a fresh slot positioned 262 kB *past* those records: they were never decoded and never
will be. The rows stay in the table for their three days, but nothing drains them — they are only
re-read if a client explicitly asks for `replay`. Every leg of the path is best-effort from the
moment of commit, which is the reason the design's only guarantee lives in the outbox and the fetch.

Two of the rows in §2 decide the design on their own. The refusal is *at join*, which means channel
authorization is evaluated once per connection and cached for its lifetime — so a topic whose
audience can change during a connection is a leak waiting to happen. And the removed member receiving
nothing shows the alternative: when the *sender* decides the audience per write, revocation takes
effect on the same live socket, with no reconnect and no cache to invalidate.

## The design, in one line

**The database fans a nudge out to each member's private inbox topic; the client answers a nudge with
the fetch it already has.**

### 1. One topic per user, not per list — and not Postgres Changes

Three options were considered.

**Postgres Changes** (`.on('postgres_changes', …)`) makes Realtime evaluate the table's RLS policies
per subscriber per changed row. That is the cost model
[read-rooted-at-list-members](../kb/entries/read-rooted-at-list-members.md) spent a whole migration
avoiding, re-introduced on the write path; and its filters are a single `eq` on one column, so a
client in twenty lists needs twenty subscriptions or a table-wide one. Rejected.

**A topic per list** (`list:<id>`) needs one channel per list, cannot tell you about a list you have
just been given access to (you are not on its topic yet, and you do not know it exists), and — per
the measurement above — keeps delivering to someone whose access was revoked until they happen to
reconnect. Rejected.

**A topic per user** (`user:<uid>`) is one channel per client for the life of the session. The
receive policy touches no table at all:

```sql
create policy "receive your own inbox" on realtime.messages
  for select to authenticated
  using (extension = 'broadcast' and realtime.topic() = 'user:' || (select auth.uid())::text);
```

No `select` policy for sending: clients never broadcast, the database does. Note this is the same
`(select auth.uid())` InitPlan form the rest of the schema uses, and that a topic-only predicate is
why joining stays flat as the account grows.

The fan-out is a trigger. It is `security definer` for both of the reasons `list_members_of` is
([select-policy-gates-update-and-delete](../kb/entries/select-policy-gates-update-and-delete.md)): it
must read *other people's* membership rows, and `authenticated` has no insert on `realtime.messages`.

```sql
create function public.notify_list_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_list uuid;
  departed uuid;
  member uuid;
begin
  case tg_table_name
    when 'lists' then target_list := new.id;
    else target_list := coalesce(new.list_id, old.list_id);
  end case;

  -- The one person the read below cannot find: someone who has just stopped being a member, and
  -- who is still looking at the list. They have to be told once, and never again.
  if tg_table_name = 'list_members' and tg_op = 'DELETE' then departed := old.user_id; end if;

  for member in
    select m.user_id from public.list_members m where m.list_id = target_list
    union
    select departed where departed is not null
  loop
    perform realtime.send(
      jsonb_build_object('listId', target_list, 'source', tg_table_name, 'op', tg_op),
      'list/changed',
      'user:' || member::text,
      true
    );
  end loop;

  return null;
end;
$$;

create trigger notify_on_item_change
  after insert or update on public.items
  for each row execute function public.notify_list_members();

create trigger notify_on_list_rename
  after update on public.lists
  for each row execute function public.notify_list_members();

create trigger notify_on_membership_change
  after insert or update or delete on public.list_members
  for each row execute function public.notify_list_members();
```

Four things in there are deliberate and easy to get wrong:

- **`after update on lists`, not `after insert or update`.** At the instant a `lists` AFTER INSERT
  trigger runs, the creator's membership row may not exist yet — `on_list_created` is also an AFTER
  INSERT trigger and Postgres fires same-timing triggers in **name order**, so the fan-out would
  find nobody. Creation is covered anyway: `on_list_created` inserts into `list_members`, which
  fires the membership trigger.
- **`update` on `items` covers checking an item off.** `set_item_done` is a definer function that
  `UPDATE`s `items`, so the row trigger fires normally. Nothing extra is needed for toggles.
- **`delete` on `list_members` is the un-share notification**, and it is why `departed` exists at
  all. Without it, being removed from a list leaves the list on that person's screen until they next
  foreground the app.
- **The membership read is served by the primary key.** `list_members`'s PK is `(list_id, user_id)`,
  so `where list_id = ?` is a prefix scan. This is the one read in the system that wants the PK
  rather than the `(user_id, created_at)` index the read path was built around — worth knowing before
  anyone "tidies" either.

`realtime.send` is a plain insert into `realtime.messages`, so it is transactional: a write that
rolls back sends no nudge. (Inferred from it being an insert, not separately measured.)

### 2. The message is a nudge, not a delta

The payload carries `listId` and nothing about the change itself. The client answers by calling the
`refresh()` it already has. Five reasons, of which the first two would be enough:

1. **The merge already exists.** `replay(fetched, outbox)` is the only place that knows how server
   truth and pending writes combine. A delta stream would be a second description of "a write" in
   the client — precisely what the outbox avoided by queueing reducer actions rather than inventing
   a vocabulary ([writes-retry-from-an-outbox](../kb/entries/writes-retry-from-an-outbox.md)).
2. **A dropped message costs staleness; a mis-applied delta costs divergence.** Realtime stays an
   optimisation: if the socket never connects, the app behaves exactly as it does today. That
   property is worth more than the round trip it saves.
3. **Server-computed values arrive correct.** `done_at` is the database's clock
   ([server-stamps-done-at](../kb/entries/server-stamps-done-at.md)); a fetch brings the real one, a
   delta would carry whatever the trigger happened to serialise.
4. **A nudge cannot leak.** The receive policy is topic-only — whatever is in the payload reaches
   whoever is on that topic, with no row-level check. A list id its recipient already has is a
   strictly smaller blast radius than the row contents `realtime.broadcast_changes` would put on the
   wire if the fan-out's membership read were ever wrong.
5. It keeps the message stable. New columns, new tables and new write paths need no payload changes.

The cost is one extra `GET` per burst of remote activity, measured at ~20 ms.

### 3. What changes in the client

**The subscription belongs behind the module seam, not in the provider.** Only
[src/lib/supabase.ts](../../src/lib/supabase.ts) imports supabase-js
([supabase-client-module-boundary](../kb/entries/supabase-client-module-boundary.md)), so add one
function beside the queries — `src/lib/listsChannel.ts`, or `listsApi.ts` itself:

```ts
export function subscribeToChanges(
  userId: string,
  onChange: () => void,
  onResubscribe: () => void
): () => void;
```

Tests then mock one plain function and no websocket ever opens under jest.

In `ListsContext`, once `status === 'ready'`:

- `onChange` → `refreshSoon()`, a trailing debounce of ~300 ms that collapses a burst into one fetch.
- `onResubscribe` (fired on every `SUBSCRIBED`, **including reconnects**) → `refreshSoon()` as well.
  Delivery is at-most-once and measured to be so: anything sent while the socket was down is gone,
  and the refetch is the repair. `broadcast: { replay: { since, limit } }` does work, and is still
  the wrong trade — see §3.
- Nothing to do about tokens. supabase-js re-auths the socket on `TOKEN_REFRESHED` itself (measured
  in the installed bundle) — do not hand-roll it.
- **Keep the foreground `resume()` exactly as it is.** It is the belt to realtime's braces, and it is
  what makes a failed socket a latency problem rather than a correctness one.

**One existing line has to change, and it is the easiest thing in this document to miss.** `refresh`
early-returns while `flushing` or `retry` is set — the guard must stay, for the reason
[first-fetch-replaces-list-state](../kb/entries/first-fetch-replaces-list-state.md) spells out — so
today a nudge arriving during a flush or during backoff is **silently thrown away**. It has to be
remembered instead:

```ts
const owed = useRef(false);
// in refresh: if (flushing.current || retry.current) { owed.current = true; return; }
// at the end of the flush loop, and wherever resume() clears the backoff timer:
//   if (owed.current) { owed.current = false; void refresh(); }
```

Without it the app is stalest exactly when it is busiest: somebody else editing while your own write
is retrying.

## The other half: the outbox when a remote change arrives

**The rule is already written, and realtime does not change it.** Fetched rows are the base, the
outbox folds on top, and *only the database's own refusal removes a write*. A nudge is not a new kind
of event — it is one more reason to call the fetch that already knows what to do.

| what arrives | your unsent write | what happens, and why it is right |
|---|---|---|
| someone renames a list you have also renamed | `list/renamed` | the fetch brings their name; `replay` puts yours back on screen. When yours flushes it becomes everyone's. If theirs lands after yours, theirs wins. Last-write-wins **by arrival at the database**, not by device clock. |
| someone ticks an item you unticked | `item/setDone` | same shape. The value is absolute, so a retry or a coalesced toggle is still exactly correct; your screen shows your intent until the database has heard it. |
| someone adds items, or a list is shared with you | nothing pending | they simply appear — `lists/loaded` replaces wholesale and there is nothing to preserve. |
| your access is downgraded to `reader` | queued writes on that list | the fetch brings `role: 'reader'`, so the controls disappear; the queued ops stay queued and are dropped only when the database refuses them — 403 → `permanent` → banner → rollback. **Do not pre-emptively drop them.** |
| you are removed from the list | queued writes on that list | the list is gone from the fetch, so `replay`'s `updateList` drops those ops from the *view* silently (it already does this for a list it cannot place) and the row leaves the screen. The ops themselves still flush, and still get one honest refusal. |
| your own write, echoed back | still in the outbox | harmless: the refetch re-applies it via `replay`, and it is how the server's `done_at` reaches the screen. |

Three rules follow, and each of them is a thing that looks like an improvement and is not:

- **Do not apply remote changes to reducer state directly.** One merge, one place, above the reducer.
  Hydration must stay a wholesale replace.
- **Do not drop a queued write because a fetch says you may no longer make it.** The `role` in a
  fetch is a snapshot that can be seconds old and can move in both directions; the database is the
  authority and it answers with a status the outbox already classifies. Dropping locally would
  discard a write that might still be accepted, and "only a refusal removes a write" is the promise
  the whole offline design rests on.
- **Do not reach for conflict resolution.** Last-write-wins is the stated policy; realtime makes it
  *visible* rather than changing it. Both mutating writes carry absolute values, so repeated or
  reordered delivery converges. A checkbox that flips under someone's finger is the honest rendering
  of what happened, and the only thing worth adding — later, if at all — is not showing it mid-touch.

### The one new hazard

More fetches means more chances to fetch a row that is *also* still in the outbox, and `replay`
appends `item/added` and `list/created` without deduping by id — which is exactly why the cache never
stores the replayed view
([list-cache-holds-acknowledged-rows](../kb/entries/list-cache-holds-acknowledged-rows.md)). Today
this is unreachable because a fetch and a flush never overlap. That invariant stops being incidental
and becomes load-bearing at a much higher fetch rate. So:

- **Nudges go through `refresh` (guarded), never `hydrate` (unguarded).**
- Worth considering as hardening: make `list/created` and `item/added` idempotent by id — replace
  when present rather than append. It is pure, cheap, and makes `replay` idempotent. It does *not*
  license caching the replayed view; that rule's reason (the cache holds what the database
  acknowledged) is independent, and the KB entry should keep saying so.

### Self-echo

Your own write nudges you back, in ~30 ms. Recommendation: **leave it.** One extra fetch per burst,
and it is the cheapest correct way to pick up server-stamped values. If it ever proves noisy, the
escape hatch is measured and ready — put a per-launch `x-client-id` in `createClient`'s
`global.headers`, read it in the trigger from `request.headers`, and skip that one device. Note
*device*, not user: your other phone still has to be told.

## Staging

1. **Migration only.** The receive policy, `notify_list_members`, the three triggers. No client
   change; nothing in the app behaves differently. Verifiable with a two-account script of the kind
   described above (admin-API accounts, one subscribed socket, writes driven through PostgREST) — and
   it is worth re-running the removed-member check specifically, because that is the security
   property, not the feature.
2. **The client.** `subscribeToChanges`, `refreshSoon`, the `owed` refresh. This is the step a user
   can see. Verify in the browser with two profiles side by side
   ([supabase-local-stack](../kb/entries/supabase-local-stack.md)); in tests, drive the mocked
   subscription's callback wrapped in `act`, since it is an external update
   ([rntl-14-api-changes](../kb/entries/rntl-14-api-changes.md)).
3. **Optional hardening**, only if wanted: idempotent replay, echo suppression, a "just updated"
   affordance in `SyncBanner`.

## What this does not solve, and what was not measured

- **Deletion still does not exist**, so a nudge can never mean "gone". `set_item_done`'s "zero rows
  can only mean refused" reasoning survives untouched — and would have to be revisited *before* item
  deletion, not after.
- **No presence, no per-field conflict UI, no "who is editing".**
- **One delivery gap survives this design, and it is worth naming.** If the socket stays up but a
  single message is dropped in flight, nothing else changes that list afterwards, and the app is
  never backgrounded, the screen stays stale indefinitely. Every other gap is closed by a
  resubscribe or a foreground. If it ever matters, the cheap answer is a low-frequency backstop
  refresh while the app is in front (60 s or so) — not worth adding speculatively, and worth
  remembering before reaching for `replay`.
- **Cost at scale is a write per member per change** against the same database, physically stored
  (`realtime.messages`, three-day retention). 0.08 ms per member locally; the cloud project's
  concurrent-connection and message quotas are backlog item 4's subject, not this document's.
- **Not measured:** a token expiring on a long-lived channel; a physical device against the cloud
  project ([supabase-target-picked-at-runtime](../kb/entries/supabase-target-picked-at-runtime.md));
  the fan-out at a million lists; whether Realtime's own connection pool behaves under a hundred
  simultaneous members. The 14–30 ms figures are one machine, one Docker stack, one hop.

## If only three things survive from this document

1. **A per-user inbox topic, fanned out by a definer trigger that reads membership at write time** —
   because authorization on a channel is decided at join and cached, and this is the shape that does
   not care.
2. **The message is a nudge; the fetch is the mechanism.** Realtime is an optimisation over a code
   path that already works, never a second way for data to enter the app.
3. **A remote change never removes a local one.** Fetched rows are the base, the outbox folds on top,
   and only the database's refusal throws a write away.
