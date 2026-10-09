---
id: trigram-index-needs-three-characters
title: pg_trgm's GIN index cannot accelerate a query under 3 characters — client and server both floor search_users_by_name there now
type: gotcha
status: current
tags: [supabase, postgres, pg_trgm, performance, search]
sources: [ai/tasks/18-share-by-name/implementation-log-step-1.md, ai/tasks/18-share-by-name/implementation-log-step-2.md, ai/tasks/18-share-by-name/seed-1m-users.sql, ai/tasks/18-share-by-name/seed-1m-users-output.txt, supabase/migrations/20260922000000_share_by_name.sql, supabase/migrations/20260923000000_set_name_min_length.sql, src/components/UserAutocomplete.tsx, ai/tasks/20-ux/implementation-log-step-5.md, ai/tasks/28-invitations/implementation-log-step-1.md, 47965d5, supabase/migrations/20261008000000_invitations.sql, src/lib/membersApi.ts]
last_verified: 2026-10-09
verify: grep -q 'const MIN_QUERY_LENGTH = 3;' src/components/UserAutocomplete.tsx && grep -q 'using gin (lower(name) gin_trgm_ops)' supabase/migrations/20260922000000_share_by_name.sql && grep -q 'char_length(trimmed) < 3' supabase/migrations/20260923000000_set_name_min_length.sql && grep -q '^drop function public.search_users_by_name(text);' supabase/migrations/20261008000000_invitations.sql && test "$(cat supabase/migrations/*.sql | grep -E '^create (or replace )?function public\.search_users_by_name\(' | tail -1)" = 'create function public.search_users_by_name(p_query text, p_list_id uuid default null)' && sed -n '/^create function public.search_users_by_name(p_query text, p_list_id/,/^\$\$;/p' supabase/migrations/20261008000000_invitations.sql | grep -q "lower(u.name) like '%' || lower("
related: [scope-boundaries, read-rooted-at-list-members, session-still-valid-guards-writes, supabase-local-stack]
indexed: false
---

A `like '%text%'` pattern needs at least 3 literal characters before `pg_trgm` can extract a
trigram to probe with — the [share-by-name migration](../../../supabase/migrations/20260922000000_share_by_name.sql)'s
`create index ... using gin (lower(name) gin_trgm_ops)` behind `search_users_by_name` only speeds up a query once the caller has
typed that many. This is a property of `pg_trgm` itself, not of this schema, so it does not go away
with any future migration.

Measured against 1,000,000 seeded `public.users` rows
(`ai/tasks/18-share-by-name/seed-1m-users.sql`, raw output in `seed-1m-users-output.txt`): a 3+
character query (`'ann'`, `'Olivia Smith'`) plans as a `Bitmap Index Scan` on the trigram index,
2–230ms depending on match count and cache state — forcing the planner off that index on the same
warm query reproduces a `Parallel Seq Scan` roughly 4.5x slower. A 2-character query (`'an'`) plans
as a `Parallel Seq Scan` over the whole table regardless of cache state — ~270ms at 1M rows,
reproduced twice — because there is no trigram-backed plan to fall back from; none exists.
Through the app (task 20 step 5, a million generated rows loaded), `"Jor"` took ~3.5 s cold and 245 ms
warm, and under build load hit the 8 s `statement_timeout`: the index keeps a warm search fast, not
a cold one ([supabase-local-stack](supabase-local-stack.md)).

**As of step 18's second half this is closed, on both ends.**
[UserAutocomplete](../../../src/components/UserAutocomplete.tsx)'s `MIN_QUERY_LENGTH` moved from 2
to 3, so the client no longer fires a search short enough to force the scan. And
[set_name](../../../supabase/migrations/20260923000000_set_name_min_length.sql) now rejects any
name under 3 characters at the database, as a second `if` kept deliberately distinct from the
existing empty-name check (so `''` still gets "please enter a name" rather than "please enter at
least 3 characters"). Before this, a 1- or 2-character name was a contradiction the schema allowed:
a real account that `search_users_by_name` could never reach on an indexed plan. No backfill was
needed: no seeded row was shorter than 3 characters at the time.

**The function now takes a list:** `search_users_by_name(p_query text, p_list_id uuid default null)`
([invitations migration](../../../supabase/migrations/20261008000000_invitations.sql)) replaces the
one-argument one — dropped and recreated, never overloaded, so PostgREST never has two candidates;
the default keeps a `p_query`-only call working. When the caller owns `p_list_id`, its members and
pending invitees are excluded **before** `limit 5`, so the filter never shrinks the five; a list the
caller does not own is ignored, so a list id cannot probe a roster. `UserAutocomplete` passes Sharing's
`listId` through `searchUsers` ([src/lib/membersApi.ts](../../../src/lib/membersApi.ts)). The filter
is one hashed subplan and costs nothing measurable (`jor` about 8–11 ms warm at 1M users); the
trigram probe is unchanged.

**The gotcha for a future change is now this: do not lower `MIN_QUERY_LENGTH` below 3, and do not
add a second search entry point that allows a shorter query, without re-reading this entry.** The
underlying limitation has not moved — only the code's exposure to it has. `EXPLAIN` the function's
own inline query directly if this needs re-measuring, rather than wrapping the RPC call: `security
definer` plus its `set search_path` clause each independently block inlining, so `explain analyze
select * from search_users_by_name(...)` shows only an opaque `Function Scan`, never the plan
inside it.
