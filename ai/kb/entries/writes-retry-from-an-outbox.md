---
id: writes-retry-from-an-outbox
title: Every write is queued on disk and retried until the database acknowledges it
type: decision
status: current
tags: [state, persistence, offline, supabase, architecture]
sources: [ai/tasks/4-offline-support/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-2.md, ai/tasks/8-realtime/implementation-log-step-1.md, ai/tasks/9-deletion/implementation-log-step-1.md, ai/tasks/10-rename-item/implementation-log-step-1.md, src/state/ListsContext.tsx, src/lib/outbox.ts, src/lib/listsApi.ts]
last_verified: 2026-09-11
verify: test "$(grep -rl 'useReducer(' src --include='*.ts' --include='*.tsx')" = src/state/ListsContext.tsx && test "$(grep -c 'dispatch(op);' src/state/ListsContext.tsx)" = "$(grep -c 'void enqueueOp(op);' src/state/ListsContext.tsx)" && grep -q "verdict === 'retryable'" src/state/ListsContext.tsx && grep -q "verdict === 'permanent'" src/state/ListsContext.tsx && grep -q "code === 'P0002'" src/lib/listsApi.ts && ! grep -qE 'attempt[A-Za-z._]* *>=? *[0-9A-Z_]' src/state/ListsContext.tsx && ! grep -rqiE 'expo-network|netinfo' src package.json && ! grep -qiE "removed'" src/state/types.ts && ! grep -q 'state.lists.filter' src/state/listsReducer.ts && test "$(grep -c '^  | { type:' src/state/types.ts)" = 8
related: [list-cache-holds-acknowledged-rows, optimistic-list-writes, first-fetch-replaces-list-state, server-stamps-done-at, refused-writes-return-zero-rows, ids-minted-outside-reducer, update-list-identity-preserving, supabase-client-module-boundary, realtime-is-a-nudge-to-a-per-user-inbox, writes-can-land-on-a-tombstone, deletion-is-a-tombstone, scope-boundaries]
---

Every reducer-owned write dispatches first — the row is on screen before any request — and is then
written to an outbox on disk (`outbox:<userId>`, [src/lib/outbox.ts](../../../src/lib/outbox.ts))
*before* the request goes out. A serial flush loop in [ListsContext](../../../src/state/ListsContext.tsx)
keeps sending it until the database takes it: across backgrounding, a restart, days with no signal
([optimistic-list-writes](optimistic-list-writes.md) is the "fire once, re-fetch on failure" this replaced).

**Decision: only a refusal removes a write.** [listsApi](../../../src/lib/listsApi.ts) classifies
every response into a `verdict` — `ok`; `applied` (`23505`, this client's own insert catching up with
itself, which is what minting ids up front buys); `retryable` (status 0 = a failed fetch, 5xx, 401);
`permanent` (403/4xx). Anything unrecognised is `retryable`, deliberately: a doomed retry costs a
spin, a dropped write costs the user their data. Only a `permanent` verdict re-fetches; a retryable
failure must **not** — offline, the fetch fails too, and the repair would take the failed write's row
off the screen. A refused write vanishes: gone from database and outbox both, nothing replays it.

**The SQLSTATE beats the status, and two rules do it.** `23505` is one; `P0002` is the other:
PostgREST answers it with **500** — measured — and a 500 otherwise means "send it again", but the
sharing RPCs raise it for "no account with that email yet", a typo that will never succeed. When
adding an RPC that raises, check what HTTP status PostgREST gives its SQLSTATE first. **There is no
attempt cap** — "eventually persisted" is incompatible with giving up after N tries, and a cap would
fire in exactly the case the feature exists for. Backoff is 1s doubling to a 30s ceiling, cut short
by the web `online` event or `AppState` going `active`.

**The queue holds reducer actions, not a second vocabulary for "a write".** `WriteAction` in
[src/state/types.ts](../../../src/state/types.ts) is `Action` minus `lists/loaded` — seven writes,
two of them renames since step 10 — which is what lets [replay](../../../src/state/replay.ts) fold
pending ops back over fetched rows with the reducer itself. Every one carries an **absolute value**,
never a flip or an inverse, so a retry or a coalesced duplicate is exactly correct
([update-list-identity-preserving](update-list-identity-preserving.md)): `enqueue` replaces a queued
write with a newer one for the same target, so bin/restore/bin, or three renames, while offline is
one request. Nothing *removes* anything from `state.lists` — deletion is an absolute `deletedAt`,
and there is no `list/removed` or `item/removed`. The boolean `set_item_done` takes is derived at
send time from `doneAt !== null`, not stored ([server-stamps-done-at](server-stamps-done-at.md)).

