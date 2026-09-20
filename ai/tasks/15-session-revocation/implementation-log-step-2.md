# Step 2 implementation log — redirect a kicked-out device to the sign-in screen

## What changed

- `src/lib/listsApi.ts`: `Result` gained `sessionRevoked?: boolean`. `resultFor` — the function both
  `writeResult` (the 6 outbox writes) and the 3 membership RPCs route through — sets it by matching
  the *exact* message `session_still_valid()` raises (`'this device has been signed out'`) against a
  `42501` error, before `writeResult`'s `humanize()` call can rewrite it to the generic sentence.
  `writeResult` needed no change: it already spreads `resultFor`'s return before overwriting `.error`.
- `src/state/SessionContext.tsx`: `AuthState`'s `signedOut` case gained `reason?: 'revoked'`, and
  `signOut` takes an optional `reason` parameter. `onAuthStateChange`'s listener only ever sees the
  resulting session, never why it changed, so a `useRef<'revoked' | undefined>` is set just before
  `supabase.auth.signOut` is called and consumed (read, then cleared) the next time the listener
  fires. `signOutEverywhere` and the initial `getSession()` restore stay reason-less.
- `src/state/useOutbox.ts`: `flush()` branches on `sessionRevoked` immediately after `sendWrite`
  returns, before the `target_deleted`/`retryable`/`permanent` branches — calls a new
  `onSessionRevoked()` callback and returns, skipping `setError`, `persist`, `dropDependents`, and
  `hydrate()` entirely. The op is deliberately left at the head of the queue, on disk exactly as it
  was persisted when enqueued: the write itself was never wrong, only this device's credentials were
  stale, so it replays once the user signs back in — the same "unsent writes flush at the next
  sign-in" behavior `SessionContext` already documents for an ordinary sign-out.
- `src/state/ListsContext.tsx`: `ListsProvider` takes a new required `onSessionRevoked: () => void`
  prop, threaded into `useOutbox`. The provider still never calls `useSession()` itself — the
  callback is opaque — so its own "nothing here consults the session" invariant holds.
- `App.tsx`: `ListsForSignedInUser` (already the seam between `SessionContext` and `ListsProvider`)
  now also destructures `signOut` and passes `onSessionRevoked={() => void signOut('revoked')}`.
- `src/screens/SharingScreen.tsx`: `run()`, the funnel all three membership RPCs go through, checks
  `sessionRevoked` first inside its `if (failure)` branch and calls `signOut('revoked')` instead of
  `setError`. Needed `useSession` newly imported here.
- `src/screens/SignInScreen.tsx`: reads `state` from `useSession()`, and renders
  `"You were signed out on another device."` above the phase-specific content when
  `state.reason === 'revoked'`.
- No migration, no other `supabase/` change — the backend has raised the distinct message since step
  1; this step is entirely about reading it before it gets erased, and reacting to it.

## Why this design

`RootNavigator` already swaps its whole stack to `SignInScreen` the instant `SessionContext.state`
becomes `signedOut`, and `ListsProvider` is only mounted while `signedIn` — confirmed by reading both
before writing any code. So the redirect itself needed no new screen, no navigation call, nothing
beyond calling the sign-out that already exists. All the actual work was in getting the *signal*
there intact:

**Two funnels, one detection point.** Six write RPCs go through the outbox
(`useOutbox.flush`), which retries and only reaches the user minutes later; three membership RPCs
(`share_list`, `set_member_role`, `remove_member`) are called synchronously from `SharingScreen`'s
`run()` and fail live. Both ultimately call `resultFor` in `listsApi.ts` — confirmed by reading
`writeResult`'s body, which calls `resultFor` and spreads its result before overwriting `.error` —
so that one function is where `sessionRevoked` is computed, once, for every caller.

**Message text, not errcode, is the signal.** `42501` is shared with every other permission refusal
this schema raises (wrong role, not an owner, stale membership) — trusting the code alone would
redirect a writer who merely tried something they were never allowed to do, which is wrong and would
be a confusing, silent sign-out for an ordinary refusal. The exact string
`'this device has been signed out'` is the only thing that tells the two apart, and it has to be
read before `humanize()` runs — found via the librarian's step-1 deposit report, which flagged that
`humanize()` was already silently collapsing this message for 6 of the 9 RPCs.

