# Implementation Log — Task 2, Step 2

**Date:** 2026-08-30
**Task:** [description-step-2.md](description-step-2.md) — email OTP sign-in, no biometric unlock
**Status:** Complete, verified end to end in the browser

## What was delivered

Passwordless sign-in: enter an email, receive a six-digit code, enter it, land in the app. The
session survives a reload; a header button signs out. A `users` table mirrors `auth.users`,
populated by a trigger and fenced by row-level security.

| | |
|---|---|
| Supabase JS | `@supabase/supabase-js` 2.x |
| Session storage | `@react-native-async-storage/async-storage` |
| Supabase CLI | 2.116.0, as a devDependency so `npx supabase` is pinned |
| Stack | local (`npx supabase start`) — Postgres :54322, API :54321, Mailpit :54324 |

This is step 1 of [ai/suggestions/otp-biometric-auth.md](../../suggestions/otp-biometric-auth.md),
minus list persistence.

## Decisions

### Local Supabase stack, not cloud

Confirmed with the user. The deciding factor was verification: the local stack ships Mailpit, so
the OTP email is machine-readable and the whole flow can be driven by Playwright. On cloud, the
code lands in a real inbox and a human has to relay it. Email templates also become committed
files under version control rather than a dashboard click-path.

Cost: a phone running Expo Go cannot reach the Mac's `127.0.0.1:54321`, so native is unverifiable
for this feature. Web was already the verification path, so nothing regressed.

### Auth only — `users` is the only table

The description says "create the `users` table", singular. Read literally: sign-in and sessions
land now; `lists`/`items` stay in memory. Confirmed with the user before starting.
`listsReducer.ts`, `ListsContext.tsx` and `src/state/types.ts` were not touched, so the reducer
tests stay pure and offline, and `ListsScreen.test.tsx` / `ListDetailScreen.test.tsx` needed no
edits at all.

**Consequence worth stating plainly:** the session persists across a reload, the lists do not.
That reads as a bug if you don't know the step boundary. The README now says so explicitly.

### `public.users` mirroring `auth.users`, populated by a trigger

`auth.users` is Supabase's table, not ours, and is not readable by the `anon`/`authenticated`
roles. So application columns live in `public.users`, keyed by the same uuid with
`references auth.users on delete cascade`.

Rows are minted by an `after insert or update of email` trigger running `security definer`, **not**
by the client. That is why there is no insert policy: the app cannot forge a row even if it tries.
`on conflict (id) do update set email = excluded.email` also keeps the mirrored address in sync
through an email change, and makes the trigger idempotent.

### Session state as a union, not a boolean

`SessionContext` exposes `{ status: 'loading' | 'signedOut' | 'signedIn' }` and `RootNavigator`
`switch`es on it. A `session ? app : signIn` branch would have to be unpicked when the planned
biometric `locked` state arrives; this way it is one new case in one switch.

### Sign-out lives in the navigator, not in `ListsScreen`

`headerRight: () => <SignOutButton />` is set in `RootNavigator`'s screen options. Putting it
inside `ListsScreen` would have given that screen a session dependency and forced both existing
screen test files to wrap in a `SessionProvider`. This way they are untouched.

### `sessionStorage` is a named export, not an inlined `storage: AsyncStorage`

Ten lines today that cost nothing, and precisely the seam a biometric unlock replaces — it would
swap in a blob encrypted under a keystore-gated key, with no other file changing.

### Errors are returned, not thrown

`requestCode` / `verifyCode` / `signOut` all return `{ error: string | null }`. This is the app's
first async failure surface and the UI previously had no error affordance at all; returning the
message lets `SignInScreen` render it instead of failing silently.

## Problems hit and how they were resolved

### The `useReducer` grep counts comments — including one about not using it

`npm run kb:audit` went red on `persistence-isolated-to-provider`, whose `verify:` asserts
`ListsContext.tsx` is the only file under `src/` matching `grep -rl useReducer`. The offender was
a **comment** in `SessionContext.tsx` explaining that it deliberately does *not* call `useReducer`.
The check greps text, so naming the hook at all trips it.

**Fix at the time:** reworded the comment to avoid the token. **That was the wrong fix** — a KB
check that fires on prose is a bad check. The librarian's deposit pass tightened the `verify:` to
`useReducer(` instead, so the comment now names the hook plainly again. Recorded here because the
instinct to edit source until an audit goes green is the thing to resist.

### `unmount()` is async in RNTL 14, like `render` and `fireEvent`

The unsubscribe-on-unmount test failed with 0 calls. Step 1's log records `render`/`fireEvent`
being async; `unmount` is too, and `await screen.unmount()` fixed it.

