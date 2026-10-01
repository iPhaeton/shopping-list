---
id: max-rows-is-a-silent-ceiling
title: PostgREST's `max_rows` silently caps embedded arrays too — `MAX_ROWS` mirrors it by hand, and a page must never be shorter than it asked for
type: gotcha
status: current
tags: [supabase, postgrest, pagination, config, persistence]
sources: [ai/tasks/11-pagination/implementation-log-step-1.md, ai/suggestions/pagination.md, supabase/config.toml, src/lib/listsApi.ts, ai/tasks/13-google-sign-in/implementation-log-step-1.md, ai/tasks/18-share-by-name/implementation-log-step-1.md, ai/tasks/23-list-limits/implementation-log-step-1.md]
last_verified: 2026-10-01
verify: test "$(grep -oE '^max_rows = [0-9]+' supabase/config.toml | grep -oE '[0-9]+')" = "$(grep -oE '^export const MAX_ROWS = [0-9]+' src/lib/listsApi.ts | grep -oE '[0-9]+')" && test "$(grep -oE '^export const PAGE_SIZE = [0-9]+' src/lib/listsApi.ts | grep -oE '[0-9]+')" -le "$(grep -oE '^export const MAX_ROWS = [0-9]+' src/lib/listsApi.ts | grep -oE '[0-9]+')" && test "$(grep -oE '^export const LIST_PAGE_SIZE = [0-9]+' src/lib/listsApi.ts | grep -oE '[0-9]+')" -le "$(grep -oE '^export const MAX_ROWS = [0-9]+' src/lib/listsApi.ts | grep -oE '[0-9]+')" && ! awk '/^\[remotes\.production\]/{f=1} f' supabase/config.toml | grep -q '^max_rows' && test "$(grep -c '\.limit(limit)' src/lib/listsApi.ts)" = 2 && test "$(grep -c 'if (limit > MAX_ROWS)' src/lib/listsApi.ts)" = 2 && test "$(grep -c 'rows.length < limit' src/lib/listsApi.ts)" = 2 && ! grep -q 'limit(MAX_ROWS)' src/lib/listsApi.ts
related: [read-rooted-at-list-members, deletion-is-a-tombstone, supabase-config-push-sends-the-whole-root, scope-boundaries, supabase-local-stack]
indexed: false
---

`[api] max_rows = 1000` in [supabase/config.toml](../../../supabase/config.toml) is a **silent**
ceiling on every response: a request for more rows comes back with exactly that many, **no error,
and no header says it was cut** — and it applies to each *embedded array* as well as to the top-level
rows. Measured on the local stack's PostgREST 14.5 while designing pagination (step 11). Nothing in
the client can discover the value at runtime.

**Why it matters here.** Paging rests on one rule — *a short page is the last page*: `fetchItems` and
`fetchLists` leave a `next` cursor only when a page came back full. A page silently shortened by the
cap would read as the end of the stream, and scrolling would stop with rows unread and nothing to say
so. Since task 23 lists are paged exactly as items are, so nothing asks for `MAX_ROWS` rows in one go
any more — the old capped list read, its `truncated` flag and its `__DEV__` warning are gone, and
the assertion below is the only guard left.

**What holds it together, all of it by hand.**

- `MAX_ROWS` in [src/lib/listsApi.ts](../../../src/lib/listsApi.ts) mirrors the config value. Keep
  the two equal; the `verify:` command is the only thing that notices when they drift.
- `PAGE_SIZE` (400 items, from a 100 kB-per-request budget at ~40-character titles) and
  `LIST_PAGE_SIZE` (100 lists, the user's number) stay `<= MAX_ROWS`, and `fetchItems` and
  `fetchLists` each **throw** on a `limit` above it rather than trusting the caller — a thrown page
  is loud, a capped one is not. A new paged read copies that assertion.
- **Never set `max_rows` under `[remotes.production]`**, and do not raise it in the cloud dashboard:
  `config push` sends the whole root and the remote inherits the root value
  ([supabase-config-push-sends-the-whole-root](supabase-config-push-sends-the-whole-root.md)), which
  is exactly what keeps one `MAX_ROWS` true for both environments.

Raising the page size is a two-file change (`PAGE_SIZE`, and the budget comment beside it), and the
bin's first page is the fetch-size term to watch
([deletion-is-a-tombstone](deletion-is-a-tombstone.md)). Raising `max_rows` itself is a three-place
change — config, `MAX_ROWS`, and a re-measure of the plan
([read-rooted-at-list-members](read-rooted-at-list-members.md)).
