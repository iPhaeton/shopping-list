# Implementation log — step 1: deletion

**Date:** 2026-09-10. Description: [description-step-1.md](description-step-1.md). Source proposal:
[ai/suggestions/deletion.md](../../suggestions/deletion.md).

Lists and items can be deleted now, as **tombstones rather than `delete`**. A deleted row keeps its
place and grows a `deleted_at`; it stays visible behind a "Show deleted" checkbox, whoever may delete
it may restore it, and a nightly `pg_cron` job collects anything binned for more than 30 days. A
queued write that lands on something another owner binned is not thrown away — the owner is offered
*"Restore it and keep your change?"*, and a writer's write to the same thing drops quietly.

Scope was settled with the user before any code: **all six of the suggestion's staging steps in one
step** (schema, state, API, error messages, UI, purge), the shape step 8 used, and **the `pg_cron`
schedule ships with the purge function** rather than following it.

The suggestion's design was adopted as written, with three corrections recorded under *Problems hit*.
It also absorbs backlog items 7 (human-readable errors) and 11 (rename endpoint returns errors).

## What was built

| File | |
|---|---|
| `supabase/migrations/20260910000000_deletion.sql` | new — columns, indexes, `write_outcome`, five functions, grants |
| `supabase/migrations/20260910000001_purge_schedule.sql` | new — `pg_cron` extension and the 03:30 GMT job |
| `src/state/restorePlan.ts` | new — what has to come out of the bin, and who may lift it |
| `src/components/ShowDeletedToggle.tsx` | new |
| `src/components/BlockedBanner.tsx` | new |
| `src/state/types.ts` | `deletedAt` on `Item` and `List`; two actions, so six `WriteAction`s |
| `src/state/listsReducer.ts` | two arms; `liveItems`, `liveLists`; `countDone` filters through them |
| `src/lib/outbox.ts` | `supersedes` and `dropDependents` arms; `queueFirst` |
| `src/lib/listCache.ts` | `VERSION` 2 → 3 |
| `src/lib/listsApi.ts` | `add_item` / `rename_list` / the two delete RPCs; `outcome` on `Result`; a SQLSTATE map |
| `src/state/ListsContext.tsx` | the `target_deleted` branch, `blocked`, restore/discard, two mutators |
| `ListRow`, `ItemRow`, both screens | the checkbox, the Deleted tag, delete/restore, the banner |
| 7 suites | 61 new tests (163 → 224) |

Untouched on purpose: **every policy**, `my_memberships()`, the realtime migration, `listsChannel`,
`replay`, `storageQueue`, `supabase.ts`, and the navigator.

## Decisions

**No policy changes at all, and that is the fact worth recording.** A tombstone is still a row,
members must see it to restore it, and the client decides what to render. The read stays rooted at
`list_members` with the `in (select … from my_memberships())` shape intact, and `lists`/`items` still
have no `for delete` policy — the only hard delete in the schema is the purge, which runs as
`postgres`. Filtering tombstones inside `my_memberships()` would have been the tempting shortcut and
would have made the bin unreachable.

**The server reports the fact; the client decides by role.** `write_outcome` is
`('applied', 'target_deleted')` and says nothing about who may restore what. `restorePlan` answers
that from `list.role`, the same division `src/state/roles.ts` already keeps.

**`set_item_done` was dropped and recreated, not replaced.** Its return type changed from `void`, and
`create or replace` cannot do that. The drop takes the grants with it, so both are re-issued;
`notify pgrst, 'reload schema'` ends the migration, because a signature change is exactly when
PostgREST answers with "could not find the function in the schema cache".

**Its zero-row branch now splits three ways**, and the order is a security decision: row missing →
`target_deleted`; **caller not a writer → raise 42501**; otherwise → `target_deleted`. The suggestion
put the tombstone test first, which would tell a stranger holding an item id that the row is in the
bin. Tested before the permission check, it never does.

