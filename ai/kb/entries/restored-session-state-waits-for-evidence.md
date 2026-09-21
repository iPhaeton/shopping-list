---
id: restored-session-state-waits-for-evidence
title: A restored session must stay `loading` until a cache read or fetch actually decides its name — never set `signedIn` first and correct it later
type: gotcha
status: current
tags: [auth, state]
sources: [ai/tasks/17-user-names/implementation-log-step-1.md, src/state/SessionContext.tsx, src/state/SessionContext.test.tsx]
last_verified: 2026-09-21
verify: test "$(awk '/^  function enterSignedIn/,/^  }/' src/state/SessionContext.tsx | grep -c 'setState(')" = 1 && grep -q "async function resolveRestoredSignIn" src/state/SessionContext.tsx && grep -q "never shows the full app for a restored session before a cache or fetch backs it up" src/state/SessionContext.test.tsx
related: [signed-in-event-fires-on-restore-too, first-fetch-replaces-list-state]
---

A real, user-reported bug, reproduced against the local stack before being fixed: sign up, leave
[SetNameScreen](../../../src/screens/SetNameScreen.tsx) without setting a name, close the app,
reopen it — the app skipped straight past the gate into the normal app. `public.users.name` was
confirmed via `psql` to still be `null`; nothing was silently written. The name simply hadn't been
checked yet, and the app had already decided to act as if it had.

**The cause:** `enterSignedIn`'s original restored-session branch set `{ status: 'signedIn', name:
null }` **synchronously**, before either the on-device cache or a network fetch had said anything.
`name: null` doubling as "not yet known" was deliberate ([the `signedIn` case's own comment in
`SessionContext.tsx`](../../../src/state/SessionContext.tsx) says so) — but that "assume set, don't
block" behavior was meant only as the fallback for a *failed* read, and the bug was applying it to
the merely-*pending* case too, on every single cold-start restore. The window was normally a tick or
two — invisible to a `findByText` assertion, which is exactly why the original test suite (which only
ever checked the eventual state, never the state in between) didn't catch it — but
[`ListsProvider`](../../../src/state/ListsContext.tsx) mounts for the whole `signedIn` status, so real
list-fetching and a realtime subscription started inside that window on every cold start. That is
plenty wide to act inside, which is presumably how the report experienced it as "goes straight to the
app" rather than a flicker.

**The fix:** `enterSignedIn`'s restored branch no longer calls `setState` at all — it delegates
outright to `resolveRestoredSignIn`, which tries the on-device name cache first, then a fetch, and
never applies "assume set" to a state nothing has evidenced. Until one of those actually answers,
`AuthState` stays `{ status: 'loading' }` — mounting nothing, the same as first boot. `signedIn` is
now reached optimistically only from a *cache hit*, or from a *failed fetch* (the one place the app
still assumes a name exists with no evidence, deliberately, because a returning offline user must not
be locked out of cached lists over a name nobody has found missing) — never from "haven't checked
yet". A regression test in `SessionContext.test.tsx` asserts the transient state directly (a
deliberately-held-open fetch, checking `status: loading` while it is pending, neither `signedIn` nor
`nameRequired`) rather than only the eventual one, since the eventual state was never wrong.

**What to do:** any new branch of `AuthState` gated on data that isn't known synchronously follows
the same shape — hold `loading` (or whatever state precedes it) until a cache read or fetch actually
resolves, and write a test that inspects the state *while the resolving promise is still pending*,
not only after it settles. A `findByText`-only assertion cannot see a bug that only exists in the tick
before the expected state arrives.
