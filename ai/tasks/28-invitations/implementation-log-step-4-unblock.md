# Step 4 follow-up — implementation log (2026-10-09): unblocking restores suppressed invitations

After step 4 was committed (`0508f98`). No description file: the user asked for the change in chat.
Applied to the local stack only (`npx supabase migration up --local`). Not pushed to cloud, not
committed. No `/librarian` run: step 5 deposits, and this log is one of its inputs.

## Request

User message, verbatim: "When a user unblock someone, they should see the unblocaked user's earlier
supressed invitations."

This reverses D2's "Unblocking does not bring it back" (description-step-1.md, the
`list_invitations.suppressed` comment in `20261008000000_invitations.sql`, step 1's S7). It also
reverses the step 4 log's "unblock_user nudges nobody; suppressed invitations stay suppressed". On
this point, this log overrides both.

## What changed

- **New `supabase/migrations/20261009100000_unblock_restores_invitations.sql`.**
  - It runs `create or replace function public.unblock_user(uuid)`. The signature is unchanged, so
    the grants are kept.
  - The body, in order:
    1. the `session_still_valid()` guard;
    2. `perform … for no key update` on every `lists` row holding a `pending`, `suppressed`
       invitation from `p_user_id` to the caller, `order by l.id`;
    3. delete the `user_blocks` row;
    4. one `with restored as (update list_invitations set suppressed = false … returning id,
       list_id, created_at) insert into notifications (…, invitation_id, created_at) select …`.
  - Then a one-time repair, the same `update … returning` and `insert` across all users. It covers
    every pending suppressed invitation whose invitee has no `user_blocks` row against its inviter.
  - It ends with `notify pgrst, 'reload schema'`.
  - The header says it supersedes the earlier migration's comments. The applied migration was not
    edited.
- **App: comments only, no behaviour change.**
  - `src/lib/notificationsApi.ts`: the `unblockUser` doc is rewritten, and the `blockInviter` doc
    gains "until an unblock".
  - `BlockedPeopleScreen.tsx` and `NotificationsScreen.tsx` docs: "no nudge" narrows to the
    notifications that were only hidden.
  - No jest change, since the tests mock `unblockUser`.
- **`description-step-5.md`:**
  - Inputs: this log is added, and "all four log paths" becomes "all five", with a note that this
    log overrides steps 1 and 4 on what an unblock restores.
  - The scope-boundaries row: "unblocking does not revive suppressed invitations" is replaced.
  - The realtime row gains the unblock's nudge.
- **Not changed:** `description-step-1.md` and the step 1–4 logs, which are historical.

## Decisions

1. **The restored notification takes the invitation's `created_at`.**
   - The card sits in send order with a true age, not on top as "just now".
   - It is unread, so the bell counts it and the card gets a dot.
   - Its purge date is its invitation's, and the invitation's purge cascades to it anyway.
2. **Every still-pending suppressed invitation comes back.** That includes one whose list is binned
   or whose inviter no longer owns it: it shows as the existing unavailable card.
3. **Only `unblock_user` changes.**
   - `block_inviter` still deletes the other pending invitations' notifications, and
     `invite_to_list` still writes none while blocked.
   - The restore re-creates the notifications, so a card read before the block comes back unread.
   - Keeping the notifications at block time would have preserved read state, but it would have
     meant rewriting two more functions. It would also have left the restore needed anyway for
     invitations sent during the block, and for blocks made before this migration.
4. **The repair statement exists because the old `unblock_user` could only leave this state behind:**
   pending, suppressed, and no block. Locally it touched only the seeded case's 2 rows. After
   cleanup, the DB holds no pending invitation at all, only 5 answered ones (2 accepted, 3
   declined), and the repair skips answered rows.
5. **Lock order.**
   - The lists come first, in id order, as `delete_account` locks its own
     (`20261005100000_list_owner_locks.sql`).
   - The notification insert takes `for key share` on each list, which is the wait that deadlocks
     with an inviter's `delete_account` while the invitation is held.
   - The block row is deleted after the lists are locked, because `delete_account`'s cascade from
     `auth.users` reaches `user_blocks` after it holds the lists.
   - The invitations header's rare case 1 still applies: an inviter who left the list deletes their
     account mid-unblock, and Postgres returns 40P01.
