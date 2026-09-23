---
id: writes-retry-from-an-outbox
title: Every write is queued on disk and retried until the database acknowledges it
type: decision
status: current
tags: [state, persistence, offline, supabase, architecture]
sources: [ai/tasks/4-offline-support/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-2.md, ai/tasks/8-realtime/implementation-log-step-1.md, ai/tasks/9-deletion/implementation-log-step-1.md, ai/tasks/10-rename-item/implementation-log-step-1.md, ai/tasks/11-pagination/implementation-log-step-1.md, ai/tasks/11-pagination/implementation-log-step-2.md, ai/tasks/15-session-revocation/implementation-log-step-2.md, ai/tasks/16-sync-banner-flicker/implementation-log-step-1.md, ai/tasks/18-share-by-name/implementation-log-step-1.md, src/state/ListsContext.tsx, src/state/useListWrites.ts, src/state/useOutbox.ts, src/state/sendWrite.ts, src/lib/outbox.ts, src/lib/listsApi.ts, src/lib/membersApi.ts, src/state/types.ts]
last_verified: 2026-09-22
verify: test "$(grep -rl 'useReducer(' src --include='*.ts' --include='*.tsx')" = src/state/ListsContext.tsx && test "$(cat src/state/ListsContext.tsx src/state/useListWrites.ts | grep -c 'dispatch(op);')" = "$(cat src/state/ListsContext.tsx src/state/useListWrites.ts | grep -c 'void enqueueOp(op);')" && grep -q "verdict === 'retryable'" src/state/useOutbox.ts && grep -q "verdict === 'permanent'" src/state/useOutbox.ts && grep -q "code === 'P0002'" src/lib/listsApi.ts && ! grep -qE 'attempt[A-Za-z._]* *>=? *[0-9A-Z_]' src/state/useOutbox.ts && ! grep -rqiE 'expo-network|netinfo' src package.json && ! grep -qiE "removed'" src/state/types.ts && ! grep -q 'state.lists.filter' src/state/listsReducer.ts && test "$(grep -cE "^ +(\| \{ )?type: '" src/state/types.ts)" = 10 && grep -q "{ type: 'lists/loaded' } | { type: 'items/pageLoaded' } | { type: 'items/firstPageLoaded' }" src/state/types.ts && test "$(grep -n 'if (sessionRevoked)' src/state/useOutbox.ts | head -1 | cut -d: -f1)" -lt "$(grep -n 'dropDependents(rest, op)' src/state/useOutbox.ts | head -1 | cut -d: -f1)"
related: [list-cache-holds-acknowledged-rows, optimistic-list-writes, first-fetch-replaces-list-state, server-stamps-done-at, refused-writes-return-zero-rows, ids-minted-outside-reducer, update-list-identity-preserving, supabase-client-module-boundary, realtime-is-a-nudge-to-a-per-user-inbox, writes-can-land-on-a-tombstone, deletion-is-a-tombstone, scope-boundaries, expo-crypto-undefined-under-jest, session-revoked-write-redirects, sync-banner-mount-is-unconditional]
---

Every reducer-owned write dispatches first — the row is on screen before any request — and is then
written to an outbox on disk (`outbox:<userId>`, [src/lib/outbox.ts](../../../src/lib/outbox.ts))
*before* the request goes out. A serial flush loop, now in [useOutbox.ts](../../../src/state/useOutbox.ts),
keeps sending it until the database takes it: across backgrounding, a restart, days with no signal
([optimistic-list-writes](optimistic-list-writes.md) is the fire-once design this replaced).

**Decision: only a refusal removes a write.** [listsApi](../../../src/lib/listsApi.ts) classifies
every response into a `verdict` — `ok`; `applied` (`23505`, this client's own insert catching up with
itself, which is what minting ids up front buys); `retryable` (status 0 = a failed fetch, 5xx, 401);
`permanent` (403/4xx). Anything unrecognised is `retryable`, deliberately: a doomed retry costs a
spin, a dropped write costs the user their data. Only a `permanent` verdict re-fetches; a retryable
failure must **not** — offline, the fetch fails too, and the repair would take the failed write's row
off the screen. A refused write vanishes: gone from database and outbox both, nothing replays it —
**except a `sessionRevoked` one**, intercepted in `useOutbox.flush` before this branch runs: the write
was never wrong, only the device's credentials were, so it stays queued and replays at the next
sign-in instead ([session-revoked-write-redirects](session-revoked-write-redirects.md)).

**The SQLSTATE beats the status, and two rules do it.** `23505` is one; `P0002` is the other:
PostgREST answers it with **500** — measured — and a 500 otherwise means "send it again", but
`share_list` raises it for a refusal that will never succeed on retry — since step 18, "that account
no longer exists" (a search-resolved id deleted before the tap on Share), where it used to be a typed
email with no matching account. When adding an RPC that raises, check what HTTP status PostgREST
gives its SQLSTATE first. **There is no
attempt cap** — "eventually persisted" is incompatible with giving up after N tries, and a cap would
fire in exactly the case the feature exists for. Backoff is 1s doubling to a 30s ceiling, cut short
by the web `online` event or `AppState` going `active`.

**The queue holds reducer actions, not a second vocabulary for "a write".** `WriteAction` in
[src/state/types.ts](../../../src/state/types.ts) is `Action` minus the three *reads*
(`lists/loaded`, `items/pageLoaded`, `items/firstPageLoaded`) — seven writes, two of them
renames — which is what lets [replay](../../../src/state/replay.ts) fold pending ops back over fetched
rows with the reducer itself; a page gets the same treatment by re-dispatch (`foldPage`). Every one
carries an **absolute value**, never a flip or an inverse, so a retry or a coalesced duplicate is
exactly correct ([update-list-identity-preserving](update-list-identity-preserving.md)): `enqueue`
replaces a queued write with a newer one for the same target, so bin/restore/bin, or three renames,
while offline is one request. Nothing *removes* anything from `state.lists` — deletion is an absolute
`deletedAt`, and there is no `list/removed` or `item/removed`. The boolean `set_item_done` takes is
derived at send time from `doneAt !== null`, not stored ([server-stamps-done-at](server-stamps-done-at.md)).

**Adding a write is a new action plus a case in `sendWrite()`, and the type errors enumerate the rest.** `listIdOf`, `itemIdOf`, `sendWrite()`
(`send()` renamed, now in [sendWrite.ts](../../../src/state/sendWrite.ts), alongside the seven action creators in [useListWrites.ts](../../../src/state/useListWrites.ts))
and `dropDependents`'s "strands nothing" arm are exhaustive switches, so let the compiler point at them. Two things in `outbox.ts` do **not** defend themselves and must be edited by hand, each with a test naming the trap:
`supersedes` ends in `default: return false`, so a new absolute-valued write silently stops
coalescing; and `dropDependents`'s `item/added` arm is a filter predicate rather than a `switch`, so
it silently keeps a new item action that a refused insert should have stranded. **`outbox.ts`'s
`VERSION` stays `1`**: a bump throws away unsent writes and buys nothing, because a v1 blob can only
hold actions that are still valid ([list-cache-holds-acknowledged-rows](list-cache-holds-acknowledged-rows.md)
has the asymmetry with the cache's version). `queueFirst`, the one exception to appending, puts a
restore in front of the write it unblocks ([writes-can-land-on-a-tombstone](writes-can-land-on-a-tombstone.md)).

**Membership writes deliberately do *not* go through any of this.** `shareList`, `setMemberRole` and
`removeMember` are called straight from `SharingScreen`, which holds its roster in `useState`. Since
step 18 [`shareList`](../../../src/lib/membersApi.ts) takes an id a search suggestion already
resolved, so there is no typed address left to answer synchronously — the reason now is that the
reducer models no members at all, `replay` has nothing to preserve, and the roster is an uncached,
online-only RPC. The boundary is "a write the reducer describes", not "any request".

**Serial, and never overlapping a fetch.** `items.list_id` is a foreign key, so an item insert must
not overtake the list insert it depends on: one request in flight, and a retryable failure stops the
loop rather than skipping ahead. A `fetching` ref keeps the loop and `refresh` apart — overlapped, a
write completing mid-fetch would be missing from both the response and the queue, and its row would
vanish. Two smaller properties are load-bearing and easy to "simplify" away: the loop dequeues **by
identity** (`filter(c => c !== op)`), since a toggle coalesced into the head mid-flight is a newer
write `shift()` would drop unsent; and a permanent failure drops its dependents (`dropDependents`) so
one refusal is one error, not a burst of foreign-key complaints.

**Per account, on a shared disk.** The provider is mounted only while signed in and takes `userId` as
a **prop** — outbox and cache keys are per account. Do not reach for `useSession()` inside
`ListsContext` for the id: that drags a `SessionProvider` and an auth mock into every list suite.

**What to do, and what not to.**

- Do not add a connectivity library (`expo-network` says "the OS has Wi-Fi", not "the request will
  succeed" — only a failed request doesn't lie), cap attempts, or add a compensating action per write.
- Do not clear the outbox on sign-out. `signOut` clears the cached rows only; unsent writes flush at
  that account's next sign-in. The residue is deliberate: keeping the promise means keeping the data.
- New AsyncStorage writes go through `inOrder` in [storageQueue](../../../src/lib/storageQueue.ts):
  the outbox is serialised whole on every change, and two racing writes tear it — a lost row.
- `SyncBanner` (muted, `pending > 0`) means *not saved yet*; the red `ErrorBanner` is reserved for
  a `permanent` verdict. Crying wolf every time a lift loses signal is what the split prevents. It
  also debounces its own paint since step 16 — [sync-banner-mount-is-unconditional](sync-banner-mount-is-unconditional.md).
- **Do not drop a queued write because a fetch says you may no longer make it.** A `role` in a fetch
  is a snapshot that can be seconds old and move either way; the database is the authority and answers
  with a status the outbox already classifies. Being removed from a list is the same shape: `replay`
  drops those ops from the *view*, not the queue, and they still flush and earn one honest refusal —
  realtime made this common and changed nothing else here
  ([realtime-is-a-nudge-to-a-per-user-inbox](realtime-is-a-nudge-to-a-per-user-inbox.md)).

**Any new write path must fail loudly or not at all.** Since sharing, a refusal is a normal thing
that happens to an honest user, and the loop rests on it coming back as one. An RPC that reported a
refusal as success would have the outbox drop a write it never delivered, which is why
`set_item_done` raises ([server-stamps-done-at](server-stamps-done-at.md)); a `PATCH` or `DELETE`
filtered to zero rows answers `204` and reads as success unless it asked for the row back
([refused-writes-return-zero-rows](refused-writes-return-zero-rows.md)). `writeResult` rewrites
`42501` and `23514` into sentences for these seven writes only, because their failure reaches the
banner minutes or days after the tap; the membership RPCs keep the raw message.

**Still not solved:** conflict resolution beyond last-write-wins, no happens-before, no sync engine
(PowerSync if this ever needs real convergence), no warning when signing out with writes pending.

The `verify:` command asserts shape, not plumbing: one `useReducer` caller; dispatch and enqueue
counts equal, summed over `ListsContext.tsx` and `useListWrites.ts` (**a write that skips the
outbox fails** — it counts the literal `dispatch(op);`, so a loop over already-queued ops must name
its variable differently, as `foldPage` does); both verdict branches; the `P0002` rule; no attempt
cap; no connectivity library; no `…/removed` action (case-insensitive, since a case-sensitive grep
once let `'item/setDeleted'` past); no `state.lists.filter` in the reducer; exactly **ten** `Action`
members (`type:` line count) and `WriteAction` excluding exactly the three reads — so the next write
cannot be added without revisiting this entry.
