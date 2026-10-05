---
id: session-revoked-write-redirects
title: A write refused for a revoked session redirects to sign-in instead of erroring, and stays queued
type: decision
status: current
tags: [state, auth, outbox, architecture]
sources: [ai/tasks/15-session-revocation/implementation-log-step-2.md, ai/tasks/17-user-names/implementation-log-step-1.md, ai/tasks/18-share-by-name/implementation-log-step-1.md, ai/tasks/19-remove-oneself/implementation-log-step-1.md, ai/tasks/25-account-deletion/implementation-log-step-3.md, src/lib/listsApi.ts, src/state/useOutbox.ts, src/state/ListsContext.tsx, src/state/SessionContext.tsx, src/screens/SharingScreen.tsx, src/screens/AccountScreen.tsx, src/screens/SetNameScreen.tsx, src/screens/SignInScreen.tsx, App.tsx]
last_verified: 2026-10-05
verify: grep -A2 'if (sessionRevoked) {' src/state/useOutbox.ts | grep -q 'onSessionRevoked();' && test "$(grep -n 'if (sessionRevoked) {' src/state/useOutbox.ts | head -1 | cut -d: -f1)" -lt "$(grep -n 'dropDependents(rest, op)' src/state/useOutbox.ts | head -1 | cut -d: -f1)" && grep -q 'onSessionRevoked: () => void;' src/state/useOutbox.ts && grep -q 'onSessionRevoked: () => void;' src/state/ListsContext.tsx && ! grep -qE "import .*SessionContext" src/state/ListsContext.tsx && grep -A2 'if (sessionRevoked) {' src/screens/SharingScreen.tsx | grep -q "signOut('revoked')" && test "$(grep -A1 'if (sessionRevoked) {' src/screens/AccountScreen.tsx | grep -c "void signOut('revoked');")" -ge 2 && grep -A2 'if (sessionRevoked) {' src/screens/SetNameScreen.tsx | grep -q "signOut('revoked')" && grep -q "signOut: (reason?: 'revoked') => Promise<Result>;" src/state/SessionContext.tsx && grep -q "revoked: 'You were signed out on another device.'" src/screens/SignInScreen.tsx && grep -q 'NOTICES\[state.reason\]' src/screens/SignInScreen.tsx && grep -q "onSessionRevoked={() => void signOut('revoked')}" App.tsx
related: [session-still-valid-guards-writes, writes-retry-from-an-outbox, writes-can-land-on-a-tombstone, account-deletion-forces-signed-out-and-clears-twice]
---

`session_still_valid()` raises `42501` with the exact message `'this device has been signed out'` for
a write whose device was signed out elsewhere
([session-still-valid-guards-writes](session-still-valid-guards-writes.md)). `resultFor` in
[listsApi.ts](../../../src/lib/listsApi.ts) matches that string — not just the errcode, which every
other permission refusal in this schema also raises — and sets `Result.sessionRevoked` *before*
`writeResult` calls `humanize()`, which would otherwise collapse it to the same generic sentence as an
ordinary role refusal.

**One detection point, and every caller reacts to the flag instead of rendering anything — but not
through a shared funnel.** Six of the twelve guarded RPCs are outbox writes, reached through
`useOutbox.flush`. The other six (`share_list`, `set_member_role`, `remove_member`, `leave_list`,
`set_name`, `delete_account`) are called synchronously, and each *call site* checks `sessionRevoked` for itself, inline
— there is no second shared helper the way `useOutbox.flush` is for the outbox side. `SharingScreen`'s
`run()` is one such call site, covering all four membership RPCs; `set_name` has **two** —
`AccountScreen`'s `saveName()` and `SetNameScreen`'s `submit()` — and `delete_account` one,
`AccountScreen`'s `pressConfirmDelete()`, so `AccountScreen` holds two inline checks; none is routed
through `run()` or through another. All paths ultimately call `resultFor` (`writeResult` spreads its return before
rewriting `.error`), so `sessionRevoked` is computed once, but the reaction to it — `if
(sessionRevoked) { void signOut('revoked'); return; }` — is copied at each synchronous call site
rather than factored out; a new synchronous call site would repeat it again. None of
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
sees the resulting session, never why it changed. `SignOutReason` is `'revoked' | 'deleted'`; a plain
`useRef<SignOutReason | undefined>` is set immediately before `supabase.auth.signOut` is called and
read-then-cleared the next time the listener fires, landing on `AuthState`'s `signedOut` case as
`reason`. `SessionContext.signOut` still takes only `reason?: 'revoked'`; `'deleted'` is set by
`deleteAccount` alone, and a `deleted` state is sticky — `enterSignedOut` keeps it against any later
sign-out event, this redirect's `signOut('revoked')` included
([account-deletion-forces-signed-out-and-clears-twice](account-deletion-forces-signed-out-and-clears-twice.md)).
`signOutEverywhere` and the initial `getSession()` restore stay reason-less. `SignInScreen` renders
one notice per reason from `NOTICES`, a `Record<SignOutReason, string>` — `revoked` is `"You were
signed out on another device."` — so a new reason does not compile until it has copy.

**What to do:** a new write path that should redirect rather than drop on this refusal reads
`sessionRevoked` off the `Result` its caller already gets back and calls `signOut('revoked')` (or,
inside the outbox, the `onSessionRevoked` callback) — do not add a second detection point;
`resultFor` is already shared by every caller. A synchronous call site copies the three-line check
rather than reaching for a helper that does not exist yet; introducing one is fair game once a third
screen needs it, but nothing here forces it. The `verify:` command asserts the outbox's interception
happens before the write is ever dropped (`dropDependents`), that `ListsContext.tsx` still never
imports `SessionContext`, that every synchronous call site reacts to the flag (both of
`AccountScreen`'s), and that the `revoked` reason reaches `SignInScreen`'s `NOTICES` map.