**Adding a write is a new action plus a case in `send()`, and the type errors enumerate the rest.**
`listIdOf`, `itemIdOf`, `send()` and `dropDependents`'s "strands nothing" arm are exhaustive
switches, so let the compiler point at them. Two things in `outbox.ts` do **not** defend themselves
and must be edited by hand — steps 7 and 10 both did, and each has a test naming the trap:
`supersedes` ends in `default: return false`, so a new absolute-valued write silently stops
coalescing; and `dropDependents`'s `item/added` arm is a filter predicate rather than a `switch`, so
it silently keeps a new item action that a refused insert should have stranded. **`outbox.ts`'s
`VERSION` stays `1`**: a bump throws away unsent writes and buys nothing, because a v1 blob can only
hold actions that are still valid ([list-cache-holds-acknowledged-rows](list-cache-holds-acknowledged-rows.md)
has the asymmetry with the cache's version). `queueFirst`, the one exception to appending, puts a
restore in front of the write it unblocks ([writes-can-land-on-a-tombstone](writes-can-land-on-a-tombstone.md)
holds that, and the third answer a write can get, neither `ok` nor a refusal).

**Membership writes deliberately do *not* go through any of this.** `shareList`, `setMemberRole` and
`removeMember` are called straight from `SharingScreen`, which holds its roster in `useState`. Four
reasons, the first sufficient alone: `share_list` resolves the email **server-side**, so "no account
with that email yet" must be answered while the user is looking at the field — queued, it arrives an
hour later as an error about a stranger; the reducer models no members, so there is nothing to show
optimistically and nothing for `replay` to preserve; the roster is an uncached RPC, so that screen is
the app's one online-only screen regardless; and a `member/removed` action would trip this entry's
own `verify:`, correctly. The boundary is "a write the reducer describes", not "any request" — do
not widen the outbox to a screen whose state it cannot replay.

**Serial, and never overlapping a fetch.** `items.list_id` is a foreign key, so an item insert must
not overtake the list insert it depends on: one request in flight, and a retryable failure stops the
loop rather than skipping ahead. A `fetching` ref keeps the loop and `refresh` apart — overlapped, a
write that completed during a fetch would be missing from both the response and the queue, and its
row would vanish. Two smaller properties are load-bearing for the same reason and easy to "simplify"
away: the loop dequeues **by identity** (`filter(c => c !== op)`), because a toggle coalesced into
the head while that head was in flight is a newer write that `shift()` would drop unsent; and a
permanent failure drops its dependents (`dropDependents`) so one refusal is one error rather than a
burst of foreign-key complaints.

**Per account, on a shared disk.** The provider is mounted only while signed in and takes `userId`
as a **prop** — outbox and cache keys are per account, and one device holds an `outbox:<uid>` for
every account that ever signed in on it, so a probe that reads "the" outbox has to name the account.
Do not reach for `useSession()` inside `ListsContext` for the id: that drags a `SessionProvider` and
an auth mock into every list suite.

**What to do, and what not to.**

- Do not add a connectivity library. `expo-network` works in Expo Go and on web, but "the OS says
  there is Wi-Fi" and "the request will succeed" are different claims, and only a failed request
  cannot lie. It could decorate the UI; it must never gate the flush.
- Do not cap attempts, and do not add a compensating action per write. Both were considered.
- Do not clear the outbox on sign-out. `signOut` clears the cached rows only; unsent writes flush at
  that account's next sign-in. The residue is deliberate: keeping the promise means keeping the data.
- New AsyncStorage writes go through `inOrder` in [storageQueue](../../../src/lib/storageQueue.ts):
  the outbox is serialised whole on every change, and two racing writes tear it — a lost row.
- `SyncBanner` (muted, `pending > 0`) means *not saved yet*; the red `ErrorBanner` is reserved for
  a `permanent` verdict. Crying wolf every time a lift loses signal is what the split prevents.
- **Do not drop a queued write because a fetch says you may no longer make it.** A `role` in a fetch
  is a snapshot that can be seconds old and move in both directions; the database is the authority
  and answers with a status the outbox already classifies. Being removed from a list is the same
  shape: the list leaves the fetch, `replay` drops those ops from the *view*, and they still flush
  and earn one honest refusal. Realtime made this common and changed nothing else here
  ([realtime-is-a-nudge-to-a-per-user-inbox](realtime-is-a-nudge-to-a-per-user-inbox.md)).

**Any new write path must fail loudly or not at all.** Since sharing, a refusal is a normal thing
that happens to an honest user, and the loop rests on it coming back as one. An RPC that reported a
refusal as success would have the outbox drop a write it never delivered, which is why
`set_item_done` raises ([server-stamps-done-at](server-stamps-done-at.md)); a plain `PATCH` or
`DELETE` filtered to zero rows answers `204` with no error and reads as success unless it asked for
the row back ([refused-writes-return-zero-rows](refused-writes-return-zero-rows.md)). `writeResult`
rewrites `42501` and `23514` into sentences for these seven writes only, because their failure
reaches the banner minutes or days after the tap; the membership RPCs keep the raw message.

**Still not solved:** conflict resolution beyond last-write-wins, no happens-before, no sync engine
(PowerSync if this ever needs real convergence), no warning when signing out with writes pending.

The `verify:` command asserts shape, not plumbing: one `useReducer` caller; dispatch and enqueue
counts equal (**a write that skips the outbox fails**); both verdict branches; the `P0002` rule; no
attempt cap (a heuristic); no connectivity library; no `…/removed` action (case-insensitive — a
case-sensitive grep once let `'item/setDeleted'` past); no `state.lists.filter` in the reducer; and
exactly **eight** `Action` members, so the next write cannot be added without revisiting this entry.