6. **Open race, documented in the migration.**
   - `invite_to_list` reads `user_blocks` without a lock. An invite that read the block before an
     unblock committed, and inserted after it, stays suppressed with no block to lift.
   - Closing it would mean `for key share` on the block row inside `invite_to_list`, a rewrite of
     that function. It was not done.
7. **The unblock now nudges the unblocker**, once per restored invitation, through `notify_recipient`.
   - The notifications that were only hidden still return silently, so `BlockedPeopleScreen` keeps
     its `refreshUnread()`.
   - The `list_invitations` update also fires `notify_list_members` on each restored list, as the
     block's suppression already did.

## Verification

Scripts are in the scratchpad's `t28u/`: `api.mjs` and `sql.sh` copied from step 4, plus
`pre.sh`, `fn.sh`, `answer.sh`, `browser-seed.sh`, `account-seed.sh` and `state.sh`. The accounts
were throwaways: `t28u-own@example.com` (O) and `t28u-inv@example.com` (I).

**Repair case, set up before the migration was applied**
- Setup: O invited I to L1 and L2, I blocked on L1, O invited I to L3, then the block row was
  deleted in SQL.
- Before the migration: L2 and L3 were `pending`, `suppressed`, with 0 notifications and 0 blocks.
- After `migration up --local`: L2 and L3 were unsuppressed, each with exactly 1 notification, its
  `created_at` equal to the invitation's (13:30:49.602 and 13:30:51.092), and unread.

**New function**
- O invited I to L4, I blocked on L4 (L2 and L3 were suppressed again, with 0 notifications), and O
  invited I to L5 while blocked. `unread_notification_count` was 0.
- `unblock_user(O)` was called twice, with no error both times. Then:
  - L2, L3 and L5 were unsuppressed with 1 notification each, dated at send time and unread;
  - L1 and L4 stayed declined and read;
  - blocks were 0, `my_blocked_users` returned `[]`, and `unread_notification_count` was 3;
  - `my_notifications` listed L5, L4, L3, L2 and L1, newest first.
- Answering restored invitations: `accept_invitation(L2)` returned the list id, and
  `decline_invitation(L3)` succeeded. O's `pending_invitations_of(L5)` still showed I.
- Nudges, counted in `realtime.messages` on `user:<I>` with event `notifications/changed`:
  - one more block cycle (L6), then the first unblock: **+1**, for L5 restored;
  - the second unblock: **+0**.

**Browser** (Playwright at 390×844, web on 8081)
- The Metro on 8081 was already running: the user's `expo start --web`, started 14:42, with no
  target override, so `.env`'s `local` applied. It was reused and left running.
- The block for this run: O invited I to L7, I blocked on it (L5 was suppressed again), and O
  invited I to L8 while blocked.
- Notifications showed `No notifications yet`. Then: the `Blocked people` pill, `Unblock T28u-own`,
  and the screen went to `You haven't blocked anyone`.
- While Blocked people covered Notifications, the screen underneath made **2** `my_notifications`
  reads: the restore's nudge, then the nudges from marking the restored rows read.
- Back on Notifications:
  - L8 and L5 were pending cards with Decline, Accept and `Block T28u-own`, each with its unread dot
    (screenshot checked by eye);
  - L7, L6, L4, L3 and L1 showed Declined, and L2 showed You joined;
  - every card was in send order.
- Accept on L8 gave `You joined`, and `Open T28u L8` opened the list.
- **From Account.** After re-blocking through the API (L9; and later L10 for a clean count), the
  path was Lists, Account, `Blocked people`, Unblock, Back, Back.
  - `unread_notification_count` answered `1` twice: Blocked people's `refreshUnread`, and the
    debounced nudge.
  - The bell's dot showed on My Lists (screenshot checked by eye). On web the bell's
    `N unread` value is not exposed, which is why the count was read from the responses.

