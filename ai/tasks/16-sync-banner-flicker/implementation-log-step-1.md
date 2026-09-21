# Implementation log — step 1: stop the sync banner flickering while online

**Date:** 2026-09-21. No `description-step-1.md`: this was an ad hoc fix requested directly in
chat, not a planned task step, so there was no upfront description or plan file. Staged,
uncommitted at time of writing (`git diff --cached --stat`: `src/components/SyncBanner.tsx`,
`src/screens/ListDetailScreen.tsx`, `src/screens/ListsScreen.tsx`).

**Symptom:** with the app online, making a change flashed "1 change will sync when you're back
online" for the duration of the request, then hid it again.

**Cause:** `pending` (`ListsContext.tsx`) goes from 0 to a nonzero count the instant a write is
enqueued (`useOutbox.ts`'s `persist()` → `setPending(queue.current.length)`) and back to 0 the
instant it's acknowledged. Both `ListsScreen.tsx` and `ListDetailScreen.tsx` rendered `SyncBanner`
on plain `pending > 0`, so a normal fast online round trip mounted and unmounted the banner inside
one render cycle.

## What was built

| File | |
|---|---|
| `src/components/SyncBanner.tsx` | added a 400ms show-delay: `visible` state, `useEffect` keyed on `pending > 0` that sets a `setTimeout` before flipping `visible` true, cleared/reset on unmount or on `pending` returning to 0; returns `null` until `visible` |
| `src/screens/ListsScreen.tsx` | renders `<SyncBanner pending={pending} />` unconditionally now, was `{pending > 0 ? <SyncBanner .../> : null}` |
| `src/screens/ListDetailScreen.tsx` | same change |

## Decisions

**The delay lives inside `SyncBanner`, not in the screens, and the screens now mount it
unconditionally.** The two screens previously gated the component's existence on `pending > 0`;
kept that way, the parent would unmount `SyncBanner` (discarding its debounce timer) on the same
tick `pending` drops to 0, which is exactly the transition the fix needs to survive. Mounting
unconditionally lets `SyncBanner` own its own "should I be visible" state across `pending`
blipping 0 → 1 → 0.

**`pending`'s meaning was not touched.** `ai/kb/entries/writes-retry-from-an-outbox.md` documents
`SyncBanner` on `pending > 0` as a deliberate decision ("`SyncBanner` (muted, `pending > 0`) means
*not saved yet*"). The fix does not change that trigger or `pending` itself — `ListsContext.tsx`'s
cache-write gate (`status === 'ready' && pending === 0`) still reads the raw, undebounced value.
Only `SyncBanner`'s own paint is delayed, by 400ms of `pending` staying continuously > 0. A write
that resolves within that window never paints; one still unacknowledged after it shows the banner,
same as before, just ~400ms later, and hides immediately once `pending` clears.

## How it was verified

`npx jest src/screens/ListsScreen.test.tsx src/screens/ListDetailScreen.test.tsx` — 60/60 passed
unchanged, including the two tests that assert the banner appears on a `retryable` write
(`findByText` polls with real timers, well within its default timeout, so the added 400ms delay
did not require touching them). Full suite: `npm test` — 352/352 passed. `npm run typecheck` —
clean.

Not verified in a browser: the fix removes a fast flicker, which is inherently hard to assert from
a static screenshot. Reasoned from the mechanism (`pending`'s round trip vs. the 400ms delay)
rather than observed by eye.
