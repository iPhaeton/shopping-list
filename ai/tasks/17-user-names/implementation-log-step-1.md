# Implementation log — step 1: required, unique, editable user names

**Date:** 2026-09-21. Description: [description-step-1.md](description-step-1.md). Source proposal:
[ai/suggestions/user-names.md](../../suggestions/user-names.md).

## What changed

**Server** — `supabase/migrations/20260921000000_user_names.sql`:
- `public.users` gains a nullable `name text` column and a `unique index on (lower(name))`.
- New RPC `set_name(p_name text)` — the 10th write RPC to check `session_still_valid()`, the first
  to catch `unique_violation` and re-raise it under `22023` rather than let a raw `23505` reach the
  client (see "Decisions worth flagging").
- `list_members_of` dropped and recreated to also return `name`.

**Client:**
- New `src/lib/nameCache.ts` (mirrors `listCache.ts`) and `src/lib/profileApi.ts` (mirrors
  `membersApi.ts`: `fetchProfile`, `setName`).
- `src/state/SessionContext.tsx` — `AuthState` gains a `nameRequired` case
  (`{ session, confirmed: boolean }`) alongside `signedIn` gaining `name: string | null`. A new
  `hasResolvedOnce` ref distinguishes a live sign-in from a cold-start restore (both fire the literal
  `onAuthStateChange` event `'SIGNED_IN'` — confirmed by reading `@supabase/auth-js`'s
  `GoTrueClient` source, not assumed) so the two get different offline-fetch-failure fallbacks. A live
  sign-in goes straight to `nameRequired` and resolves from there; a restored session stays `loading`
  (see "Problem hit during verification" #3) until a cache read or a fetch actually decides between
  `signedIn` and `nameRequired` — never assumed either way before one of them answers. New
  `setName`/`retryName` context methods.
- `src/navigation/RootNavigator.tsx` / `types.ts` — one new route/switch arm, `SetName`, in the exact
  place `RootNavigator`'s own comment already anticipated a state like this.
- New `src/screens/SetNameScreen.tsx` — the blocking gate, same shape as `SignInScreen.tsx`.
- `src/lib/membersApi.ts` / `src/screens/SharingScreen.tsx` — roster rows carry `name`; a
  `displayNameFor` helper falls back to email for a not-yet-gated account.
- `src/screens/AccountScreen.tsx` — now shows email (previously shown nowhere) and name, with inline
  edit reusing `setName`.
- Tests: new `nameCache.test.ts`, `profileApi.test.ts`, `SetNameScreen.test.tsx`; updated
  `SessionContext.test.tsx`, `AccountScreen.test.tsx`, `SharingScreen.test.tsx`, `membersApi.test.ts`.

## Decisions worth flagging

- **The trigger does not seed `name` from Google's `full_name` claim.** Real names collide ("John
  Smith"), and a collision in `handle_new_user`'s insert would abort the whole `auth.users` insert
  transaction — sign-up itself would fail, opaquely, for the second "John Smith". Both sign-in
  methods leave every new account nameless; `SetNameScreen` only *prefills* from the OAuth claim as a
  client-side suggestion.
- **`set_name` catches `unique_violation` itself and re-raises under `22023`**, specifically so the
  raw `23505` never reaches the client: `verdictFor` in `listsApi.ts` hard-codes `23505 -> 'applied'`,
  calibrated for a client-minted insert retrying into itself, which would misclassify a genuine name
  collision as a quiet success were it not intercepted here.
- **Verified rather than assumed:** a raised `22023` reaches PostgREST as HTTP 400 (confirmed against
  the local stack via the browser's network log during manual verification), which `verdictFor`'s
  generic `status >= 400 -> 'permanent'` branch already classifies correctly — no code change was
  needed, but this was worth checking rather than guessing, the same habit `P0002`'s measured-500
  comment in `listsApi.ts` already models.
- **`list_members_of`'s return shape changed** (gained `name`) — relevant if any KB entry describes
  its old columns.
- **`session-still-valid-guards-writes`'s KB entry is now stale**: its `verify:` command asserts
  `session_still_valid` appears in exactly one migration file, and `set_name` is the tenth write RPC
  to use it, now spread across two files. Flagging for the deposit pass rather than hand-editing the
  entry.

## Problem hit during verification

Three bugs surfaced only once the new tests, and then a user-reported repro, actually ran — not from
reasoning about the design:

1. A new `SessionContext.test.tsx` case asserted a state transition without ever calling
   `auth.getSession.mockResolvedValue(...)` with a real session first — the app correctly stayed
   `signedOut` and the assertion timed out. Test bug, not a code bug; fixed by adding the missing
   mock.
2. `SetNameScreen`'s `useState(() => prefillFrom(session))` lazy initializer only ever runs once, at
   first mount. In production this is fine — `RootNavigator` only mounts `SetNameScreen` once
   `state.status` is already `nameRequired`, so `session` is real from the first render. The first
   draft of the test suite mounted the screen unconditionally from a signed-out start, so the
   initializer captured `session: null` and the Google-prefill assertion failed. Fixed by mounting
   through a small `GateHarness` in the test that mirrors `RootNavigator`'s actual conditional
   rendering, rather than adding defensive code to the component for a mount order that cannot happen
   for real.
3. **A real bug, reported by the user after the first verification pass, and reproduced against the
   local stack before fixing it:** sign up, leave the gate without setting a name, close the app,
   reopen it, and the app went straight past the gate into the normal app — `Account` would then show
   "Not set" for name, but a database check confirmed `public.users.name` genuinely stayed `null`; no
   name was silently written anywhere. The cause was in `enterSignedIn`'s original restored-session
   branch: it set `{ status: 'signedIn', name: null }` **synchronously**, before either the on-device
   cache or a fetch had said anything — "assume set, don't block" was meant as the fallback for a
   *failed* read, but the original code applied it to the merely-*pending* one too, on every single
   restore. The window was normally a tick or two (invisible to a `findByText` assertion, which is
   exactly why the original test suite didn't catch it), but `ListsProvider` mounts for the whole
   `signedIn` status, so real list-fetching and a realtime subscription started during that window on
   every cold start, and it was wide enough to act inside, which is presumably how the user's repro
   experienced it as "goes straight to the app" rather than a flicker. Fixed by splitting
   `enterSignedIn`'s restored branch into its own `resolveRestoredSignIn`, which leaves `AuthState` at
   `loading` — mounting nothing, same as first boot — until a cache read or a fetch actually resolves;
   `signedIn` is now reached optimistically only from a *cache hit*, and from a *failed fetch* exactly
   as originally intended, never from "haven't checked yet". Added a regression test asserting the
   transient state directly (`status: loading`, neither `signedIn` nor `nameRequired`, until a
   deliberately-held-open fetch is released) rather than only the eventual one, since the eventual
   state was never wrong — only the state in between was.

   The user's report also described the name ending up set to the account's email in the database.
   This did not reproduce: `auth.users.raw_user_meta_data` for an OTP account carries no `full_name`
   (only `sub`/`email`/`email_verified`/`phone_verified`), and `public.users.name` stayed `null`
   through the entire repro, checked directly via `psql` before and after. Left open — see the report
   back to the user.

## Verification

First pass, before the bug report:

- `npm run typecheck` — clean.
- `npm test` — 383/383 passing (21 suites), including three new suites and four updated ones.
- `npm run kb:audit` — 36/39 entries mechanically pass; the one failure
  (`session-still-valid-guards-writes`) is the expected, described drift above, for the librarian to
  reconcile.
- Local Supabase stack (`npx supabase db reset`, Docker) + `npm run web`, driven end to end with
  Playwright against the running browser, reading OTP codes from local Mailpit:
  - A brand-new OTP sign-up landed on `SetNameScreen` ("Choose a name") immediately after
    `verifyOtp` succeeded.
  - Submitting a name cleared straight into `Lists`; `Account` then showed both the email (not shown
    anywhere before this step) and the name, with a working inline edit.
  - A second account tried to claim the first account's name in a different case (`gate tester` vs.
    `Gate Tester`) and was refused with the exact string `that name is taken`, confirming the unique
    index is genuinely case-insensitive end to end, not just at the SQL level.
  - Sharing a list from the second account to the first showed the first account's name ("Gate
    Tester"), server-resolved via `list_members_of`, not the email — including in the roster's own
    role/remove labels.

Second pass, after fixing problem #3 above:

- `npm run typecheck` — clean.
- `npm test` — 384/384 passing, including a new regression test asserting the transient `loading`
  state directly.
- Reproduced the exact reported steps against the local stack in a real browser both before the fix
  (confirmed: closing and reopening landed straight on `Lists`, skipping the gate) and after
  (confirmed: lands directly on `SetNameScreen`, no intermediate `Lists` render observed across two
  separate close/reopen cycles) — `public.users.name` checked via `psql` and stayed `null` throughout
  both passes, which is what ruled out a silent write as the cause of the email-as-name half of the
  report.
