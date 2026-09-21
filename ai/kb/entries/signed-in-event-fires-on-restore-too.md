---
id: signed-in-event-fires-on-restore-too
title: onAuthStateChange's literal 'SIGNED_IN' event fires for a cold-start restore too, not only an interactive sign-in
type: gotcha
status: current
tags: [supabase, auth]
sources: [ai/tasks/17-user-names/implementation-log-step-1.md, src/state/SessionContext.tsx, node_modules/@supabase/auth-js/dist/module/GoTrueClient.js]
last_verified: 2026-09-21
verify: grep -q "hasResolvedOnce.current ? 'live' : 'restored'" src/state/SessionContext.tsx && grep -q "_recoverAndRefresh" src/state/SessionContext.tsx && grep -q "_notifyAllSubscribers('SIGNED_IN', currentSession)" node_modules/@supabase/auth-js/dist/module/GoTrueClient.js
related: [session-still-valid-guards-writes, supabase-client-module-boundary, restored-session-state-waits-for-evidence]
---

`supabase.auth.onAuthStateChange`'s callback receives the literal event string `'SIGNED_IN'` for two
different things: an interactive sign-in (OTP code verified, Google token exchanged) **and**, just as
often, an ordinary cold-start restore of a session already on disk. Nothing in the event's name or
payload tells the two apart. That distinction matters whenever a follow-up async step — a profile
fetch, anything else keyed off "a session just appeared" — should behave differently for a returning
user than for one who just proved connectivity by signing in live: treating a restore as if it were
live risks gating or re-checking a returning, possibly offline user over something it already knows.

**Confirmed by reading the installed library, not assumed.** `@supabase/auth-js`'s
`GoTrueClient._recoverAndRefresh` — the routine that loads a persisted session once at client
construction — calls `this._notifyAllSubscribers('SIGNED_IN', currentSession)` on its common path (an
unexpired session needing no refresh). That is the same event string every interactive sign-in path
in the same file broadcasts. No version of the docs states this; it is only visible in
`GoTrueClient.js` itself, and it is exactly the shape of fact this KB exists for — the code you'd
read to use the library gives no hint of it.

**What `SessionContext` does about it.**
[SessionContext.tsx](../../../src/state/SessionContext.tsx) sets a `hasResolvedOnce` ref the instant
its own `getSession()` call resolves for the first time. Any `'SIGNED_IN'` the listener sees *before*
that ref flips is folded into the same cold-start restore `getSession()` is about to report anyway
(`origin: 'restored'`); any it sees after is treated as a genuine live sign-in (`origin: 'live'`).
Being wrong here has only one failure direction — misreading a live sign-in as a restore — which just
applies the more lenient restore fallback once where the stricter one was due, never the reverse.

**What to do:** never branch on the event name `'SIGNED_IN'` alone to mean "the user just did
something interactive right now." New code whose behavior should differ between a restore and a live
sign-in reuses `hasResolvedOnce`/the `origin: 'restored' | 'live'` parameter already threaded through
`enterSignedIn`, rather than re-deriving the distinction from the event itself. `enterSignedIn` hands
a `'restored'` origin to `resolveRestoredSignIn` (cache-then-fetch, never assumes) and a `'live'` one
straight to `resolveName`; see
[restored-session-state-waits-for-evidence](restored-session-state-waits-for-evidence.md) for why the
two are no longer symmetric.
