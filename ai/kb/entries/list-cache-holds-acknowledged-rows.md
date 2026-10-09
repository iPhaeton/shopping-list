---
id: list-cache-holds-acknowledged-rows
title: The list cache holds rows the database acknowledged — never the replayed view, and not only what a fetch returned
type: gotcha
status: current
tags: [state, persistence, offline, cache]
sources: [ai/tasks/4-offline-support/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-2.md, ai/tasks/8-realtime/implementation-log-step-1.md, ai/tasks/9-deletion/implementation-log-step-1.md, ai/tasks/11-pagination/implementation-log-step-1.md, ai/tasks/11-pagination/implementation-log-step-2.md, ai/tasks/18-share-by-name/implementation-log-step-1.md, ai/tasks/23-list-limits/implementation-log-step-1.md, ai/tasks/23-list-limits/implementation-log-step-2.md, ai/tasks/24-search-and-sort/implementation-log-step-2.md, src/lib/listCache.ts, src/state/ListsContext.tsx, src/state/useHydration.ts]
last_verified: 2026-10-09
verify: grep -q "status === 'ready' && pending === 0" src/state/ListsContext.tsx && grep -q 'writeCachedLists(userId, lists, pages.cursors, read.counts)' src/state/useHydration.ts && grep -q 'writeCachedLists(userId, state.lists, state.listCursors, state.listCounts)' src/state/ListsContext.tsx && ! grep -q 'writeCachedLists(.*replay' src/state/useHydration.ts && ! grep -q 'writeCachedLists(userId, loaded' src/state/useHydration.ts && grep -q '!isCounts(stored.counts)' src/lib/listCache.ts && grep -q 'const VERSION = 8;' src/lib/listCache.ts && grep -q 'const VERSION = 1;' src/lib/outbox.ts
related: [writes-retry-from-an-outbox, first-fetch-replaces-list-state, update-list-identity-preserving, realtime-is-a-nudge-to-a-per-user-inbox, deletion-is-a-tombstone, supabase-local-stack, expo-crypto-undefined-under-jest]
---

[src/lib/listCache.ts](../../../src/lib/listCache.ts) keeps the last known rows under
`lists:<userId>` so a cold start with no signal shows the lists instead of claiming the account has
none. What goes in it is the part that is easy to get wrong, in two opposite directions — and both
were hit.

**Never cache what is on screen.** The screen is server truth with the outbox replayed on top
([writes-retry-from-an-outbox](writes-retry-from-an-outbox.md)); the cache holds only what the
database has taken. `hydrate` therefore caches the rows its reads returned, before `replay`.

**The symptom that used to enforce that rule is gone as of step 8; the rule is not.** Until then,
caching the replayed view duplicated a row on the next load — `list/created` appended by id and the
reducer did not dedupe. Step 8 made `list/created` and `item/added` idempotent by id for realtime's
own reasons ([realtime-is-a-nudge-to-a-per-user-inbox](realtime-is-a-nudge-to-a-per-user-inbox.md),
[update-list-identity-preserving](update-list-identity-preserving.md)), so that breakage no longer
happens. What is left is harder to debug, not easier: cache the replayed view now and you persist
**unacknowledged** writes as though the database had confirmed them, with nothing visible going wrong
to tell you. Treat "the cache holds acknowledged rows" as a definition kept on purpose rather than a
rule the app will re-teach you — and note the `verify:` command still forbids
`writeCachedLists(userId, replay…)` for exactly that reason.

**But caching *only* fetched rows is a snapshot of the last cold start.** A fetch happens on mount
and nowhere else, so everything written since is missing from the cache — after a session of
creating a list and adding items *online*, a restart with the database unreachable showed an **empty
app**: the cache still held the `[]` from the fetch that ran at sign-in, and the outbox was empty
because every write had been acknowledged. The browser found this; unit tests did not.

