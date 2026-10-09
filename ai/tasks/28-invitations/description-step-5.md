# Step 5 — Deposit the whole task into the KB

The user's requests and the decisions they settled are in
[description-step-1.md](description-step-1.md). This step is request 9.

**Run it after the last step of this task that lands**, normally step 4. It changes no code, no
mockup and no config. It is the only step of task 28 that runs the librarian.

## Why one deposit

Request 9. Steps 1–4 skip the per-step `/librarian deposit` that CLAUDE.md's working rules ask for,
so that one pass sees the task's end state.

- Several entries are touched by more than one step:
  - `scope-boundaries` by steps 3 and 4;
  - `session-still-valid-guards-writes` by steps 1 and 3 (nineteen guarded RPCs, then eighteen);
  - `realtime-is-a-nudge-to-a-per-user-inbox` by steps 1 and 3;
  - `phone-is-the-product` by steps 2–4.
- One pass writes each entry once, instead of an early step writing it and a later one rewriting it.

## Inputs

- **The logs:** `implementation-log-step-1.md`, `-2.md`, `-3.md`, `-4.md` and `-4-unblock.md`, each
  ending in its **KB candidates** section.
  - Where they disagree, the log of the step that landed later wins, because it records the later
    state. `-4-unblock.md` is a follow-up to step 4 and landed last: on what an unblock restores,
    it overrides steps 1 and 4.
  - Steps 1 and 2 may land in either order, so check which came first.
- **The base:** the parent of the task's first step commit. Find it with `git log --oneline`. Task
  commits are named like `27-sign-in-email-1`.
- **Not the description files, and not the suggestion.** The command hands the planner logs only,
  because a log records what was actually built.

## How

- Run `/librarian deposit 28`.
- **Change one thing in the command's step 1.** The command is written for a single step's log.
  Hand the planner all five log paths and the base, and tell it they are one task's deposit. Hand
  it nothing else.
- Everything else is as the command says:
  1. save the plan on `Mode: groups`;
  2. run the risky groups, then the review-on-touch groups;
  3. close with `npm run kb:audit` and the `last_verified` check;
  4. relay the reports verbatim.
- `Mode: done` for the whole task is a valid outcome.

## Expected candidates

These are the union of the four steps' KB impact tables. They are a starting point, not a mandate:
the planner decides each one under the admission test in [CHARTER.md](../../kb/CHARTER.md).

| entry | from |
|---|---|
| scope-boundaries | steps 3 and 4, as one rewrite. **In:** invitations between existing accounts — Sharing invites, nobody joins without accepting, the inviter hears accept and decline, an owner may withdraw, and everything expires after 30 days. **In:** an in-app Notifications screen, paged 100 at a time, with no push or badge (D6). **In:** blocking, for invitations only (D5) — invisible to the blocked person except as one decline; unblocking restores every suppressed invitation still pending, as an unread notification dated when it was sent (the step 4 follow-up). **Still out:** the stranger invite (`list_invites`), and a wider block. The entry's "`share_list` takes only a resolved user id" becomes `invite_to_list` |
| session-still-valid-guards-writes | steps 1 and 3: seven new guarded RPCs, and `share_list` dropped, so eighteen. The `verify:`'s awk takes each function's latest `create` and does not see `drop function`, so it still lists `share_list` |
| realtime-is-a-nudge-to-a-per-user-inbox | steps 1 and 3: a second event on the same topic (`notifications/changed`, from `notify_recipient`); `notify_list_members` on a fourth table, `list_invitations`; the app side — `onNotifications` on the same channel, `lastNotificationsNudge`, and `NotificationsContext`'s debounced count. From the step 4 follow-up: an unblock nudges the unblocker once per restored invitation, and never for the notifications that were only hidden |
| list-data-scoped-by-rls | step 1: three RPC-only tables, with no policy and no grant. The invitation RPCs keep the list-then-rows lock order |
| deletion-is-a-tombstone | step 1: `purge_notifications`, a second nightly hard delete, for rows that are never tombstoned |
| limit-checks-pass-an-applied-resend | step 1: `accept_invitation` checks membership before inserting, because the limit trigger fires ahead of `on conflict` |
| the list limits (wherever the KB keeps them) | steps 1 and 3: met by the invitee at accept, in the second person. The owner no longer meets them at invite |
| keyset-paging-in-the-order-shown, or first-fetch-replaces-list-state | steps 1, 3 and 4: notifications and blocks page keyset, descending, inside RPCs, with the redundant `<=` and the measured plans. Both screens page outside `ListsContext`. Notifications' reload re-reads everything shown in one call, and its read marking is per page. An unblock drops its row and keeps the cursor |
| writes-retry-from-an-outbox | step 3: invitation and notification writes stay out of the outbox |
| phone-is-the-product | steps 2–4: the new mockups; the four `lists-screen-*` scenes re-rendered with the round header; the harness drawing Sharing again (calibrated), Notifications and Blocked people; the screenshots that match them; any image the user called superseded |
| maestro-drives-the-native-ui | step 3: finding a glyph-only button by its label |
| screens-take-navigation-props | step 4: `NotificationsScreen` listens for `focus` on its navigation prop, so test stubs supply `addListener` |

## Done when

- The deposit has closed. Every entry on the work list carries today's `last_verified`, or is named as
  flagged.
- `npm run kb:audit` passes, or each failure is named with whether the fact or the check is wrong.
  `session-still-valid-guards-writes` must pass now.
- `implementation-log-step-5.md` records:
  - the planner's mode and summary;
  - the groups run;
  - the audit result;
  - any entry still owed.

  The workers' reports go to the user verbatim and are summarized in the log, not copied.

There is no deposit after this step, because this step is the deposit.
