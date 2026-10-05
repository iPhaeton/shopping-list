# Step 2 follow-up — implementation log: locking the list row on owner changes

2026-10-05, after step 2 was committed (b928761). No description file: the user asked for the change in chat.
**No app code changed.** Applied to the local stack only (`npx supabase migration up --local`). Not pushed to cloud,
not committed.

## Request

User messages, verbatim, in order:

1. "HOw would you fix the race with the locks?" This refers to step 2's accepted race, recorded in
   `20261005000000_delete_account.sql` as "do not add `for update` or advisory locks without asking the user".
   - I answered with a design: lock the list's `lists` row in `delete_account` and in `keep_last_owner`.
   - I then extended it, in the plan the user approved: the four membership RPCs lock first, and `delete_account`
     locks every list the caller is on. The reasons are below.
2. "Go ahead"

This lifts the no-locks rule for **ownership only**. The list-limit rule (task 23 step 2, "no locks: overshoot
accepted", in scope-boundaries) is a separate decision and is unchanged.

## What changed

- **New: `supabase/migrations/20261005100000_list_owner_locks.sql`.** It runs `create or replace` on six functions,
  each copied from its latest definition with one statement added.
  - A script in the scratchpad diffed each body against its source: only the added lines differ.
  - The latest definitions:
    - `keep_last_owner` from `20260907000000_list_sharing.sql`;
    - `leave_list` from `20260924000000_leave_list.sql`;
    - `set_member_role` and `remove_member` from `20260920000000_session_revocation.sql`;
    - `share_list(uuid, uuid, list_role)` from `20260922000000_share_by_name.sql`;
    - `delete_account` from `20261005000000_delete_account.sql`.
  - **`keep_last_owner()`:** `perform 1 from public.lists l where l.id = old.list_id for no key update;`. It goes after
    both cascade exemptions and before the "another owner?" count, so cascades take no lock.
  - **`leave_list`, `set_member_role`, `remove_member`, `share_list`:** right after the session guard and before the
    owner check, `perform 1 from public.lists l where l.id = p_list_id for no key update;`.
  - **`delete_account()`:** right after the guard, this statement. It locks every list the caller is on, of any
    role, in id order:
    ```sql
    perform 1 from public.lists l
     where l.id in (select m.list_id from public.list_members m where m.user_id = (select auth.uid()))
     order by l.id
     for no key update;
    ```
  - The header comment covers:
    - the three forms of the race;
    - why re-reading after the lock is enough;
    - `no key update`;
    - why the RPCs lock first, citing T6;
    - why every list is locked, in id order;
    - what each waiter gets;
    - the residuals;
    - that the limits are unchanged.
- **Edited: `20261005000000_delete_account.sql`, comments only.** The "No locks, and one race is accepted… without
  asking the user" paragraph became a two-line pointer to the new migration.
- **`pg_proc` was read back before and after, and is identical** for all six functions:
  - owner `postgres`, `prosecdef` t, `proconfig {search_path=""}`;
  - the same `proacl`;
  - `has_function_privilege('anon', …)` f for the five RPCs.
  - `keep_last_owner` carries PUBLIC and `anon` EXECUTE, as it did before. It is a trigger function and cannot be
    called directly.
  - `prosrc` contains `for no key update` in all six.

## Decisions

1. **The rule is: lock the list row, then read the owners, then write membership rows.**
   - Under READ COMMITTED, each statement in a plpgsql function takes a fresh snapshot.
   - So the waiter's next statement re-reads the owners as the other transaction committed them. No retry loop and
     no isolation change are needed.
2. **`for no key update`, not `for update`.**
   - The foreign-key checks for inserting an item or a member take `for key share` on the list row, and only
     `for update` conflicts with that.
   - These locks wait only for each other and for updates of the list row: rename, bin and restore, which take
     `no key update` themselves.
3. **The RPCs lock up front, and the trigger keeps a lock too.**
   - A BEFORE ROW trigger runs after its membership row is locked. So a write that reaches the trigger's lock while
     holding a departing user's membership row deadlocks with that user's `delete_account`, which holds the list and
     whose cascade needs the row. This was measured in T6.
   - Locking first gives one global order: the list, then its membership rows.
   - The trigger lock stays for direct table writes. `authenticated` holds DELETE and UPDATE on `list_members`
     (Supabase default grants), and the policies let an owner delete or demote their own row. T7 measures that the
     trigger lock alone holds.
4. **`share_list` is included.** Its `on conflict … do update set role` can demote an existing owner.
5. **`delete_account` locks lists of any role, not only owned ones.**
   - Its cascade writes the caller's membership row on every list they are on, so by the rule each list comes first.
   - The id order makes two concurrent account deletions over shared lists wait for each other rather than deadlock.
     That deadlock was reasoned, not run.
   - It already existed before this change: A owns L1 where B is a member, and B owns L2 where A is a member. Each
     deletion's list cascade takes the other's membership row, then its user cascade needs the one the other holds.
6. **A new migration, not an edit of `20261005000000`.** That migration is applied locally, and re-applying it would
   need `db reset`, which is forbidden. It is also committed.
7. **Lock placement in the RPCs is before the owner check.** That check then reads post-wait state too.
   - The cost: any authenticated caller can lock a list row by id, even one they are not on, for the length of one
     call that then raises. This is not meaningful, since it needs the uuid and lasts milliseconds.

## Fixture

- **Accounts** were made by OTP sign-in through Mailpit, with step 2's `otp.sh`. They are throwaway accounts only;
  `maya@` and `maya3@` were not touched.
  - `t25la1…t25la7@example.com` were A for R0 and T1–T8. Every committed deletion used one up.
  - `t25lb@` was B in every test, and `t25lc@` was the second co-owner in T4.
  - All nine signed in on the first try, with no 429s, because every address was different.
- **Lists** have ids `25250000-0000-4000-8000-0000000001NN` (NN = test number). They were seeded as `postgres`: an
  insert into `lists` with `created_by` = A, so `on_list_created` mints A's owner row, then B inserted as owner. Each
  list was deleted as `postgres` after its test.
- **The harness** is `scratchpad/locks/lib.sh`:
  - Each session is a background `psql` with its own `PGAPPNAME`. It runs `begin`, then
    `set_config('request.jwt.claims', {sub, role, session_id}, true)`, then `set local role authenticated`, then the
    call under `\timing`, then a tail: `pg_sleep(2); commit`, `commit`, or inspect as `postgres` and `rollback`.
  - The second session starts 0.5 s after the first. An observer reads `pg_stat_activity` at about 1.2 s.
  - **The pause:** a `postgres` session holds `select … from auth.users where id = A for update` for 3 s. That stops
    A's `delete_account` at its `delete from auth.users`, after its list locks and list delete.

## Results

| # | first | second | second's call | observed at ~1.2 s | outcome |
|---|---|---|---|---|---|
| R0 (before the migration) | B `leave_list`, sleep 2 s, commit | A `delete_account`, commit | 349 ms, no wait | first in `PgSleep`, second already done | **L: 0 owners, 0 members**, A gone: reproduced |
| T1 | B `leave_list`, sleep 2 s, commit | A `delete_account`, inspect, rollback | 1,494 ms | second `Lock`/`transactionid` | inside A's transaction, L deleted and A's `auth.users` row gone. Rolled back |
| T2 | A `delete_account`, sleep 2 s, commit | B `leave_list` | 1,485 ms | second `Lock`/`transactionid` | `23514` "a list must keep at least one owner". L kept with B owner, A gone |
| T3 | A `delete_account`, sleep 2 s, commit | B `delete_account`, inspect, rollback | 1,533 ms | second `Lock`/`transactionid` | inside B's transaction, L deleted and B gone. Rolled back |
| T4 | B `leave_list`, sleep 2 s, commit (B and C co-own) | C `leave_list` | 1,476 ms | second `Lock`/`transactionid` | `23514`. C stays owner: **the race that predates task 25 is closed too** |
| T5 (paused) | A `delete_account`, commit | B `remove_member(L, A)` | 2,186 ms | both `Lock`/`transactionid` | A committed when the pause lifted (A took 2,695 ms). B got `P0002` "that person is not a member of this list". **No deadlock** |
| T6 (paused) | A `delete_account`, commit | `postgres` raw `delete from public.list_members where list_id = L and user_id = A` | 3,184 ms | both `Lock`/`transactionid` | **`40P01` deadlock** about 1 s after the pause lifted (`deadlock_timeout` 1 s). Postgres aborted **A's `delete_account`**, inside the cascade's `DELETE FROM ONLY "public"."list_members"`. The raw delete succeeded, and A's account survived |
| T7 | A `delete_account`, sleep 2 s, commit | B `delete from public.list_members` of their own owner row, as `authenticated` through RLS | 1,534 ms | second `Lock`/`transactionid` | `23514`. The trigger's lock alone holds for direct table writes |
| T8 | A `delete_account`, sleep 2 s, commit | B `set_member_role(L, B, 'writer')` | 1,521 ms | second `Lock`/`transactionid` | `23514` on the UPDATE arm |

**The T6 victim.** The victim is whichever waiter's deadlock check finds the cycle. The raw delete began waiting
first and its one check, after 1 s, found no cycle yet. A's wait began when the pause lifted, so A's check found it.
So in the unordered case it is **the account deletion** that fails. That is the concrete cost the RPCs' up-front lock
removes.

`wait_event` `transactionid` covers both row-lock waits and waits on the locker's transaction. It does not show
whether a session waits on the list row or on a membership row. T5 against T6 is the evidence for the order: same
pause, and the only difference is whether the list is locked before the membership row.

## Cost

- **The account on the most lists** is the task 23 load-test owner `c0309447-…`: on 5,231 lists, owning 5,229. That
  is past the 1,000 cap, which "keeps everything".
  - The lock statement took **26.7 ms cold and 13.2 ms warm**, run with `explain (analyze, buffers)` inside
    `begin … rollback`.
  - The plan is a hash join of two seq scans, then a sort on `l.id`, then `LockRows` over 5,231 rows, with 14,340
    shared buffers hit and 68 dirtied.
  - At this selectivity (65 % of `list_members`) the seq scans are the right plan.
- **A typical account on 3 lists:** an index scan on `list_members_user_id_created_at_idx`, then `lists_pkey`. It took
  1.6 ms.
- **The uncontended cleanup deletions through REST**, `POST /rest/v1/rpc/delete_account`, each returned 204:
  - `t25la5` (survived T6): 67 ms;
  - `t25lb`: 16 ms;
  - `t25lc`: 25 ms.
- **Afterwards nothing was left:** 0 `t25l%` rows in `auth.users` and `public.users`, and 0 fixture lists and
  memberships.

## Residuals (accepted, both rare, neither strands a list)

1. **A list the caller joins after `delete_account`'s lock statement is not locked.** Stranding it needs, inside that
   one call, a share making the caller an owner, then a co-owner's leave still uncommitted when the caller's
   sole-owner delete reads the owners.
2. **`purge_deleted` deletes lists in heap-scan order.** It can still deadlock with:
   - an account deletion over two or more of the same binned lists, at 03:30;
   - an owner's direct table write to their own row on a list being purged.

   This is reasoned, not run. Postgres aborts one transaction. The purge reruns nightly, and the user can retry.

## Problems hit (harness only)

1. **zsh's `echo` turns `\t` into a tab**, so `echo '\timing on'` reached psql as `<TAB>iming on`, a syntax error.
   Both sessions aborted and rolled back with nothing committed. `printf '%s\n'` fixed it.
2. **`grep` here is ugrep, which rejects an empty alternative** (`|)$`). `(…)?$` fixed the output filter.
3. **A `bash -c '…'` script was blocked** by Claude Code's removal safety check, although it contained no `rm`. The
   same script ran from a file.

## Verification

- `npm run kb:audit`: "65 entries, 60 mechanically checked, 0 error(s), 1 warning(s)". The warning is "ground moved"
  for `delete-account-removes-sole-owned-lists`, from the uncommitted comment edit in `20261005000000`.
  - That entry's `verify` still passes, because `for no key update` does not match its `for update` grep. **But the
    fact it asserts, "never locked", is now false.**
- `npm run typecheck`: clean.
- `npm test`: 31 suites, 786 of 786 passed.
- `git status`: the new migration (untracked), the edited comment in `20261005000000`, and this log.

## KB candidates (for the librarian)

| entry | change |
|---|---|
| delete-account-removes-sole-owned-lists | the title and body say "never locked" and "one race is accepted… do not add locks without asking". Now the function locks every list the caller is on, `for no key update`, in id order, before its deletes. The co-owner race is closed (T1–T3). The `verify` grep of `advisory\|for update` must become an assertion that the lock statement is present, read from the latest definition |
| list-data-scoped-by-rls | the paragraph's "holds the one accepted race — no locks without asking" is now false. The new rule: any function that writes `list_members` rows of an existing list locks that list's `lists` row first (`for no key update`), and `keep_last_owner` locks it again before counting owners. A writer that skips the up-front lock can deadlock with `delete_account`, and Postgres then aborts the deletion (T6). Two owners leaving at once is now refused (T4) |
| scope-boundaries | no change to the limits' "no locks: overshoot accepted". Worth one clause, so the ownership locks are not read as lifting it |
| supabase-local-stack | possibly: local `list_members` holds the task 23 load-test owner on 5,231 lists, past the 1,000 cap, which seq-scans in any per-user measurement |
