# Implementation Log — Task 3, Step 1

**Date:** 2026-08-31
**Task:** [description-step-1.md](description-step-1.md) — persist lists in the database, no sharing
**Status:** Complete, verified end to end in the browser

Note on the filename: the description in this folder is `description-step-1.md`, not
`description-step-3.md` as tasks 1 and 2 would suggest. The log is named to pair with the
description beside it.

## What was delivered

Lists and items live in Postgres, one owner each. Create a list, add items, tick one, reload — it
is all still there. A second account signing in on the same browser sees none of it, and that is
row-level security saying so, not a filter in the app.

This is staging step 1 of [ai/suggestions/supabase-persistence.md](../../suggestions/supabase-persistence.md):
persistence for a single owner. No `list_members`, no sharing, no realtime, no deletion.

## Decisions

### Optimistic writes, rolled back by re-fetching

Confirmed with the user. The client mints the row's uuid, the reducer moves immediately, and the
insert follows. On failure the message is surfaced and `fetchLists` runs again, so the screen ends
up showing what the database holds.

The alternative — awaiting the server before touching state — needs no rollback at all but puts a
round trip in front of every tick of a checkbox. Rolling back by re-fetching is what let the
optimistic version stay small: there is no `list/removed` or `item/removed` action, because one
path repairs every kind of failed write, and it repairs it with server truth rather than with the
client's guess at what it had just done.

### `Item.done: boolean` → `doneAt: string | null`

Also confirmed with the user, after weighing the smaller diff of keeping the boolean and converting
at the provider boundary. State now mirrors the row, so a realtime row will fold in verbatim when
that step lands. `ItemRow` derives `const done = item.doneAt !== null` and is otherwise unchanged.

The timestamp is minted in the provider and carried on the action, exactly as ids are — the
convention in [ids-minted-outside-reducer](../../kb/entries/ids-minted-outside-reducer.md) now
governs a second value, and the reducer stays deterministic.

### `item/toggled` → `item/setDone`, carrying an absolute value

The provider computes the target (`new Date().toISOString()` or `null`) and sends it whole; the
reducer is never asked to flip. A flip applied twice — by a retried request, or by a second device
— lands back where it started. The same absolute value applied twice is the same result, and the
reducer returns the identical state object for the second one.

### `src/lib/listsApi.ts` beside the provider, not PostgREST calls inside it

[persistence-isolated-to-provider](../../kb/entries/persistence-isolated-to-provider.md) planned for
storage to land in `ListsContext`, and it did — but the four queries sit in their own module. Two
reasons: it keeps `src/lib/supabase.ts` as the only importer of `@supabase/supabase-js`, and it is
a far better test seam than a fake of PostgREST's chained builder. `ListsContext.test.tsx` mocks
four plain functions.

Row → model mapping (`done_at` → `doneAt`) lives there too, so no database column names appear
anywhere under `src/state/`.

### The provider is mounted only while signed in

`App.tsx` gained a six-line `ListsForSignedInUser` that renders `<ListsProvider>` only for a
`signedIn` session, keyed on the user id. That is what lets the provider fetch on mount without
consulting the session at all: there is always a token, signing out unmounts it and discards one
account's lists with it, and a different account remounts it.

The alternative — `useLists` calling `useSession` — would have forced both existing screen test
files to wrap in a `SessionProvider` and mock supabase auth. They still render a bare
`<ListsProvider>`.

### Client-minted uuids, so `expo-crypto`

Counter ids (`list-1`) cannot be primary keys in a table shared by every account. `newId()` lives in
`src/lib/ids.ts` — one place where a native module is touched, and the seam jest replaces.

### No delete policies, no membership table

The task says sharing is out, and deletion has never been in. `lists` policies are plain
`auth.uid() = owner_id`; `items` policies check ownership through their list. The suggestion's
`is_list_member` `security definer` helper is **not** needed here: it exists to break the policy
recursion between `lists` and `list_members`, and with no membership table nothing recurses.

## Problems hit and how they were resolved

### `expo-crypto`'s `randomUUID()` returns `undefined` under jest

Not an error — jest-expo mocks the native module away and the call quietly yields `undefined`.
Every row would have got the same id and failed somewhere far from the cause. Probed for it before
writing a line of test (a throwaway suite that just logged the return value), then added
`jest.setup.ts` mapping `expo-crypto` to Node's `crypto.randomUUID`, wired in via `setupFiles`.

The mock factory uses `require` inside the body rather than a top-level import, because jest hoists
`jest.mock` above the imports and a factory may not close over them.

### Hydration replaces state, so it can wipe an optimistic write

