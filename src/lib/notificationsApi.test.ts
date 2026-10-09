import { LISTS_FULL, OWNED_LISTS_FULL } from './limits';
import {
  acceptInvitation,
  declineInvitation,
  fetchNotifications,
  fetchUnreadCount,
  markNotificationsRead,
} from './notificationsApi';
import { supabase } from './supabase';

/** Mocked at the module boundary, as `membersApi.test.ts` does: every call here is an RPC. */
jest.mock('./supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

type Response = { data: unknown; error: { message: string; code?: string } | null; status?: number };

function respondToRpcWith(response: Response) {
  const rpc = jest.fn().mockResolvedValue(response);
  jest.mocked(supabase.rpc).mockImplementation(rpc as unknown as typeof supabase.rpc);
  return rpc;
}

beforeEach(() => {
  jest.clearAllMocks();
});

const COMMON = {
  read_at: null,
  actor_id: 'u2',
  actor_name: 'Maya',
  list_id: 'l1',
  list_name: 'Weekend BBQ',
};
const INVITATION = {
  ...COMMON,
  id: 'n1',
  kind: 'list_invitation',
  created_at: '2026-10-09T10:00:00+00:00',
  invitation_id: 'inv1',
  role: 'writer',
  status: 'pending',
  available: true,
};
const ACCEPTED = {
  ...COMMON,
  id: 'n2',
  kind: 'invitation_accepted',
  created_at: '2026-10-09T09:00:00+00:00',
  read_at: '2026-10-09T09:30:00+00:00',
  invitation_id: null,
  role: null,
  status: null,
  available: null,
};
const DECLINED = { ...ACCEPTED, id: 'n3', kind: 'invitation_declined', created_at: '2026-10-09T08:00:00+00:00' };

describe('fetchNotifications', () => {
  /** PostgREST resolves an RPC by argument name; a typo reads as "function not found". */
  it('asks for page 1 with no cursor, and for the rows after one with it', async () => {
    const rpc = respondToRpcWith({ data: [], error: null, status: 200 });

    await fetchNotifications({ limit: 100 });
    expect(rpc).toHaveBeenLastCalledWith('my_notifications', { p_limit: 100 });

    await fetchNotifications({ before: { createdAt: '2026-10-09T08:00:00+00:00', id: 'n3' }, limit: 100 });
    expect(rpc).toHaveBeenLastCalledWith('my_notifications', {
      p_before_at: '2026-10-09T08:00:00+00:00',
      p_before_id: 'n3',
      p_limit: 100,
    });
  });

  it('decodes all three kinds', async () => {
    respondToRpcWith({ data: [INVITATION, ACCEPTED, DECLINED], error: null, status: 200 });

    const { notifications } = await fetchNotifications({ limit: 100 });

    expect(notifications).toEqual([
      {
        id: 'n1',
        kind: 'list_invitation',
        createdAt: '2026-10-09T10:00:00+00:00',
        readAt: null,
        actorId: 'u2',
        actorName: 'Maya',
        listId: 'l1',
        listName: 'Weekend BBQ',
        invitationId: 'inv1',
        role: 'writer',
        status: 'pending',
        available: true,
      },
      {
        id: 'n2',
        kind: 'invitation_accepted',
        createdAt: '2026-10-09T09:00:00+00:00',
        readAt: '2026-10-09T09:30:00+00:00',
        actorId: 'u2',
        actorName: 'Maya',
        listId: 'l1',
        listName: 'Weekend BBQ',
      },
      {
        id: 'n3',
        kind: 'invitation_declined',
        createdAt: '2026-10-09T08:00:00+00:00',
        readAt: '2026-10-09T09:30:00+00:00',
        actorId: 'u2',
        actorName: 'Maya',
        listId: 'l1',
        listName: 'Weekend BBQ',
      },
    ]);
  });

  it('continues from the last row of a full page', async () => {
    respondToRpcWith({ data: [INVITATION, ACCEPTED, DECLINED], error: null, status: 200 });

    const { cursor } = await fetchNotifications({ limit: 3 });

    expect(cursor).toEqual({ createdAt: '2026-10-09T08:00:00+00:00', id: 'n3' });
  });

  it('says a short page is the end', async () => {
    respondToRpcWith({ data: [INVITATION, ACCEPTED], error: null, status: 200 });

    expect((await fetchNotifications({ limit: 3 })).cursor).toBeNull();
  });

  it('reads a null body as an empty last page', async () => {
    respondToRpcWith({ data: null, error: null, status: 200 });

    expect(await fetchNotifications({ limit: 100 })).toEqual({
      notifications: [],
      cursor: null,
      error: null,
      retryable: false,
    });
  });

  /**
   * A newer database may send a kind this app predates. It is dropped rather than drawn wrong — and
   * the cursor is still the last row read, so the row is neither read again nor a reason to stall.
   */
  it('drops a row of an unknown kind, and still pages past it', async () => {
    const future = { ...DECLINED, id: 'n4', kind: 'list_renamed', created_at: '2026-10-09T07:00:00+00:00' };
    respondToRpcWith({ data: [INVITATION, future], error: null, status: 200 });

    const { notifications, cursor } = await fetchNotifications({ limit: 2 });

    expect(notifications?.map((n) => n.id)).toEqual(['n1']);
    expect(cursor).toEqual({ createdAt: '2026-10-09T07:00:00+00:00', id: 'n4' });
  });

  it('says whether a failed read is worth trying again', async () => {
    respondToRpcWith({ data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 });
    expect(await fetchNotifications({ limit: 100 })).toEqual({
      notifications: null,
      cursor: null,
      error: 'TypeError: Failed to fetch',
      retryable: true,
    });

    respondToRpcWith({ data: null, error: { message: 'permission denied', code: '42501' }, status: 403 });
    expect((await fetchNotifications({ limit: 100 })).retryable).toBe(false);
  });

  /** PostgREST's `max_rows` would cut a larger answer silently. */
  it('refuses a page larger than max_rows', async () => {
    await expect(fetchNotifications({ limit: 1001 })).rejects.toThrow('silently capped');
  });
});

describe('the other calls', () => {
  it('names every RPC argument the way the function declares it', async () => {
    const rpc = respondToRpcWith({ data: null, error: null, status: 204 });

    await fetchUnreadCount();
    expect(rpc).toHaveBeenLastCalledWith('unread_notification_count');

    await markNotificationsRead(['n1', 'n2']);
    expect(rpc).toHaveBeenLastCalledWith('mark_notifications_read', { p_ids: ['n1', 'n2'] });

    await acceptInvitation('inv1');
    expect(rpc).toHaveBeenLastCalledWith('accept_invitation', { p_invitation_id: 'inv1' });

    await declineInvitation('inv1');
    expect(rpc).toHaveBeenLastCalledWith('decline_invitation', { p_invitation_id: 'inv1' });
  });

  it('reads the unread count', async () => {
    respondToRpcWith({ data: 3, error: null, status: 200 });

    expect(await fetchUnreadCount()).toEqual({ count: 3, error: null, retryable: false });
  });

  it('returns a failed count rather than throwing it', async () => {
    respondToRpcWith({ data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 });

    expect(await fetchUnreadCount()).toEqual({
      count: null,
      error: 'TypeError: Failed to fetch',
      retryable: true,
    });
  });

  /** The answer is the list's id, a JSON string, so the app could open it. */
  it('answers an accept with the list it joined', async () => {
    respondToRpcWith({ data: 'l1', error: null, status: 200 });

    expect(await acceptInvitation('inv1')).toEqual({ error: null, verdict: 'ok', listId: 'l1' });
  });

  /**
   * The database's words are about somebody else ("they are already on 1,000 lists"). At accept the
   * person over the limit is the one holding the phone, so they read the Lists screen's sentences.
   */
  it.each([
    ['LM002', 'they are already on 1,000 lists', LISTS_FULL],
    ['LM001', 'they already own 100 lists', OWNED_LISTS_FULL],
  ])('rephrases a %s refusal at accept in the second person', async (code, message, sentence) => {
    respondToRpcWith({ data: null, error: { message, code }, status: 400 });

    expect(await acceptInvitation('inv1')).toEqual({
      error: sentence,
      verdict: 'permanent',
      sessionRevoked: false,
    });
  });

  it('keeps any other refusal in the database\'s words', async () => {
    respondToRpcWith({
      data: null,
      error: { message: 'this invitation is no longer open', code: 'P0002' },
      status: 500,
    });

    expect(await declineInvitation('inv1')).toEqual({
      error: 'this invitation is no longer open',
      verdict: 'permanent',
      sessionRevoked: false,
    });
  });

  it('flags a write refused for a revoked session', async () => {
    respondToRpcWith({
      data: null,
      error: { message: 'this device has been signed out', code: '42501' },
      status: 403,
    });

    expect(await markNotificationsRead(['n1'])).toMatchObject({ sessionRevoked: true });
  });
});
