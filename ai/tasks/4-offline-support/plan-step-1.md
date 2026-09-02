# Plan — step 1: changes survive being made offline

**Requirement** ([description-step-1.md](description-step-1.md)): *the changes made to the lists
(adding items, marking items as done) should be guaranteed to be eventually persisted in database.*

Read as: a write made with no signal, on a dying battery, or against a 500 must land in Postgres
without the user doing anything about it — including across an app restart. Reading the lists
offline is in scope too (decided with the user): without it a cold start with no signal shows an
empty app, and the scenario the queue exists for — ticking items off in a shop with no bars — never
happens.

## What breaks the guarantee today

[ListsContext.tsx](../../../src/state/ListsContext.tsx) fires each request exactly once. On failure
it sets `error` and re-fetches, so the user's change is not retried — it is *erased*, because
`lists/loaded` replaces the whole array
([first-fetch-replaces-list-state](../../kb/entries/first-fetch-replaces-list-state.md)).

| Gap | Consequence |
|---|---|
| No retry | one attempt, then the write is abandoned |
| No durability | a reload loses anything in flight; only the auth session is on disk |
| Rollback is a re-fetch | the failure path actively deletes the optimistic row |
| No read cache | a cold start offline shows "No lists yet" — a false claim about the database |

Note that supabase-js does not paper over this: `postgrest-js` 2.112.4 retries `GET`, `HEAD` and
`OPTIONS` only, so every insert and every `set_item_done` RPC gets exactly one attempt.

**Two properties already in place make the fix small**, and both were built for this
([optimistic-list-writes](../../kb/entries/optimistic-list-writes.md)): ids are minted on the client
before the row exists, and writes carry absolute values rather than flips. Every write is therefore
already idempotent. The missing piece is only *keep replaying it until it lands*.

## Shape

Two pieces of local state on disk, both per user, both plain modules under `src/lib/`:

- **the outbox** — a FIFO of writes that have not been acknowledged. It is the guarantee.
- **the list cache** — the last `fetchLists` result, i.e. server truth as of the last successful
  read. It is what makes the app usable offline.

They meet in one pure function, `replay`, which folds the outbox over a set of lists using the
existing reducer. Everything the user sees is `replay(server truth, unsent writes)`.

```
createList / addItem / toggleItem
   ├─ dispatch                      (unchanged — instant, optimistic)
   └─ enqueue → persist → kick flush

flush (one at a time, in order)
   ├─ ok / duplicate key   → dequeue, persist, continue
   ├─ retryable            → stop; backoff timer; retry
   └─ permanent            → dequeue (+ dependents), set error, re-fetch

hydrate (mount)
   ├─ cache hit  → dispatch replay(cache, outbox); status 'ready'
   └─ fetch      → ok: write cache, dispatch replay(fetched, outbox)
                   fail: keep what is on screen, no error banner
```

## Decisions

**A queued write *is* the action that was dispatched.** The outbox stores `Action` values —
`list/created`, `item/added`, `item/setDone` — not a second vocabulary of "operations". That buys
two things: `replay` can fold them straight through `listsReducer`, and there is exactly one place
that describes a write. `setItemDone`'s boolean is derived at send time (`action.doneAt !== null`),
so nothing new is stored. The `doneAt` on the action stays what it already is — a placeholder for
the optimistic row ([server-stamps-done-at](../../kb/entries/server-stamps-done-at.md)) — and
replaying it is harmless because nothing renders it.

**Strictly serial, head-of-line blocking.** `items.list_id` is a real foreign key, so an item insert
must never overtake the list insert it depends on. One request in flight; a retryable failure stops
the loop rather than skipping ahead. At this data volume concurrency buys nothing and costs the
ordering guarantee.

**Failures are classified in [listsApi.ts](../../../src/lib/listsApi.ts)**, which is already "the
only place that knows the database's names" — knowing PostgREST's error shapes is the same job.
`Result` grows a verdict:

```ts
export type Result = { error: string | null; verdict: 'ok' | 'applied' | 'retryable' | 'permanent' };
```

Classify on `status` and `code`, never on the message text:

| Response | Verdict | Why |
|---|---|---|
| no error | `ok` | |
| `409` / code `23505` | `applied` | duplicate key — a retry of an insert that already landed. This is what client-minted ids buy |
| `status === 0` | `retryable` | postgrest-js reports a fetch failure this way (`code: ''`, `message: 'TypeError: …'`) — this is "offline" |
| `status >= 500` | `retryable` | |
| `401`, code `PGRST301`/`PGRST303` | `retryable` | expired JWT; supabase-js refreshes and the next attempt succeeds |
| `403` / code `42501` | `permanent` | RLS refused it. Retrying cannot change that |
| other `4xx` (`23503`, `23514`, …) | `permanent` | constraint violations |
| **anything unrecognised** | `retryable` | |

The default direction is deliberate: retrying a doomed write costs a spin, dropping a write that
would have succeeded loses the user's data. `permanent` is a short allowlist, and nothing else joins
it without a reason.

