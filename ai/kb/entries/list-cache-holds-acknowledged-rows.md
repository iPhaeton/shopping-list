---
id: list-cache-holds-acknowledged-rows
title: The list cache holds rows the database acknowledged — never the replayed view, and not only what a fetch returned
type: gotcha
status: current
tags: [state, persistence, offline, cache]
sources: [ai/tasks/4-offline-support/implementation-log-step-1.md, src/lib/listCache.ts, src/state/ListsContext.tsx]
last_verified: 2026-09-02
verify: grep -q "status === 'ready' && pending === 0" src/state/ListsContext.tsx && grep -q 'writeCachedLists(userId, lists)' src/state/ListsContext.tsx && ! grep -q 'writeCachedLists(userId, replay' src/state/ListsContext.tsx
related: [writes-retry-from-an-outbox, first-fetch-replaces-list-state, supabase-local-stack]
---

[src/lib/listCache.ts](../../../src/lib/listCache.ts) keeps the last known rows under
`lists:<userId>` so a cold start with no signal shows the lists instead of claiming the account has
none. What goes in it is the part that is easy to get wrong, in two opposite directions — and both
were hit.

**Never cache what is on screen.** The screen is server truth with the outbox replayed on top
([writes-retry-from-an-outbox](writes-retry-from-an-outbox.md)). Cache that, and the next load
replays those same pending ops onto rows that already contain them: `list/created` appends by id and
the reducer does not dedupe, so the list appears twice. `refresh` therefore caches the rows
`fetchLists` returned, before `replay`.

**But caching *only* fetched rows is a snapshot of the last cold start.** A fetch happens on mount
and nowhere else, so everything written since is missing from the cache — after a session of
creating a list and adding items *online*, a restart with the database unreachable showed an **empty
app**: the cache still held the `[]` from the fetch that ran at sign-in, and the outbox was empty
because every write had been acknowledged. The browser found this; unit tests did not.

The rule that covers both is **cache what the database has acknowledged**, of which fetched rows are
a special case. An effect in the provider writes the cache whenever `status === 'ready' && pending
=== 0` — with nothing queued, every row on screen has been acknowledged, so it is server truth by
another route. The write inside `refresh` stays for the case where writes *are* pending and the
effect is quiet. `ListsContext.test.tsx` carries the regression test ("remembers writes the database
acknowledged, not just what a fetch returned"), which fails if the effect is removed.

**The cache is disposable; the outbox is not.** Anything unreadable here is dropped and re-fetched —
losing the cache costs a round trip. A broken outbox blob is moved aside to `outbox:<userId>:broken`
instead, because losing it loses the user's writes. Keep that asymmetry when touching either module.
Sign-out clears the cache (a readable copy of an account's lists must not outlive its session) and
deliberately keeps the outbox.

The `verify:` command asserts all three halves: the acknowledged-rows effect still exists, `refresh`
still caches the fetched array, and nothing caches a `replay(...)` result.