### A transition pushed in from outside React needs `act`

The test that drives an `onAuthStateChange` callback directly produced
`An update to SessionProvider inside a test was not wrapped in act(...)`. Nothing RNTL owns
triggered that update, so it needed `await act(async () => emitAuthChange(...))`. Awaiting the
assertion via `findByText` is not enough on its own.

### `supabase start` did not apply the migration

The first `npx supabase start` found existing containers and reported status without running
migrations — `public.users` did not exist afterwards. Editing `config.toml` also needs the auth
container restarted to take effect. `npx supabase stop && npx supabase start && npx supabase db
reset` settled both at once.

### Both email templates need overriding, not just Magic Link

Anticipated from the suggestion and confirmed empirically. GoTrue sends `confirmation` to a
brand-new address and `magic_link` to a returning one, and `shouldCreateUser: true` means the flow
hits both. Overriding only `magic_link` would have worked on the second sign-in and shipped a
magic link — which `verifyOtp` cannot accept — on the first. Both point at
`supabase/templates/otp-code.html`.

`verifyOtp({ type: 'email' })` was confirmed to accept both, so the new-user and returning-user
paths need no branch in the client.

## Files

```
supabase/migrations/20260830000000_users.sql   users table, RLS, trigger
supabase/templates/otp-code.html               renders {{ .Token }}
supabase/config.toml                           + confirmation / magic_link template overrides
src/lib/supabase.ts                            new — client, sessionStorage seam, AppState refresh
src/state/SessionContext.tsx                   new — auth union, requestCode/verifyCode/signOut
src/screens/SignInScreen.tsx                   new — email → code, resend cooldown, errors
src/components/SignOutButton.tsx               new — header button
src/navigation/RootNavigator.tsx               switch on status; headerRight on Lists
src/navigation/types.ts                        + SignIn route and props type
src/theme.ts                                   + colors.error
App.tsx                                        SessionProvider wraps ListsProvider
app.json                                       + scheme
.env / .env.example / .gitignore                local URL + anon key; .env now ignored
README.md                                      supabase start + Mailpit; persistence note corrected
```

Tests: `src/state/SessionContext.test.tsx`, `src/screens/SignInScreen.test.tsx`. Both mock
`src/lib/supabase.ts` at the module boundary and render the real `SessionProvider`, so
`@supabase/supabase-js` is never loaded by Jest and `transformIgnorePatterns` needed no change.

## Verification performed

1. `npm run typecheck` — clean under `strict: true`.
2. `npm test` — **40 tests across 5 suites, all passing** (27 → 40; the 27 existing ones untouched).
3. `npm run kb:audit` — 0 errors. Three `ground moved` warnings on uncommitted files, which are
   the librarian's business, not failures.
4. Schema, by `psql` against `127.0.0.1:54322`: `public.users` with the FK to `auth.users`,
   `relrowsecurity = t`, both policies present, `on_auth_user_created` on `auth.users`.
5. `npm run web` driven end to end in a real browser via Playwright:
   - sign-in screen on load; "Send code" disabled while the email is blank
   - `shopper@example.com` → code phase, resend showing a live countdown
   - **new-user email in Mailpit carried the code, not a link** — subject "Your sign-in code"
   - correct code → "My Lists" with the sign-out button in the header
   - created "Groceries"; the existing list flow is unaffected
   - **reload → still signed in** (the lists reset, as designed)
   - sign out → sign-in screen; reload → still signed out
   - signed in again with the same address: the **returning-user** template also carried a code
   - wrong code → "Token has expired or is invalid" rendered, field cleared, still on the code
     phase. The accompanying console 403 is the rejected `/auth/v1/verify` request itself.
   - otherwise 0 console errors; the one warning is React Navigation's known
     `props.pointerEvents is deprecated`, as in step 1.
6. Trigger and RLS, after two sign-ins:
   - `public.users` holds **exactly one row** — the `on conflict` path works
   - anon key reading `/rest/v1/users` → `[]`
   - anon insert → `HTTP 401`
   - the signed-in user's own token → exactly their own row

## Follow-ups / notes for later steps

- **`scope-boundaries` is now partly wrong** and needs a librarian pass: auth is in; persistence of
  list data and sharing are still out.
- Candidate KB facts handed to the librarian: the local-stack + Mailpit verification loop; both
  email templates needing `{{ .Token }}`; the `useReducer`-in-a-comment audit trap; `unmount` being
  async in RNTL 14; the `sessionStorage` seam.
- The biometric half (`secureSession.ts`, `UnlockScreen`, the `locked` state) is untouched and
  still needs a dev build. `scheme` is set, so that build will not need a rebuild for it.
- Nothing here is committed yet.
