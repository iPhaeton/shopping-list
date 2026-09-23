---
id: trigram-index-needs-three-characters
title: pg_trgm's GIN index cannot accelerate a 2-character search — search_users_by_name's shortest allowed query is a full scan
type: gotcha
status: current
tags: [supabase, postgres, pg_trgm, performance, search]
sources: [ai/tasks/18-share-by-name/implementation-log-step-1.md, ai/tasks/18-share-by-name/seed-1m-users.sql, ai/tasks/18-share-by-name/seed-1m-users-output.txt, supabase/migrations/20260922000000_share_by_name.sql, src/components/UserAutocomplete.tsx]
last_verified: 2026-09-23
verify: grep -q 'const MIN_QUERY_LENGTH = 2;' src/components/UserAutocomplete.tsx && grep -q 'using gin (lower(name) gin_trgm_ops)' supabase/migrations/20260922000000_share_by_name.sql
related: [scope-boundaries, read-rooted-at-list-members]
indexed: false
---

A `like '%text%'` pattern needs at least 3 literal characters before `pg_trgm` can extract a
trigram to probe with — [search_users_by_name](../../../supabase/migrations/20260922000000_share_by_name.sql)'s
`create index ... using gin (lower(name) gin_trgm_ops)` only speeds up a query once the caller has
typed that many. [UserAutocomplete](../../../src/components/UserAutocomplete.tsx)'s
`MIN_QUERY_LENGTH` is 2 — the shortest query the UI actually ever sends is exactly the length the
index cannot help with.

Measured against 1,000,000 seeded `public.users` rows
(`ai/tasks/18-share-by-name/seed-1m-users.sql`, raw output in `seed-1m-users-output.txt`): a 3+
character query (`'ann'`, `'Olivia Smith'`) plans as a `Bitmap Index Scan` on the trigram index,
2–230ms depending on match count and cache state — forcing the planner off that index on the same
warm query reproduces a `Parallel Seq Scan` roughly 4.5x slower. A 2-character query (`'an'`) plans
as a `Parallel Seq Scan` over the whole table regardless of cache state — ~270ms at 1M rows,
reproduced twice — because there is no trigram-backed plan to fall back from; none exists.

Not a bug in `search_users_by_name` itself — its escaping and 5-row cap both work as designed — and
not urgent at today's real row count. It is an **open, unresolved scaling gap**: every user's second
keystroke against this RPC costs a full-table scan that grows with the table, until either
`MIN_QUERY_LENGTH` moves to 3 (trading away one-character-sooner suggestions) or the scan is
accepted as the cost of a friendlier minimum. No future step should assume the trigram index covers
every query the UI can send without checking this first — `EXPLAIN` the function's own inline
query directly rather than wrapping the RPC call: `security definer` plus its `set search_path`
clause each independently block inlining, so `explain analyze select * from
search_users_by_name(...)` shows only an opaque `Function Scan`, never the plan inside it.
