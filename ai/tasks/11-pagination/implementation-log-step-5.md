# Implementation log — step 5: the first realtime connect was mistaken for a resubscribe

**Date:** 2026-09-13. Description: [description-step-5.md](description-step-5.md). Plan: the
approved plan-mode file (not checked in).

The report: on every app load, `fetchLists` and the per-list `fetchItems` re-read both ran twice.
Root cause traced to `listsChannel.ts`'s `subscribeToChanges`: its `.subscribe((status) => ...)`
callback called `onResubscribe` on *every* `'SUBSCRIBED'` event, and a channel's very first
successful connection also reports `'SUBSCRIBED'` — indistinguishable in the code from a real
reconnect. `ListsContext.tsx` wires `onResubscribe` to `refreshSoon` with no list id, so the first
connect (which happens on every mount, moments after the mount's own `hydrate()` already ran) set
`dirty.current = 'all'` and, 300ms later, ran a second full `hydrate()` — repeating `fetchLists()`
and, via `reloadPages`, a `fetchItems()` re-read for every list flagged `itemsLoaded`.

The "re-read on resubscribe" behaviour is deliberate — see
[realtime-is-a-nudge-to-a-per-user-inbox](../../kb/entries/realtime-is-a-nudge-to-a-per-user-inbox.md)
— but its reasoning (repair for Realtime's at-most-once delivery) only holds for an actual
reconnect. Nothing could have been missed before the channel existed, and the provider's own mount
fetch already has current truth. Nobody distinguished "first connect" from "reconnect" when step 8
built this, and no test caught it: `ListsContext.test.tsx` mocks `subscribeToChanges` and only ever
invokes `onResubscribe` when a test explicitly calls the captured `resubscribe()`, so the real
first-connect wiring was never exercised end to end.

## What was built

| File | |
|---|---|
| `src/lib/listsChannel.ts` | `subscribeToChanges` gained a closure flag, `connected`, set once the channel first reaches `'SUBSCRIBED'`. `onResubscribe` now fires only when `connected` was already `true` — i.e. a second-or-later `'SUBSCRIBED'` on the same channel instance, which can only happen after a drop and rejoin. The first `'SUBSCRIBED'` sets the flag and returns without calling it. `onResubscribe`'s JSDoc reworded to describe reconnect-only firing and why the first connect needs no repair. |
| `listsChannel.test.ts` | `'reports a subscription, and nothing else'` — whose final assertion (first-ever `SUBSCRIBED` → `onResubscribe` called) is now the wrong behaviour — split into two: `'does not treat the first connection as a resubscribe'` (first `SUBSCRIBED`, after `CLOSED`/`CHANNEL_ERROR`, calls nothing) and `'reports a reconnect, and nothing else'` (a second `SUBSCRIBED` after a first one calls it exactly once). Net test count in this file 8 → 9. |

Untouched: `ListsContext.tsx`, `useHydration.ts`, `reloadPages.ts`, and every other test file —
`listsChannel.ts` was the one place conflating "first connect" with "reconnect", and
`ListsContext.test.tsx`'s realtime tests drive `onResubscribe` by calling the mock's captured
`resubscribe()` directly, which is exactly the second-or-later case this fix preserves.

## Decisions

**A one-way closure flag, not a connection-state machine.** `connected` is never reset on
`CLOSED`/`CHANNEL_ERROR`. It doesn't need to be: once a channel instance has reached `'SUBSCRIBED'`
once, any *later* `'SUBSCRIBED'` on that same instance is a reconnect by construction — the channel
had to drop and rejoin to report the status a second time. Tracking "currently connected" would be
answering a question nothing here asks.

**Fixed in `listsChannel.ts`, not in `ListsContext.tsx`'s wiring.** `ListsContext.tsx` passes the
same `refreshSoon` as both `onChange`'s reaction and `onResubscribe` — that pairing is correct
(a reconnect really does need a full, unscoped re-read). The bug was `subscribeToChanges` handing
back a signal that didn't mean what its name promised on the very first call, and fixing the source
of that signal is narrower than adding a guard at every consumer.

## Problems hit

None. The fix and its test update passed on the first attempt after typecheck was clean.

## Verified

- `npm run typecheck` — clean.
- `npx jest src/lib/listsChannel.test.ts` — 9/9 passing, including the two new/renamed cases.
- Confirmed the new `'does not treat the first connection as a resubscribe'` test fails on the
  pre-fix code (`git stash` on `listsChannel.ts` alone, re-ran with `-t "does not treat the first
  connection"`): fails with `onResubscribe` called once when it should not be, reproducing the
  reported symptom exactly. Passed once the fix was restored.
- Full suite: 325/325 passing, no regressions — in particular `ListsContext.test.tsx`'s realtime
  section (`'re-reads when the socket comes back'`, both "write enqueued while a nudge-triggered
  fetch was in flight" tests) is unaffected, since it drives reconnects through the mock's
  `resubscribe()` directly rather than through real `subscribeToChanges` status transitions.
- `npm run kb:audit`: 0 errors, 10 warnings. Two of the warnings are this change's own "ground
  moved" flags on `realtime-is-a-nudge-to-a-per-user-inbox` and `supabase-client-module-boundary`
  (both list `listsChannel.ts` as a source) — expected, for the librarian to re-verify and re-date.
  The rest predate this step and are unrelated (`list-data-scoped-by-rls`,
  `queries-go-through-a11y-labels`, `read-rooted-at-list-members`, `refused-writes-return-zero-rows`,
  `screens-take-navigation-props`, `server-stamps-done-at`, `update-list-identity-preserving`, plus
  `supabase-local-stack`'s length warning).

## Not re-verified this session

No real-device or real-browser run against a live Supabase socket confirming the double fetch is
gone in practice — as with steps 3 and 4, every assertion goes through the mocked `../lib/supabase`
seam ([supabase-client-module-boundary](../../kb/entries/supabase-client-module-boundary.md)). The
mechanism (a channel's first `SUBSCRIBED` vs. a later one) is simple enough that the unit test is a
faithful proxy, but this has not been watched happen against the real realtime socket.

## KB impact — handed to the librarian, not edited here

- [realtime-is-a-nudge-to-a-per-user-inbox](../../kb/entries/realtime-is-a-nudge-to-a-per-user-inbox.md)
  — its prose states "`onResubscribe` fires on every `SUBSCRIBED`, reconnects included," which is now
  wrong: it fires on every `SUBSCRIBED` *after the first*. Its `verify:` script doesn't check this
  (no clause matches the changed lines), so `kb:audit` won't flag the prose itself — only the
  mechanical "ground moved" warning against `listsChannel.ts`. Worth stating explicitly that this
  step narrows, not removes, that behaviour: reconnect repair still works, unchanged, for every call
  after the first.
- [first-fetch-replaces-list-state](../../kb/entries/first-fetch-replaces-list-state.md) — its "three
  guarded doors onto `hydrate`/`hydrateLists`" section doesn't need new content, but its account of
  what triggers a re-read on mount should no longer imply (if it does) that the realtime subscription
  contributes a second fetch on cold start — this step is precisely what stops that.

## What this does not solve

- **No change to reconnect behaviour** — a genuine drop-and-rejoin still triggers exactly one full
  `hydrate()`, same as before this step.
- **No end-to-end proof against a live socket** — see "Not re-verified this session" above.
