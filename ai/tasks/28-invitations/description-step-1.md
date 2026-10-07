# Step 1 — Invitations, notifications and blocks: the database

User requests (2026-10-07 and 2026-10-08), verbatim, in order. This whole task comes from them:

1. "I want to introduce the invitation flow:
   - The user that wants to share a list with someone sends an invitation, the same flow as there is
     now to add a user
   - There is a Notifications page in the app, it shows all notifications, the notifications that
     weren't read are marked
   - The user that is invited to a list sees notification on the Notifications screen, also the
     Notifications button in the header is marked when there are unread notifications
   - On the Notifications screen the user can accept or ignore the invitations, they can also block
     the inviter not to see future invitations from that user
   - The blocked users should appear on a separate screen where they may be unblocked
   Create a suggestion for implementation."
2. "- Choice 2: Let's rename "Ignore" to "Decline". If the invitation is declined, the inviter should
   get a notification.
   - Let's make the Account pill a round button already."
   This was said after the first draft. Its choice 2 read: the inviter can't tell "ignored",
   "blocked" and "not seen yet" apart, so a block is never revealed.
3. "An accepted invitation should also appear on notifications"
4. "All confirmed". This confirmed decisions D1–D7 below.
5. "Create the task descriptions"
6. "Can we make notifications paged in the ui?" This was said after these descriptions were first
   written, which had capped the screen at 100 rows with no paging. It became D8.
7. "Let's make page size 100". This was said after D8 was drafted with pages of 25.
8. ""The bell can now stay marked after you open the screen" - that's fine". This confirmed D8's
   per-page read marking over marking everything read when the screen opens.
9. "Also, on no step the librarian should run. Create a separate last step to do that." Steps 1–4
   never run `/librarian deposit`, whatever CLAUDE.md's working rules say. Step 5 deposits the
   whole task once.
10. "Blocked users should also be paged". The page size, 100, is request 7's, carried over.

The design is [ai/suggestions/invitations-and-notifications.md](../../suggestions/invitations-and-notifications.md)
(commit `c07ce8a`). It is background, not scope. **Where it differs from these descriptions, these
descriptions win.**

## Decisions — settled, not open