**The queue keeps the write, doesn't drop it.** The first design considered treated a
`sessionRevoked` failure exactly like any other `permanent` refusal: drop it via `dropDependents`,
show a banner, re-fetch. Rejected because nothing is wrong with the write — the tap was legitimate
and the same account may still want it applied once signed back in. Since the provider unmounts once
`state.status` flips (no re-render of the screen the banner would show on is coming), skipping
`setError`/`hydrate` entirely also avoids doing pointless work on a component about to disappear.

**Ref bridge for the reason, not a new event.** supabase-js's `onAuthStateChange` callback receives
only the resulting session, never a reason. Rather than inventing a parallel notification path, a
plain ref set immediately before the `signOut` call and read-then-cleared the next time the listener
fires was the smallest mechanism that gets the reason from "the caller who knows why" to "the
listener that owns state" without changing what triggers a re-render.

**The user chose to show why**, over a silent redirect, specifically because it also resolves the
`humanize()` gap for this one case: the device redirected here never reaches the screen that would
have shown the generic banner text, so what the librarian flagged as a UX gap in step 1 is closed as
a side effect of this step rather than needing its own fix to `humanize()`.

## Problem hit during implementation — not a design flaw, a test-suite gap

`SharingScreen.test.tsx` rendered the screen wrapped only in `ListsProvider`, never `SessionProvider`
— reasonable when the screen only read `useLists()`. Once it started reading `useSession()` too,
every test in that file would have crashed on mount (`useSession must be used inside a
<SessionProvider>`), and the render call sites also needed the same `src/lib/supabase.ts` and
`../lib/googleSignIn` module mocks the auth-focused suites already carry — `SessionContext.tsx`
imports `googleSignIn.ts`, which imports the native Google Sign-In module, which has no jest-safe
stand-in and throws `TurboModuleRegistry.getEnforcing` if reached. Caught by running the whole suite
before considering this done, not assumed from the diff. Fixed by adding both mocks and a
`withProviders` helper wrapping `SessionProvider` around the existing `ListsProvider` at all three
render sites in that file.

Separately: `resultFor`'s new field is set unconditionally (`true` or `false`, never `undefined`) for
every error case, which broke several existing `toEqual` assertions on exact `Result` shapes across
`listsApi.test.ts` and `membersApi.test.ts` that predate this field. Fixed by adding
`sessionRevoked: false` to those expected objects rather than making the field's absence mean
"false" — an explicit `false` is what the type already promises for any error case, and hiding that
behind an implicit default would make a future reader's `toEqual` pass without actually checking it.

## Verification

- `npm run typecheck` — clean.
- `npm test` — 18 suites / 352 tests, all passing (18 new since step 1's 344: `resultFor`'s exact
  message match in `listsApi.test.ts` and `membersApi.test.ts`; the outbox handoff and queue
  preservation in `ListsContext.test.tsx`; the reason ref-bridge, both directions, in
  `SessionContext.test.tsx`; the redirect-with-reason and no-reason-on-an-ordinary-visit in
  `SignInScreen.test.tsx`; the membership-RPC handoff in `SharingScreen.test.tsx`).
- Manual, end to end, against the local stack and the real web app (Metro on :8081): signed in with
  an existing persisted session, read the live access token out of the browser's own `localStorage`,
  and called `POST /auth/v1/logout?scope=global` against it directly — the same "another device
  signed out of everywhere" the original bug report described, reproduced with one browser rather
  than two (two tabs on one origin share `localStorage` and would collide into the same session, per
  the finding recorded during step 1's verification). With that now-revoked token still held by the
  page, toggling an item's checkbox in the UI: the app landed on the sign-in screen, page title
  flipped to "ShoppingLoop", and "You were signed out on another device." rendered above the email
  field. Console showed exactly two errors, both expected: the `set_item_done` RPC's `403`, and a
  `403` from the `signOut('revoked')` call's own `auth/v1/logout?scope=local` — the latter because
  the global revoke had already deleted the session server-side, so the local revoke had nothing left
  to revoke; supabase-js still clears its own local state regardless, which is what let the redirect
  happen. Neither is a regression.
- Not re-verified: a live two-device reproduction of the membership-RPC path (`SharingScreen`) end to
  end in the browser. Covered instead by the `SharingScreen.test.tsx` unit test asserting
  `auth.signOut` is called with `{ scope: 'local' }` and no refusal text renders — judged sufficient
  given the mechanism (`resultFor`'s detection) is shared and already verified live for the outbox
  path, and `run()`'s branch is a direct, five-line mirror of `useOutbox.flush`'s.