`lists/loaded` replaces the whole list array. Anything created between mount and the fetch landing
is therefore discarded. In the app this cannot happen — `ListsScreen` renders a spinner, not an
input, until `status === 'ready'` — but `ListDetailScreen.test.tsx`'s harness created its list in a
`useEffect` that runs *before* the provider's, and the list vanished. The harness now waits for
`status === 'ready'`, mirroring what the app does.

### The empty state flashed before the first fetch returned

"No lists yet" is a claim about the database, and the screen was making it before asking. Hence the
`status` field and the spinner; a test asserts the empty state is *absent* while a deferred fetch is
in flight.

## Files

```
supabase/migrations/20260831000000_lists.sql   lists + items, indexes, RLS, owner-only policies
src/lib/ids.ts                                 new — newId(), the one native-crypto call site
src/lib/listsApi.ts                            new — the four queries; done_at <-> doneAt lives here
src/state/types.ts                             Item.doneAt; lists/loaded and item/setDone actions
src/state/listsReducer.ts                      + lists/loaded; item/setDone; countDone by doneAt
src/state/ListsContext.tsx                     hydrate on mount, optimistic writes, status + error
src/components/ErrorBanner.tsx                 new — role="alert", theme tokens
src/components/ItemRow.tsx                     derives `done` from doneAt
src/screens/ListsScreen.tsx                    spinner while loading; error banner
src/screens/ListDetailScreen.tsx               error banner
App.tsx                                        ListsProvider mounted only while signed in
jest.setup.ts / package.json                   new — expo-crypto mock; setupFiles
README.md                                      the "lists do not persist" note replaced
```

Tests: `src/state/ListsContext.test.tsx` new (7 cases, mocking `../lib/listsApi`);
`listsReducer.test.ts` reworked for the new actions; the two screen suites gained the same module
mock plus two new cases in `ListsScreen.test.tsx` (loading spinner, error banner).

## Verification performed

1. `npm run typecheck` — clean under `strict: true`.
2. `npm test` — **52 tests across 6 suites, all passing** (40 → 52).
3. `npm run kb:audit` — 0 errors. Six `ground moved` warnings on uncommitted files, the librarian's
   business rather than failures.
4. `npx supabase stop`-free path: `npx supabase start` then **`npx supabase db reset`**, which is
   what actually applied the new migration.
5. Schema by `psql`: both tables with their FKs, checks and indexes; `relrowsecurity = t` on both;
   six policies (three per table), no delete policy.
6. REST with the anon key: `GET /rest/v1/lists` → `[]`; forged insert → **401,
   "new row violates row-level security policy"**.
7. `npm run web` driven end to end with Playwright, codes read from Mailpit:
   - signed in as `shopper@example.com`; created "Groceries"; added "Milk" and "Bread"; ticked Milk
   - `psql` confirmed the row: uuid id, `owner_id` resolving to that account, `done_at` set on Milk
     and null on Bread
   - **reload → "Groceries, 1 of 2 done"**, the detail screen showing Milk ticked, Bread not, in
     insertion order
   - signed out, signed in as `other@example.com` → **"No lists yet"**: RLS proven from the UI, and
     the first account's state gone with its provider
   - patched `window.fetch` to fail the insert: the banner rendered "simulated insert failure" and
     the optimistic row **disappeared**, rolled back by the re-fetch. Restoring fetch and creating
     "Hardware" cleared the banner and persisted.
   - `psql` at the end: two lists, two owners, two items under Groceries
   - console: 0 errors, the known React Navigation `props.pointerEvents` warning. (The one 400 on
     `/auth/v1/token` was a stale refresh token in localStorage from before `db reset` wiped the
     auth schema.)

## Follow-ups / notes for later steps

- **`scope-boundaries` is now wrong again**: persistence is in; sharing, realtime and deletion are
  still out. **`persistence-isolated-to-provider` has been fulfilled**, and departed from in one
  respect — the queries sit in `src/lib/listsApi.ts`, not inside the provider. Being a `decision`
  entry it wants superseding rather than editing.
- Candidate KB facts for the librarian: `expo-crypto`'s `randomUUID` returning `undefined` under
  jest; `listsApi` as the module seam list tests mock; hydration replacing optimistic state and the
  `status` gate that makes that safe; owner-only RLS and why no `security definer` helper is needed
  until `list_members` exists.
- Offline is still not solved: a write lost to bad signal is lost, and the banner is the only thing
  that says so. PowerSync over the same database is the answer if that day comes.
- Sharing will *replace* the owner-only policies rather than extend them, and that is when the
  `is_list_member` helper earns its place.
- Nothing here is committed yet.
