---
id: sync-banner-mount-is-unconditional
title: SyncBanner debounces its own paint; gating its mount on pending > 0 defeats that
type: gotcha
status: current
tags: [ui, state, outbox]
sources: [ai/tasks/16-sync-banner-flicker/implementation-log-step-1.md, src/components/SyncBanner.tsx, src/screens/ListsScreen.tsx, src/screens/ListDetailScreen.tsx]
last_verified: 2026-09-21
verify: grep -q 'SHOW_AFTER_MS = 400' src/components/SyncBanner.tsx && grep -q '<SyncBanner pending={pending} />' src/screens/ListsScreen.tsx && grep -q '<SyncBanner pending={pending} />' src/screens/ListDetailScreen.tsx && ! grep -qE 'pending *> *0 *\? *<SyncBanner' src/screens/ListsScreen.tsx src/screens/ListDetailScreen.tsx
related: [writes-retry-from-an-outbox, queries-go-through-a11y-labels]
indexed: false
---

**The bug this fixed:** online, a normal write flashed "1 change will sync when you're back online"
for the split second between `pending` going 1 and the ack bringing it back to 0. `pending`
(`ListsContext.tsx`) always ticked 0 → 1 → 0 across a request; a fast round trip is not a failure
worth interrupting the screen for.

**The fix lives inside [SyncBanner](../../../src/components/SyncBanner.tsx), not in its callers.**
It holds its own `visible` state and only flips it true after `SHOW_AFTER_MS` (400) of `pending`
staying continuously nonzero, clearing the timer the instant `pending` returns to 0. Both
[ListsScreen](../../../src/screens/ListsScreen.tsx) and
[ListDetailScreen](../../../src/screens/ListDetailScreen.tsx) render `<SyncBanner pending={pending}
/>` **unconditionally** now — before this they gated it on `{pending > 0 ? <SyncBanner .../> :
null}`.

**Gating the mount on `pending > 0` again silently reintroduces the flicker.** Conditionally
rendering `SyncBanner` unmounts it the same tick `pending` drops to 0 — exactly the transition the
400ms delay exists to survive — which resets `visible` to its initial `false` and cancels the
pending `setTimeout`. Nothing errors; the banner just starts flashing again on every fast write.
This is standard React (unmount discards state and effects), but it cost a debugging cycle here
because the old conditional-render pattern is the natural thing to reach for, and `SyncBanner`'s own
code gives no signal that it now depends on staying mounted across the 0 → 1 → 0 blip.

**`pending`'s meaning is untouched.** `ListsContext`'s cache-write gate
(`status === 'ready' && pending === 0`,
[list-cache-holds-acknowledged-rows](list-cache-holds-acknowledged-rows.md)) still reads the raw,
undebounced value; only `SyncBanner`'s own paint is delayed.

**What to do:** any new consumer of `SyncBanner`, or any new component built on the same
"debounce a boolean derived from `pending`" shape, mounts unconditionally and lets the component own
its visibility. Do not move the delay back out into a screen's conditional render.
