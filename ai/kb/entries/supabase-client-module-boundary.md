---
id: supabase-client-module-boundary
title: src/lib/supabase.ts is the only runtime importer of supabase-js, and the seam tests mock
type: convention
status: current
tags: [supabase, auth, testing, architecture]
sources: [ai/tasks/2/implementation-log-step-2.md, src/lib/supabase.ts, src/state/SessionContext.test.tsx]
last_verified: 2026-08-30
verify: test -z "$(grep -rn "from '@supabase/supabase-js'" src --include='*.ts' --include='*.tsx' | grep -v '^src/lib/supabase.ts:' | grep -v 'import type')"
related: [persistence-isolated-to-provider, supabase-local-stack, rntl-14-api-changes]
---

[src/lib/supabase.ts](../../../src/lib/supabase.ts) creates the client and is the only file under
`src/` that imports `@supabase/supabase-js` at runtime. `SessionContext` imports `type { Session }`
from it, which TypeScript erases, so nothing else pulls the library into a bundle or into jest.

**That module is the test seam.** Both auth suites do `jest.mock('../lib/supabase', ...)` and render
the *real* `SessionProvider` against it, so `@supabase/supabase-js` is never loaded under jest and
`transformIgnorePatterns` in [package.json](../../../package.json) needs no entry for it. Mocking
`@supabase/supabase-js` itself, or calling `createClient` inline inside a provider or a screen,
gives that up and buys an ESM transform failure.

**`sessionStorage` is exported by name** rather than passed inline as `storage: AsyncStorage`,
because it is the seam a biometric unlock replaces: it would swap in a blob encrypted under a
keystore-gated key with nothing else in the app changing. Ten lines that keep a planned feature to
one file — the same reasoning as
[persistence-isolated-to-provider](persistence-isolated-to-provider.md).

**What to do:** need Supabase anywhere new? Import from `../lib/supabase`, and put anything that
needs configuring — storage, realtime, a service client — in that file rather than at the call site.
The `verify:` command allows type-only imports and fails on any other file importing the library.