| # | decision |
|---|---|
| D1 | An invitation **replaces** direct adding. `share_list` is dropped in step 3, and nobody becomes a member without accepting. Existing members' roles change only on the roster's `RolePicker`. The invite bar no longer doubles as a promote. |
| D2 | The inviter sees *Invited* until the invitee accepts or declines, an owner withdraws, or the invitation expires. **Accepting or declining sends the inviter a notification.** A block alone stays invisible: the invitation it is pressed on reads as an ordinary decline, and every later invitation from that inviter stays *Invited* until it expires. |
| D3 | Every invitation and every notification is **purged 30 days after it was created**, nightly. |
| D4 | **Opening the Notifications screen marks what it shows as read.** The dots stay for that visit and are gone on the next one. Accepting or declining also marks that invitation's notification read. |
| D5 | **Blocking governs invitations only.** It removes nobody from a shared list and hides nobody from name search. While the block stands, every notification from that person is hidden. |
| D6 | **In-app only.** No push, no app-icon badge (backlog #10 stays out). |
| D7 | The Lists header's three actions are all **round 36 pt buttons**: mode, Notifications (a bell), Account (a person glyph). |
| D8 | **The Notifications and Blocked people screens are paged** (requests 6 and 10), **100 per page** (request 7): newest first, keyset, the next page read on scroll, as Lists and List detail do. No cap on the total. On Notifications, D4 holds per page: a page marks its own unread rows when it loads. So with more than a page unread, the bell stays marked until the rest is scrolled to (confirmed, request 8). |

## The steps

| step | delivers |
|---|---|
| 1 (this) | the migrations: three tables, the RPCs, the realtime triggers, the purge. `share_list` stays, so the shipped app keeps working. No app change |
| 2 | mockups in `ai/ux/primary/`, signed off by the user. No app code |
| 3 | the app: the round header, `NotificationsContext`, the Notifications screen without Block, Sharing's Invite and Invited section. A migration drops `share_list` |
| 4 | the app: Block, the Blocked people screen, the Account card |
| 5 | the KB: one `/librarian deposit` for the whole task (request 9). No code |

Steps 1 and 2 are independent, and either may land first. Step 3 needs both. Step 4 needs step 3.
Step 5 runs after the last of them that lands.

**Scope change.** [scope-boundaries](../../kb/entries/scope-boundaries.md) keeps "invites out". That
is `list_invites`, the invite to an email with **no account**, which stays out. This task brings in
invitations between two existing, named accounts, found through the name search step 18 shipped.

## The migrations

Two files, dated the day they are written, sorting after `20261007000000`:

- `<yyyymmdd>000000_invitations.sql`: everything below except the cron schedule.
- `<yyyymmdd>000001_purge_notifications_schedule.sql`: only the `cron.schedule` call. Split for the
  reason [20260910000001_purge_schedule.sql](../../../supabase/migrations/20260910000001_purge_schedule.sql)
  gives: a refused statement rolls back only its own file.

Apply with `npx supabase migration up --local`. **Never `db reset`**: it wipes the 1M load-test users
and the screenshot accounts ([supabase-local-stack](../../kb/entries/supabase-local-stack.md)).
**Local only.** Do not push to cloud.

### Tables

```sql
create type public.invitation_status as enum ('pending', 'accepted', 'declined');
create type public.notification_kind as enum ('list_invitation', 'invitation_accepted', 'invitation_declined');

create table public.list_invitations (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists on delete cascade,
  inviter_id uuid not null references auth.users on delete cascade,
  invitee_id uuid not null references auth.users on delete cascade,
  role public.list_role not null,
  status public.invitation_status not null default 'pending',
  suppressed boolean not null default false,
  created_at timestamptz not null default now(),
  check (inviter_id <> invitee_id)
);
create unique index list_invitations_open_idx on public.list_invitations (list_id, invitee_id)
  where status = 'pending';
create index on public.list_invitations (list_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users on delete cascade,
  kind public.notification_kind not null,
  actor_id uuid not null references auth.users on delete cascade,
  list_id uuid not null references public.lists on delete cascade,
  invitation_id uuid references public.list_invitations on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check ((kind = 'list_invitation') = (invitation_id is not null))
);
create index on public.notifications (recipient_id, created_at desc, id desc);
create index on public.notifications (invitation_id) where invitation_id is not null;

create table public.user_blocks (
  blocker_id uuid not null references auth.users on delete cascade,
  blocked_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index on public.user_blocks (blocker_id, created_at desc, blocked_id desc);

alter table public.list_invitations enable row level security;
alter table public.notifications enable row level security;
alter table public.user_blocks enable row level security;
revoke all on public.list_invitations, public.notifications, public.user_blocks from anon, authenticated;
```

- **RPC-only, like `apple_tokens`.** No policy and no grant. Every read and write is a definer
  function, because each must see a row the caller's RLS hides: the inviter's name, a list the
  invitee is not on yet, another owner's invitation. The explicit revoke is needed because Supabase's
  default privileges grant every new `public` table to both roles
  ([supabase-default-grants-defeat-revokes](../../kb/entries/supabase-default-grants-defeat-revokes.md)).
- **`suppressed`** marks an invitation sent while the invitee blocks the inviter, or still pending
  when they blocked (D2). The inviter sees it as *Invited*. The invitee has no notification for it
  and cannot act on it. Unblocking does not bring it back.
- **A notification's `invitation_id`** is set only for `list_invitation`. Withdrawing or purging the
  invitation cascades to that notification. An answer (`invitation_accepted`/`invitation_declined`)
  points at no invitation, so it outlives the invitation's purge. The invitation's state is read
  through the join, never copied into `notifications`.
- **One open invitation per person per list.** A declined one is closed, so an owner may invite again
  after a decline. Block is the invitee's answer to repeats.
- **The cascades cover account deletion.** `delete_account` deleting sole-owned lists takes their
  invitations and notifications with them. The `auth.users` delete takes the departing account's
  invitations, notifications and blocks, in both directions. `delete_account` is not edited.
- Comment each table with its why, in the style of the existing migrations.

### RPC conventions

- Every one is `security definer`, `set search_path = ''`, and uses `(select auth.uid())`.
- `revoke execute … from public, anon;` then `grant execute … to authenticated;`. Read `pg_proc.proacl`
  back after applying.
- **Every write** starts with the session guard, verbatim:
  `if not public.session_still_valid() then raise exception using errcode = '42501', message = 'this device has been signed out'; end if;`
  ([session-still-valid-guards-writes](../../kb/entries/session-still-valid-guards-writes.md)).
  **Reads** are `stable` and unguarded, like `list_members_of`.
- **Never raise `23505`.** `verdictFor` in [listsApi.ts](../../../src/lib/listsApi.ts) reads it as
  `'applied'`, so the app would report the refusal as success. Use `22023` for "already" refusals,
  as `share_list` does. `P0002` and `42501` are classified `permanent`.
- **Lock order: the list first, then its rows.** Any RPC that writes an invitation's state takes
  `perform 1 from public.lists l where l.id = … for no key update` before touching the invitation.
  [20261005100000_list_owner_locks.sql](../../../supabase/migrations/20261005100000_list_owner_locks.sql)
  explains why. Here, locking the invitation first deadlocks against the inviter's `delete_account`,
  which holds the list and whose cascade needs the invitation.
- End the file with `notify pgrst, 'reload schema';`.

### Write RPCs (all guarded)

Raise in the order listed. Messages are exact, because the app shows them verbatim.

**`invite_to_list(p_list_id uuid, p_user_id uuid, p_role public.list_role) returns void`**

1. The caller is not an owner of the list → `42501` `'only an owner can invite people to this list'`.
2. The list is binned (`deleted_at is not null`) → `P0002` `'this list is in the bin'`.
3. `p_user_id` is the caller → `22023` `'you already have this list'`.
4. No `public.users` row for `p_user_id` → `P0002` `'that account no longer exists'`.
5. `p_user_id` is already a member → `22023` `'they already have this list'`.
6. Look up `blocked`: does `p_user_id` block the caller?
7. Insert the invitation with `suppressed = blocked`, using
   `on conflict (list_id, invitee_id) where status = 'pending' do nothing returning id into …`.
   If nothing was inserted → `22023` `'they have already been invited'`.
8. If not `blocked`, insert the invitee's `list_invitation` notification. A suppressed invitation
   gets none; that absence is what hides it.

No list lock (it changes no ownership) and **no limit check**. The invitee meets the limits at
accept, when the count actually moves.

**`withdraw_invitation(p_invitation_id uuid) returns void`**

- Look up the invitation's list, lock that list, then delete the row where `status = 'pending'` and
  the caller is an owner of its list. This lets any owner withdraw, not only the inviter. Its
  notification cascades.
- No row → `P0002` `'this invitation is no longer open'`. That covers a bad id, a non-owner, and
  an invitation already answered.

**`mark_notifications_read(p_ids uuid[]) returns void`**

- `read_at = now()` where `id = any(p_ids) and recipient_id = caller and read_at is null`.
- Marks **exactly the ids passed**, so a notification that arrived between the app's fetch and its
  mark keeps its dot. Unknown or foreign ids are skipped silently.

**`accept_invitation(p_invitation_id uuid) returns uuid`** (the list id, so the app can open it)

1. Read the invitation's `list_id` (where `invitee_id` = caller) and lock that list. If none is
   found, the lock statement locks nothing, and step 2 raises.
2. `select … for update` the invitation where it is the caller's, `pending`, and `not suppressed`.
   None → `P0002` `'this invitation is no longer open'`.
3. The list is binned → `P0002` `'this list has been deleted'`.
4. The inviter is no longer an owner of the list (checked under the lock) → `P0002`
   `'this invitation is no longer valid'`.
5. Insert the membership with the invitation's role, **only if the caller is not already a member**.
   Do not rely on `on conflict do nothing`: `limit_list_memberships` is a BEFORE trigger, so it fires
   ahead of the conflict check
   ([limit-checks-pass-an-applied-resend](../../kb/entries/limit-checks-pass-an-applied-resend.md)).
   While `share_list` still exists, an owner can add someone who also has a pending invitation. The
   trigger may raise `LM001`/`LM002` here. That refusal is the invitee's, and the app rephrases it.
6. Set `status = 'accepted'`, and set `read_at = coalesce(read_at, now())` on the caller's
   notification for this invitation.
7. Insert an `invitation_accepted` notification to the inviter, with the caller as actor. Notify the
   inviter only, not the list's other owners.
8. Return the list id.

**`decline_invitation(p_invitation_id uuid) returns void`**

- Same lock order as accept. It adds no member, but the notification insert takes a key share on the
  list, and that would wait on an inviter's `delete_account` that is itself waiting on the invitation
  row this function holds.
- Update to `declined` where the invitation is the caller's, `pending`, and `not suppressed`.
  None → `P0002` `'this invitation is no longer open'`.
- Mark the caller's notification read, as accept does. Insert an `invitation_declined` notification
  to the inviter.

**`block_inviter(p_invitation_id uuid) returns void`**

- Takes an **invitation**, not a user id. Blocking is only ever offered on an invitation, and this
  way a caller can neither block an arbitrary id nor then read back its name.
- `decline_invitation`'s body, with the same refusals. Then three more statements:
  1. Suppress every other `pending` invitation from that inviter to the caller.
  2. Delete those invitations' notifications to the caller.
  3. Insert the block, `on conflict do nothing`.
- Only the pressed invitation's list is locked. Suppressing writes no member and no key column.
- The inviter is told of the decline, as with any decline (D2). The block itself is never told.

**`unblock_user(p_user_id uuid) returns void`**

- Delete the caller's block of `p_user_id`. Idempotent: no row is not an error.
- Suppressed invitations stay suppressed.

### Read RPCs (stable, unguarded)

**`pending_invitations_of(p_list_id uuid) returns table (invitation_id uuid, user_id uuid, name text, role public.list_role, created_at timestamptz)`**

- For an owner of the list: its `pending` invitations, **suppressed ones included** (D2), oldest
  first.
- For anyone else: empty.

**`my_notifications(p_before_at timestamptz default null, p_before_id uuid default null, p_limit integer default 100) returns table (id uuid, kind public.notification_kind, created_at timestamptz, read_at timestamptz, actor_id uuid, actor_name text, list_id uuid, list_name text, invitation_id uuid, role public.list_role, status public.invitation_status, available boolean)`**

- Query: `notifications n` join `users` (the actor) join `lists`, left join `list_invitations` on
  `invitation_id`.
- Filter: `n.recipient_id` = caller, and **no `user_blocks` row from the caller to `n.actor_id`**
  (D5). The notifications come back on unblock.
- **Paged, keyset, in the order shown (D8).** Order `n.created_at desc, n.id desc`. With no cursor
  it returns page 1. With a cursor (the last row's `created_at` and `id`), it returns the rows after
  that row:

  ```sql
  and (p_before_at is null
       or (n.created_at <= p_before_at
           and (n.created_at < p_before_at or n.id < p_before_id)))
  ```

  - The `<=` is redundant, and it is the point: it turns the index condition into a range starting at
    the cursor ([keyset-paging-in-the-order-shown](../../kb/entries/keyset-paging-in-the-order-shown.md)).
  - Keep `id` in the key: rows written in one transaction share `created_at`, because `now()` is
    frozen per transaction.
- `limit least(greatest(p_limit, 1), 1000)`. The ceiling is PostgREST's `max_rows`, which would
  otherwise cut a larger answer silently
  ([max-rows-is-a-silent-ceiling](../../kb/entries/max-rows-is-a-silent-ceiling.md)). The app asks
  for more than one page only to re-read what it already shows.
- `invitation_id`, `role`, `status` and `available` are null for the two answer kinds.
- `available` = the list is not binned and the inviter is still an owner. It is meaningful only
  while `pending`.
- A generic row on purpose: a later kind is one enum value and a `case` in the app.

**`unread_notification_count() returns integer`**

- The same predicate as `my_notifications`, plus `read_at is null`. No limit.

**`my_blocked_users(p_before_at timestamptz default null, p_before_id uuid default null, p_limit integer default 100) returns table (user_id uuid, name text, blocked_at timestamptz)`**

- The caller's blocks, **paged exactly as `my_notifications` is** (D8). The keyset is
  `(created_at, blocked_id)` descending, newest block first, with the same redundant `<=` and the
  same clamp on `p_limit`.
- The cursor is the last row's `blocked_at` and `user_id`.
- The primary key serves the existence checks in `invite_to_list` and `my_notifications`. The new
  index serves this read.

**`search_users_by_name(p_query text, p_list_id uuid default null)`** (backlog #23)

- Drop the one-argument function and recreate it. Drop, never overload: PostgREST must never have
  two candidates for one call.
- The body is
  [20260922000000_share_by_name.sql](../../../supabase/migrations/20260922000000_share_by_name.sql)'s,
  plus one filter. When the caller owns `p_list_id`, exclude that list's members and anyone with a
  `pending` invitation to it, **before** `limit 5`, so the filter never shrinks the five suggestions.
- When the caller does not own `p_list_id`, ignore the parameter. Otherwise anyone holding a list id
  could probe its roster.
- The shipped app calls it with `p_query` alone. The default keeps that call working.

### Realtime

```sql
create function public.notify_recipient() returns trigger …   -- r := old on DELETE, new otherwise
  perform realtime.send(
    jsonb_build_object('source', 'notifications', 'op', tg_op),
    'notifications/changed',
    'user:' || r.recipient_id::text,
    true
  );

create trigger notify_on_notification_change
  after insert or update or delete on public.notifications
  for each row execute function public.notify_recipient();

create trigger notify_on_invitation_change
  after insert or update or delete on public.list_invitations
  for each row execute function public.notify_list_members();
```

- **No receive-policy change.** The `realtime.messages` policy is topic-only and event-agnostic
  ([realtime-is-a-nudge-to-a-per-user-inbox](../../kb/entries/realtime-is-a-nudge-to-a-per-user-inbox.md)).
  Check that this still holds before relying on it.
- **`notify_list_members` is reused unchanged.** Its `else` branch reads `new.list_id`. It refreshes
  the *Invited* section on every owner's Sharing screen. A suppressed invitation nudges the list's
  members, which tells the invitee nothing.
- Nudge only: neither payload carries anything the app trusts.
- `mark_notifications_read` on n rows sends n nudges to the caller's own topic. The app debounces
  them (step 3). Record n and the count of `realtime.messages` rows in the log.
- Like the other trigger functions, `notify_recipient` gets no grant. Push (D6) would attach here
  later.

### Expiry (D3)

`purge_notifications(p_older_than interval default interval '30 days')`, modelled on `purge_deleted`
in [20260910000000_deletion.sql](../../../supabase/migrations/20260910000000_deletion.sql):

- Delete invitations, then notifications, `where created_at <= now() - p_older_than`. Use **`<=`,
  not `<`**: `now()` is frozen per transaction, so `<` makes the zero-interval proof call a no-op.
- Return the two counts.
- `revoke execute … from public, anon, authenticated`, as `purge_deleted` does.
- Schedule it in the second file:
  `select cron.schedule('purge-notifications', '35 3 * * *', $$select public.purge_notifications()$$);`.
  That is five minutes after `purge-deleted`. Re-running it upserts by name.

## Tests

Run by hand in `psql` on the local stack, and record every case in the log.

- **Run as `authenticated` with a real `session_id`** in `request.jwt.claims`; with only `sub`, every
  guarded RPC raises. Sign throwaway accounts in through OTP (Mailpit and `/auth/v1/verify`), and take
  each `session_id` from `auth.sessions`.
- **Never use `maya@example.com` or `maya3@example.com`.**
- Wrap each case in a transaction and roll back where possible. Count rows as `postgres`, never by the
  absence of an error: RLS refuses with zero rows
  ([refused-writes-return-zero-rows](../../kb/entries/refused-writes-return-zero-rows.md)).

**Fixture:** throwaway accounts O (owner), P (second owner), I (invitee), X (stranger); list L owned
by O and P.

| case | expect |
|---|---|
| each refusal of each write RPC, in the order above | the exact code and message |
| O invites I twice | the second raises `22023` `they have already been invited` |
| O invites I, and I declines | O can invite I again |
| O invites a member | `22023` `they already have this list` |
| anything inviting into a binned list | `P0002` |
| I blocks O, then O invites I | the row lands `suppressed`, with no notification for I; `pending_invitations_of` shows it to O and P; I's `accept_invitation` and `decline_invitation` on it raise `P0002` |
| I accepts | I is a member with the invitation's role; I's notification is read; exactly one new notification, `invitation_accepted` to O; P gets nothing |
| I declines | `invitation_declined` to O only |
| I blocks on one invitation while O has two more pending to I | the pressed one is declined and O is notified; the other two are suppressed, still pending, still in `pending_invitations_of`, and their notifications are gone; `my_notifications` for I shows nothing from O; after `unblock_user` it shows O's earlier rows again; the suppressed ones stay suppressed |
| `unblock_user` twice | no error |
| P withdraws O's invitation | the row and I's notification are gone; X withdrawing raises `P0002` |
| O is demoted, then I accepts | `P0002` `this invitation is no longer valid` |
| I at 1,000 lists accepts | `LM002`; nothing changes |
| I at 100 owned lists accepts an owner invitation | `LM001` |
| `search_users_by_name` | with O's call and `p_list_id = L`, it excludes L's members and pending invitees and still returns five when five others match; with X's call and `L`, it is unfiltered; it still works with `p_query` alone |
| `my_notifications` | all three kinds decode; `available` is false after L is binned and after the inviter is demoted |
| `my_notifications` paging | with 250 rows for I, a dozen of them sharing one `created_at` across the boundary between pages 1 and 2, walking pages of 100 by each page's last row returns all 250 newest first (100, 100, 50), with no gap and no repeat; a page after the last is empty; `p_limit` 0 reads as 1 and 5000 as 1000; a blocked actor's rows are skipped on every page |
| `my_blocked_users` paging | with 250 blocks by one account (the blocked are load-test accounts), a dozen sharing one `created_at` across the boundary between pages 1 and 2, walking pages of 100 returns all 250 newest first (100, 100, 50), with no gap and no repeat; after an unblock of a page-1 row, continuing from page 1's last row still returns page 2 whole |
| `mark_notifications_read` | marks only the ids passed, and only the caller's |
| `purge_notifications(interval '0 seconds')` | removes every invitation and notification; answers lose nothing they need |
| `anon` | cannot execute any of the new functions |
| a revoked `session_id` | every write raises `42501` `this device has been signed out` and changes nothing |
| `delete_account` of I, and of O | no invitation, notification or block of theirs remains |
| broadcasts | in one transaction, count `realtime.messages` per topic and event: an invite gives `notifications/changed` to I, plus `list/changed` to each member of L |

**Races.** Use two `psql` sessions holding transactions open. Each must wait, not deadlock (`40P01`),
and end in a consistent state. Record what each saw:

- I accepts while O runs `delete_account`, in both orders.
- I declines while O runs `delete_account`.
- I blocks while O runs `delete_account`.
- I accepts while P withdraws.
- I accepts while P demotes O.

**Plan.** Measure `my_notifications` and `my_blocked_users` with `explain (analyze, buffers)` as
`authenticated`, for page 1 and for a cursor deep in the stream:

- Seed first, by [read-rooted-at-list-members](../../kb/entries/read-rooted-at-list-members.md)'
  method: about 1M notifications spread over the load-test accounts, and 10,000 for one test account;
  and 10,000 blocks by one test account, beside a few hundred thousand by others.
  A table of a few thousand rows gives a seq scan that says nothing about scale.
- Expected: a walk of `(recipient_id, created_at desc, id desc)`, and of
  `(blocker_id, created_at desc, blocked_id desc)`, that stops after a page. Record buffers and
  time for each.
- Delete the seed afterwards.

**Through `/rest/v1/rpc/…`** with a real access token: record the HTTP status of one success and of
each refusal code (`22023`, `P0002`, `42501`, `LM002`). Step 3 classifies by them.

## Verification

- `npm run kb:audit` is **expected to fail on `session-still-valid-guards-writes`**. Its `verify:`
  asserts exactly twelve guarded RPCs, and this step makes nineteen: `share_list` stays, plus
  `invite_to_list`, `withdraw_invitation`, `mark_notifications_read`, `accept_invitation`,
  `decline_invitation`, `block_inviter` and `unblock_user`. The fact changed; the check is not broken.
  Leave it for step 5, and never edit code or check to make it pass. Investigate any other
  failure.
- `npm test` and `npm run typecheck` pass unchanged.
- The shipped app still shares, searches and receives nudges on the local stack.

## After this step

- **Do not run `/librarian deposit`**, whatever CLAUDE.md's working rules say (request 9).
  Step 5 deposits the whole task once.
- Write `implementation-log-step-1.md` as usual. End it with a **KB candidates** section: the table
  below, corrected to what was actually done, plus anything the step taught that the table misses.
  That section is how this step reaches step 5.
- Never edit `ai/kb/`. If `npm run kb:audit` fails on an entry this step made stale, that is
  expected until step 5: name it in the log. Never change code to make a check pass.

## KB impact (for step 5's deposit)

| entry | change |
|---|---|
| session-still-valid-guards-writes | seven new guarded write RPCs, nineteen in all until step 3 drops `share_list`. Update the list and the `verify:` |
| realtime-is-a-nudge-to-a-per-user-inbox | a second event on the same topic (`notifications/changed`, from `notify_recipient` on `notifications`), and `notify_list_members` on a fourth table, `list_invitations` |
| list-data-scoped-by-rls | three RPC-only tables with no policy and no grant. The invitation RPCs keep the list-then-rows lock order |
| deletion-is-a-tombstone | a second nightly hard delete, `purge_notifications`, for rows that are never tombstoned |
| limit-checks-pass-an-applied-resend | `accept_invitation` checks membership before inserting, because the limit trigger fires ahead of `on conflict` |
| keyset-paging-in-the-order-shown | a fifth and sixth paged read: notifications `(created_at, id)` and blocks `(created_at, blocked_id)`, both descending, with the redundant `<=`, inside RPCs rather than PostgREST filters. Add the measured plans |
| scope-boundaries | nothing yet. Step 3 brings the scope change |
