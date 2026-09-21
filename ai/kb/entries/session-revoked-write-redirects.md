---
id: session-revoked-write-redirects
title: A write refused for a revoked session redirects to sign-in instead of erroring, and stays queued
type: decision
status: current
tags: [state, auth, outbox, architecture]
sources: [ai/tasks/15-session-revocation/implementation-log-step-2.md, ai/tasks/17-user-names/implementation-log-step-1.md, src/lib/listsApi.ts, src/state/useOutbox.ts, src/state/ListsContext.tsx, src/state/SessionContext.tsx, src/screens/SharingScreen.tsx, src/screens/AccountScreen.tsx, src/screens/SetNameScreen.tsx, src/screens/SignInScreen.tsx, App.tsx]
last_verified: 2026-09-21
verify: grep -A2 'if (sessionRevoked) {' src/state/useOutbox.ts | grep -q 'onSessionRevoked();' && test "$(grep -n 'if (sessionRevoked) {' src/state/useOutbox.ts | head -1 | cut -d: -f1)" -lt "$(grep -n 'dropDependents(rest, op)' src/state/useOutbox.ts | head -1 | cut -d: -f1)" && grep -q 'onSessionRevoked: () => void;' src/state/useOutbox.ts && grep -q 'onSessionRevoked: () => void;' src/state/ListsContext.tsx && ! grep -qE "import .*SessionContext" src/state/ListsContext.tsx && grep -A2 'if (sessionRevoked) {' src/screens/SharingScreen.tsx | grep -q "signOut('revoked')" && grep -A2 'if (sessionRevoked) {' src/screens/AccountScreen.tsx | grep -q "signOut('revoked')" && grep -A2 'if (sessionRevoked) {' src/screens/SetNameScreen.tsx | grep -q "signOut('revoked')" && grep -q "signOut: (reason?: 'revoked') => Promise<Result>;" src/state/SessionContext.tsx && grep -q "state.reason === 'revoked'" src/screens/SignInScreen.tsx && grep -q "onSessionRevoked={() => void signOut('revoked')}" App.tsx
related: [session-still-valid-guards-writes, writes-retry-from-an-outbox, writes-can-land-on-a-tombstone]
---

`session_still_valid()` raises `42501` with the exact message `'this device has been signed out'` for
a write whose device was signed out elsewhere
([session-still-valid-guards-writes](session-still-valid-guards-writes.md)). `resultFor` in
[listsApi.ts](../../../src/lib/listsApi.ts) matches that string — not just the errcode, which every
other permission refusal in this schema also raises — and sets `Result.sessionRevoked` *before*
`writeResult` calls `humanize()`, which would otherwise collapse it to the same generic sentence as an
ordinary role refusal.

**One detection point, and every caller reacts to the flag instead of rendering anything — but not
through a shared funnel.** Six of the ten guarded RPCs are outbox writes, reached through
`useOutbox.flush`. The other four (`share_list`, `set_member_role`, `remove_member`, `set_name`) are
called synchronously, and each *call site* checks `sessionRevoked` for itself, inline — there is no
second shared helper the way `useOutbox.flush` is for the outbox side. `SharingScreen`'s `run()` is
one such call site, covering all three membership RPCs; `set_name` has **two**, since step 17 —
`AccountScreen`'s `saveName()` and `SetNameScreen`'s `submit()` — neither routed through `run()` or
through each other. All paths ultimately call `resultFor` (`writeResult` spreads its return before
rewriting `.error`), so `sessionRevoked` is computed once, but the reaction to it — `if
(sessionRevoked) { void signOut('revoked'); return; }` — is copied at each synchronous call site
rather than factored out; a fourth screen calling an RPC synchronously would repeat it again. None of
them ever render `humanize()`'s generic sentence or the raw database message for this case; the
device redirects before either would paint.

**The outbox write is not dropped — it is the one `permanent`-verdict case that is not.**
[writes-retry-from-an-outbox](writes-retry-from-an-outbox.md)'s rule is "only a refusal removes a
write"; a `sessionRevoked` refusal is `verdict: 'permanent'` too (`403` → `permanent` in
`verdictFor`), but `flush` intercepts it before reaching that branch, calls `onSessionRevoked()`, and
returns — skipping `setError`, `persist`, `dropDependents`, and `hydrate()` entirely. The write itself
was never wrong, only this device's credentials were, so the op is left exactly as it was persisted at
the head of the queue on disk and replays once the user signs back in — the same "unsent writes flush
at the next sign-in" behavior `SessionContext` already gives an ordinary local sign-out (the outbox is
deliberately not cleared on one). Skipping `hydrate()`/`setError` also avoids doing pointless work on a
provider about to unmount: `RootNavigator` swaps its stack to `SignInScreen` the instant
`SessionContext.state` flips to `signedOut`.

**`ListsProvider` learns about this without ever importing `useSession()`.** It takes a new required
`onSessionRevoked: () => void` prop, threaded straight into `useOutbox`; the callback is opaque, so the
provider's existing "nothing here consults the session" invariant holds (see
[writes-retry-from-an-outbox](writes-retry-from-an-outbox.md): do not reach for `useSession()` inside
`ListsContext`). `App.tsx`'s `ListsForSignedInUser` — already the seam between `SessionContext` and
`ListsProvider` — supplies `() => void signOut('revoked')`.

**The reason crosses a ref, not a new event.** `supabase.auth.onAuthStateChange`'s callback only ever
sees the resulting session, never why it changed. `SessionContext.signOut` now takes an optional
`reason?: 'revoked'` parameter; a plain `useRef<'revoked' | undefined>` is set immediately before
`supabase.auth.signOut` is called and read-then-cleared the next time the listener fires, landing on
`AuthState`'s `signedOut` case as `reason?: 'revoked'`. `signOutEverywhere` and the initial
`getSession()` restore stay reason-less — the ref exists for exactly this one caller. `SignInScreen`
renders `"You were signed out on another device."` above its normal content when
`state.reason === 'revoked'`.

**What to do:** a new write path that should redirect rather than drop on this refusal reads
`sessionRevoked` off the `Result` its caller already gets back and calls `signOut('revoked')` (or,
inside the outbox, the `onSessionRevoked` callback) — do not add a second detection point;
`resultFor` is already shared by every caller. A synchronous call site copies the three-line check
rather than reaching for a helper that does not exist yet; introducing one is fair game once a third
screen needs it, but nothing here forces it. The `verify:` command asserts the outbox's interception
happens before the write is ever dropped (`dropDependents`), that `ListsContext.tsx` still never
imports `SessionContext`, that every synchronous call site reacts to the flag, and that the reason
survives the round trip from `signOut` to `SignInScreen`.
