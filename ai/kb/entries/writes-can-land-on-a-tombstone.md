---
id: writes-can-land-on-a-tombstone
title: A queued write can land on something in the bin — `target_deleted` is neither success nor refusal, and the client decides by role
type: decision
status: current
tags: [state, persistence, offline, supabase, deletion, architecture]
sources: [ai/tasks/9-deletion/implementation-log-step-1.md, ai/suggestions/deletion.md, supabase/migrations/20260910000000_deletion.sql, src/state/restorePlan.ts, src/state/useBlockedWrites.ts, src/state/useOutbox.ts, src/lib/listsApi.ts]
last_verified: 2026-09-13
verify: grep -q "create type public.write_outcome as enum ('applied', 'target_deleted');" supabase/migrations/20260910000000_deletion.sql && grep -q "verdict === 'ok' && outcome === 'target_deleted'" src/state/useOutbox.ts && grep -B6 'setBlocked({ op' src/state/useOutbox.ts | grep -q 'await hydrate();' && grep -q 'queueFirst(queue.current, restore)' src/state/useBlockedWrites.ts && grep -q 'restorePlan(lists, blocked).length > 0' src/state/useBlockedWrites.ts && grep -q "rpc('add_item'" src/lib/listsApi.ts && grep -q "rpc('rename_list'" src/lib/listsApi.ts && awk '/create function public.set_item_done/,/^\$\$;/' supabase/migrations/20260910000000_deletion.sql | grep -E "raise exception|return 'target_deleted'" | tail -2 | head -1 | grep -q 'raise exception'
related: [deletion-is-a-tombstone, writes-retry-from-an-outbox, refused-writes-return-zero-rows, server-stamps-done-at, first-fetch-replaces-list-state, list-data-scoped-by-rls, queries-go-through-a11y-labels]
---

Since deletion exists, a write sitting in the outbox can be sent to a list or item somebody else put
in the bin ([deletion-is-a-tombstone](deletion-is-a-tombstone.md)). That is a **third answer**, and
the whole design turns on it not being squeezed into the two that existed.

```sql
create type public.write_outcome as enum ('applied', 'target_deleted');
```

`set_item_done`, `add_item` and `rename_list` return it. In
[listsApi](../../../src/lib/listsApi.ts) `target_deleted` rides along with **`verdict: 'ok'`** — the
request was accepted, the caller was allowed to make it, there was simply nothing live for it to land
on. Classifying it `permanent` was the first attempt and is wrong: `dropDependents` would throw away
the tick queued behind an add, so "keep my change" would restore the item unticked.

**The server reports the fact; the client decides what to offer, from the role it already holds.**
`write_outcome` says nothing about who may restore what.
[restorePlan](../../../src/state/restorePlan.ts) answers that from `list.role`, which is the division
this codebase already keeps everywhere: roles choose which controls exist, never whether a write is
allowed ([list-data-scoped-by-rls](list-data-scoped-by-rls.md)). So an owner is offered *"That list is
in the bin. Restore it and keep your change?"* and a writer's write drops quietly, with no role logic
duplicated into a return value that could not enforce it anyway.

**Four properties of the blocked state, each of which was got wrong first.**

- **The op stays at the head of the outbox, on disk.** Nothing is dequeued and nothing is persisted
  elsewhere. Held only in React state it would not survive a reload before the user answered.
- **The flush loop stops** behind a `stuck` ref, beside `flushing` and `fetching`. Without it the loop
  carries on to the next write on the same list, earns the same answer, and overwrites the prompt.
- **`hydrate()` runs *before* `setBlocked`, and the order is load-bearing.** The tombstone is somebody
  else's write, so the device has never seen it; `restorePlan` reading the pre-delete view finds
  nothing in the bin, concludes there is nothing to offer, and **discards the write** — silently: no
  banner, no error, and a tick that never happened. Jest batched the two updates into one render and
  saw nothing; the browser caught it on the first real run. The regression test asserts the *order*
  (no prompt while the fetch is in flight) rather than the outcome, and was checked against the old
  code to confirm it fails there.
- **Restores are prepended with `queueFirst`, not enqueued.** The blocked write is still first, so an
  append would send it before the thing meant to unblock it. And **both** tombstones are lifted when
  an item was binned inside a binned list — restoring only the list blocks the retry again on the
  item and asks a user who has already said yes to say it twice. `restoreBlocked`/`discardBlocked` and
  the auto-discard effect live in [useBlockedWrites.ts](../../../src/state/useBlockedWrites.ts), an ad
  hoc extraction from `ListsContext.tsx`; the `flush` loop that produces `blocked` in the first place
  moved separately, into [useOutbox.ts](../../../src/state/useOutbox.ts) — the two hooks talk through
  `stuck`, `hydrate` and `flush` passed in as params, not a shared file.

**An empty plan means discard, and that is a mechanism rather than a rendering choice.** When
`restorePlan` returns nothing — the row was purged, or this account is a writer, or it was demoted or
removed between making the change and the queue reaching it — the provider drops the write itself. It
cannot be left to the banner to decline rendering: the write is still the head of a stopped queue, so
an invisible prompt would stall everything behind it. This is also what stops the prompt looping when
a restore is itself refused, because the fetch that follows the refusal carries the role that refused
it.

**Two write paths had to become RPCs to carry an outcome, and only one of those reasons is deletion.**

- **`insertItem` → `add_item`, not optional.** The `writers add items` policy checks *membership*, and
  membership is completely intact after a soft delete, so a plain insert would be **accepted** into a
  binned list. The function keeps retry safety with `on conflict (id) do nothing` and reports
  `applied` either way, replacing the `23505` the direct insert leaned on — deliberately with no
  `get diagnostics`, because a retry finding its own earlier insert reports zero rows and calling that
  a refusal would banner a write that landed.
- **`updateListName` → `rename_list`, owed anyway.** A refused rename answered `200 []`, which cannot
  tell **deleted** from **demoted** — and no client can, because RLS hides a list you were removed
  from exactly as thoroughly as one that is gone
  ([refused-writes-return-zero-rows](refused-writes-return-zero-rows.md)).

`insertList` stays a plain insert: creating a list cannot land on a deleted target.

**`set_item_done`'s zero-row branch now splits three ways, and the order is a security decision.** Row
missing → `target_deleted` (purged out from under a very old queued write); **caller not a writer →
`raise 42501`**; otherwise → `target_deleted`. The proposal put the tombstone test first, which would
tell a stranger holding an item id that a row they cannot see is in the bin. Tested after the
permission check, it never does — and the `verify:` command asserts that ordering, since the two
branches look interchangeable. Keep the first branch too when someone later "simplifies" three cases
into two: past the purge window the row really is gone, and dropping the write quietly is the right
answer ([server-stamps-done-at](server-stamps-done-at.md) is where "zero rows can only mean refused"
used to live).

**The failure modes it does not address.** There is **no happens-before**: the rule is who you are,
not whose change came first, so an owner is offered a restore whether their edit predated the delete
by a second or a week. Real causal ordering needs version vectors, and at that point the answer is a
sync engine rather than half of one. Last-write-wins is unchanged for concurrent edits to a field.

The `verify:` command asserts the contract and the two orderings that no type checker protects: the
enum still holds both values, `target_deleted` is still paired with an `ok` verdict rather than
promoted to a failure, `hydrate()` still precedes `setBlocked`, restores still go to the front,
the provider still discards on an empty plan, both writes are still RPCs, and the permission check in
`set_item_done` still comes before the last tombstone branch.
