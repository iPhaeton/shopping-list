---
id: optimistic-list-writes
title: List writes are optimistic and roll back by re-fetching; the queries live in src/lib/listsApi.ts
type: decision
status: superseded
superseded_by: [writes-retry-from-an-outbox]
tags: [state, persistence, supabase, architecture]
sources: [ai/tasks/3/implementation-log-step-1.md, ai/tasks/4-offline-support/implementation-log-step-1.md, src/state/ListsContext.tsx, src/lib/listsApi.ts]
last_verified: 2026-09-01
verify: test "$(grep -rl 'useReducer(' src --include='*.ts' --include='*.tsx')" = src/state/ListsContext.tsx && grep -q "from './supabase'" src/lib/listsApi.ts && ! grep -q "lib/supabase'" src/state/ListsContext.tsx && ! grep -qE "removed'|deleted'" src/state/types.ts
related: [writes-retry-from-an-outbox, list-data-scoped-by-rls, server-stamps-done-at, first-fetch-replaces-list-state, supabase-client-module-boundary, ids-minted-outside-reducer, persistence-isolated-to-provider]
---

> **Superseded by [writes-retry-from-an-outbox](writes-retry-from-an-outbox.md) (step 4).** A failed
> write is no longer abandoned and no longer repaired by a re-fetch: it is queued on disk and
> retried until the database takes it, and only a *refusal* re-fetches. The last paragraph below —
> "Still not solved: offline. A write lost to bad signal is lost" — is the sentence step 4 was
> written to delete. Everything else here (optimistic dispatch, absolute values, no compensating
> actions, the `listsApi` seam, the provider mounted only while signed in) was carried forward
> rather than reversed; read the superseding entry for the current form.

Persistence landed in step 3. [src/state/ListsContext.tsx](../../../src/state/ListsContext.tsx)
hydrates on mount and owns every write; the four database calls — three PostgREST queries and one
RPC — sit one module over in [src/lib/listsApi.ts](../../../src/lib/listsApi.ts), which is also the
only place that knows the database's names (`done_at` becomes `doneAt` there, so no row shape
reaches `src/state/`).

**Decision: the client moves first, and a failure repairs itself with a re-fetch.** The id is minted
up front, the reducer dispatches immediately, the request follows. On failure the provider sets
`error` and calls `fetchLists` again, so the screen converges on what the database holds rather than
on the client's guess at what it had just done.

**That is why there is no `list/removed` or `item/removed` action, and no inverse of any write.** One
path repairs every kind of failed write. Adding a compensating action per write is the mistake this
avoids — it doubles the action surface to reproduce, less accurately, what one re-fetch already does.
The alternative shape, awaiting the server before touching state, needs no rollback at all but puts a
round trip in front of every tick of a checkbox; it was weighed and rejected.

**Writes carry absolute values, never flips.** A flip applied twice by a retry or a second device
lands back where it started; the same absolute value applied twice is the same result, and the
reducer returns the identical state object for the second one (see
[update-list-identity-preserving](update-list-identity-preserving.md)). Keep this property when
adding a write: send what the row should become, not what to do to it.

**What crosses to the database for a tick is now a boolean, not a timestamp.** `setItemDone(itemId,
done)` calls the `set_item_done` function and Postgres stamps `done_at` from its own clock; the
`doneAt` string the provider puts on the `item/setDone` action is a placeholder for the optimistic
row only. That is the same absolute-value rule stated more exactly, not a departure from it — see
[server-stamps-done-at](server-stamps-done-at.md), which also records why the device's clock stopped
being trusted and what it costs.

**The provider is mounted only while signed in.** `App.tsx` wraps it in a six-line
`ListsForSignedInUser` that renders `<ListsProvider key={userId}>` for a `signedIn` session only.
That is what lets `ListsContext` fetch on mount without consulting the session at all: there is
always a token, sign-out unmounts the provider and discards one account's lists with it, and a
different account remounts it. Do not reach for `useSession()` inside `ListsContext` — besides being
redundant, it would force both screen test suites to stand up a `SessionProvider` and mock supabase
auth, where today they render a bare `<ListsProvider>`.

**Why `listsApi` rather than queries inside the provider:** it keeps
[src/lib/supabase.ts](../../../src/lib/supabase.ts) the sole importer of `@supabase/supabase-js`
(see [supabase-client-module-boundary](supabase-client-module-boundary.md)), and four plain functions
are a far better test seam than a fake of PostgREST's chained builder. Every list suite does
`jest.mock('../lib/listsApi', ...)`.

This supersedes [persistence-isolated-to-provider](persistence-isolated-to-provider.md), which
planned for storage to land *inside* `ListsContext` and nowhere else. It largely did — the reducer,
the components and the screens' data flow were untouched — but the query module beside it is a real
departure, and the plan is now a fact.

**Still not solved: offline.** A write lost to bad signal is lost, and the banner is the only thing
that says so. Nothing queues or retries. Do not assume otherwise when adding a feature.

The `verify:` command asserts the four things that make this shape work: `ListsContext` is still the
only file calling `useReducer`, `listsApi` is what talks to the Supabase client, the provider does
*not* import that client itself, and no remove/delete action has appeared in `src/state/types.ts`. A
compensating action is the change most likely to be made without reading this entry, so the check
looks for one.
