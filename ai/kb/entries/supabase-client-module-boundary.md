---
id: supabase-client-module-boundary
title: src/lib/supabase.ts is the only runtime importer of supabase-js, and the seam tests mock
type: convention
status: current
tags: [supabase, auth, testing, architecture]
sources: [ai/tasks/2/implementation-log-step-2.md, ai/tasks/3/implementation-log-step-1.md, ai/tasks/5-supabase-cloud/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-2.md, src/lib/supabase.ts, src/state/SessionContext.test.tsx, src/lib/listsApi.test.ts]
last_verified: 2026-09-08
verify: test -z "$(grep -rn "from '@supabase/supabase-js'" src --include='*.ts' --include='*.tsx' | grep -v '^src/lib/supabase.ts:' | grep -v 'import type')"
related: [writes-retry-from-an-outbox, supabase-local-stack, supabase-target-picked-at-runtime, rntl-14-api-changes]
---

[src/lib/supabase.ts](../../../src/lib/supabase.ts) creates the client and is the only file under
`src/` that imports `@supabase/supabase-js` at runtime. `SessionContext` imports `type { Session }`
from it, which TypeScript erases, so nothing else pulls the library into a bundle or into jest.

**That module is the test seam.** Both auth suites do `jest.mock('../lib/supabase', ...)` and render
the *real* `SessionProvider` against it, so `@supabase/supabase-js` is never loaded under jest and
`transformIgnorePatterns` in [package.json](../../../package.json) needs no entry for it. Mocking
`@supabase/supabase-js` itself, or calling `createClient` inline inside a provider or a screen,
gives that up and buys an ESM transform failure.

**A feature may add a seam of its own on top, and list data did.**
[src/lib/listsApi.ts](../../../src/lib/listsApi.ts) imports the client from here and exports the
plain query functions — four after step 3, nine after step 7's sharing UI added `updateListName`,
`fetchMembers`, `shareList`, `setMemberRole` and `removeMember`. Every list suite mocks
`../lib/listsApi` rather than this file, because faking PostgREST's chained builder
(`.from().select().order()`) is far more work than faking `fetchLists`. So the rule is not "one seam"
but "one importer": query modules import `../lib/supabase`, and screens and providers import the
query module. See [writes-retry-from-an-outbox](writes-retry-from-an-outbox.md).

**A screen may call the query module directly, and one does.** `SharingScreen` calls `fetchMembers`
/ `shareList` / `setMemberRole` / `removeMember` itself rather than going through `ListsContext`,
because the roster is not in `State`, is not cached, and has nothing for `replay` to fold. The seam
is unchanged by that — the screen still imports `listsApi`, never `supabase` — and its suite mocks
`../lib/listsApi` like all the others. The rule to carry: state that the reducer owns goes through
the provider; state that only one screen has goes in that screen's `useState`, calling the query
module directly.

**One suite is the exception, and it has to be: `listsApi`'s own.**
[src/lib/listsApi.test.ts](../../../src/lib/listsApi.test.ts) (step 7) mocks `./supabase` — the seam
*below* the module under test — and stubs each builder chain in about five lines, because the chains
are short and `fetchLists` is where a query shape can now be got wrong. It carries three such
helpers, one per chain shape the module uses: `.from().select().order()`,
`.from().update().eq().select()`, and `rpc()`. A module cannot be tested through the mock of itself;
every suite *above* `listsApi` still mocks `listsApi`.

**Not every module beside it is a seam to mock, though.** Step 4's `src/lib/outbox.ts` and
`src/lib/listCache.ts` are also plain modules under `lib/`, but the list suites deliberately let
them run for real against AsyncStorage's own jest mock — faking them would fake away the thing under
test. Mock the module that owns a *network* call; let the ones that own disk run.

**`sessionStorage` is exported by name** rather than passed inline as `storage: AsyncStorage`,
because it is the seam a biometric unlock replaces: it would swap in a blob encrypted under a
keystore-gated key with nothing else in the app changing. Ten lines that keep a planned feature to
one file — the same reasoning that shaped the state layer before persistence landed
(see [persistence-isolated-to-provider](persistence-isolated-to-provider.md), now superseded).

**Configuration that needs *testing* moves out, one module down.** Step 5 wrote `pickTarget()` —
which Supabase URL and key to use — inside `supabase.ts` first, and could not test it there: a suite
importing that file imports supabase-js, which is the thing this convention exists to prevent. It
lives in [src/lib/supabaseTarget.ts](../../../src/lib/supabaseTarget.ts) instead, with `supabase.ts`
importing it, so the branch has its own suite while the client seam stays thin
([supabase-target-picked-at-runtime](supabase-target-picked-at-runtime.md)). The rule generalises:
config that is only *set* belongs in `supabase.ts`; config that is *decided* belongs below it, where
a test can reach it.

**What to do:** need Supabase anywhere new? Import from `../lib/supabase`, and put anything that
needs configuring — storage, realtime, a service client — in that file rather than at the call site.
The `verify:` command allows type-only imports and fails on any other file importing the library.
