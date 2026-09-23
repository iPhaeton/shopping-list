---
id: trigram-index-needs-three-characters
title: pg_trgm's GIN index cannot accelerate a query under 3 characters — client and server both floor search_users_by_name there now
type: gotcha
status: current
tags: [supabase, postgres, pg_trgm, performance, search]
sources: [ai/tasks/18-share-by-name/implementation-log-step-1.md, ai/tasks/18-share-by-name/implementation-log-step-2.md, ai/tasks/18-share-by-name/seed-1m-users.sql, ai/tasks/18-share-by-name/seed-1m-users-output.txt, supabase/migrations/20260922000000_share_by_name.sql, supabase/migrations/20260923000000_set_name_min_length.sql, src/components/UserAutocomplete.tsx]
last_verified: 2026-09-23
verify: grep -q 'const MIN_QUERY_LENGTH = 3;' src/components/UserAutocomplete.tsx && grep -q 'using gin (lower(name) gin_trgm_ops)' supabase/migrations/20260922000000_share_by_name.sql && grep -q 'char_length(trimmed) < 3' supabase/migrations/20260923000000_set_name_min_length.sql
related: [scope-boundaries, read-rooted-at-list-members, session-still-valid-guards-writes]
indexed: false
---

A `like '%text%'` pattern needs at least 3 literal characters before `pg_trgm` can extract a
trigram to probe with — [search_users_by_name](../../../supabase/migrations/20260922000000_share_by_name.sql)'s
`create index ... using gin (lower(name) gin_trgm_ops)` only speeds up a query once the caller has
typed that many. This is a property of `pg_trgm` itself, not of this schema, so it does not go away
with any future migration.

Measured against 1,000,000 seeded `public.users` rows
(`ai/tasks/18-share-by-name/seed-1m-users.sql`, raw output in `seed-1m-users-output.txt`): a 3+
character query (`'ann'`, `'Olivia Smith'`) plans as a `Bitmap Index Scan` on the trigram index,
2–230ms depending on match count and cache state — forcing the planner off that index on the same
warm query reproduces a `Parallel Seq Scan` roughly 4.5x slower. A 2-character query (`'an'`) plans
as a `Parallel Seq Scan` over the whole table regardless of cache state — ~270ms at 1M rows,
reproduced twice — because there is no trigram-backed plan to fall back from; none exists.

**As of step 18's second half this is closed, on both ends.**
[UserAutocomplete](../../../src/components/UserAutocomplete.tsx)'s `MIN_QUERY_LENGTH` moved from 2
to 3, so the client no longer fires a search short enough to force the scan. And
[set_name](../../../supabase/migrations/20260923000000_set_name_min_length.sql) now rejects any
name under 3 characters at the database, as a second `if` kept deliberately distinct from the
existing empty-name check (so `''` still gets "please enter a name" rather than "please enter at
least 3 characters"). Before this, a 1- or 2-character name was a contradiction the schema allowed:
a real account that `search_users_by_name` could never reach on an indexed plan. No backfill was
needed: no seeded row was shorter than 3 characters at the time.

**The gotcha for a future change is now this: do not lower `MIN_QUERY_LENGTH` below 3, and do not
add a second search entry point that allows a shorter query, without re-reading this entry.** The
underlying limitation has not moved — only the code's exposure to it has. `EXPLAIN` the function's
own inline query directly if this needs re-measuring, rather than wrapping the RPC call: `security
definer` plus its `set search_path` clause each independently block inlining, so `explain analyze
select * from search_users_by_name(...)` shows only an opaque `Function Scan`, never the plan
inside it.
