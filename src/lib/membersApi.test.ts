import {
  fetchMembers,
  leaveList,
  removeMember,
  searchUsers,
  setMemberRole,
  shareList,
} from './membersApi';
import { supabase } from './supabase';

/**
 * `src/lib/supabase.ts` is mocked at the module boundary, the same seam `listsApi.test.ts` mocks —
 * these four are RPCs, so there is no builder to fake, only `supabase.rpc` itself.
 */
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

/**
 * The roster, and the four ways to change it — all five RPCs because the `list_members` select
 * policy shows the caller exactly one row, their own, and a select policy also gates what UPDATE and
 * DELETE may touch.
 */
describe('the membership calls', () => {
  it('maps the roster onto the client shape, name included', async () => {
    respondToRpcWith({
      data: [
        { user_id: 'u1', email: 'alice@example.com', name: 'Alice', role: 'owner' },
        // A row that hasn't cleared the name gate yet — null, not dropped from the response.
        { user_id: 'u2', email: 'bob@example.com', name: null, role: 'reader' },
      ],
      error: null,
    });

    expect(await fetchMembers('l1')).toEqual({
      members: [
        { userId: 'u1', email: 'alice@example.com', name: 'Alice', role: 'owner' },
        { userId: 'u2', email: 'bob@example.com', name: null, role: 'reader' },
      ],
      error: null,
    });
  });

  it('returns a failed roster read rather than throwing it', async () => {
    respondToRpcWith({ data: null, error: { message: 'JWT expired' } });

    expect(await fetchMembers('l1')).toEqual({ members: null, error: 'JWT expired' });
  });

  /**
   * PostgREST resolves an RPC by argument *name*, so a typo here reads as "function not found"
   * rather than as a bad argument. These six assertions are the only thing that would catch it.
   */
  it('names every RPC argument the way the function declares it', async () => {
    const rpc = respondToRpcWith({ data: null, error: null, status: 204 });

    await fetchMembers('l1');
    expect(rpc).toHaveBeenLastCalledWith('list_members_of', { p_list_id: 'l1' });

    await searchUsers('bob');
    expect(rpc).toHaveBeenLastCalledWith('search_users_by_name', { p_query: 'bob' });

    await shareList('l1', 'u3', 'writer');
    expect(rpc).toHaveBeenLastCalledWith('share_list', {
      p_list_id: 'l1',
      p_user_id: 'u3',
      p_role: 'writer',
    });

    await setMemberRole('l1', 'u2', 'owner');
    expect(rpc).toHaveBeenLastCalledWith('set_member_role', {
      p_list_id: 'l1',
      p_user_id: 'u2',
      p_role: 'owner',
    });

    await removeMember('l1', 'u2');
    expect(rpc).toHaveBeenLastCalledWith('remove_member', { p_list_id: 'l1', p_user_id: 'u2' });

    await leaveList('l1');
    expect(rpc).toHaveBeenLastCalledWith('leave_list', { p_list_id: 'l1' });
  });

  it('maps search results onto the client shape', async () => {
    respondToRpcWith({
      data: [
        { user_id: 'u3', name: 'Carol' },
        { user_id: 'u4', name: 'Caroline' },
      ],
      error: null,
    });

    expect(await searchUsers('car')).toEqual({
      users: [
        { userId: 'u3', name: 'Carol' },
        { userId: 'u4', name: 'Caroline' },
      ],
      error: null,
    });
  });

  it('returns a failed search rather than throwing it', async () => {
    respondToRpcWith({ data: null, error: { message: 'JWT expired' } });

    expect(await searchUsers('car')).toEqual({ users: null, error: 'JWT expired' });
  });

  /**
   * "That account no longer exists" is a user error, and it arrives as an HTTP 500 — which for
   * every other code means "the server is having a moment, send it again". The SQLSTATE has to win.
   * This is a race the UI only reaches if the target account vanishes between a search suggestion
   * and the tap on Share — `canInvite` requires a `selected` suggestion, so there is no longer a
   * typo path into this refusal the way an unresolved email address once was.
   */
  it('classifies P0002 as a refusal despite its 500', async () => {
    respondToRpcWith({
      data: null,
      error: { message: 'that account no longer exists', code: 'P0002' },
      status: 500,
    });

    expect(await shareList('l1', 'deleted-user-id', 'reader')).toEqual({
      error: 'that account no longer exists',
      verdict: 'permanent',
      sessionRevoked: false,
    });
  });

  it('still classifies a plain 500 as worth retrying', async () => {
    respondToRpcWith({ data: null, error: { message: 'upstream is down' }, status: 500 });

    expect(await shareList('l1', 'u2', 'reader')).toEqual({
      error: 'upstream is down',
      verdict: 'retryable',
      sessionRevoked: false,
    });
  });

  /**
   * These three keep the database's own words rather than `humanize()`'s, but the detection itself
   * is shared with the outbox writes via `resultFor` — a kicked device's roster edit must redirect
   * exactly like a queued write does.
   */
  it('flags a membership RPC refused for a revoked session the same way a write is', async () => {
    respondToRpcWith({
      data: null,
      error: { message: 'this device has been signed out', code: '42501' },
      status: 403,
    });

    expect(await shareList('l1', 'u2', 'reader')).toMatchObject({
      sessionRevoked: true,
    });
  });
});
