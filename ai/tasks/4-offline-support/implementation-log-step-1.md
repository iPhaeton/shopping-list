# Implementation log — step 1: changes survive being made offline

**Date:** 2026-09-01. Plan: [plan-step-1.md](plan-step-1.md). Description:
[description-step-1.md](description-step-1.md).

A write made with no signal is now queued on disk and retried until the database takes it —
across backgrounding, across a restart, across days of no signal. Reading offline came in with it
(decided with the user before starting): without a cached copy, a cold start with no signal showed
an empty app, and the scenario the queue exists for never happens.

## What was built

| File | |
|---|---|
| `src/lib/storageQueue.ts` | new — one promise chain for every AsyncStorage write |
| `src/lib/outbox.ts` | new — the queue: load/save, coalescing enqueue, `dropDependents` |
| `src/lib/listCache.ts` | new — the last acknowledged rows, per user |
| `src/state/replay.ts` | new — `replay(lists, ops)`, a fold through the reducer |
| `src/lib/listsApi.ts` | `Result` gained a `verdict`, classified from `status` and SQLSTATE |
| `src/state/ListsContext.tsx` | enqueue + serial flush loop with backoff; hydrates cache → network; exposes `pending` |
| `src/state/SessionContext.tsx` | `signOut` clears the cached lists for that account |
| `src/components/SyncBanner.tsx` | new — the muted "not saved yet" line |
| `App.tsx`, both screens | pass `userId`; render the banner |
| `jest.setup.ts` | the library's in-memory AsyncStorage mock |

No migration. The database is untouched: `23505` handling is a client-side reading of the error the
existing insert already returns, and `set_item_done` was idempotent already.

## Decisions that changed during the work

**The plan's rule "cache server truth only, never the replayed view" was right but incomplete, and
the browser found it.** Fetches only happen on mount, so a cache fed by fetches alone is a snapshot
of the last cold start — everything written since is missing from it. After a session of creating a
list and adding items *online*, a restart with the database unreachable showed an empty app: the
cache still held the `[]` from the fetch that ran at sign-in, and the outbox was empty because every
write had been acknowledged.

The rule is now **cache what the database has acknowledged**, which the fetched rows are a special
case of. An effect writes the cache whenever `status === 'ready' && pending === 0` — with nothing
queued, every row on screen has been acknowledged, so it is server truth by another route. The write
inside `refresh` stayed: while writes are pending the effect stays quiet, and fetched rows are worth
caching then too. `ListsContext.test.tsx` grew a regression test that fails without the effect.

**Dequeue by identity, not by position.** Not in the plan, and it would have been a data-loss bug: a
toggle coalesced into the head of the queue while that head was in flight is a *newer, different*
write, and `queue.shift()` would have dropped it unsent. The loop removes the op it actually sent
(`filter((candidate) => candidate !== op)`), so a coalesce-during-flight leaves the new write queued.

**Fetch and flush never overlap.** A `fetching` ref guards the loop. Without it, a write that
completed while a fetch was in flight could be missing from both the response and the queue, and its
row would vanish from the screen. The hydration path fetches and *then* flushes; the only other
fetch is the one a permanent failure triggers, which happens inside the loop.

**`ListsProvider` takes a `userId` prop.** The outbox and cache are per-account and two accounts
share one device's disk. A prop rather than `useSession()`, which the KB rules out — it would drag a
`SessionProvider` and an auth mock into all three list suites.

## Problems hit

- **The dev server was already running on 8081** (pid 23503), so `npm run web` exited rather than
  prompting for another port. Metro picked up the changes on reload; nothing to fix.
- **`page.context().setOffline(true)` cannot be used to test a restart**, because it blocks the Metro
  bundle too and the app never boots. Aborting only requests to port 54321 is the faithful
  simulation: the app starts, the database is unreachable.
- **Two sync banners exist in the DOM at once** on the detail screen — React Navigation keeps the
  Lists screen mounted underneath. Only one is visible (checked with `isVisible()`); tests that query
  the text need `.last()` or a visibility filter.

## Verification

`npm test` (82 tests, 8 suites), `npm run typecheck`, `npm run kb:audit` (0 errors) all pass. New
suites: `src/lib/outbox.test.ts` (12), `src/state/replay.test.ts` (6), plus 10 offline cases in
`ListsContext.test.tsx` and one banner assertion per screen suite.

Then the local stack in a browser, driven with Playwright MCP, signed in as
`offline-test@example.com`:

1. **Online** — created *Groceries*, added *Milk* and *Bread*; both rows in Postgres.
2. **Offline** (all requests to 54321 aborted) — added *Eggs*, ticked *Milk*. Both appeared, the
   banner read "2 changes will sync when you're back online", no error banner. The console shows the
   backoff retrying at 1s, 2s, 4s, 8s, 16s. (It also shows postgrest-js retrying the *read* three
   times on its own — it retries GET/HEAD/OPTIONS only, which is why writes needed this feature.)
3. **Restart while offline** — the lists were still there, complete with the unsent changes, and the
   banner still counted 2.
4. **Back online, untouched** — the backoff timer alone delivered them; the banner cleared and the
   database held `Milk` done, `Bread` done, `Eggs`, `Tea`, one row each, `done_at` stamped by
   Postgres.
5. **Sign out** — `lists:<uid>` and the auth token gone from localStorage, `outbox:<uid>` still
   there, as intended.

Step 1 above is what caught the cache bug: the restart in that first pass showed an empty app.

## Still not solved

Sharing, realtime, deletion, and conflict resolution beyond last-write-wins. No sync engine and no
connectivity library — a failed request is the only signal, and it is the one that cannot lie. Sign
out with unsent writes does not warn; they simply flush at that account's next sign-in. And the
residue is deliberate: unsent item titles stay on the device after sign-out, because keeping the
promise means keeping the data.
