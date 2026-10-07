# Suggestion — list invitations, a Notifications screen, and blocking

**Status:** proposal, promoted 2026-10-08 by `ai/tasks/28-invitations/description-step-1.md` to
`-step-5.md` at the user's request; where they differ from this file, they win.
[scope-boundaries](../kb/entries/scope-boundaries.md) is updated by the librarian in step 5, once for
the whole task.

**Date:** 2026-10-07

**Revised 2026-10-08 — the user's review of the uncommitted draft, rewritten in place.** "Ignore"
became **Decline**, and a decline now **notifies the inviter** — and, in a second pass the same day,
so does an **accept** — so D2 no longer hides the outcome; only a block stays invisible. That made
three notification kinds, so the read state moved off
`list_invitations` onto a new `notifications` table, and blocking became `block_inviter`, which acts
on one invitation. The `Account` pill becomes a round button **as part of this work**, no longer a
fallback for a crowded header. D1–D7 were then all confirmed. The 2026-10-07 draft was never committed, so no inline markers.

**Sourced from `backlog/backlog.txt`** #21 *Invitations*, and it folds in #23 *Filter out already
invited users in the share list*, which only becomes meaningful once an "invited" state exists.
#10 *Push notifications* stays out (see "Deliberately out").

**Not the invite [scope-boundaries](../kb/entries/scope-boundaries.md) keeps out.** That entry's
"invites out" is `list_invites` — inviting an email with **no account**, claimed at sign-up. This
proposal is between two existing, named accounts, found through the search step 18 already ships.
The stranger invite stays out.

## What the user asked for

1. Sharing sends an **invitation** instead of adding the person — same search-by-name flow as today.
2. A **Notifications** screen listing every notification; unread ones are marked.
3. The invitee sees the invitation there, and the **Notifications button in the Lists header is
   marked** while anything is unread.
4. On that screen the invitee can **Accept** or **Decline**, and can **Block** the inviter so no
   further invitations from them are shown. **An accept or a decline notifies the inviter**
   (2026-10-08).
5. Blocked people are listed on **their own screen**, where each can be unblocked.
6. The `Account` pill in the Lists header becomes a **round button** (2026-10-08).

## Decisions — all seven confirmed by the user, 2026-10-08

| # | decision | why |
|---|---|---|
| D1 | An invitation **replaces** direct adding. `share_list` is dropped; nobody becomes a member without accepting. Role changes of existing members stay on the roster's `RolePicker` — the invite bar stops doubling as a promote. | "Same flow as there is now", with consent in the middle. Keeping both paths would let an owner skip the invitee's consent. |
| D2 | The inviter sees *Invited* until the invitee accepts or declines, an owner withdraws, or it expires. **Accepting or declining sends the inviter a notification.** A block alone stays invisible: the invitation it is pressed on reads as an ordinary decline, and every later invitation from that inviter stays *Invited* until it expires — the same as someone who has not opened the app. | The user wants declines told. A block that showed itself would invite retaliation and new accounts, and an *instant* decline of every later invitation would show it. |
| D3 | Every invitation and every notification is **purged 30 days after it was created**, by the nightly cron that already runs `purge_deleted`. | Keeps the Notifications screen bounded with no paging, and gives *Invited* an end. Same horizon as the bin. |
| D4 | **Opening the Notifications screen marks what it shows as read.** The dots stay for that visit and are gone on the next one. Accepting or declining also marks that invitation's notification read. | No per-row "mark read" gesture to learn; the badge clears the moment you look. |
| D5 | **Blocking only governs invitations.** It does not remove anyone from a list you already share, does not hide you from their name search, and hides every notification from that person while the block stands. | Exactly what was asked ("not to see future invitations"). A wider block (hide from search, eject from lists) is a separate, bigger feature. |
| D6 | **In-app only.** No push notification, no app-icon badge. | Push is backlog #10, needs `expo-notifications`, APNs keys and a sender. This design leaves the hook for it (the `notifications` trigger). |
| D7 | The Lists header's three actions are all **round 36 pt buttons**: mode, Notifications, Account (a person glyph). | The user's call. Three round buttons end ~69 pt clear of the title; the pill plus a bell would have left ~11 pt. |

