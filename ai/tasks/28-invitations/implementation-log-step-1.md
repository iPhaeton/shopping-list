# Step 1 — implementation log (2026-10-08)

Done and verified on the local stack. Both migrations are applied locally. **Not pushed to cloud.** Nothing in
`src/` changed, and `share_list` stays.

## Deviations from the description

1. **The keyset's cursor bound is written with `coalesce`, not `p_before_at is null or (…)`.** It appears in
   `my_notifications` and `my_blocked_users` as:

   ```sql
   n.created_at <= coalesce(p_before_at, 'infinity')
   and (n.created_at < coalesce(p_before_at, 'infinity') or n.id < p_before_id)
   ```

   - It returns the same rows, and the redundant `<=` is kept.
   - **Why:**
     - A `security definer` SQL function with `set search_path` is never inlined.
     - On PG 17.6 its body is planned with no argument values. auto_explain shows `COALESCE($1, …)` unfolded.
     - The literal form therefore puts the whole cursor test in a Filter. Measured at 8,000 rows deep: `Rows Removed
       by Filter: 8000`, 16,783 buffers, 5.1 ms, against 752 buffers and 0.35 ms (table under "Plans").
2. **`block_inviter` calls `decline_invitation` instead of repeating its body.**
   - It gets the same refusals, locks and notification.
   - The guard runs twice (once each), which costs nothing measurable.
   - It then reads `inviter_id` back from the row its own transaction just declined.

Everything else is as described: tables, codes, messages, raise order, lock order, grants, triggers, purge and
schedule.

## What changed

| file | content |
|---|---|
| `supabase/migrations/20261008000000_invitations.sql` | 2 enums, 3 tables (RLS on, no policy, `revoke all … from anon, authenticated`), 4 indexes beyond the PKs plus the partial unique, 7 guarded write RPCs, 4 read RPCs, `search_users_by_name` dropped and recreated with `p_list_id uuid default null`, `notify_recipient()` + 2 triggers, `purge_notifications(interval)`, grants, `notify pgrst` |
| `supabase/migrations/20261008000001_purge_notifications_schedule.sql` | `cron.schedule('purge-notifications', '35 3 * * *', …)` only |

## Decisions beyond the description

- **`decline_invitation` reads `list_id` for the notification from the lock lookup** (`target_list`). The `update …
  returning` returns only `inviter_id`.
- **`accept_invitation` and `decline_invitation` keep `read_at = coalesce(read_at, now())`.**
  - The update always touches the invitee's notification, so their other devices get `notifications/changed` and
    re-read the new status.
  - `where read_at is null` would skip that nudge whenever the screen had already marked the row read, which is the
    normal case under D4.
- **`search_users_by_name` filter shape:**
  - `not exists (<caller owns p_list_id>) or u.id not in (<members> union all <pending invitees>)`.
  - The plan shows `(NOT (InitPlan 3).col1) OR (NOT (ANY (id = (hashed SubPlan 4).col1)))`: one InitPlan and one
    hashed subplan, built once per call.
- **`unread_notification_count` has no partial `read_at is null` index.** It measured 3.8 ms at 10,000
  notifications for one account, and the 30-day purge bounds that count.
- **`purge_notifications` deletes are sequential scans.** No index leads with `created_at`, and the 30 days bound
  the tables. Its counts exclude notifications removed by cascade from a purged invitation (S12: 3 purged
  invitations, `notifications_purged` 2, table empty after).
- **`notify_recipient` has no revoke/grant block**, like `notify_list_members`. Its ACL reads back with the
  Supabase defaults (`=X`, `anon=X`, …), which is harmless for a trigger function.
- **Residuals**, documented in the migration header:
  1. **An inviter who has already left the list deletes their account while the invitee declines or blocks →
     `40P01`.** Reproduced (race X2 below). `delete_account` locks only the caller's lists, so it takes
     `auth.users` and then, by cascade, the invitation. The decline holds the invitation and then needs that
     `auth.users` row's key share for its notification's FK.
  2. **An invitee deletes their account while an owner withdraws their invitation.** The two cascades reach the
     invitation and its notification in opposite orders. Reasoned, not run.

  Postgres aborts one side, and nothing is left inconsistent. No change was made for either.