The rule that covers both is **cache what the database has acknowledged**, of which fetched rows are
a special case. An effect in the provider writes the cache whenever `status === 'ready' && pending
=== 0` — with nothing queued, every row on screen has been acknowledged, so it is server truth by
another route. The write inside `hydrate` stays for the case where writes *are* pending and the
effect is quiet. `ListsContext.test.tsx` carries the regression test ("remembers writes the database
acknowledged, not just what a fetch returned"), which fails if the effect is removed.

**The cache is disposable; the outbox is not.** Anything unreadable here is dropped and re-fetched —
losing the cache costs a round trip. A broken outbox blob is moved aside to `outbox:<userId>:broken`
instead, because losing it loses the user's writes. Keep that asymmetry when touching either module.
Sign-out clears the cache (a readable copy of an account's lists must not outlive its session) and
deliberately keeps the outbox.

**The same asymmetry governs the two `VERSION` constants, and they do not move together.** Step 7
added a required `role` to `List` and took `listCache`'s `VERSION` to `2`, so a pre-sharing blob is
dropped rather than rendered as `role: undefined` — that is exactly what the `v` check is for, and it
costs one fetch. **`outbox.ts` stayed at `1` on purpose:** a version mismatch there moves the blob
aside as broken, throwing away the unsent writes the outbox exists to protect, and a v1 outbox holds
only actions that are still valid. So bump the cache version whenever the cached shape changes; bump
the outbox version only when a queued action can no longer be replayed at all, and expect to write a
migration instead if it ever comes to that. Step 7's sharing UI is the worked example of *not*
bumping either: it added a fourth `WriteAction` (`list/renamed`) and no field on `List`, so a cached
v2 blob is still exactly right and a queued v1 op is still replayable.

**The cache version is `8` since task 24 step 2, and every bump so far was required.** The first
five each added a field that an old blob reads back as `undefined`, and each failed silently in its
own way. Step 9's
`deletedAt` ([deletion-is-a-tombstone](deletion-is-a-tombstone.md)): `undefined !== null` is
**`true`**, so every cached row read as deleted and the first screen after the upgrade was empty.
Step 11's `nextLive` / `nextBin`: `undefined` read as "there is more", so the first scroll asked for a
page after a cursor that does not exist. Step 11-2's `itemsLoaded`: falsy like `false`, so only a
wasted fetch — lower-risk, not optional, since the version check exists so nobody has to rely on a
new field happening to fail closed. Task 23 step 1's `joinedAt`: read as *stamped*, so counted as a
loaded list when `hydrate` sizes its re-read, and sorted among fetched ones. Task 23 step 2's
`counts`: `undefined >= 100` is `false`, so at a limit the Create bar came back until the first
fetch. The comparison bites outside the cache too, where no version helps: `toList` / `toItem` in
[listsApi](../../../src/lib/listsApi.ts) coalesce the timestamps with `?? null`, because a column
left out of the `select` string arrives `undefined`. **Task 24 step 2's bump added no field: a cursor
changed meaning.** The bin now pages newest deletion first, so `cursors.bin` and every list's
`nextBin` are `(deletedAt, id)` positions, and a v7 one is a `(createdAt, id)` place in the old order.
`isCursors` only asks "object or `null`", so nothing but `v` tells the two apart — **bump on a change
of meaning, not only of shape.** `outbox.ts` stayed at `1` every time — no queued action changed
shape, and `list/created` still mints `joinedAt: null` in the reducer.

**The cache holds every page that was loaded, cursors included — of each list's items since step 11,
and of the lists themselves since task 23 step 1.** The blob is `{ v, lists, cursors, counts,
fetchedAt }`, and `readCachedLists` drops one missing either cursor key or either count. A list
scrolled three pages deep, or a Lists screen scrolled three pages down, is cached that deep, and the
first `hydrate` after a cold start re-reads that many pages to match — which works only because the
cold-start dispatch also seeds the refs `hydrate` counts from
([first-fetch-replaces-list-state](first-fetch-replaces-list-state.md)). A page is server truth, so
it is acknowledged by definition.

**The list counts follow the rows' rule.** `hydrate` caches `read.counts`, what `my_list_counts()`
returned, never `replayed.listCounts`: that one has this device's pending creates and bins counted
on top, and the next cold start replays the same queue over the cache and would count them twice.
The acknowledged-rows effect caches `state.listCounts`, which with nothing pending is the server's
numbers plus writes it has since taken.

The `verify:` command asserts all of it: the acknowledged-rows effect still exists, `hydrate` and the
effect still pass the cursors and counts, `hydrate` caches the counts it read, nothing caches a
replayed result, an old blob without counts is dropped, and the two versions are still `8` and `1` —
a "tidy-up" that syncs them fails the check.
