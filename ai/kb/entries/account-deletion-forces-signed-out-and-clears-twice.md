---
id: account-deletion-forces-signed-out-and-clears-twice
title: After `delete_account` succeeds the device forces `signedOut`/`deleted` itself, keeps it sticky, and clears the account's keys twice — before the sign-out and again after the signed-in tree unmounts
type: gotcha
status: current
tags: [auth, state, persistence, account, deletion, outbox]
sources: [ai/tasks/25-account-deletion/implementation-log-step-3.md, src/state/SessionContext.tsx, src/screens/AccountScreen.tsx, src/lib/outbox.ts]
last_verified: 2026-10-05
verify: f=src/state/SessionContext.tsx && b=$(sed -n '/const deleteAccount = useCallback/,/}, \[state\]);/p' "$f") && n=$(for p in 'if (result.error) return result;' 'deletedUserId.current = userId;' 'await forgetAccount(userId);' "signOutReason.current = 'deleted';" "await supabase.auth.signOut({ scope: 'local' });" "enterSignedOut('deleted');"; do echo "$b" | grep -nF "$p" | head -1 | cut -d: -f1; done) && test "$(echo "$n" | grep -c .)" = 6 && echo "$n" | sort -n -c && grep -qF "prev.status === 'signedOut' && prev.reason === 'deleted' ? prev" "$f" && grep -qF "if (state.status !== 'signedOut' || state.reason !== 'deleted' || !deletedUserId.current) return;" "$f" && grep -A3 "state.reason !== 'deleted' || !deletedUserId.current) return;" "$f" | grep -qF 'void forgetAccount(userId);' && grep -qF 'Promise.all([clearCachedLists(userId), clearCachedName(userId), clearOutbox(userId)])' "$f" && grep -A4 'label="Delete account"' src/screens/AccountScreen.tsx | grep -qF 'disabled={pending || pendingEverywhere}' && grep -A3 'label="Sign out"$' src/screens/AccountScreen.tsx | grep -qF 'disabled={pending || pendingDelete}' && grep -A4 'label="Sign out of all devices"' src/screens/AccountScreen.tsx | grep -qF 'disabled={pendingDelete}'
indexed: false
related: [delete-account-locks-then-removes-sole-owned-lists, session-revoked-write-redirects, writes-retry-from-an-outbox, signed-in-event-fires-on-restore-too, restored-session-state-waits-for-evidence]
---

What the device does once `delete_account`
([delete-account-locks-then-removes-sole-owned-lists](delete-account-locks-then-removes-sole-owned-lists.md))
has answered, in `SessionContext.deleteAccount`
([SessionContext.tsx](../../../src/state/SessionContext.tsx)). Every step below looks removable and
is not.

**The order.** Guard on `signedIn`/`nameRequired`, call the RPC; on error return the result untouched
— nothing on the device changes. Then set `deletedUserId.current`, `await forgetAccount(id)` (list
cache, name cache and outbox — the one path that discards the outbox, see
[writes-retry-from-an-outbox](writes-retry-from-an-outbox.md)), set `signOutReason.current =
'deleted'`, `await supabase.auth.signOut({ scope: 'local' })` with its result ignored, and call
`enterSignedOut('deleted')` regardless.

**Why the state is forced, not left to `onAuthStateChange`.** In auth-js 2.112.4's `_signOut`
(`GoTrueClient.js`, about line 3412) the first branch is `if (sessionError &&
!isAuthSessionMissingError(sessionError)) return this._returnResult({ error: sessionError })` — it
returns *before* `removeCurrentSession()` and without notifying. A retryable (network) refresh
failure comes back as that `sessionError`, so in that one case the listener never hears `SIGNED_OUT`
and the stored session survives, leaving the device signed in to an account that no longer exists.
Forcing the state covers it. The leftover stored session self-heals: the next refresh gets 400
`refresh_token_not_found`, and auth-js removes it and emits `SIGNED_OUT`.

**`deleted` is sticky.** `enterSignedOut` keeps a `signedOut`/`deleted` state against any later
sign-out event; only a sign-in leaves it. Two races needed this:

- a flush step whose write comes back 403 `sessionRevoked` calls `signOut('revoked')`
  ([session-revoked-write-redirects](session-revoked-write-redirects.md)), and its `signOutReason =
  'revoked'` can overwrite `'deleted'` before the listener reads it;
- a failed auto-refresh later emits `SIGNED_OUT` with no reason.

Either would replace `SignInScreen`'s "Your account was deleted." with the wrong notice or none.

**The second clear.** `ListsProvider` can write the outbox and the list cache back after the first
clear — a flush step in flight when the RPC answered persists its queue; a hydration or the cache
effect writes rows — until it unmounts, in the render after the `deleted` state arrives. So an
effect on `state` runs when the state is `signedOut`/`deleted` and `deletedUserId.current` is set:
it takes the id, nulls the ref and runs `void forgetAccount(id)`. It works because React runs every
passive unmount cleanup before any new passive effect in a commit, so `ListsProvider`'s
`live.current = false` lands first and every write it started is already ahead in `inOrder`'s chain.
The first clear, before the sign-out, stays too, so an app kill in between leaves nothing.

**Residual, not handled:** `SessionContext`'s own `writeCachedName`. A background `resolveName`, or a
`setName` whose response arrives after the second clear, would re-create `name:<id>` — judged
negligible.

**The lock-out on `AccountScreen`.** `Delete account` is disabled while `pending ||
pendingEverywhere`; `Sign out` and `Sign out of all devices` are disabled while `pendingDelete`. A
plain `Sign out` racing a successful delete would reach `signedOut` with no reason, and the second
clear — keyed on `deleted` — would be skipped.

**What to do:** do not "simplify" `deleteAccount` to rely on the listener, drop either clear, or make
`enterSignedOut` overwrite unconditionally. A new account-ending action on `AccountScreen` joins the
mutual disabling. A new per-account key on disk joins `forgetAccount`.

The `verify:` asserts, inside `deleteAccount`, the error return, ref, first clear, reason, local
sign-out and forced state in that order; the sticky `enterSignedOut`; the second-clear effect;
`forgetAccount` covering cache, name and outbox; and the three disable conditions.