## Apply and read-back

- `npx supabase start` (Docker had been stopped), then `npx supabase migration up --local`: both files applied.
- PostgreSQL 17.6. `auth.users` held 1,000,041 rows, of which 1,000,000 are load-test users. Those users were kept.
- `pg_policy` on `realtime.messages`: only `receive your own inbox`, checked before applying, so no receive-policy
  change was needed.
- `pg_proc.proacl`:
  - All 13 client RPCs read `{postgres=X, authenticated=X, service_role=X}`, with no PUBLIC and no anon. That covers
    the 7 writes, the 4 reads, `pending_invitations_of` and `search_users_by_name(text, uuid)`.
  - `purge_notifications(interval)` reads `{postgres=X, service_role=X}`.
- `information_schema.role_table_grants` on the 3 tables: `postgres` and `service_role` only. `relrowsecurity` is
  true on all 3, with 0 policies.
- `cron.job`: `purge-deleted 30 3 * * *` and `purge-notifications 35 3 * * *`.
- Triggers: `notify_on_notification_change` on `notifications`, `notify_on_invitation_change` on `list_invitations`.

## Fixture

- **Accounts** were signed in by OTP: `POST /auth/v1/otp`, the code from the Mailpit API, then `POST /auth/v1/verify`.
  `session_id` was read from the access token's claims. Each new account left 2 `auth.sessions` rows, as known.
  - Names were set as `postgres`, all starting `Tee28 ` so one query (`tee28`) matches all of them:
    - O `Ba Owner`, P `Aa Second`, I `Ab Invitee`, X `Bb Stranger`;
    - R1–R5 (race owners), D1/D2 (deletion), L (limits over REST), W (residual), and `t28web` (browser).
  - P and I were named to sort first, so a filter applied after `limit 5` would visibly shrink the five.
  - `maya@`/`maya3@` were not used.
- **Case form:**
  - `psql` with `ON_ERROR_ROLLBACK on` and `VERBOSITY verbose`.
  - A per-account macro: a `DO` block doing `set_config('request.jwt.claims', {sub, role, session_id}, true)`, then
    `set local role authenticated`, the call, and `reset role`.
  - Counts were taken as `postgres`. Every case ran in `begin … rollback` unless marked committed.
  - Fixture lists L, L2, L3 (owner O; P co-owns L) and L4 (owner P) were inserted as `postgres`, so
    `on_list_created` mints each owner row.
- **Revoked session:** O's second session was logged out with `POST /auth/v1/logout?scope=local` (204), leaving 0
  `auth.sessions` rows for it. The JWT still verifies.

## Cases

All codes and messages below were read from the server, not inferred.

