import type { Role } from '../state/types';
import { LIMIT_CODES, LISTS_FULL, OWNED_LISTS_FULL } from './limits';
import { MAX_ROWS, resultFor, type Result } from './listsApi';
import { supabase } from './supabase';

/**
 * The Notifications screen's reads and writes (task 28). Every one is an RPC: the three tables
 * behind them have no policy and no grant, because each answer needs a row the caller's RLS would
 * hide — the inviter's name, a list the invitee is not on yet.
 *
 * Online-only, like the Sharing screen: nothing here is cached and nothing goes through the outbox.
 * An answer to an invitation is given while the person is looking at it, and a queued accept
 * landing hours later, after the list was binned or the inviter demoted, would be worse than
 * saying "you need a connection" now.
 */

/**
 * Notifications per page — the user's number (task 28, request 7), as `LIST_PAGE_SIZE` is. Bounded
 * above by `MAX_ROWS`, and asserted.
 */
export const NOTIFICATION_PAGE_SIZE = 100;

/**
 * The most a single read may ask for: PostgREST's `max_rows`, which the database clamps to as well.
 * The screen asks for more than a page only to re-read what it already shows, and past this it
 * re-reads this many and pages on from there. Exported here because a screen may not import values
 * from `listsApi`, whose suites mock it whole.
 */
export const NOTIFICATION_RELOAD_MAX = MAX_ROWS;

export type InvitationStatus = 'pending' | 'accepted' | 'declined';

/** Where the next page starts: the last row read, in the order shown (newest first). */
export type NotificationCursor = { createdAt: string; id: string };

type Common = {
  id: string;
  createdAt: string;
  readAt: string | null;
  actorId: string;
  actorName: string;
  listId: string;
  listName: string;
};

/**
 * One row of the screen, by `kind`. An invitation carries its own state, read through the join and
 * never copied into the notification: `status`, and `available` — the list is live and the inviter
 * still owns it — which means something only while `status` is `pending`. The two answers go to the
 * inviter and carry nothing more.
 */
export type Notification =
  | (Common & {
      kind: 'list_invitation';
      invitationId: string;
      role: Role;
      status: InvitationStatus;
      available: boolean;
    })
  | (Common & { kind: 'invitation_accepted' })
  | (Common & { kind: 'invitation_declined' });

type NotificationRow = {
  id: string;
  kind: string;
  created_at: string;
  read_at: string | null;
  actor_id: string;
  actor_name: string;
  list_id: string;
  list_name: string;
  invitation_id: string | null;
  role: Role | null;
  status: InvitationStatus | null;
  available: boolean | null;
};

/**
 * A page of notifications, newest first: page 1 without `before`, the rows after `before`
 * otherwise. Keyset, so a row arriving at the top never shifts a later page.
 *
 * `cursor` is the last row's, from a **full** page, and `null` from a short one — the stream has
 * ended. It is taken from the rows as read, before a row of an unknown kind is dropped, so a
 * dropped row neither repeats nor stalls the paging. `retryable` says whether trying again later
 * could help: offline, a 5xx, an expired token.
 */
export async function fetchNotifications({
  before,
  limit,
}: {
  before?: NotificationCursor | null;
  limit: number;
}): Promise<{
  notifications: Notification[] | null;
  cursor: NotificationCursor | null;
  error: string | null;
  retryable: boolean;
}> {
  if (limit > MAX_ROWS) {
    throw new Error(`fetchNotifications: a page of ${limit} rows would be silently capped at ${MAX_ROWS}`);
  }

  const { data, error, status } = await supabase.rpc(
    'my_notifications',
    before
      ? { p_before_at: before.createdAt, p_before_id: before.id, p_limit: limit }
      : { p_limit: limit }
  );

  if (error) {
    return { notifications: null, cursor: null, error: error.message, retryable: isRetryable(error, status) };
  }

  const rows = (data ?? []) as NotificationRow[];
  const last = rows[rows.length - 1];
  return {
    notifications: rows.flatMap(toNotification),
    cursor: rows.length < limit || !last ? null : { createdAt: last.created_at, id: last.id },
    error: null,
    retryable: false,
  };
}

/** How many notifications are unread — what puts the dot on the Lists screen's bell. */
export async function fetchUnreadCount(): Promise<{
  count: number | null;
  error: string | null;
  retryable: boolean;
}> {
  const { data, error, status } = await supabase.rpc('unread_notification_count');

  if (error) return { count: null, error: error.message, retryable: isRetryable(error, status) };
  if (typeof data !== 'number') return { count: null, error: 'unexpected answer', retryable: false };
  return { count: data, error: null, retryable: false };
}

/**
 * Marks exactly `ids` read — the caller's own, and only those still unread. A notification that
 * arrived after the screen read its page keeps its dot until a page shows it.
 */
export async function markNotificationsRead(ids: string[]): Promise<Result> {
  const { error, status } = await supabase.rpc('mark_notifications_read', { p_ids: ids });
  return resultFor(error, status);
}

/**
 * Joins the list with the invitation's role, and tells the inviter. Answers with the list's id.
 *
 * **A limit refusal is rephrased here.** The database's words are about somebody else — "they are
 * already on 1,000 lists" — written for an owner promoting a member on Sharing. Here the person who
 * would go over is the one holding the phone, so they read `LISTS_FULL` or `OWNED_LISTS_FULL`, the
 * sentences the Lists screen already uses. The verdict stays `permanent`.
 */
export async function acceptInvitation(invitationId: string): Promise<Result & { listId?: string }> {
  const { data, error, status } = await supabase.rpc('accept_invitation', {
    p_invitation_id: invitationId,
  });
  const result = resultFor(error, status);

  if (error?.code === LIMIT_CODES.ownedLists) return { ...result, error: OWNED_LISTS_FULL };
  if (error?.code === LIMIT_CODES.lists) return { ...result, error: LISTS_FULL };
  if (error) return result;
  return typeof data === 'string' ? { ...result, listId: data } : result;
}

/** Turns the invitation down, and tells the inviter — as an ordinary decline, whatever follows. */
export async function declineInvitation(invitationId: string): Promise<Result> {
  const { error, status } = await supabase.rpc('decline_invitation', {
    p_invitation_id: invitationId,
  });
  return resultFor(error, status);
}

/** A read is classified the way a write is, so offline reads the same everywhere. */
function isRetryable(error: { message: string; code?: string | null }, status: number): boolean {
  return resultFor(error, status).verdict === 'retryable';
}

/**
 * One row, or none. A kind this app predates — a newer database's — is dropped rather than drawn
 * wrong or thrown on. So is an invitation row missing what an invitation must carry.
 */
function toNotification(row: NotificationRow): Notification[] {
  const common: Common = {
    id: row.id,
    createdAt: row.created_at,
    readAt: row.read_at ?? null,
    actorId: row.actor_id,
    actorName: row.actor_name,
    listId: row.list_id,
    listName: row.list_name,
  };

  switch (row.kind) {
    case 'list_invitation':
      if (row.invitation_id === null || row.role === null || row.status === null) return [];
      return [
        {
          ...common,
          kind: 'list_invitation',
          invitationId: row.invitation_id,
          role: row.role,
          status: row.status,
          available: row.available === true,
        },
      ];
    case 'invitation_accepted':
      return [{ ...common, kind: 'invitation_accepted' }];
    case 'invitation_declined':
      return [{ ...common, kind: 'invitation_declined' }];
    default:
      return [];
  }
}