**`insertItem` and `updateListName` became RPCs.** The first is not optional: the `writers add items`
policy checks membership, and membership survives a soft delete, so a plain insert would have been
*accepted* into a binned list. The second was owed anyway — a refused rename returned `200 []`, which
cannot tell **deleted** from **demoted**, and no client can, because RLS hides a list you were
removed from exactly as thoroughly as one that is gone. `insertList` stays a plain insert; creating a
list cannot land on a deleted target.

**The two schedule halves are separate migration files.** A migration is one transaction, so a
refused `create extension pg_cron` on cloud would roll back the whole feature. Split, it costs the
schedule only. The price is recorded in the file's header: an **unapplied** migration wedges every
later `db push`, because the CLI retries from the earliest unapplied file forward.

**The error map is scoped to the six outbox writes.** Those reach a red banner minutes or days after
the tap that caused them, so `42501` and `23514` get a sentence. The membership RPCs deliberately
keep the database's own words — `share_list`'s "no account with that email yet" is already the right
sentence, said next to the field the address was typed into, and rewriting it would be a regression.

**"Show deleted" renders only when the bin is non-empty.** A toggle that reveals nothing is noise,
and it also keeps `ListDetailScreen.test.tsx`'s `getAllByRole('checkbox')` assertion — which expects
exactly the item titles — green.

## Problems hit

### 1. The conflict prompt announced itself before it could know anything — found only in the browser

The first design treated `target_deleted` like a `permanent` refusal, and a review of the plan killed
three parts of that before any code: `dropDependents` would discard the tick queued behind an add, so
"keep my change" restored the item unticked; the held op would live only in React state, so a reload
before the user answered lost it; and the loop would carry on to the next write on the same list and
overwrite the prompt, while `enqueue`'s append put the restore *behind* the write it was meant to
unblock. The shipped shape leaves the op at the head, persists nothing, stops the loop behind a
`stuck` ref, and prepends restores with `queueFirst`.

**What survived all of that, and what no unit test caught, was the ordering inside the branch.**
`setBlocked` ran *before* the fetch that follows it. The tombstone is somebody else's write, so the
device had never seen it; `restorePlan` read the pre-delete view, found nothing in the bin, concluded
there was nothing to offer — and **discarded the write**. Silently: no banner, no error, and a tick
that simply never happened. Jest batched the two updates into one render and never noticed. The
browser did, on the first run of the real scenario.

The fix is `await hydrate()` first and `setBlocked` after. The regression test asserts the *order*
(no prompt while the fetch is in flight) rather than the outcome, and was checked against the old
code to confirm it actually fails.

### 2. `purge_deleted(interval '0 seconds')` collected nothing

`now()` is the **transaction's** start time, frozen for its whole life. A tombstone stamped by
`set_item_deleted` and a cutoff of `now() - interval '0 seconds'` are therefore the same instant when
both happen in one transaction, and `deleted_at < cutoff` is false. The one call that proves this
function works was a silent no-op. Changed to `<=`, which is identical at a real 30-day cutoff.

### 3. The browser probe's "back online" step never went back online

The offline stub was reinstalled from a stale `window.__realFetch`, so restoring it restored the
stub. It looked exactly like the feature hanging. Caught by asking the page to make one direct API
call, which failed inside the stub rather than at the network. A reload was the fix — and a better
test, since the queued write survived it, proving the blocked op really was on disk.

## How it was verified

**Automated:** 224 tests across 13 suites, `tsc --noEmit` clean, `npm run kb:audit` at **3 errors**
— all three predicted, all three entries whose facts this step changed (see below).

**Migration:** `npx supabase migration up`, not `db reset`, so the two existing accounts and
`bob list` survived. Then the ACL was read back rather than trusted: `authenticated` holds exactly
one UPDATE column privilege (`lists.name`), `has_column_privilege` is false for `deleted_at` on both
tables, `purge_deleted`'s `proacl` names neither `anon` nor `authenticated`, and `cron.job` holds one
row running as `postgres` with `cron.timezone` = GMT.

