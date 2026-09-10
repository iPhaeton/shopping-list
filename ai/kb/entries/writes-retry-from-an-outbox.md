---
id: writes-retry-from-an-outbox
title: Every write is queued on disk and retried until the database acknowledges it
type: decision
status: current
tags: [state, persistence, offline, supabase, architecture]
sources: [ai/tasks/4-offline-support/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-2.md, ai/tasks/8-realtime/implementation-log-step-1.md, src/state/ListsContext.tsx, src/lib/outbox.ts, src/lib/listsApi.ts]
last_verified: 2026-09-09
verify: test "$(grep -rl 'useReducer(' src --include='*.ts' --include='*.tsx')" = src/state/ListsContext.tsx && test "$(grep -c 'dispatch(op);' src/state/ListsContext.tsx)" = "$(grep -c 'void enqueueOp(op);' src/state/ListsContext.tsx)" && grep -q "verdict === 'retryable'" src/state/ListsContext.tsx && grep -q "verdict === 'permanent'" src/state/ListsContext.tsx && grep -q "code === 'P0002'" src/lib/listsApi.ts && ! grep -qE 'attempt[A-Za-z._]* *>=? *[0-9A-Z_]' src/state/ListsContext.tsx && ! grep -rqiE 'expo-network|netinfo' src package.json && ! grep -qE "removed'|deleted'" src/state/types.ts
related: [list-cache-holds-acknowledged-rows, optimistic-list-writes, first-fetch-replaces-list-state, server-stamps-done-at, refused-writes-return-zero-rows, ids-minted-outside-reducer, update-list-identity-preserving, supabase-client-module-boundary, realtime-is-a-nudge-to-a-per-user-inbox, scope-boundaries]
---

Step 4 replaced "fire once, re-fetch if it fails" with a durable queue.
[createList / addItem / toggleItem](../../../src/state/ListsContext.tsx) still dispatch first — the
row is on screen before any request — but the action is then written to an outbox on disk
(`outbox:<userId>`, [src/lib/outbox.ts](../../../src/lib/outbox.ts)) *before* the request goes out,
and a serial flush loop keeps sending it until the database takes it: across backgrounding, across a
restart, across days with no signal.

**Decision: only a refusal removes a write.** [listsApi](../../../src/lib/listsApi.ts) classifies
every response into a `verdict` — `ok`, `applied` (`23505`, this client's own insert catching up with
itself, which is what minting ids up front buys), `retryable` (status 0 = a failed fetch, 5xx, 401),
`permanent` (403/4xx). Anything unrecognised is `retryable`, deliberately: a doomed retry costs a
spin, a dropped write costs the user their data.

**The SQLSTATE beats the status, and since step 7 there are two rules that do it.** `23505` was the
first; `P0002` is the second, added when the sharing screen arrived. PostgREST answers `P0002` with
**500** — measured — and a 500 otherwise means "send it again", but the sharing RPCs raise it for "no
account with that email yet", which is a user's typo and will never succeed. Classified by status it
would be an outage message, or an infinite retry if it ever reached the queue. When adding an RPC
that raises, check what HTTP status PostgREST gives its SQLSTATE before assuming the status is
enough. **There is no attempt cap** — "eventually
persisted" is incompatible with giving up after N tries, and a cap would fire in exactly the case
the feature exists for. Backoff is 1s doubling to a 30s ceiling, cut short by the web `online` event
or `AppState` going `active`.

**This supersedes [optimistic-list-writes](optimistic-list-writes.md), whose rule was "a failure
repairs itself with a re-fetch".** Now only a `permanent` verdict re-fetches. A retryable failure
must **not**: we are offline, so the fetch fails too, and the failed write's row would be taken off
the screen by the very repair meant to save it. The rollback story survives where it belongs — a
refused write vanishes because it is gone from both the database and the outbox, so nothing replays
it.