| # | case | result |
|---|---|---|
| S1 | `invite_to_list` refusals in order | X (non-owner) → `42501 only an owner can invite people to this list`, also on a binned list (owner check first). Binned → `P0002 this list is in the bin`, also when O invites O (bin before self). O→O → `22023 you already have this list`. Unknown id → `P0002 that account no longer exists`. O→P (member) → `22023 they already have this list`. O→I ok. O→I again, and P→I → `22023 they have already been invited`. Exactly 1 pending row and 1 notification for I |
| S2 | `withdraw_invitation` | X → `P0002 this invitation is no longer open`; bad id → same. P withdraws O's invitation: row 0 and I's notification 0. Again → `P0002`. An answered one (declined) → `P0002`, row stays `declined` |
| S3 | I declines; O re-invites | Status `declined`, I's notification read, exactly 1 new notification (`invitation_declined` to O, actor I, on L, unread), P none. Decline, accept or block again → `P0002 … no longer open`. O re-invites → ok, new `pending` beside the `declined` |
| S4 | I accepts | Returns L. I is a member with `writer` (the invitation's role). Status `accepted`, I's notification read, exactly 1 new notification (`invitation_accepted` to O, actor I), P 0. Accept or decline again → `P0002` |
| S5 | accept refusals | Bad id, or X on I's invitation (accept/decline/block) → `P0002 this invitation is no longer open`. Binned → `P0002 this list has been deleted`. P demotes O, then I accepts → `P0002 this invitation is no longer valid`, I not a member, still `pending` |
| S6 | I blocks O (via `block_inviter` on L2), then O invites I to L | No error. Row `pending`, `suppressed`, 0 notifications. `pending_invitations_of(L)` shows I to O and to P; X sees 0. I's accept, decline and block on it → `P0002`. O invites again → `22023 they have already been invited` |
| S7 | I blocks on L while O has L2 and L3 pending, and P has L4 pending | L `declined`, its notification kept (read). L2 and L3 `pending` + `suppressed`, 0 notifications, still in `pending_invitations_of` (1 each); L 0. O got `invitation_declined`. `my_notifications(I)`: only P's L4 row, `unread_notification_count` 1 (4 before), `my_blocked_users` shows O. After `unblock_user(O)` ×2 (no error): O's earlier L row is back (`declined`), blocked 0, L2 and L3 still suppressed |
| S8 | `search_users_by_name('tee28', …)` | O, no list: `Aa Second, Ab Invitee, Bb Stranger, Ca Race1, Cb Race2`. O with L (P member, I invited): `Bb Stranger, Ca, Cb, Cc, Cd`, still 5. P with L: same (O excluded as a member). X with L, and X with an unknown id: unfiltered (`Aa Second, Ab Invitee, Ba Owner, Ca, Cb`). After I declines: `Ab Invitee` is suggested again |
| S9 | `my_notifications` decoding | I: three `list_invitation` rows with role, status (`accepted`/`pending`/`declined`), `available` t, actor name. O: `invitation_accepted` and `invitation_declined` with `invitation_id`/`role`/`status`/`available` all null. `available` false with L binned, true after restore, false after P demotes O |
| S10 | `mark_notifications_read` + broadcasts | One invite on L (owners O, P): +1 `notifications/changed` → I, +1 `list/changed` → O, +1 → P. I marks `[n1, n2, O's notification, unknown]`: only n1 and n2 marked, O's stays unread, **n = 2 → 2 `notifications/changed` rows**. Marking rows already read: 0 messages. O marking I's notification: no change |
| S12 | `purge_notifications` | `interval '0 seconds'`: 3 invitations, 5 notifications → 0/0 (returned 3, 2). Default 30 days, with L's invitation and its notification stamped 31 days ago: L's invitation and notification gone; O's fresh `invitation_accepted` stays and decodes (nulls); I's fresh L2 row stays; I's membership of L untouched |
| S13 | `anon` | All 13 new client functions → `42501 permission denied for function …`. `authenticated` on `purge_notifications` → same |
| S14 | revoked session | O's logged-out `session_id` (`session_still_valid()` false), and I with a random `session_id`: invite, withdraw, mark, unblock, accept, decline, block → each `42501 this device has been signed out`. The before/after diff of all three tables plus the fixture memberships: 0 rows changed |
| S15 | limits at accept | I on 1,000 live lists (seeded under `session_replication_role = replica`) accepts a writer invitation → `LM002 they are already on 1,000 lists`; I not a member, status `pending`, notification still unread, 0 new notifications. I owning 100 lists accepts an owner invitation → `LM001 they already own 100 lists`; a writer invitation is accepted |
| S16 | `delete_account` of D1 (invitee), then D2 (owner), committed | Fixture: D2 owns LD (X co-owner) and LD2 (sole), D1 owns LD3. Invitations both ways, D1 blocked D2, X blocked D1, plus declines. Before: D1 in 5 invitations, 7 notifications, 2 blocks; D2 in 4, 5, 1. After D1: 0 rows referencing D1 in any of the three tables, and LD3 gone. After D2: 0 referencing D2, LD2 gone (W's invitation to it too), LD kept. All three tables empty at the end |
| S17 | `my_notifications` paging | 250 rows from O to I, positions 95–106 sharing one `created_at` (12 rows across the page-1/2 boundary), plus 30 rows from X (blocked) spread over all pages. Walk by each page's last row: **100, 100, 50, then 0**. 250 distinct, equal to the direct `order by created_at desc, id desc`, 0 rows from X. `p_limit` 0 → 1; **`p_limit` null → 1** (`greatest` ignores null); P with 1,200 rows: 5000 → 1000, default → 100 |
| S18 | `my_blocked_users` paging | X blocks 250 load-test accounts, 12 sharing one stamp across the boundary: **100, 100, 50, 0**, distinct, equal to the direct order, no null names. After unblocking row 42 of page 1, page 2 read from page 1's last row: 100 rows, identical to before |

## Races

The harness is the scratchpad `race.sh`:
- Session A starts first, makes the call, then `pg_sleep(2)` and commits (or commits at once).
- Session B starts 0.5 s later. It either commits, or inspects as `postgres` and rolls back.
- An observer reads `pg_stat_activity` about 0.8 s after B starts.

Each scenario had its own committed fixture list and invitation. **No `40P01` in any of the eleven.** In every one, B
was observed in `Lock/transactionid`.

| # | A (first) | B (second) | B's wait | outcome |
|---|---|---|---|---|
| A1 | I accepts RL1a, sleep, commit | R1 `delete_account`, inspect, rollback | 1,563 ms | Inside B, R1 is gone and RL1a too: still solely owned, since I joined as writer. After rollback: I is a member (writer), `accepted`, `invitation_accepted` to R1 |
| A2 | R2 `delete_account` (sole owner of RL2), sleep, commit | I accepts | 1,489 ms | `P0002 this invitation is no longer open`. RL2 and R2 gone, nothing left |
| A3 | R3 `delete_account` (RL3 co-owned with P), sleep, commit | I accepts | 1,481 ms | `P0002 … no longer open` (the invitation cascaded from `auth.users`). RL3 kept with P as owner, I not a member |
| D1 | I declines RL1b, sleep, commit | R1 `delete_account`, inspect, rollback | 1,491 ms | Inside B, all gone. After rollback: `declined`, I's notification read, `invitation_declined` to R1 |
| D2 | R4 `delete_account`, sleep, commit | I declines | 1,498 ms | `P0002`. Nothing left |
| B1 | I blocks on RL1c (RL1d and RL1e pending), sleep, commit | R1 `delete_account`, inspect, rollback | 1,502 ms | Inside B, all gone, the block included. After rollback: RL1c `declined`, RL1d and RL1e `pending`+`suppressed` with 0 notifications, block I→R1, `invitation_declined` to R1 |
| B2 | R5 `delete_account`, sleep, commit | I blocks on RL5 | 1,517 ms | `P0002`. No block created |
| W1 | I accepts LW1, sleep, commit | P withdraws | 1,490 ms | `P0002 … no longer open`. I a member, `accepted` |
| W2 | P withdraws LW2, sleep, commit | I accepts | 1,472 ms | `P0002 … no longer open`. No row, I not a member |
| R1 | P demotes O on LR1, sleep, commit | I accepts | 1,466 ms | `P0002 this invitation is no longer valid`. Still `pending`, unread |
| R2 | I accepts LR2, sleep, commit | P demotes O | 1,491 ms | The demotion succeeds. I a member, O a writer, `accepted` |

**Residual 1, reproduced (X2).**
- Setup: list RLw is owned by W and P. W invited X, then W left. A `postgres` session holds W's `auth.users` row
  `for update` for 3 s.
- A: W `delete_account`. B: X declines, 0.5 s later.
- Observer: A in `Lock/transactionid` (behind the pause), B in `Lock/tuple` (queued behind A on W's `auth.users`
  tuple).
- When the pause lifted, B got `40P01 deadlock detected` after 3,164 ms. A committed after 3,722 ms.
- End state: W gone, the invitation gone by cascade, no notification, RLw kept with P. Consistent. Postgres chose the
  decline as the victim here.
- The first attempt (X) used R1, but B1 had already suppressed R1's RLr invitation, so B was refused at once with
  `P0002`. That run proves nothing, and X2 replaced it.

## Plans

**Seed**, under `session_replication_role = replica`, so no FK checks and no nudges. One marker list `seed-t28`.
- Notifications: 1,000,000 over 50,000 load-test recipients (20 each, actors from another 50,000, spread over 30
  days, a third unread), plus 10,000 for I from 2,000 actors. I blocks 5 of them.
  - Total 1,010,005 rows, 459 MB.
- Blocks: 10,000 by X, plus 300,000 between load-test accounts (30,000 blockers × 10). Total 310,005.
- `analyze` after seeding.

Measured as `authenticated` with real claims. **auto_explain is preloaded on the local stack:**
`set auto_explain.log_nested_statements = on; set auto_explain.log_level = notice; set auto_explain.log_analyze =
on; set auto_explain.log_buffers = on` prints each definer function's inner plan to the client. `load
'auto_explain'` itself is refused and not needed. The literal forms were run as `pg_temp` copies with the
description's `is null or`. The cursor is the 8,000th row. Times are the inner plan, warm.

| read | plan | buffers | time |
|---|---|---|---|
| `my_notifications`, page 1 | Index Scan `notifications_recipient_id_created_at_id_idx`, Index Cond `recipient_id = InitPlan AND created_at <= COALESCE($1,'infinity')`, 104 rows read, `Limit` 100. Nested loops into `users_pkey` and `lists_pkey` (Memoize), anti join on `user_blocks_pkey` | 769 | 0.37 ms |
| `my_notifications`, cursor at 8,000 | same, starting at the cursor: 105 read, 1 removed by the `or` | 752 | 0.35 ms |
| literal form, page 1 | same index, Filter `($1 IS NULL) OR (…)` | 657 | 0.86 ms |
| literal form, cursor at 8,000 | same, **Rows Removed by Filter: 8000** | 16,783 | 5.1 ms |
| `unread_notification_count` (I: 10,003 rows, 3,334 unread) | Bitmap scan on the same index, filter `read_at is null` | 389 | 3.8 ms |
| `my_blocked_users`, page 1 (X: 10,000) | Index Only Scan `user_blocks_blocker_id_created_at_blocked_id_idx`, Index Cond `blocker_id AND created_at <= COALESCE`, 100 rows | 407 | 0.14 ms |
| `my_blocked_users`, cursor at 8,000 | same, 1 removed | 606 | 0.60 ms |
| literal form, cursor at 8,000 | same index, **Rows Removed by Filter: 8000** | 16,280 | 5.7 ms |

- `list_invitations` held 3 rows during the run, so the left join is a Seq Scan plus Materialize. At volume it would
  be `list_invitations_pkey`. That was not seeded.
- **Search** (1M users, as O, owned list LW1):
  - `jor`: 6,603 trigram candidates. Old body copy 9.5–13.6 ms warm; new, no list 7.9–8.2 ms; new, owned list
    8.6–11.4 ms; first call 23–49 ms.
  - `an` (two letters, a known trigram limit): about 1.3–1.8 s either way.
  - The scope costs nothing measurable.
- **The seed was removed**, again under `replica`: 1,010,000 notifications in 1.2 s, then 310,005 blocks, then the
  list. `realtime.messages` went 385 → 386, the one being the list delete's own trigger. Then `vacuum analyze`.

## Through `/rest/v1/rpc/…` (real access tokens; step 3 classifies by these)

| call | HTTP | body |
|---|---|---|
| `invite_to_list` success | **204** | — |
| `accept_invitation` success | **200** | `"<list uuid>"` (a JSON string) |
| `decline_invitation`, `unblock_user`, `mark_notifications_read` success | 204 | — |
| `my_notifications`, `unread_notification_count` (`1`), `pending_invitations_of`, `my_blocked_users` (`[]`) | 200 | JSON |
| `search_users_by_name` with `{p_query}` alone, and with `p_list_id` | 200 | 5 rows. With LW2, its pending invitee L and member P were excluded |
| `22023` they have already been invited | **400** | `code`, `message` verbatim |
| `P0002` that account no longer exists / this invitation is no longer open | **500** | same |
| `42501` only an owner can invite… | **403** | same |
| `42501` this device has been signed out (the logged-out session's JWT) | **403** | same |
| `LM002` they are already on 1,000 lists (L on 1,000 seeded lists accepts) | **400** | same |
| `anon` → `my_notifications` | **401** | `42501 permission denied for function my_notifications` |
| `authenticated` → `purge_notifications` | 403 | `42501 permission denied …` |

## The shipped app (web, local stack)

- `.env` has the target commented out, and the shell variable was unset. The bundle carries no
  `EXPO_PUBLIC_SUPABASE_TARGET`, so it targets local. Nothing was on port 8081 before `npm run web`.
- The Playwright browser held `maya3@example.com`'s session from an earlier task. **Its site storage was cleared, not
  signed out**, so maya3's server sessions are untouched. A later screenshot run in this browser must sign in again.
- Signed in as `t28web@example.com` by OTP through Mailpit.
- **Nudge:** O's `share_list` of LW1 to t28web through `curl` returned 204. `t28 LW1` appeared on My Lists with no
  reload.
- **Search and share:**
  - Created "t28 web list", then Share. Typing `tee28 bb` suggested `Tee28 Bb Stranger`: `POST
    rpc/search_users_by_name` 200, with the shipped `{p_query}` call.
  - Share as Writer: `POST rpc/share_list` 204.
  - The roster shows X, and `list_members` holds X as `writer`.

## Repo checks

- `npm run typecheck`: clean.
- `npm test`: the first, cold run had 2 failures in `AccountScreen.test.tsx`, the known cold-transform-cache
  timeouts (`jest-cold-cache-timeouts`). The next two warm runs passed: 32 suites, 865 tests.
- `npm run kb:audit`: `73 entries, 66 mechanically checked, 1 error(s), 0 warning(s)`. The one error is
  **`session-still-valid-guards-writes`**, as the description predicts: its `verify:` expects exactly twelve guarded
  RPCs, and there are nineteen. Not edited. No other entry failed or warned.

## Problems hit (harness only)

1. **`\gset` inside a psql variable does not run.** A backslash command inside `\set` text reaches the server as
   text. The per-account macro became a `DO` block.
2. **Subqueries in test calls ran as `authenticated` and read the RPC-only tables**, which correctly refused with
   `42501 permission denied for table list_invitations`. The first S8–S10 run lost those cases. Ids are now fetched as
   `postgres` with `\gset` first. The `who()` helper is `security definer` for the same reason.
3. **`set_config(…, true)` outside `begin`** dies with its implicit transaction (`SET LOCAL can only be used in
   transaction blocks`). The first S16 `delete_account` raised `this device has been signed out`. Wrapped in
   `begin … commit`.
4. **A seed block insert hit 23505** from a modulo that repeats every 7 × 30,000 rows. The pairing was rewritten, and
   the transaction had rolled back whole.
5. **`delete … where blocker_id = X or blocker_id in (select id from auth.users where email like …)` ran 5 min** (a
   per-row subplan over 1M users) and was cancelled with `pg_cancel_backend` on this session's own pid, rolling
   back. Rewritten as `delete … using auth.users u where …`, 0.76 s.
6. **The first residual run (X) was spoiled by B1's suppression.** See "Races".

## State left

- Both migrations applied locally. `supabase_migrations.schema_migrations` max is `20261008000001`.
- Every `t28%@example.com` account was deleted as `postgres` (6 left at the end; R1–R5, D1, D2 and W were consumed by
  `delete_account`). Every `t28 %` and `seed-t28%` list was deleted.
- `list_invitations`, `notifications` and `user_blocks` are empty.
- `auth.users` still holds 1,000,000 load-test users. `maya@` and `maya3@` were untouched.
- Mailpit keeps the `t28` sign-in mails. Metro is stopped.

## KB candidates

For step 5's single deposit. This is the description's table, corrected to what was done, then what it missed.

| entry | change |
|---|---|
| session-still-valid-guards-writes | Seven new guarded write RPCs: `invite_to_list`, `withdraw_invitation`, `mark_notifications_read`, `accept_invitation`, `decline_invitation`, `block_inviter`, `unblock_user`. That makes **nineteen** with `share_list` until step 3 drops it. Update the list and the `verify:` set. The line check (`= 3` non-guard mentions) still holds. `block_inviter` runs the guard twice, its own and `decline_invitation`'s |
| realtime-is-a-nudge-to-a-per-user-inbox | A second event on the same `user:<uid>` topic: `notifications/changed`, payload `{source: 'notifications', op}`, from `notify_recipient()` on every insert, update and delete of `notifications`. `notify_list_members` now also fires on a fourth table, `list_invitations`. The receive policy is unchanged (checked in `pg_policy`). Measured: one invite = 1 `notifications/changed` to the invitee + 1 `list/changed` per list member; `mark_notifications_read` of n unread rows = n nudges, already-read rows = 0. Accept and decline always nudge the invitee (the `coalesce` update). **`unblock_user` and `block_inviter`'s block row send nothing**; a blocker's other devices learn of an unblock at their next read |
| list-data-scoped-by-rls | Three RPC-only tables (`list_invitations`, `notifications`, `user_blocks`): RLS on, no policy, no `anon`/`authenticated` grant (read back: `postgres` and `service_role` only). Every invitation-state RPC locks the list `for no key update` first; 11 races measured with no `40P01` (this log) |
| deletion-is-a-tombstone | A second nightly hard delete: `purge_notifications(interval default 30 days)` at 03:35 GMT (`purge-notifications`), deleting invitations and then notifications by `created_at <=` the cutoff, rows that are never tombstoned. Its counts exclude the cascade. Sequential scans. `delete_account` cascades take every invitation, notification and block of the departing account (S16) |
| limit-checks-pass-an-applied-resend | `accept_invitation` checks membership before inserting, because `limit_list_memberships` fires before the conflict check. LM002 and LM001 are measured at accept (S15), and LM002 over REST is 400 |
| keyset-paging-in-the-order-shown | Fifth and sixth paged reads, inside SQL definer RPCs rather than PostgREST filters: notifications `(created_at, id)` desc on `(recipient_id, created_at desc, id desc)`, and blocks `(created_at, blocked_id)` desc on `(blocker_id, created_at desc, blocked_id desc)`. **In an RPC the redundant bound must be `<= coalesce(p_before_at, 'infinity')`**, since a non-inlined SQL function is planned without argument values and `p_before_at is null or …` leaves the bound in a Filter. Plans: 752 vs 16,783 buffers at depth 8,000. Page sizes are clamped `least(greatest(p_limit, 1), 1000)`, and **a null `p_limit` returns 1 row** |
| scope-boundaries | Nothing yet. Step 3 brings the scope change |

Not in the description's table:

| entry | change |
|---|---|
| ownership-changes-lock-the-list-row-first / delete-account-locks-then-removes-sole-owned-lists | The invitation RPCs join the list-then-rows order. Residual: an inviter who has already left the list, deleting their account during a decline or block, deadlocks (reproduced, X2: the decline was the victim, consistent end state). Reasoned: an invitee's deletion against an owner's withdrawal. Both accepted, not fixed |
| supabase-default-grants-defeat-revokes | The new trigger function keeps the default grants like the others. The 13 client RPCs read back without PUBLIC or anon. `purge_notifications` has no client grant (`anon` 401, `authenticated` 403 over REST) |
| server-stamps-done-at (or wherever `verdictFor`'s code→status facts live) | Measured statuses for the new RPCs: `22023` → 400, `P0002` → 500, `42501` → 403, `LM002` → 400, anon → 401. `accept_invitation` → 200 with the list id as a JSON string; void RPCs → 204 |
| supabase-local-stack (or a new environment entry) | **auto_explain is preloaded locally.** With the `log_nested_statements`/`log_level = notice` settings above, `psql` shows the inner plan of a definer function, and `load` is refused but unnecessary. A delete filtered by `or … in (select … from auth.users where email like …)` against the 1M load-test users runs for minutes; use `using auth.users`. Seed deletes under `replica` avoid a `realtime.messages` row per deleted notification |
| trigram-index-needs-three-characters / share-by-name | `search_users_by_name(p_query text, p_list_id uuid default null)` replaces the one-argument function (dropped, not overloaded). It excludes the owned list's members and pending invitees before `limit 5`, and ignores a list the caller does not own. One hashed subplan, no measurable cost (`jor` about 8–11 ms warm at 1M users) |
| jest-cold-cache-timeouts | Seen again on 2026-10-08: 2 first-run failures in `AccountScreen.test.tsx`, then clean warm runs |
