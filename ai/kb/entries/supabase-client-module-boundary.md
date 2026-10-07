---
id: supabase-client-module-boundary
title: src/lib/supabase.ts is the only runtime importer of supabase-js, and the seam tests mock
type: convention
status: current
tags: [supabase, auth, testing, architecture]
sources: [ai/tasks/2/implementation-log-step-2.md, ai/tasks/3/implementation-log-step-1.md, ai/tasks/5-supabase-cloud/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-2.md, ai/tasks/8-realtime/implementation-log-step-1.md, ai/tasks/11-pagination/implementation-log-step-1.md, ai/tasks/13-google-sign-in/implementation-log-step-2.md, ai/tasks/17-user-names/implementation-log-step-1.md, ai/tasks/18-share-by-name/implementation-log-step-1.md, ai/tasks/19-remove-oneself/implementation-log-step-1.md, ai/tasks/20-ux/implementation-log-step-1.md, ai/tasks/20-ux/implementation-log-step-3.md, ai/tasks/23-list-limits/implementation-log-step-2.md, ai/tasks/24-search-and-sort/implementation-log-step-2.md, ai/tasks/24-search-and-sort/implementation-log-step-3.md, ai/tasks/26-apple-sign-in/implementation-log-step-3.md, 9421c3c, src/lib/supabase.ts, src/lib/limits.ts, src/state/SessionContext.test.tsx, src/lib/listsApi.test.ts, src/lib/listsChannel.ts, src/lib/membersApi.ts, src/lib/profileApi.ts]
last_verified: 2026-10-07
verify: test -z "$(grep -rn "from '@supabase/supabase-js'" src --include='*.ts' --include='*.tsx' | grep -v '^src/lib/supabase.ts:' | grep -v 'import type')" && for f in $(grep -rl '<ListsProvider' src --include='*.test.tsx'); do grep -q "jest.mock('../lib/listsChannel'" "$f" || exit 1; done && for f in src/state/SessionContext.test.tsx src/screens/AccountScreen.test.tsx src/screens/SharingScreen.test.tsx src/screens/SetNameScreen.test.tsx; do grep -q "jest.mock('../lib/profileApi'" "$f" || exit 1; done && grep -q "import { supabase } from './supabase';" src/lib/profileApi.ts && grep -q "error.name !== 'FunctionsHttpError'" src/lib/profileApi.ts && grep -q "from '../lib/membersApi'" src/components/UserAutocomplete.tsx && for f in $(ls src/components/*.ts src/components/*.tsx | grep -v 'UserAutocomplete' | grep -v '\.test\.'); do ! grep -q "from '../lib/" "$f" || exit 1; done && grep -q "import { listLimitSentence } from '../lib/limits';" src/screens/ListsScreen.tsx && ! grep -qE "from '\./(listsApi|supabase)'" src/lib/limits.ts && test -z "$(grep -H "from '../lib/listsApi'" src/screens/*.tsx | grep -v '\.test\.tsx:' | grep -v ':import type ')"
related: [writes-retry-from-an-outbox, supabase-local-stack, supabase-target-picked-at-runtime, realtime-is-a-nudge-to-a-per-user-inbox, rntl-14-api-changes, component-suite-earned-by-owned-logic]
---

[src/lib/supabase.ts](../../../src/lib/supabase.ts) creates the client and is the only file under
`src/` that imports `@supabase/supabase-js` at runtime. Elsewhere only `import type` (erased by
TypeScript) is allowed, so nothing else pulls the library into a bundle or into jest. **The
boundary covers the app only:** the Edge Functions under `supabase/functions/` import supabase-js
as `npm:` on Deno, outside `src/`, and the `verify:` does not look there.

**That module is the test seam.** Both auth suites do `jest.mock('../lib/supabase', ...)` and render
the *real* `SessionProvider` against it, so `@supabase/supabase-js` is never loaded under jest and
`transformIgnorePatterns` in [package.json](../../../package.json) needs no entry for it. Mocking
`@supabase/supabase-js` itself, or calling `createClient` inline inside a provider or a screen,
gives that up and buys an ESM transform failure.

**A feature may add a seam of its own on top, and list data did.**
[src/lib/listsApi.ts](../../../src/lib/listsApi.ts) imports the client from here and exports the
plain query functions. Every list suite mocks `../lib/listsApi` rather than this file, because
faking PostgREST's chained builder (`.from().select().order()`) is far more work than faking
`fetchLists`. So the rule is not "one seam" but "one importer": query modules import
`../lib/supabase`, and screens and providers import the query module. See
[writes-retry-from-an-outbox](writes-retry-from-an-outbox.md).

**The sharing/roster functions are a second query module, and it is not a duplicate seam.**
[src/lib/membersApi.ts](../../../src/lib/membersApi.ts) imports `supabase` from here directly and
`resultFor`/`type Result` from `listsApi.ts` rather than redefining them, so it is built *on top of*
`listsApi.ts`, which keeps the list/item functions and the shared result-classification helpers.
A suite rendering a screen that touches both mocks `../lib/listsApi` and `../lib/membersApi` as two
separate `jest.mock(...)` calls, never one file standing in for the other.

**[src/lib/listsChannel.ts](../../../src/lib/listsChannel.ts) sits at the seam too, and is not a
query module.** It holds `subscribeToChanges`, the client side of the realtime socket
([realtime-is-a-nudge-to-a-per-user-inbox](realtime-is-a-nudge-to-a-per-user-inbox.md)), beside
`listsApi` because a subscription has a lifetime and is not a query. Its suite mocks `./supabase`.

**The consequence every list suite pays: a suite that renders `ListsProvider` must
`jest.mock('../lib/listsChannel', …)`, or the provider opens a websocket under jest.** The `verify:`
asserts every `ListsProvider`-rendering suite has one, so a new one that forgets fails the check. In
`ListsContext.test.tsx` the mock is also the *handle*: it captures the two callbacks so a test can
deliver a nudge or a reconnect by hand, wrapped in `act` because it is an external update
([rntl-14-api-changes](rntl-14-api-changes.md)).

**A screen may call the query module directly, and one does.** `SharingScreen` calls `fetchMembers`
/ `shareList` / `setMemberRole` / `removeMember` / `leaveList` itself rather than going through `ListsContext`,
because the roster is not in `State`, is not cached, and has nothing for `replay` to fold. The seam
is unchanged by that — the screen still imports a query module, never `supabase` — it is just
`membersApi.ts` for all five, plus `type Result` from `listsApi.ts`; its suite mocks both. The
rule to carry: state that the reducer owns goes through the provider; state that only one screen has
goes in that screen's `useState`, calling the query module directly.

**The same rule reaches a component.**
[UserAutocomplete](../../../src/components/UserAutocomplete.tsx) owns a debounced search effect and
calls `membersApi.searchUsers` itself rather than taking suggestions as a prop, because the effect
(timer, in-flight-response race) is the component's own state, with nothing for a parent to hold.
Read "screens and providers import the query module" as "whatever owns the state that triggers the
call does" — a presentational component (`ItemRow`, `ListRow`, `RolePicker`, all of task 20's) takes
its data as props, reads only the theme from context (and, for `Card`, `Backdrop`'s blur target),
and imports nothing from `lib/`. The `verify:` holds every file in `src/components/` but
`UserAutocomplete` to that.

**One suite is the exception, and it has to be: `listsApi`'s own — and `membersApi`'s is the same
exception a second time.** [src/lib/listsApi.test.ts](../../../src/lib/listsApi.test.ts) mocks
`./supabase` — the seam *below* the module under test — because `fetchLists` and `fetchItems` are
where a query shape can be got wrong. Its `respondWith` is a **recording** builder (each method it
names returns itself and logs `[method, args]`), so a test asserts a read's shape without the stub
knowing its chain order; `respondToRpcWith` serves the writes. `membersApi.test.ts` has its own copy,
deliberately: no two suites share builder helpers. A module cannot be tested through its own mock.

**`SessionContext` has its own query module at the seam.**
[src/lib/profileApi.ts](../../../src/lib/profileApi.ts) holds `fetchProfile`/`setName`/`deleteAccount`/
`deleteAccountWithApple`; it imports `supabase` from here directly, the same "one importer" shape as
`membersApi.ts`. `SessionContext` calls `fetchProfile` on every sign-in, live or restored, to
resolve the name gate — so **every suite that renders `SessionProvider` and lets a session go
non-null must `jest.mock('../lib/profileApi', () => ({ fetchProfile: jest.fn(), setName: jest.fn() }))`**,
the same consequence `listsChannel.ts` forces on `ListsProvider` suites. `SignInScreen.test.tsx`
skips it only because none of its cases ever emit a non-null session to the listener.

**An error class is told apart by `error.name`, never `instanceof`.** `deleteAccountWithApple` calls
`supabase.functions.invoke`, and only a `FunctionsHttpError` carries the function's answer (a
`Response` in `error.context`). Importing that class would be a runtime import of supabase-js
outside `supabase.ts`, so it checks `error.name !== 'FunctionsHttpError'` instead. Do the same for
any supabase-js error class a query module needs to recognise.

**Not every module beside it is a seam to mock, though.** `src/lib/outbox.ts` and
`src/lib/listCache.ts` are plain modules under `lib/` too, but the list suites let them run for real
against AsyncStorage's own jest mock — faking them would fake away the thing under test. Mock the
module that owns a *network* call; let the ones that own disk run.

**`sessionStorage` is exported by name** rather than passed inline as `storage: AsyncStorage`,
because it is the seam a biometric unlock would replace — a keystore-gated blob with nothing else in
the app changing ([persistence-isolated-to-provider](persistence-isolated-to-provider.md), superseded).

**Configuration that needs *testing* moves out, one module down.** `pickTarget()` — which Supabase
URL and key to use — cannot be tested inside `supabase.ts`, because a suite importing that file
imports supabase-js. It lives in [src/lib/supabaseTarget.ts](../../../src/lib/supabaseTarget.ts),
which `supabase.ts` imports ([supabase-target-picked-at-runtime](supabase-target-picked-at-runtime.md)).
Config that is only *set* belongs in `supabase.ts`; config that is *decided* belongs below it.

**A value a screen shows moves out of `listsApi` for the same kind of reason.** Every list suite
mocks `../lib/listsApi` with a factory, and `supabase.ts` throws at import without env, so
`jest.requireActual` is no way round it. A constant or sentence a screen read from `listsApi` would be
the factory's copy, and a test asserting it would assert the mock against itself. So the limits
(`MAX_OWNED_LISTS`, `MAX_LISTS`, `MAX_ITEMS`, the SQLSTATEs and the three sentences) live in
[src/lib/limits.ts](../../../src/lib/limits.ts), which imports neither, not beside `MAX_ROWS`;
`humanize` and `ListsScreen` both read them there. `src/lib/searchCopy.ts` is the same kind of
module, reusing `limits.ts`' exported `grouped`. The `verify:` keeps screens to type imports from
`listsApi` and `limits.ts` free of both modules.

**What to do:** need Supabase anywhere new in `src/`? Import from `../lib/supabase`, and put
anything that needs configuring — storage, realtime, a service client — in that file rather than at
the call site. The `verify:` fails on any other file importing the library at runtime.
