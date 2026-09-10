# Implementation log — step 1: realtime

**Date:** 2026-09-09. Description: [description-step-1.md](description-step-1.md). Source proposal:
[ai/suggestions/realtime-sync.md](../../suggestions/realtime-sync.md).

A change made by one member of a list now reaches every other member within a second, with neither
app being backgrounded. The mechanism is the suggestion's: **the database fans a nudge out to each
member's private inbox topic, and the client answers a nudge with the fetch it already had.** No new
way for data to enter the app, and the foreground re-fetch is untouched, so a socket that never
connects costs latency rather than correctness.

Scope was settled with the user before any code: the suggestion's staging steps 1 and 2, plus one
piece of its optional step 3 — idempotent replay. Echo suppression (`x-client-id`) and the
`SyncBanner` affordance were declined. Local stack only; `npx supabase db push` is left to the user.

## What was built

| File | |
|---|---|
| `supabase/migrations/20260909000000_realtime.sql` | new — the receive policy, `notify_list_members`, three triggers |
| `src/lib/listsChannel.ts` | new — `subscribeToChanges`, the whole client side of the socket |
| `src/lib/listsChannel.test.ts` | new |
| `src/state/ListsContext.tsx` | `refreshSoon` (debounce), `drainOwed`, the subscription effect, two refs |
| `src/state/listsReducer.ts` | `list/created` and `item/added` are idempotent by id |
| `src/state/replay.test.ts` | the duplication test inverted, two added |
| four suites | one `jest.mock('../lib/listsChannel', …)` each |

Untouched on purpose: `outbox`, `listCache`, `listsApi`, every screen, the navigator, `supabase.ts`,
and — most deliberately — the foreground `resume()` effect.

## Decisions

**A per-user inbox topic, not a per-list topic and not Postgres Changes.** Channel authorization is
evaluated **at join** and cached for the connection's lifetime; a stranger joining someone else's
topic is refused with `CHANNEL_ERROR`, not merely starved of messages. That makes any topic whose
audience can change mid-connection a leak waiting to happen. With one topic per user the *sender*
decides the audience per write, so a revoke takes effect on the same live socket. The receive policy
touches no table at all, so joining stays flat as an account grows.

**The message is a nudge.** Payload is `{listId, source, op}` and the client reads only that
something changed. `replay` remains the one place that knows how server truth and pending writes
combine; a dropped message costs staleness where a mis-applied delta would cost divergence; and
`done_at` arrives correct because it is read rather than serialised by a trigger.

**Two callbacks, not one.** `subscribeToChanges(userId, onChange, onResubscribe)` — a resubscribe is
a *repair*, not a change. Both are wired to `refreshSoon` today; the seam keeps them separable.

## Problems hit

### 1. The suggestion's `coalesce(new.list_id, old.list_id)` — flagged, then measured, then dropped

The plan asserted this would raise `record "new" is not assigned yet` on a DELETE and break every
un-share. **That was wrong, and testing it before shipping the claim is the only reason it did not
end up in a comment as fact.** On PostgreSQL 17 a row-level DELETE trigger reads `NEW` as null rather
than raising — verified with a throwaway trigger in a rolled-back transaction. The migration still
branches on `tg_op`, because there is no column all three tables share (`lists` names it `id`), but
the comment now says the true reason instead of the invented one.

### 2. `refresh`'s guard is pinned byte-for-byte by the KB audit

`first-fetch-replaces-list-state`'s `verify:` greps for
`if (flushing.current || retry.current) return;` within three lines of `const refresh = useCallback`.
The suggestion's design rewrote exactly that line into `{ owed.current = true; return; }`, which would
have turned `npm run kb:audit` red. The owing moved into `refreshSoon` instead, which is a better
placement anyway: `refresh` stays the documented guarded door and remembering a turned-away nudge is
realtime's business. `refresh` gained one line — `owed.current = false` — so a foreground re-read
settles the debt.

### 3. The same audit's `! grep -q 'replay' src/state/listsReducer.ts`

That clause asserts the merge lives above the reducer. Documenting the idempotency change in a
comment that *named* `replay` tripped it, even though the fact it protects was untouched. Reworded to
"folding the outbox back over fetched rows". Worth knowing before writing reducer comments.

### 4. The browser was talking to cloud, not local

`.env` carries `EXPO_PUBLIC_SUPABASE_TARGET=cloud`, so the first browser run hit the production
project (and failed at sign-in, because Resend's sandbox sender only delivers to the account owner).
`EXPO_PUBLIC_SUPABASE_TARGET=local` in the *shell* does not reach the bundle — Metro inlines
`EXPO_PUBLIC_*` from what `@expo/env` exports, and it skips a variable already in `process.env`. A
gitignored `.env.local` (higher precedence than `.env`) plus `--clear` was the working route; it was
deleted afterwards and `.env` was never touched.

### 5. The first security probe was measuring nothing

Both subscribers pushed into one array, so alice's own echo counted as a message bob received and the
removed-member check "failed". Tagging each message with its recipient made it pass. A probe whose
subjects share a collector cannot answer "who received this", which was the whole question.

## How it was verified

**Automated:** 158 tests across 12 suites, `tsc --noEmit`, and `npm run kb:audit` at 0 errors.

**Migration:** `npx supabase migration up` rather than `db reset`, so the two existing accounts and
`bob list` survived. All three triggers exercised in a rolled-back transaction first.

**The security property, scripted** (two accounts + one throwaway, real JWTs via the admin API):

| | |
|---|---|
| a stranger joins someone else's inbox topic | refused **at join** |
| alice writes, bob is subscribed | bob receives exactly 1 |
| the writer's own inbox | also receives — the echo is real |
| the payload | `listId` only; no row contents |
| bob is removed | told exactly once, via the `departed` branch |
| alice writes again, **bob's socket still `joined`** | bob receives **0** |

**End to end in the browser**, bob signed in through the real OTP flow against the local stack, alice
driven from Node so nothing touched the tab. Every case propagated with no interaction: an item
added, an item ticked (carrying the database's own `done_at`), the list renamed, a role change
(reader → writer: the read-only notice vanished and the Add bar appeared), an un-share (the open
screen became "List not found" and the row left the list screen), and a re-share (the list
reappeared).

**The at-most-once repair:** Realtime stopped, an item added, Realtime restarted. The count stayed
`2 of 3` while it was down — the message was genuinely lost, no queue — and became `2 of 4` on
resubscribe. The only console errors in the whole run were the expected 502/500 websocket handshakes
while the container was down.

**The stack was left exactly as it was found:** probe items deleted, the list renamed back, bob's
membership `created_at` restored to the recorded value (diffed identical), `realtime.messages`
emptied, the throwaway accounts deleted, `.env.local` removed.

## What this does not solve

Deletion still does not exist, so a nudge can never mean "gone", and `set_item_done`'s "zero rows can
only mean refused" reasoning survives untouched. No presence and no per-field conflict UI.
Last-write-wins is unchanged — realtime makes it *visible* rather than different. One delivery gap
survives by design: if the socket stays up, a single message is dropped in flight, nothing else
changes that list afterwards, and the app is never backgrounded, the screen stays stale. Every other
gap is closed by a resubscribe or a foreground.

Not verified here: the cloud project (the migration is local-only, and the policy is created on
`realtime.messages`, which `supabase_realtime_admin` owns — it works as `postgres` locally but was
not tested against cloud), a physical device, and behaviour at a scale beyond one Docker stack.