## Current state

- `SharingScreen` ([SharingScreen.tsx](../../src/screens/SharingScreen.tsx)) — an owner picks a
  person in `UserAutocomplete`, picks a role, taps Share; `membersApi.shareList` calls
  `share_list(p_list_id, p_user_id, p_role)` and the person is a member immediately. Latest body:
  `supabase/migrations/20261005100000_list_owner_locks.sql`.
- Realtime ([realtime-is-a-nudge-to-a-per-user-inbox](../kb/entries/realtime-is-a-nudge-to-a-per-user-inbox.md)):
  one private topic per user, `user:<uid>`; the database sends `list/changed` with a list id; the
  receive policy on `realtime.messages` is **topic-only and event-agnostic**, so a new event name on
  the same topic needs no policy change. `notify_list_members()` is generic over any table with a
  `list_id` column, so it can be attached to a new one unchanged.
- `ListsContext` owns the one channel (`subscribeToChanges` in
  [listsChannel.ts](../../src/lib/listsChannel.ts)) and republishes nudges as `lastNudge`, which
  `SharingScreen` already listens to.
- The list limits fire in `limit_list_memberships`, a BEFORE trigger on `list_members`
  (`20261001000000_list_limits.sql`). Their messages are about *somebody else* ("they are already on
  1,000 lists") because today the owner meets them at share time.
- `verdictFor` in [listsApi.ts](../../src/lib/listsApi.ts#L507) maps **`23505` to `'applied'`** —
  "my own insert caught up with itself". So no new refusal below may raise `23505`; "already invited"
  uses `22023`, the code `share_list` already uses for "you already have this list".
- The Lists header ([ListsScreen.tsx](../../src/screens/ListsScreen.tsx), `titleActions`) is
  `ModeButton` (a round 36 pt `IconButton`) then `<PillButton label="Account" />`. The label
  `Account` is what `ListsScreen.test.tsx` and three Maestro flows (`sign-out`, `set-theme`,
  `tour-signed-in`, plus `ensure-signed-in`'s `visible:`) find it by.

## Schema — one migration

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
  -- Sent while the invitee was blocking the inviter, or still pending when they blocked (D2): the
  -- inviter sees "Invited" like any other; the invitee has no notification for it and cannot act on
  -- it. Unblocking does not bring it back.
  suppressed boolean not null default false,
  created_at timestamptz not null default now(),
  check (inviter_id <> invitee_id)
);

-- One *open* invitation per person per list. A declined one is closed, so an owner may invite again
-- after a decline — Block is the answer to an owner who keeps doing so.
create unique index list_invitations_open_idx on public.list_invitations (list_id, invitee_id)
  where status = 'pending';

-- `pending_invitations_of` reads by list, and the cascade from `lists` finds rows by it.
create index on public.list_invitations (list_id);

-- What the Notifications screen shows, and the only place read state lives. Three kinds today: an
-- invitation, to the invitee; its answer — accepted or declined — to the inviter. The invitation's
-- own state (pending, accepted, declined) is read from `list_invitations` through `invitation_id`,
-- never copied here.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users on delete cascade,
  kind public.notification_kind not null,
  actor_id uuid not null references auth.users on delete cascade,
  list_id uuid not null references public.lists on delete cascade,
  -- Withdrawing or purging the invitation takes its notification with it. An answer points nowhere:
  -- it must outlive the invitation row's purge, and it needs nothing from it.
  invitation_id uuid references public.list_invitations on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check ((kind = 'list_invitation') = (invitation_id is not null))
);

-- The screen and the unread count: a recipient's own rows, newest first.
create index on public.notifications (recipient_id, created_at desc);
create index on public.notifications (invitation_id) where invitation_id is not null;

create table public.user_blocks (
  blocker_id uuid not null references auth.users on delete cascade,
  blocked_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- RPC-only, like `apple_tokens`: no policy, no grant. Every read and write below is a definer
-- function, because each one has to see a row the caller's RLS would hide — the inviter's name, a
-- list the invitee is not on yet, another owner's invitation.
alter table public.list_invitations enable row level security;
alter table public.notifications enable row level security;
alter table public.user_blocks enable row level security;
revoke all on public.list_invitations, public.notifications, public.user_blocks from anon, authenticated;
```

Every account-deletion path is covered by the cascades: `delete_account` deleting sole-owned lists
takes their invitations and notifications with them, and the `auth.users` delete takes the departing
account's invitations, notifications and blocks, in both directions. `delete_account` needs no edit.

### The RPCs

Every write RPC starts with the `session_still_valid()` guard
([session-still-valid-guards-writes](../kb/entries/session-still-valid-guards-writes.md)); every
read is `stable`, unguarded, like `list_members_of`. All are `security definer`,
`set search_path = ''`, `(select auth.uid())`, `revoke … from public, anon` / `grant … to
authenticated`, with `notify pgrst, 'reload schema'` at the end of the migration.

| RPC | kind | who | does |
|---|---|---|---|
| `invite_to_list(p_list_id, p_user_id, p_role)` | write | owner | replaces `share_list` — body below |
| `pending_invitations_of(p_list_id)` | read | owner | `(invitation_id, user_id, name, role, created_at)` for `pending` rows, suppressed included (D2); empty for a non-owner |
| `withdraw_invitation(p_invitation_id)` | write | any owner of the list | deletes a `pending` row (its notification cascades); `P0002` if none |
| `my_notifications()` | read | anyone | the caller's notifications, newest first, `limit 100` — shape below |
| `unread_notification_count()` | read | anyone | what `my_notifications` would show with `read_at is null` |
| `mark_notifications_read(p_ids uuid[])` | write | recipient | `read_at = now()` on **exactly the ids shown**, so one that arrived between the fetch and the mark keeps its dot |
| `accept_invitation(p_invitation_id)` → `uuid` | write | invitee | body below; notifies the inviter, and returns the list id so the client can open it |
| `decline_invitation(p_invitation_id)` | write | invitee | body below; notifies the inviter |
| `block_inviter(p_invitation_id)` | write | invitee | declines that invitation (notifying the inviter, D2), suppresses every other `pending` one from the same inviter and deletes their notifications, inserts the block (`on conflict do nothing`) |
| `unblock_user(p_user_id)` | write | anyone | deletes the block; idempotent — a second tap is not an error. Suppressed invitations stay suppressed |
| `my_blocked_users()` | read | anyone | `(user_id, name, blocked_at)`, newest first |
| `search_users_by_name(p_query, p_list_id default null)` | read | anyone | backlog #23 — below |

`block_inviter` takes an **invitation**, not a user id: blocking is only ever offered on an
invitation, and this way a caller cannot block — and then read back the name of — an arbitrary id.

```sql
drop function public.share_list(uuid, uuid, public.list_role);   -- in the client step; see Staging

create function public.invite_to_list(p_list_id uuid, p_user_id uuid, p_role public.list_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  blocked boolean;
  invitation uuid;
begin
  if not public.session_still_valid() then
    raise exception using errcode = '42501', message = 'this device has been signed out';
  end if;

  if not exists (
    select 1 from public.list_members m
     where m.list_id = p_list_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'only an owner can invite people to this list';
  end if;

  if exists (select 1 from public.lists l where l.id = p_list_id and l.deleted_at is not null) then
    raise exception using errcode = 'P0002', message = 'this list is in the bin';
  end if;

  if p_user_id = (select auth.uid()) then
    raise exception using errcode = '22023', message = 'you already have this list';
  end if;

  if not exists (select 1 from public.users u where u.id = p_user_id) then
    raise exception using errcode = 'P0002', message = 'that account no longer exists';
  end if;

  if exists (select 1 from public.list_members m where m.list_id = p_list_id and m.user_id = p_user_id) then
    raise exception using errcode = '22023', message = 'they already have this list';
  end if;

  blocked := exists (select 1 from public.user_blocks b
                      where b.blocker_id = p_user_id and b.blocked_id = (select auth.uid()));

  insert into public.list_invitations (list_id, inviter_id, invitee_id, role, suppressed)
  values (p_list_id, (select auth.uid()), p_user_id, p_role, blocked)
  on conflict (list_id, invitee_id) where status = 'pending' do nothing
  returning id into invitation;

  -- Not 23505: `verdictFor` reads that as "already applied", and the screen would call it success.
  if invitation is null then
    raise exception using errcode = '22023', message = 'they have already been invited';
  end if;

  -- A suppressed invitation gets no notification: that absence is what hides it.
  if not blocked then
    insert into public.notifications (recipient_id, kind, actor_id, list_id, invitation_id)
    values (p_user_id, 'list_invitation', (select auth.uid()), p_list_id, invitation);
  end if;
end;
$$;
```

No list lock: inviting changes no ownership. The limits are **not** checked here — the invitee meets
them at accept, the moment the count actually moves, and an owner no longer learns whether a
stranger is at a limit.

```sql
create function public.accept_invitation(p_invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
  inv public.list_invitations;
begin
  if not public.session_still_valid() then
    raise exception using errcode = '42501', message = 'this device has been signed out';
  end if;

  select i.list_id into target from public.list_invitations i
   where i.id = p_invitation_id and i.invitee_id = (select auth.uid());

  -- The list first, then its rows — the order every membership write takes
  -- (20261005100000_list_owner_locks.sql). Locking the invitation first would deadlock against the
  -- inviter's `delete_account`, which holds the list and whose cascade needs the invitation.
  perform 1 from public.lists l where l.id = target for no key update;

  select * into inv from public.list_invitations i
   where i.id = p_invitation_id and i.invitee_id = (select auth.uid())
     and i.status = 'pending' and not i.suppressed
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'this invitation is no longer open';
  end if;

  if exists (select 1 from public.lists l where l.id = inv.list_id and l.deleted_at is not null) then
    raise exception using errcode = 'P0002', message = 'this list has been deleted';
  end if;

  -- Re-checked under the lock: an inviter demoted or removed since sending can no longer vouch.
  if not exists (
    select 1 from public.list_members m
     where m.list_id = inv.list_id and m.user_id = inv.inviter_id and m.role = 'owner'
  ) then
    raise exception using errcode = 'P0002', message = 'this invitation is no longer valid';
  end if;

  -- `limit_list_memberships` fires here and may raise LM001/LM002 — at the invitee, now.
  insert into public.list_members (list_id, user_id, role)
  values (inv.list_id, inv.invitee_id, inv.role)
  on conflict (list_id, user_id) do nothing;

  update public.list_invitations set status = 'accepted' where id = inv.id;
  update public.notifications set read_at = coalesce(read_at, now())
   where invitation_id = inv.id and recipient_id = inv.invitee_id;

  -- To the inviter, as a decline is. Not to the list's other owners: they see the new member on
  -- the roster, and the invitation was not theirs.
  insert into public.notifications (recipient_id, kind, actor_id, list_id)
  values (inv.inviter_id, 'invitation_accepted', inv.invitee_id, inv.list_id);

  return inv.list_id;
end;
$$;
```

```sql
create function public.decline_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
  inv public.list_invitations;
begin
  if not public.session_still_valid() then
    raise exception using errcode = '42501', message = 'this device has been signed out';
  end if;

  -- Locked like accept, though it adds no member: the decline's notification insert takes a key
  -- share on the list, which waits on the inviter's `delete_account` deleting it while that
  -- delete's cascade waits on the invitation row this function holds.
  select i.list_id into target from public.list_invitations i
   where i.id = p_invitation_id and i.invitee_id = (select auth.uid());
  perform 1 from public.lists l where l.id = target for no key update;

  update public.list_invitations i set status = 'declined'
   where i.id = p_invitation_id and i.invitee_id = (select auth.uid())
     and i.status = 'pending' and not i.suppressed
  returning * into inv;

  if not found then
    raise exception using errcode = 'P0002', message = 'this invitation is no longer open';
  end if;

  update public.notifications set read_at = coalesce(read_at, now())
   where invitation_id = inv.id and recipient_id = inv.invitee_id;

  insert into public.notifications (recipient_id, kind, actor_id, list_id)
  values (inv.inviter_id, 'invitation_declined', inv.invitee_id, inv.list_id);
end;
$$;
```

`block_inviter` is `decline_invitation`'s body followed by three statements: suppress the inviter's
other `pending` invitations to the caller, delete their notifications, and insert the block. It takes
the pressed invitation's list lock only; the other invitations' lists are not locked, since
suppressing writes neither a member nor a key column.

`my_notifications()` returns a **generic** row, so the client is not built around invitations alone:

```sql
returns table (
  id uuid, kind public.notification_kind, created_at timestamptz, read_at timestamptz,
  actor_id uuid, actor_name text,
  list_id uuid, list_name text,
  invitation_id uuid,                 -- these four null for the two answers
  role public.list_role,
  status public.invitation_status,
  available boolean                   -- list live and inviter still an owner; meaningful while pending
)
```

`from notifications n join users actor join lists l left join list_invitations i on i.id =
n.invitation_id`, `where n.recipient_id = (select auth.uid())` and **no `user_blocks` row from the
caller to `n.actor_id`** (D5 — hidden while the block stands, back on unblock). A fourth kind later
(backlog #10's "item completed", say) is one more enum value and a `case` in the client.
`unread_notification_count()` uses the same predicate plus `read_at is null`.

**`search_users_by_name` (backlog #23).** Dropped and recreated with `p_list_id uuid default null`
— dropped, not overloaded, so PostgREST never has two candidates for one call. When the caller owns
`p_list_id`, members of that list and people with a `pending` invitation to it are excluded
**before** `limit 5`, so filtering never shrinks the five suggestions. When the caller does not own
it, the parameter is ignored — otherwise anyone holding a list id could probe its roster.

### Realtime — one new event, one reused trigger

```sql
create function public.notify_recipient() returns trigger …
  -- r := old on DELETE, new otherwise.
  perform realtime.send(
    jsonb_build_object('source', 'notifications', 'op', tg_op),
    'notifications/changed',
    'user:' || r.recipient_id::text,
    true
  );

create trigger notify_on_notification_change
  after insert or update or delete on public.notifications
  for each row execute function public.notify_recipient();

-- The Invited section on every owner's Sharing screen: an invitation sent, withdrawn, accepted or
-- declined. The existing fan-out, unchanged — `list_invitations` has a `list_id`.
create trigger notify_on_invitation_change
  after insert or update or delete on public.list_invitations
  for each row execute function public.notify_list_members();
```

No receive-policy change (event-agnostic, see Current state). Neither payload carries anything to
trust, per that entry's rule. A suppressed invitation has no notification, so the invitee is never
nudged by it; the list's members are, which tells the invitee nothing. The cost of the second
trigger is one `refreshSoon(listId)` per member per invitation change — rare, and the same cost as a
rename. `mark_notifications_read` on ten rows sends ten nudges to the caller's own topic — harmless;
the client debounces them. **`notify_recipient` is also where push (D6) would hang later.**

### Expiry (D3)

`purge_notifications(p_older_than interval default interval '30 days')` deletes invitations, then
notifications, `where created_at <= now() - p_older_than` — **`<=`, not `<`**, for the reason
`purge_deleted`'s own comment gives (`now()` is frozen per transaction, so `<` makes the
zero-interval proof call a no-op). Scheduled as its own
`cron.schedule('purge-notifications', '35 3 * * *', …)`, five minutes after `purge-deleted`.

## Client

### API seam

- [membersApi.ts](../../src/lib/membersApi.ts): `shareList` → `inviteToList(listId, userId, role)`;
  add `fetchInvitations(listId)` → `PendingInvitation[]` and `withdrawInvitation(id)`;
  `searchUsers(query, listId?)` passes `p_list_id`.
- New `src/lib/notificationsApi.ts`: `fetchNotifications`, `fetchUnreadCount`,
  `markNotificationsRead(ids)`, `acceptInvitation(id)` (→ `Result & { listId? }`),
  `declineInvitation(id)`, `blockInviter(invitationId)`, `unblockUser(userId)`,
  `fetchBlockedUsers`. Imports the client from `./supabase` only
  ([supabase-client-module-boundary](../kb/entries/supabase-client-module-boundary.md)); writes
  return `resultFor(error, status)` like the membership RPCs.
- A `Notification` union in that module, keyed by `kind` — `list_invitation` carries `invitationId`,
  `role`, `status`, `available`; `invitation_accepted` and `invitation_declined` carry none of them.
- None of these go through the outbox, and nothing here is cached: like Sharing, the Notifications
  and Blocked people screens are online-only (`'You need a connection to …'` on a `retryable`).

### Realtime and the unread count

- [listsChannel.ts](../../src/lib/listsChannel.ts): `subscribeToChanges` gains an
  `onNotifications()` handler for `notifications/changed` on the **same channel** — one channel per
  topic, still owned by `ListsContext`. `ListsContext` republishes it as `lastNotificationsNudge`,
  the way it publishes `lastNudge`; `onResubscribe` bumps both.
- New `src/state/NotificationsContext.tsx`, mounted inside `ListsProvider` in
  [App.tsx](../../App.tsx) so it lives and dies with the signed-in account: holds
  `unread: number | null`, re-reads `unread_notification_count()` on mount, on foreground (its own
  `AppState` listener), and on `lastNotificationsNudge` (300 ms trailing debounce). A failed read
  keeps the last known count; `null` until the first answer, so a cold start offline shows no dot.
  Exposes `setUnread` so the Notifications screen can zero it after marking.

### Lists header — three round buttons (D7)

[ListsScreen.tsx](../../src/screens/ListsScreen.tsx) `titleActions`, left to right, each a round
36 pt outlined `IconButton` like `ModeButton`:

1. `ModeButton` — unchanged.
2. **Notifications** — a new `BellIcon` ([icons.tsx](../../src/components/icons.tsx)), navigating
   to `Notifications`. While `unread > 0` it carries the 12 pt `primary` dot with a `skyTop` ring
   that `ModeButton` draws on the magnifier. Label `Notifications`; `value` reads `2 unread`
   ([queries-go-through-a11y-labels](../kb/entries/queries-go-through-a11y-labels.md)).
3. **Account** — the `PillButton` becomes an `IconButton` with a new `PersonIcon`, **label still
   `Account`**, so `ListsScreen.test.tsx`'s `getByLabelText('Account')` holds. The Maestro flows
   tap it by text: confirm on the simulator that `tapOn: Account` and `visible: Account` still
   resolve against the accessibility label once no visible text says it.

Three buttons and two gaps take 128 pt, so the group starts near x 242 against a title ending near
x 173. `ai/ux/source/mock.js` draws the header with `PillButton({ label: 'Account' })` beside
`headerButton(s)`, so the change lands there first and every `lists-*` scene re-renders.

### `NotificationsScreen` (new)

Account's layout: `ScreenHeader` "Notifications", cards on the land, newest first. Every card: the
actor's `Avatar`, a sentence, then a line with the age. Unread: a `primary` dot at the card's left
edge and the sentence at weight 600. A small `ago()` helper, no `Intl` (the reason
[limits.ts](../../src/lib/limits.ts) gives for `grouped`).

- **An invitation, pending and available:** `**Maya** invited you to **Weekend BBQ**`, then
  `as a writer · 2 h ago`. `Decline` (outline) and `Accept` (filled), half-width each like the
  confirm row on Sharing, and under them a `Block Maya` pill in `tone="danger"`. Accept →
  `refresh()` on `ListsContext`, then the card shows *You joined · Open list ›*.
- **Block** is two-step, as every destructive row is: `Maya will be told you declined, and you won't
  see invitations from them any more. Unblock them any time under Blocked people.` → `Cancel` /
  `Block`. Afterwards every card from Maya disappears (D5). The sentence says the decline is told,
  so nobody blocks thinking it is silent.
- **An invitation, resolved:** accepted → `You joined` + a chevron opening `ListDetail`; declined →
  muted `Declined`, no actions. **Pending but unavailable:** muted `No longer available`, no
  actions; it ages out (D3).
- **An answer (to the inviter):** `**Maya** accepted your invitation to **Weekend BBQ**` with a
  chevron opening `ListDetail` — only while that list is in `ListsContext`'s `lists`, since the
  inviter may have left it since; or `**Maya** declined your invitation to **Weekend BBQ**`, no
  actions. Both then the age.
- **Refusals in the invitee's words.** An accept refused with `LM001`/`LM002` shows
  `OWNED_LISTS_FULL` / `LISTS_FULL` from limits.ts, never the database's "they are already on…".
  `P0002` keeps the database's sentence ("this invitation is no longer open"), and reloads.
- **Read marking (D4):** after each successful load, `markNotificationsRead(ids shown)` and
  `setUnread(0)`; the dots come from the loaded `read_at`, so they stay for this visit. Reloads on
  `lastNotificationsNudge` while open.
- Footer pill `Blocked people` → `BlockedPeople`. Empty state: `No notifications yet`.

### `BlockedPeopleScreen` (new)

`ScreenHeader` "Blocked people"; one card per person — `Avatar`, name, an `Unblock` pill (one tap,
no confirm: nothing is lost by it). Empty state: `You haven't blocked anyone`. Reached from the
Notifications footer **and** a new card on `AccountScreen` (where people look for privacy controls).

### `SharingScreen` changes

- Share → **Invite**: `inviteToList`; the header picker reads `Invite as writer`;
  `UserAutocomplete`'s button label `Share` → `Invite`, and it passes `listId` to `searchUsers`.
- A new **Invited** section under *People with access*, owners only: `Avatar`, name, a role badge,
  `Invited` under the name, and a withdraw `IconButton` behind the usual Cancel/confirm
  (`Maya's invitation will be withdrawn.`). `load()` fetches roster and invitations together, so
  the existing `lastNudge` effect refreshes both — an accept moves the person from Invited to the
  roster, and a decline drops them from Invited, on every owner's screen within about a second.
- Re-inviting an existing member is now refused (`they already have this list`) — the roster's
  `RolePicker` is where a role changes (D1).

### Navigation

[types.ts](../../src/navigation/types.ts): `Notifications: undefined`, `BlockedPeople: undefined`;
two `Stack.Screen`s in `RootNavigator`'s signed-in branch, `headerShown: false`, each drawing its own
Back ([screens-take-navigation-props](../kb/entries/screens-take-navigation-props.md)).

## Design first

[phone-is-the-product](../kb/entries/phone-is-the-product.md): the mockups are the design and come
from `ai/ux/source/`. Scenes needed, day and night: the Lists header with three round buttons, with
and without the dot — this re-renders every `lists-*` scene, which the user has now asked for;
`notifications-screen` (a mix: unread pending, read pending, accepted, declined, unavailable, and
an accept and a decline received), `notifications-screen-block-confirm`, `notifications-screen-empty`,
`blocked-people-screen` and its empty state, the Account card, and `sharing-screen-invited`. **The
Sharing harness was lost** (per `ai/ux/source/README.md`), so that last scene means porting Sharing
into `mock.js` first.

## Staging

1. **Database.** The migration above, **keeping `share_list`** so the shipped client still works.
   Verified in `psql` with a real `session_id` (see the guard entry) — every refusal code above; a
   blocked invite lands suppressed, with no notification, visible to `pending_invitations_of`;
   accept and decline each write the inviter's notification, and nobody else's; block declines
   one, suppresses the rest, and removes
   their notifications; accept at 1,000 lists raises `LM002`; accept after the inviter is demoted
   raises `P0002`; `search_users_by_name` filters only for an owner;
   `purge_notifications('0 seconds')` removes everything; **accept and decline racing the inviter's
   `delete_account` in two sessions wait rather than deadlock**.
2. **Mockups**, signed off by the user.
3. **The round header and invitations in the client** — the three header buttons, Sharing,
   Notifications, the channel event, `NotificationsContext` — plus a migration dropping
   `share_list`. Verified with jest, the Maestro flows that tap `Account`, a two-account browser run
   on the local stack (owner in one context, invitee in another, codes from Mailpit) covering
   invite → decline and invite → accept, each ending on the inviter's notification, and simulator
   shots of the changed screens only.
4. **Blocking in the client** — the Block confirm, `BlockedPeopleScreen`, the Account card.

Steps 3 and 4 can merge if the user prefers one client step. The round Account button needs nothing
from the database, so it can also go first, alone, if wanted before the rest.

## Testing

- `membersApi.test.ts`, `notificationsApi.test.ts` (new): params and `Result` mapping per RPC; a
  `22023` is `permanent`, never `applied`; all three notification kinds decode.
- `listsChannel.test.ts`: the new event reaches `onNotifications` and not `onChange`.
- `NotificationsContext.test.tsx` (new): fetch on mount, foreground and nudge; a failed fetch keeps
  the count.
- `NotificationsScreen.test.tsx` (new): every card state, both answer cards included — the accept
  card's chevron only while the list is held; accept calls
  `refresh` and shows `You joined`; `LM002` reads as `LISTS_FULL`; decline shows `Declined`; block
  confirm then the inviter's cards gone; marks exactly the ids it loaded.
- `ListsScreen.test.tsx`: the bell's label and value; `Account` still found by label and navigates.
- `BlockedPeopleScreen.test.tsx` (new), `SharingScreen.test.tsx` (Invite, the Invited section,
  withdraw confirm), `AccountScreen.test.tsx` (the new card).

## What the KB will need afterwards (for the librarian, not written now)

- [scope-boundaries](../kb/entries/scope-boundaries.md): invitations between accounts in; the
  stranger invite still out.
- [session-still-valid-guards-writes](../kb/entries/session-still-valid-guards-writes.md): the
  guarded set goes from twelve to eighteen (− `share_list`; + `invite_to_list`,
  `withdraw_invitation`, `mark_notifications_read`, `accept_invitation`, `decline_invitation`,
  `block_inviter`, `unblock_user`) — its `verify:` asserts the exact set and will fail until updated.
- [realtime-is-a-nudge-to-a-per-user-inbox](../kb/entries/realtime-is-a-nudge-to-a-per-user-inbox.md):
  a second event on the same topic, and `notify_list_members` on a fourth table.
- The list limits: now met by the invitee at accept, not by the owner at share.
- [maestro-drives-the-native-ui](../kb/entries/maestro-drives-the-native-ui.md): whatever step 3
  learns about tapping a glyph-only button by its label.

## Deliberately out

- **Push notifications and an app-icon badge** (D6, backlog #10).
- **Inviting someone with no account** (`list_invites`) — unchanged by this.
- **Telling the list's other owners of an answer.** Only the inviter hears; the others see the
  roster and the Invited section change.
- **A wider block** — hiding from search, removing from shared lists.
- **Paging notifications** — the 30-day purge and `limit 100` bound the screen.
- **Rate-limiting invitations.** A decline reopens the slot, so one owner can re-invite the same
  person after each decline; Block ends that for that person. A per-inviter cap of open invitations
  is the escalation if that proves wrong.
