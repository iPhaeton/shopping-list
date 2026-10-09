---
id: blocking-is-per-invitation-and-unblock-restores
title: Blocking stops invitations only, is pressed on an invitation, and unblocking restores every still-pending suppressed invitation as an unread card dated when it was sent
type: decision
status: current
tags: [invitations, blocking, notifications, supabase, postgres]
sources: [ai/tasks/28-invitations/implementation-log-step-1.md, ai/tasks/28-invitations/implementation-log-step-4.md, ai/tasks/28-invitations/implementation-log-step-4-unblock.md, supabase/migrations/20261008000000_invitations.sql, supabase/migrations/20261009100000_unblock_restores_invitations.sql, src/lib/notificationsApi.ts, 0508f98, 2916e6e]
last_verified: 2026-10-09
verify: grep -q '^create function public.block_inviter(p_invitation_id uuid)' supabase/migrations/20261008000000_invitations.sql && b="$(awk '/^create (or replace )?function public\.unblock_user\(/{b=""; on=1} on{b=b $0 "\n"} on && /^\$\$;/{on=0} END{printf "%s", b}' supabase/migrations/*.sql)" && printf '%s' "$b" | grep -q 'set suppressed = false' && printf '%s' "$b" | grep -q 'insert into public.notifications' && printf '%s' "$b" | grep -q "'list_invitation'" && printf '%s' "$b" | grep -q 'r.created_at'
related: [scope-boundaries, session-still-valid-guards-writes, realtime-is-a-nudge-to-a-per-user-inbox]
indexed: false
---

**Blocking exists only to stop invitations** (task 28, D5). It removes nobody from a list and hides
nobody from the name search; a wider block is out of scope ([scope-boundaries](scope-boundaries.md)).

**Block is pressed on an invitation, never on a person.** It sits on a pending, available
invitation's card in Notifications, behind a confirm, and `block_inviter` takes the invitation id,
never a user id. It:

- declines that invitation — the inviter hears an ordinary decline;
- suppresses the inviter's other pending invitations to you and deletes their notifications;
- hides every notification from them while the block stands (`my_notifications`' filter).

Their later invitations are still inserted, `suppressed`, with no notification. On the inviter's
side every one of them stays *Invited*, so a block is never revealed.

**Unblocking restores every suppressed invitation still pending** — the ones pending when the block
was made and the ones sent while it stood. Each is unsuppressed, so it can be answered again, and
gets a new, unread `list_invitation` notification dated the **invitation's `created_at`**. The
pressed invitation stays declined; the inviter sees no change (to them it was *Invited*
throughout). Invitations an owner withdrew, or that expired, while blocked do not come back. One
whose list is now binned, or whose inviter no longer owns it, comes back as the unavailable card.

**This reverses step 1's D2, "Unblocking does not bring it back."** The comment on
`list_invitations.suppressed` in
[20261008000000_invitations.sql](../../../supabase/migrations/20261008000000_invitations.sql) still
says the old rule, as do task 28's `description-step-1.md` and step 1's S7. Migrations are
append-only, so that comment stays wrong: the latest `unblock_user` is in
[20261009100000_unblock_restores_invitations.sql](../../../supabase/migrations/20261009100000_unblock_restores_invitations.sql),
and it wins.

**Why the invitation's `created_at`:** the restored card sits in send order with a true age, not on
top as "just now". It expires with its invitation, which `purge_notifications` deletes on that date.

**Why re-create the notifications rather than keep them at block time.** Only `unblock_user`
changed: `block_inviter` still deletes the other pending invitations' notifications, and
`invite_to_list` still writes none while blocked, so a card read before the block comes back unread.
Keeping them would have preserved read state, but meant rewriting two more functions, and the
restore would still have been needed for invitations sent during the block and for blocks made
before the migration.

**The migration ends with a one-off repair**: every pending, suppressed invitation whose invitee no
longer blocks its inviter is restored the same way. The old `unblock_user` was what left that state
behind. It is idempotent — a second run, like a second unblock, finds nothing suppressed.

**One race stays open, rare:** `invite_to_list` reads the block without locking it, so an
invitation whose call read the block just before an unblock committed, and inserted just after,
stays suppressed with no block to lift. Closing it would mean locking the block row in
`invite_to_list`.

**What to do:** do not "simplify" unblock back to a bare delete of the `user_blocks` row, and do not
date the restored card `now()`. A new way of suppressing an invitation must be one `unblock_user`
undoes. The `verify:` asserts `block_inviter` takes an invitation id and that the latest
`unblock_user` unsuppresses and inserts `list_invitation` notifications dated `created_at`.