**Repo checks**
- `npm test`: 37 suites and 996 tests passed. `npm run typecheck`: clean.
- `npm run kb:audit`: 73 entries, 66 checked, **4 errors, 26 warnings**. The errors are the same as
  step 4's: `queries-go-through-a11y-labels`, `realtime-channel-shared-per-topic`,
  `realtime-is-a-nudge-to-a-per-user-inbox` and `session-still-valid-guards-writes`, all recorded
  since step 3.
  - `session-still-valid-guards-writes`' awk now takes `unblock_user` from the new migration. It is
    still guarded, so the set the check prints is unchanged by this follow-up.
- **No simulator run and no screenshots:** no screen's look changed.

**Cleanup.** The ten `T28u L*` lists were deleted, then both accounts by exact email. 0 accounts,
lists, invitations, notifications, blocks or `public.users` rows remain. The browser's storage was
cleared.

## Observations (not changed)

- **The restored invitations are marked read by the Notifications screen underneath**, while Blocked
  people still covers it, when the screen is in the stack.
  - The nudge's reload lands, and `markLanded` marks the new unread ids.
  - The dots still show on return, because they come from the visit's `seen` set, but the bell's
    count is 0 by then.
  - This is pre-existing behaviour for any nudge that arrives while Notifications is covered, not
    something this change introduced.
- **Notifications are no longer only inserted at the top.** A restored row lands at its send time,
  possibly behind rows already loaded.
  - Notifications copes, because every reload (nudge, focus, answer) re-reads everything shown in
    one call.
  - A restored row older than everything loaded arrives when the user scrolls to it.

## Problems hit

1. **A Playwright screenshot with a bare filename** was saved to the repo root rather than to
   `.playwright-mcp/`. It was moved to the scratchpad. Pass `.playwright-mcp/<name>` explicitly.
2. **Test sequencing.** `Open T28u L8` could not be found after the API re-block. That was correct
   behaviour: the re-block's nudge reloaded Notifications and hid every card from O, the accepted
   one included. It was redone after the unblock.

## State left

- Local DB: `20261009100000` applied. No `t28u-*` data.
- Cloud: untouched.
- Metro on 8081: the user's, still running.
- Supabase: as step 4 left it. analytics, vector, studio, pg_meta and edge_runtime are still stopped
  (`npx supabase stop && npx supabase start` restores them).
- Nothing committed.

## KB candidates

These override steps 1 and 4 on what an unblock does.

| entry | candidate |
|---|---|
| scope-boundaries | Blocking (D5) is for invitations only; **unblocking restores every suppressed invitation still pending**: unsuppressed, with a new unread `list_invitation` notification dated the invitation's `created_at`. The pressed invitation stays declined; the inviter sees no change (to them it was *Invited* throughout). Invitations an owner withdrew, or that expired, while blocked do not come back |
| realtime-is-a-nudge-to-a-per-user-inbox | `unblock_user` nudges the unblocker once per restored invitation (`notify_recipient` on the insert), and the members of each restored list via `notify_list_members`. The blocked person's other notifications reappear through `my_notifications`' filter with no nudge, so the Blocked people screen re-reads the bell's count itself |
| list-data-scoped-by-rls (lock order) | `unblock_user` keeps the invitation functions' list-then-rows order: it locks the restored invitations' lists `for no key update`, in id order, before it deletes the block or touches an invitation. Open, rare: an `invite_to_list` that read the block before an unblock committed and inserts after it leaves that invitation suppressed with no block |
| keyset-paging-in-the-order-shown or first-fetch-replaces-list-state | Notifications rows can now be inserted behind the newest (a restored invitation keeps its send time), so a client must not assume new rows only arrive on page 1. Notifications is safe, because its reload re-reads everything shown |
| session-still-valid-guards-writes | No count change: `unblock_user` was already one of the guarded RPCs; its latest `create` is now `20261009100000_unblock_restores_invitations.sql` |