**The queue holds reducer actions, not a second vocabulary for "a write".** `WriteAction` in
[src/state/types.ts](../../../src/state/types.ts) is `Action` minus `lists/loaded`, which is what
lets [replay](../../../src/state/replay.ts) fold pending ops back over fetched rows with the reducer
itself, and what keeps one description of a write in one place. A new kind of write is therefore a
new action plus a case in `send()`; `setItemDone`'s boolean is derived at send time from
`action.doneAt !== null` rather than stored ([server-stamps-done-at](server-stamps-done-at.md)).

**Step 7 added the fourth member, `list/renamed`, and it is the worked example of doing that.** A
rename carries an absolute value, so `enqueue` coalesces it per list id exactly as it does a toggle
per item id, and `dropDependents` drops queued renames for a `list/created` the database refused.
**`outbox.ts`'s `VERSION` stayed `1`** — a bump moves the blob aside as broken and throws away unsent
writes, and it buys nothing, because a v1 blob can only hold actions that are still valid
([list-cache-holds-acknowledged-rows](list-cache-holds-acknowledged-rows.md) has the asymmetry with
the cache's version). The one thing that did not compile was `dropDependents`: its `list/created` arm
matched `op.listId`, and a rename names its list by `id`. That is the union working — a new
`WriteAction` cannot be added without every exhaustive switch being revisited, so let the type errors
enumerate the places rather than hunting for them.

**Membership writes deliberately do *not* go through any of this.** `shareList`, `setMemberRole` and
`removeMember` are called straight from `SharingScreen`, which holds `members` / `pending` / `error`
in `useState`. Four reasons, of which the first would be enough on its own:

1. `share_list` resolves the email **server-side**, so "no account with that email yet" has to be
   answered while the user is still looking at the field they typed it into. Queued, it arrives an
   hour later as an error about a stranger.
2. The reducer models no members, so there is nothing to show optimistically and nothing for `replay`
   to preserve.
3. The roster comes from an RPC and is not cached, so that screen is unusable offline regardless —
   it is the only online-only screen in the app.
4. A `member/removed` action in `types.ts` would trip this entry's own `verify:` command, correctly:
   the promise here is about writes the *reducer* owns.

So the boundary is "a write the reducer describes", not "any request". Do not widen the outbox to
cover a screen whose state it cannot replay.

**Serial, and never overlapping a fetch.** `items.list_id` is a foreign key, so an item insert must
not overtake the list insert it depends on: one request in flight, and a retryable failure stops the
loop rather than skipping ahead. A `fetching` ref keeps the loop and `refresh` apart — if they
overlapped, a write that completed during a fetch would be missing from both the response and the
queue, and its row would vanish. Two smaller properties are load-bearing for the same reason and are
easy to "simplify" away: the loop dequeues **by identity** (`filter(c => c !== op)`), because a
toggle coalesced into the head while that head was in flight is a newer, different write that
`shift()` would drop unsent; and a permanent failure drops its dependents (`dropDependents`) so one
refusal is one error rather than a burst of foreign-key complaints.

**What carried over unchanged** from the superseded entry: writes carry absolute values rather than
flips, so a retry or a coalesced toggle is exactly correct
([update-list-identity-preserving](update-list-identity-preserving.md)); there is still no
`list/removed` or `item/removed` action and no inverse of any write; the queries still live in
[listsApi](../../../src/lib/listsApi.ts) so
[src/lib/supabase.ts](../../../src/lib/supabase.ts) stays the only importer of supabase-js and every
list suite can mock a handful of plain functions
([supabase-client-module-boundary](supabase-client-module-boundary.md)). The provider is still
mounted only while signed in, and now takes `userId` as a **prop** — the outbox and cache keys are
per account and two accounts share one device's disk. Do not reach for `useSession()` inside
`ListsContext` to get it: that would drag a `SessionProvider` and an auth mock into all three list
suites.

**What to do, and what not to.**

- Do not add a connectivity library. `expo-network` works in Expo Go and on web, but "the OS says
  there is Wi-Fi" and "the request will succeed" are different claims, and only a failed request
  cannot lie. It could decorate the UI; it must never gate the flush.
- Do not cap attempts, and do not add a compensating action per write. Both were considered.
- Do not clear the outbox on sign-out. `signOut` clears the cached rows only; unsent writes are the
  promise this step makes and they flush at that account's next sign-in. The residue is deliberate:
  unsent item titles stay on the device, because keeping the promise means keeping the data.
- New AsyncStorage writes go through `inOrder` in
  [src/lib/storageQueue.ts](../../../src/lib/storageQueue.ts). The outbox is serialised whole on
  every change, and two writes racing interleave into a torn value — a torn outbox is a lost row.
- `SyncBanner` (muted, `pending > 0`) means *not saved yet*;
  [ErrorBanner](../../../src/components/ErrorBanner.tsx) is now reserved for a `permanent` verdict.
  Do not route a retryable failure to the red banner; crying wolf every time a lift loses signal is
  what the split exists to prevent.

**Refusals stopped being hypothetical at step 7.** Until sharing, no user could provoke a `permanent`
verdict — you owned everything you could see. A `reader` provokes one by tapping Add or ticking an
item, so the drop-and-banner path is now a normal thing that happens to an honest user rather than a
defence against a forged request. (Since step 7's UI landed, the controls a reader may not use are
not rendered at all, and `ListsContext`'s own `canEditItems` / `canManageList` guards refuse before
anything is dispatched — so a refusal now takes a race or a second device. The path is still the one
that has to be correct.) It also exposed the contract the loop rests on: an RPC that reported a
refusal as a success would have the outbox drop a write it never delivered, which is why
`set_item_done` now raises ([server-stamps-done-at](server-stamps-done-at.md)). **Any new write path
must fail loudly or not at all** — and note the second way that goes wrong, which fails quietly by
default: a plain `PATCH` or `DELETE` filtered to zero rows by a policy answers `204` with no error
and is read as success unless it asked for the row back
([refused-writes-return-zero-rows](refused-writes-return-zero-rows.md)).

**Step 8 put a remote change in front of all this, and changed none of it — which is the point.**
Somebody else's write now arrives as a nudge and is answered with the same fetch
([realtime-is-a-nudge-to-a-per-user-inbox](realtime-is-a-nudge-to-a-per-user-inbox.md)), so fetched
rows are still the base and the outbox still folds on top. One rule that used to be unreachable is
now a normal occurrence and is the tempting thing to get wrong: **do not drop a queued write because
a fetch says you may no longer make it.** A `role` in a fetch is a snapshot that can be seconds old
and can move in both directions; the database is the authority and it answers with a status the
outbox already classifies. Dropping locally would discard a write that might still be accepted, and
"only a refusal removes a write" is the promise the whole offline design rests on. Being removed from
a list is the same shape: the list leaves the fetch, `replay`'s `updateList` silently drops those ops
from the *view*, and the ops themselves still flush and still earn one honest refusal.

**Still not solved:** deletion, and conflict resolution beyond last-write-wins — realtime makes
last-write-wins *visible* rather than different, and both mutating writes carry absolute values, so
repeated or reordered delivery still converges. There is no sync engine (PowerSync is the answer if
this ever needs real convergence) and no warning when signing out with writes still pending.

The `verify:` command asserts the shape rather than the plumbing: `ListsContext` is still the only
file calling `useReducer`, **every dispatched write op is also enqueued** (the counts must match, so
a new write that skips the outbox fails the check), both verdict branches are still in the loop, the
`P0002` code-beats-status rule is still in `verdictFor`, no attempt cap has appeared, no connectivity
library has been added, and no compensating remove/delete action has been introduced. The attempt-cap grep is a heuristic — it catches `attempt > 5` and
`attempts >= MAX_ATTEMPTS` and would miss a cap spelled some other way.
