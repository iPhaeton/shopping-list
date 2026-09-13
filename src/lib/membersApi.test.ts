import { fetchMembers, removeMember, setMemberRole, shareList } from './membersApi';
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
 * The roster, and the three ways to change it — all four RPCs because the `list_members` select
 * policy shows the caller exactly one row, their own, and a select policy also gates what UPDATE and
 * DELETE may touch.
 */
describe('the membership calls', () => {
  it('maps the roster onto the client shape', async () => {
    respondToRpcWith({
      data: [
        { user_id: 'u1', email: 'alice@example.com', role: 'owner' },
        { user_id: 'u2', email: 'bob@example.com', role: 'reader' },
      ],
      error: null,
    });

    expect(await fetchMembers('l1')).toEqual({
      members: [
        { userId: 'u1', email: 'alice@example.com', role: 'owner' },
        { userId: 'u2', email: 'bob@example.com', role: 'reader' },
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
   * rather than as a bad argument. These four assertions are the only thing that would catch it.
   */
  it('names every RPC argument the way the function declares it', async () => {
    const rpc = respondToRpcWith({ data: null, error: null, status: 204 });

    await fetchMembers('l1');
    expect(rpc).toHaveBeenLastCalledWith('list_members_of', { p_list_id: 'l1' });

    await shareList('l1', '  bob@example.com  ', 'writer');
    expect(rpc).toHaveBeenLastCalledWith('share_list', {
      p_list_id: 'l1',
      // Trimmed here rather than in the database: the address is what the user typed.
      p_email: 'bob@example.com',
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
  });

  /**
   * "No account with that email yet" is a user error, and it arrives as an HTTP 500 — which for
   * every other code means "the server is having a moment, send it again". The SQLSTATE has to win,
   * or a typo in the invite field is reported as an outage and retried forever.
   */
  it('classifies P0002 as a refusal despite its 500', async () => {
    respondToRpcWith({
      data: null,
      error: { message: 'no account with that email yet', code: 'P0002' },
      status: 500,
    });

    expect(await shareList('l1', 'nobody@example.com', 'reader')).toEqual({
      error: 'no account with that email yet',
      verdict: 'permanent',
    });
  });

  it('still classifies a plain 500 as worth retrying', async () => {
    respondToRpcWith({ data: null, error: { message: 'upstream is down' }, status: 500 });

    expect(await shareList('l1', 'bob@example.com', 'reader')).toEqual({
      error: 'upstream is down',
      verdict: 'retryable',
    });
  });
});
