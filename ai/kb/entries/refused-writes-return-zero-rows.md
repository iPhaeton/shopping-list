---
id: refused-writes-return-zero-rows
title: Row-level security refuses a client UPDATE or DELETE with zero rows, which PostgREST reports as 204 and no error
type: gotcha
status: current
tags: [supabase, postgrest, rls, persistence, offline, security]
sources: [ai/tasks/7-list-sharing/implementation-log-step-2.md, ai/tasks/9-deletion/implementation-log-step-1.md, ai/tasks/18-share-by-name/implementation-log-step-1.md, ai/suggestions/list-sharing-ui.md, src/lib/listsApi.ts]
last_verified: 2026-09-22
verify: test "$(grep -c '\.update(\|\.delete(' src/lib/listsApi.ts)" = "$(grep -A4 '\.update(\|\.delete(' src/lib/listsApi.ts | grep -c '\.select(')" && grep -q "if (!error) return { error: null, verdict: 'ok' };" src/lib/listsApi.ts && grep -q "rpc('rename_list'" src/lib/listsApi.ts
related: [server-stamps-done-at, select-policy-gates-update-and-delete, writes-retry-from-an-outbox, list-data-scoped-by-rls, writes-can-land-on-a-tombstone, supabase-local-stack, insert-returning-races-membership-trigger]
---

A policy does not *reject* a client `UPDATE` or `DELETE` — it **filters it to zero rows**. Over
PostgREST that comes back as **`204 No Content`, empty body, no error**, which is indistinguishable
from a write that did exactly what it was told. Measured on the local stack as a reader, 2026-09-08:

| request | response |
|---|---|
| reader: `PATCH /rest/v1/lists?id=eq.<id>` `{"name":"…"}` | **`204`**, empty, no error |
| reader: the same, asking for the row back | `200`, body **`[]`** |
| owner: the same, asking for the row back | `200`, body `[{"id":"…"}]` |
| reader: `DELETE /rest/v1/list_members?list_id=eq.<id>&user_id=eq.<self>` | **`204`**, and `psql` shows the row is still there |

**Why this is worse than an ordinary silent failure here:** `resultFor` in
[src/lib/listsApi.ts](../../../src/lib/listsApi.ts) reads "no error" as `verdict: 'ok'`, so the
outbox removes the write **as delivered** ([writes-retry-from-an-outbox](writes-retry-from-an-outbox.md)).
The optimistic row stays on screen looking saved, nothing retries it, and the old value reappears at
the next fetch with nothing to explain it. This is the same failure
[server-stamps-done-at](server-stamps-done-at.md) closed for `set_item_done` by raising, arriving one
table over by a different route — that entry's rule ("a new write path must fail loudly or not at
all") has a second instance, and this one fails *quietly by default*.

**The fix is to ask for a representation and treat zero rows as a refusal.** The worked example was
`updateListName`: `.update({ name }).eq('id', id).select('id')`, returning `verdict: 'permanent'` with
its own message when `data` came back empty. The `.select()` is not decoration and is not a projection
nicety; it is the only thing that turns a silent no into a loud one.

**Step 9 removed the last thing this rule applied to, and the rule is why.** `updateListName` became
the `rename_list` RPC, so `listsApi` now holds **no direct `.update()` or `.delete()` at all** —
every write is an RPC that raises. The `.select()` trick worked, but it could only ever produce one
sentence: zero rows cannot tell **deleted** from **demoted**, and no amount of client code can, because
RLS hides a list you were removed from exactly as thoroughly as one that is gone. Only a
`security definer` function sees the difference
([writes-can-land-on-a-tombstone](writes-can-land-on-a-tombstone.md)). So read this entry as a rule
with nothing currently under it rather than as history: the next `.update()` or `.delete()` anyone adds
falls straight into the `204` trap, and the `verify:` command's pairing sweep is what catches it.

**`select=` in the query string alone does not do it — `Prefer: return=representation` is what
returns rows.** This cost a cycle in step 2: a hand-rolled `curl` PATCH carrying `select=id` and no
`Prefer` header came back `204` with an empty body, exactly as it had without it, which read as the
whole fix failing. supabase-js's `.select()` adds the header itself, which is why the app's own
request returned `200`. **Reproducing a postgrest-js call with `curl` needs that header, or the
reproduction lies about the code you are trying to test.**

**The `DELETE` row of the table is why there is no "Leave this list" button.** A non-owner's delete
of their own membership is filtered away and answers `204`, so a self-service leave would look like it
worked and change nothing. Removing people stays an owner's job through `remove_member`; leaving a
list you do not own is item 10 in `backlog/backlog.txt` and needs either a self-service delete policy
or a fourth RPC. The underlying reason the row is unreachable is in
[select-policy-gates-update-and-delete](select-policy-gates-update-and-delete.md) — that entry is the
`psql` half of this fact ("assert the row count, not the absence of an error"); this one is what it
looks like from the client.

**This rule is for `UPDATE`/`DELETE` only — do not reach for the same `.select()` fix on an `INSERT`
whose visibility another trigger grants.** `insertList` stays a bare `.insert()` for a different
reason than the ones above: adding `.select()` to it does not merely risk one more silent `204`, it
actively misreports a *successful* create as refused, because the row's own membership grant has not
taken effect yet when `RETURNING` re-checks it
([insert-returning-races-membership-trigger](insert-returning-races-membership-trigger.md)).

**What to do:** any `.update()` or `.delete()` the client sends asks for the row back and checks what
came back; any new database *function* raises rather than returning void. The `verify:` command
asserts the invariant across the whole module — every `.update(`/`.delete(` in `listsApi` is followed
within four lines by a `.select(`, which currently holds vacuously at zero of each and stops holding
the moment one is added — plus that `rename_list` is still an RPC rather than back to a `PATCH`, and
that `resultFor` still reads a missing error as `ok`, which is what makes all of this necessary.