**The RPCs, in one rolled-back transaction, 18 cases** — asserting row counts and returned values
rather than the absence of an error. A writer deleting and restoring an item; a retry not pushing the
tombstone forward; `set_item_done` returning `target_deleted` for a binned item, a binned list and a
purged row, and `applied` for a live one; a writer refused `42501` on both list-level RPCs; sharing
surviving a delete (2 members); `add_item` refused into a binned list with **no row inserted**;
`add_item` twice with one id → `applied`, `applied`, one row; `rename_list` leaving a binned list's
name alone; a stranger getting `42501` and never learning a row is in the bin; and the purge
collecting an item, cascading a list's items away, and not tripping `keep_last_owner`.

**End to end in the browser** against the local stack, driven with Playwright:

| | |
|---|---|
| add three items through `add_item`, delete one | row leaves the list, "Show 1 deleted" appears |
| tick the checkbox | the row returns in place, tagged `Deleted`, checkbox disabled, Restore offered — **and no second fetch** |
| queue a tick offline, bin the list from the database, reconnect | prompt: *"That list is in the bin. Restore it and keep your change?"*, change still pending, optimistic row still on screen |
| "Restore and keep my change" | list restored **and** the tick landed after it; the separately-binned item stayed binned |
| demote to `writer`, repeat | no rename button, no list delete, item deletes intact; the blocked write **dropped with no prompt and no error**, and the untick never reached the database |
| `purge_deleted(interval '0 seconds')` | `lists=1 items=1` — the item count excludes the list's cascade |

**The stack was left exactly as found:** the probe list purged, its items cascaded away, the extra
membership gone, one list and two owner rows remaining — diffed against what was there at the start.

## KB impact — handed to the librarian, not edited here

Three `verify:` commands now fail and are the entries whose facts moved:
`list-cache-holds-acknowledged-rows` (VERSION 2 → 3), `refused-writes-return-zero-rows`
(`updateListName` was the app's last direct table write and is now an RPC), and
`supabase-default-grants-defeat-revokes` (the purge must also be revoked from `authenticated`, which
no phrasing of that grep allows — and note the grep spans comments, so the words "revoke execute" in
prose fail the audit too).

Three more pass **while their prose goes false**, and the audit will not ask:
`writes-retry-from-an-outbox` and `optimistic-list-writes` both end
`! grep -qE "removed'|deleted'" src/state/types.ts`, which `'item/setDeleted'` slips past on a capital
D; and `server-stamps-done-at` greps the *sharing* migration, which this step never edited, so it
still finds an `if updated = 0 then` that no longer describes the shipped function.

Also changed: `scope-boundaries` (deletion moves in), `list-data-scoped-by-rls` ("nothing in the app
deletes anything" is false, **the policies are unchanged**, and two writes moved off direct table
access), and `realtime-is-a-nudge-to-a-per-user-inbox` ("a nudge can never mean gone" is false, with
**no migration** behind it). A likely new entry: *a write can land on a tombstone*.

## What this does not solve

**Not verified: the cloud project.** `npx supabase db push` is the user's to run, and
`create extension pg_cron` there is the one statement that may be refused — which is why the schedule
is its own file.

**No happens-before.** The rule is who you are, not whose change came first; an owner is offered a
restore whether their edit predated the delete by a second or a week. Real causal ordering needs a
sync engine.

**Restoring a list does not restore its items** — the two tombstones are independent. Correct, and
confusing enough to have earned a line of copy on the binned-list screen.

**The bin is fetched even when hidden.** One query and instant toggling is the right trade at this
size. The signal to change it is a list whose deleted rows outnumber its live ones; the answer then
is a second query behind the checkbox, not a policy change.

Nothing has yet checked `cron.job_run_details` after a real 03:30 GMT run — §7.1's failure mode is
silent and slow, and that check is owed once after deploying and again a week later.
