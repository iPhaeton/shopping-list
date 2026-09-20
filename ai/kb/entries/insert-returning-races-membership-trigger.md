---
id: insert-returning-races-membership-trigger
title: A .select() on insertList would race the AFTER INSERT trigger that grants the creator's own membership row
type: gotcha
status: current
tags: [supabase, postgres, rls, triggers, persistence]
sources: [ai/tasks/15-session-revocation/implementation-log-step-1.md, supabase/migrations/20260907000000_list_sharing.sql, src/lib/listsApi.ts]
last_verified: 2026-09-20
verify: grep -q "supabase.from('lists').insert({ id, name })" src/lib/listsApi.ts && ! grep -A3 "supabase.from('lists').insert" src/lib/listsApi.ts | grep -q '\.select('
related: [refused-writes-return-zero-rows, server-stamps-done-at, list-data-scoped-by-rls, session-still-valid-guards-writes]
indexed: false
---

A plain `POST /rest/v1/lists` with `Prefer: return=representation` — what supabase-js sends whenever
`.insert(...).select()` is chained — returned `42501 "new row violates row-level security policy for
table lists"` for the very account that had just inserted the row, even with `auth.uid()`
independently confirmed correct via raw `psql`. The same insert **without** `.select()` returned
`201`, and the row was confirmed present by a follow-up `GET`.

**Root cause, found by elimination while verifying step 15's migration and confirmed unrelated to
it** (reproduced identically after `npx supabase db reset` with that migration's file moved out of
`supabase/migrations/` entirely): `RETURNING`'s implicit re-check of the inserted row against
`lists`' SELECT policy — `id in (select list_id from my_memberships())`
([read-rooted-at-list-members](read-rooted-at-list-members.md)) — runs before `on_list_created`, the
**AFTER INSERT** trigger that grants the creator's own `list_members` row
([list-data-scoped-by-rls](list-data-scoped-by-rls.md)), has taken effect. At that instant the
creator is not yet a member of the list they just created, by this same policy's own account.

**Why `insertList` never hits this.** [listsApi.ts](../../../src/lib/listsApi.ts) calls
`.insert({ id, name })` with no `.select()` — supabase-js only sends `Prefer: return=representation`
when a `.select()` is chained, so the window this needs never opens. A retried insert is still
detected safely, via `23505` catching the client's own earlier attempt, rather than a read-back.

**Do not fix this the way [refused-writes-return-zero-rows](refused-writes-return-zero-rows.md) fixes
an `.update()`/`.delete()`.** That entry's rule — ask for the row back, treat empty as a refusal —
assumes a *successful* write is visible to its own `RETURNING`. Here a successful insert is briefly
invisible to it too, so the same fix would misreport a normal, working `insertList` call as refused.
Any table where *another* trigger is what makes a fresh row visible to its own policy carries the
same trap.

**What to do:** leave `insertList` as a bare `.insert()`. Before adding `.select()` to it, or to any
new insert whose visibility depends on a trigger granting access after the row lands, reproduce this
directly (`npx supabase db reset`, insert with `.select()`, look for a `42501` on your own row) rather
than assuming a client bug.
