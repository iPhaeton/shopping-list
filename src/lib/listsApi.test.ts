import {
  fetchLists,
  fetchMembers,
  removeMember,
  setMemberRole,
  shareList,
  updateListName,
} from './listsApi';
import { supabase } from './supabase';

/**
 * `src/lib/supabase.ts` is mocked at the module boundary, the same seam the auth suites use — so
 * `@supabase/supabase-js` is never loaded here.
 *
 * What is worth asserting is the shape change sharing brought: the query is rooted at
 * `list_members` now, each row carries the caller's `role`, and the list hangs off it as an embed.
 * Item ordering moved out of PostgREST and into `toList` at the same time, which makes it the one
 * piece of real logic in this module.
 */
jest.mock('./supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

type Response = { data: unknown; error: { message: string; code?: string } | null; status?: number };

/** Stands in for the postgrest builder: `.from(...).select(...).order(...)` and then a promise. */
function respondWith(response: Response) {
  const order = jest.fn().mockResolvedValue(response);
  const select = jest.fn(() => ({ order }));
  const from = jest.fn(() => ({ select }));
  jest.mocked(supabase.from).mockImplementation(from as unknown as typeof supabase.from);
  return { from, select, order };
}

/** The other builder this module uses: `.from(...).update(...).eq(...).select(...)`. */
function respondToUpdateWith(response: Response) {
  const select = jest.fn().mockResolvedValue(response);
  const eq = jest.fn(() => ({ select }));
  const update = jest.fn(() => ({ eq }));
  const from = jest.fn(() => ({ update }));
  jest.mocked(supabase.from).mockImplementation(from as unknown as typeof supabase.from);
  return { from, update, eq, select };
}

function respondToRpcWith(response: Response) {
  const rpc = jest.fn().mockResolvedValue(response);
  jest.mocked(supabase.rpc).mockImplementation(rpc as unknown as typeof supabase.rpc);
  return rpc;
}

const NAILS = { id: 'i2', title: 'Nails', done_at: null, created_at: '2026-09-02T10:00:00Z' };
const MILK = { id: 'i1', title: 'Milk', done_at: '2026-09-03T09:00:00Z', created_at: '2026-09-01T10:00:00Z' };

beforeEach(() => {
  jest.clearAllMocks();
});

it('reads from list_members, ordered by when each list entered the account', async () => {
  const { from, select, order } = respondWith({ data: [], error: null });

  await fetchLists();

  expect(from).toHaveBeenCalledWith('list_members');
  // The embed is inner-joined, so a membership can never arrive without its list.
  expect(select).toHaveBeenCalledWith(expect.stringContaining('lists!inner'));
  // No user filter: row-level security supplies it, and an `.eq()` here could only disagree.
  expect(order).toHaveBeenCalledWith('created_at');
});

it('carries the role from the membership row onto the list', async () => {
  respondWith({
    data: [
      { role: 'owner', lists: { id: 'l1', name: 'Groceries', items: [] } },
      { role: 'reader', lists: { id: 'l2', name: 'Hardware', items: [] } },
    ],
    error: null,
  });

  const { lists } = await fetchLists();

  expect(lists).toEqual([
    { id: 'l1', name: 'Groceries', role: 'owner', items: [] },
    { id: 'l2', name: 'Hardware', role: 'reader', items: [] },
  ]);
});

it('sorts items by when they were created, whatever order the embed returned them in', async () => {
  respondWith({
    data: [{ role: 'writer', lists: { id: 'l1', name: 'Groceries', items: [NAILS, MILK] } }],
    error: null,
  });

  const { lists } = await fetchLists();

  expect(lists?.[0].items).toEqual([
    { id: 'i1', title: 'Milk', doneAt: '2026-09-03T09:00:00Z' },
    { id: 'i2', title: 'Nails', doneAt: null },
  ]);
});

it('returns the error rather than throwing it', async () => {
  respondWith({ data: null, error: { message: 'JWT expired' } });

  expect(await fetchLists()).toEqual({ lists: null, error: 'JWT expired' });
});

// --- Renaming ---------------------------------------------------------------------------------

describe('updateListName', () => {
  it('asks for the row back rather than firing and forgetting', async () => {
    const { from, update, eq, select } = respondToUpdateWith({
      data: [{ id: 'l1' }],
      error: null,
      status: 200,
    });

    expect(await updateListName('l1', 'Weekly shop')).toEqual({ error: null, verdict: 'ok' });
    expect(from).toHaveBeenCalledWith('lists');
    expect(update).toHaveBeenCalledWith({ name: 'Weekly shop' });
    expect(eq).toHaveBeenCalledWith('id', 'l1');
    expect(select).toHaveBeenCalledWith('id');
  });

  /**
   * The failure this whole function exists for. Row-level security filters a refused rename to zero
   * rows rather than refusing it, so PostgREST answers 204 with no error — which without the
   * `.select()` would read as success, and the outbox would drop the write as delivered.
   */
  it('treats an empty response as a refusal, not a success', async () => {
    respondToUpdateWith({ data: [], error: null, status: 200 });

    expect(await updateListName('l1', 'Weekly shop')).toEqual({
      error: 'You can no longer rename this list.',
      verdict: 'permanent',
    });
  });

  it('reports a real error as itself', async () => {
    respondToUpdateWith({ data: null, error: { message: 'JWT expired' }, status: 401 });

    expect(await updateListName('l1', 'Weekly shop')).toEqual({
      error: 'JWT expired',
      verdict: 'retryable',
    });
  });
});

// --- Who else has access ----------------------------------------------------------------------

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
