---
id: postgrest-reads-retry-on-network-errors
title: postgrest-js retries every read 3 times (1 s/2 s/4 s) on a network error, so one failed page is 4 HTTP requests and ~7 s
type: gotcha
status: current
tags: [supabase, postgrest, network, offline, paging]
sources: [ai/tasks/24-search-and-sort/implementation-log-step-3.md, src/lib/listsApi.ts]
last_verified: 2026-10-09
verify: grep -q '"version": "2\.112\.' node_modules/@supabase/postgrest-js/package.json && grep -q '^const DEFAULT_MAX_RETRIES = 3;$' node_modules/@supabase/postgrest-js/dist/index.mjs && grep -qF 'Math.min(1e3 * 2 ** attemptIndex, 3e4)' node_modules/@supabase/postgrest-js/dist/index.mjs && grep -qF 'const RETRYABLE_STATUS_CODES = [520, 503];' node_modules/@supabase/postgrest-js/dist/index.mjs && ! grep -rqF '.retry(false)' src
related: [first-fetch-replaces-list-state, writes-retry-from-an-outbox, supabase-local-stack, supabase-client-module-boundary]
indexed: false
---

**postgrest-js 2.112 retries every GET, HEAD and OPTIONS by itself** — on a network error (a
failed `fetch`), and on HTTP 520 or 503. Three retries, after 1 s, 2 s and 4 s
(`DEFAULT_MAX_RETRIES`, `getRetryDelay` in `node_modules/@supabase/postgrest-js/dist`). Every read
in this app is a GET through it: `hydrate`, `hydrateLists`, a scroll page, the completion loop's
pages, the first page of a list.

**What that looks like.** Offline (requests to port 54321 aborted), one page asked for by the
completion loop in `usePaging` showed in the browser as **four** failed HTTP requests, at 0, 1, 3
and 7 s, and the coverage line's `failed` state appeared only after ~7 s. The loop itself issued
one logical request and stopped, as designed. So:

- **Count logical reads, not HTTP requests**, when judging whether code loops. Four requests per
  failed read offline is the library, not a bug in the caller.
- **A read failure surfaces ~7 s late.** A test or a flow waiting on a failed state offline needs a
  timeout past that.
- **Writes are untouched**: every write here is an RPC (POST), which postgrest-js never retries, so
  each gets exactly one attempt unless the outbox gives it another — the comment on the error
  classifier in [src/lib/listsApi.ts](../../../src/lib/listsApi.ts) relies on this.

**Deliberately not changed.** A per-query `.retry(false)` exists, and nothing in `src/` calls it.
Turning retries off app-wide, or for the completion loop only, is a decision for the user — do not
make it as a side effect of another fix.

The `verify:` pins the 2.112 line, the retry count, the backoff formula and the retried statuses,
and fails the day something in `src/` opts out with `.retry(false)` — revisit this entry then.