**No attempt cap.** Only a `permanent` verdict removes an op. "Guaranteed to be eventually
persisted" is incompatible with giving up after N tries, and a cap would fire exactly in the case
the feature exists for — a long stretch with no signal.

**Backoff, and the triggers that cut it short.** Exponential with jitter, 1s → 30s cap. Cut straight
to a flush on: hydration finishing, `AppState` → `active` (native; the guard from
[supabase.ts](../../../src/lib/supabase.ts#L46-L51)), the web `online` event, and a new enqueue
*only when no backoff timer is already running* — otherwise typing five items offline hammers a dead
network five times. Foreground and `online` reset the attempt counter; an enqueue does not.

**No connectivity library.** A failed request is the signal, and it is the only one that cannot lie.
`expo-network`'s `useNetworkState()` does work in Expo Go and on web in SDK 54, but it would only
ever decorate the UI — it must never gate the flush, because "the OS says there is Wi-Fi" and "the
request will succeed" are different claims. Out of this step.

**Hydration replays the outbox rather than clobbering it.** In the provider, not the reducer:

```ts
const hydrated = pending.reduce((s, op) => listsReducer(s, op), { lists: fetched });
dispatch({ type: 'lists/loaded', lists: hydrated.lists });
```

Server truth wins for everything settled; unsent writes are re-applied on top, in dispatch order, so
a pending `item/added` still lands after the pending `list/created` it depends on. `lists/loaded`
stays a wholesale replace and the reducer stays pure — both KB `verify:` commands keep passing — and
the "roll back by re-fetching" story survives intact rather than being replaced: a permanently
failed op vanishes from the screen precisely because it is no longer in the outbox to replay.

**The cache holds server truth only, never the replayed view.** Cache what `fetchLists` returned,
before `replay`. Caching the replayed lists would double-apply on the next load: `list/created`
appends by id and the reducer does not dedupe, so the list would appear twice. One line of code, one
subtle corruption bug avoided.

**A retryable failure no longer re-fetches.** We are offline; the fetch fails too, and its failure
would overwrite nothing useful. Re-fetch only on `permanent`, where server truth is genuinely needed
to repair the screen.

**A permanent failure drops its dependents.** If `list/created` is refused, the queued `item/added`
rows for that list can only fail with `23503`. Drop them in the same pass (`dropDependents(listId)`)
so the user gets one error, not a burst of them.

**Coalesce `item/setDone` per item.** Enqueueing a toggle replaces any pending toggle for the same
item, in place. Absolute values make this exactly correct, and it turns "tapped the checkbox five
times on the train" into one request. Inserts are never coalesced — their ids are unique by
construction.

**The outbox is never silently discarded.** If the stored blob fails to parse or carries an unknown
`v`, move it aside to `outbox:<userId>:broken` and start empty, with the error surfaced. Data that
cannot be replayed is at least recoverable by hand.

**Disk writes go through one promise chain.** The in-memory array is the truth; every mutation
serialises the whole array and chains onto the previous write (`tail = tail.then(...)`), so two
rapid enqueues cannot interleave into a torn value. Persist *before* attempting the send, and again
after each dequeue.

**Sign-out clears the cache and keeps the outbox.** Today sign-out discards a user's lists with the
provider; leaving a readable copy on disk would quietly change that posture, so `signOut` calls
`clearCachedLists(userId)`. The outbox survives on purpose — those writes are the promise this step
makes, and they flush at that user's next sign-in. The residue is real and worth stating: unsent
item titles stay on the device after sign-out. There is no way to both keep the guarantee and not
keep the data.

## On disk

```
outbox:<userId>       { v: 1, ops: Action[] }
lists:<userId>        { v: 1, lists: List[], fetchedAt: string }
```

`AsyncStorage`, already a dependency (2.2.0) via the auth session. Per-user keys because the
provider is already keyed by user id in [App.tsx](../../../App.tsx#L28-L33), and because two
accounts on one device must not see each other's rows.

## Files

| File | Change |
|---|---|
| `src/lib/outbox.ts` | new — load, persist, enqueue (with coalescing), dequeue, `dropDependents`. Plain module, no React |
| `src/lib/listCache.ts` | new — `readCachedLists`, `writeCachedLists`, `clearCachedLists` |
| `src/state/replay.ts` | new — `replay(lists, ops)`, folding the reducer. Pure |
| [src/lib/listsApi.ts](../../../src/lib/listsApi.ts) | `Result` gains `verdict`; classify by `status` and `code` |
| [src/state/ListsContext.tsx](../../../src/state/ListsContext.tsx) | `write` becomes enqueue + flush loop; hydrate from cache then network; expose `pending` |
| [src/state/SessionContext.tsx](../../../src/state/SessionContext.tsx) | `signOut` clears the cached lists for that user |
| `src/components/SyncBanner.tsx` | new — the neutral "not saved yet" line |
| [ListsScreen](../../../src/screens/ListsScreen.tsx), [ListDetailScreen](../../../src/screens/ListDetailScreen.tsx) | render it beside the error banner |

**No migration.** The database is unchanged: `23505` handling is a client-side reading of the error
the existing `insert` already returns, and `set_item_done` is idempotent as written.

## What the screen says

`error` currently means "your change is lost". After this step most failures mean "not saved *yet*",
and conflating them would cry wolf every time a lift loses signal.

- `useLists()` exposes `pending: number` alongside `error`.
- `pending > 0` renders `SyncBanner` — muted, not red: *"1 change will sync when you're back
  online"* / *"N changes …"*. `colors.textMuted` and `colors.border` on `colors.surface`
  ([theme-tokens-only](../../kb/entries/theme-tokens-only.md)).
- [ErrorBanner](../../../src/components/ErrorBanner.tsx) is reserved for a `permanent` verdict — a
  genuinely dropped write — and its doc comment gets corrected accordingly.
- Both carry `accessibilityRole` and are asserted through labels, per
  [queries-go-through-a11y-labels](../../kb/entries/queries-go-through-a11y-labels.md).

`status: 'loading' | 'ready'` keeps its meaning and its gate: a cache hit reaches `'ready'` without
waiting for the network, and nothing writes before it.

## Walkthroughs

**Add an item with no signal.** Dispatch, row appears; op persisted; flush attempts, gets
`status: 0` → `retryable`; loop stops, timer set; `SyncBanner` shows 1. Kill the app. Reopen: cache
hydrates, `replay` puts the unsent item back on screen, flush attempts again. Signal returns →
`online`/foreground fires → insert succeeds → dequeue → banner disappears.

**Cold start in a shop, no signal.** Session restores from AsyncStorage (`getSession` is local);
cache hydrates the lists; `fetchLists` fails and is swallowed — no red banner, the screen already
holds the last known truth. Ticking items enqueues toggles that flush on the walk home.

**A write the server refuses.** `insertList` returns `42501` → `permanent`: dequeue it, drop its
queued items, set `error`, re-fetch. The list disappears from the screen because it is gone from
both server truth and the outbox — the existing rollback behaviour, unchanged.

## Tests

`src/lib/outbox.test.ts` — round-trips through the AsyncStorage jest mock
(`@react-native-async-storage/async-storage/jest/async-storage-mock`): FIFO order held, `setItemDone`
coalesced per item, inserts never coalesced, `dropDependents` removes a list's items, a broken blob
is moved aside rather than dropped.

`src/state/replay.test.ts` — pure: pending ops land on top of fetched lists; a settled op that is no
longer queued does not reappear; ordering across `list/created` → `item/added` holds.

`src/state/ListsContext.test.tsx` — extends the existing suite, same `jest.mock('../lib/listsApi')`
seam, plus a mocked outbox/cache. New cases: a retryable failure keeps the row on screen and queues
it; the flush sends it once and only once; a stored outbox flushes on mount; `applied` dequeues
silently with no error; `permanent` drops the op, surfaces the error and re-fetches; a cache hit
reaches `'ready'` without the network; a failed fetch after a cache hit shows no error banner.
Backoff under fake timers. RNTL 14 rules throughout — `await` render/fireEvent, `act` around
promises the provider is already waiting on
([rntl-14-api-changes](../../kb/entries/rntl-14-api-changes.md)).

Screen suites gain one assertion each: `SyncBanner` visible when `pending > 0`, absent at zero.

## Verification

`npm test` and `npm run typecheck` throughout, then `npm run web` against the local stack
(`npx supabase start`, [supabase-local-stack](../../kb/entries/supabase-local-stack.md)) driven with
Playwright MCP. Offline is simulated with the devtools network condition, or by stopping the stack:

1. Online: add a list and items; confirm rows in Studio.
2. Offline: add an item, tick two — banner counts, no red error.
3. Reload while offline — the lists are still there and the pending count survives.
4. Back online — the banner clears; Studio shows every row, each exactly once, `done_at` stamped by
   Postgres.
5. Sign out, sign back in — nothing was lost, nothing duplicated.

`npm run kb:audit` before the log.

## Hazards

- **`optimistic-list-writes`'s `verify:` asserts `ListsContext` is the only file calling
  `useReducer`.** `replay.ts` folds the reducer directly and the outbox is a plain module, so the
  check keeps passing — do not reach for a second `useReducer` for the queue.
- **`first-fetch-replaces-list-state`'s `verify:` asserts `lists/loaded` still assigns
  `action.lists` wholesale.** Replay happens in the provider, above the reducer, for exactly this
  reason. Do not turn hydration into a merge.
- **[scope-boundaries](../../kb/entries/scope-boundaries.md) currently forbids this work** — *"do
  not build a queue, a retry loop or a local cache speculatively"*. This description promotes it;
  the entry, `optimistic-list-writes`' "Still not solved: offline" section and `ErrorBanner`'s doc
  comment are all stale the moment this lands.
- Afterwards: `ai/tasks/4-offline-support/implementation-log-step-1.md`, then
  `/librarian deposit 4-offline-support`.

## Out of scope

Sharing, realtime, deletion, and conflict resolution beyond last-write-wins. No sync engine
(PowerSync is the answer if this ever needs real convergence, and it goes over the same Postgres).
No connectivity library. No "wait for sync" flow on sign-out — a confirm when `pending > 0` is worth
considering, but it is not this step.
