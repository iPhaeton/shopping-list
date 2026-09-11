import {
  addItem,
  fetchLists,
  fetchMembers,
  removeMember,
  renameList,
  setItemDeleted,
  setItemDone,
  setListDeleted,
  setMemberRole,
  shareList,
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

/**
 * There is no `.from(...).update(...)` stub any more, and its absence is the fact: `updateListName`
 * was the app's last direct write to a table, and it became the `rename_list` RPC. Everything that
 * changes a row now goes through the one stub below.
 */
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
    { id: 'l1', name: 'Groceries', role: 'owner', deletedAt: null, items: [] },
    { id: 'l2', name: 'Hardware', role: 'reader', deletedAt: null, items: [] },
  ]);
});

it('sorts items by when they were created, whatever order the embed returned them in', async () => {
  respondWith({
    data: [{ role: 'writer', lists: { id: 'l1', name: 'Groceries', items: [NAILS, MILK] } }],
    error: null,
  });

  const { lists } = await fetchLists();

  expect(lists?.[0].items).toEqual([
    { id: 'i1', title: 'Milk', doneAt: '2026-09-03T09:00:00Z', deletedAt: null },
    { id: 'i2', title: 'Nails', doneAt: null, deletedAt: null },
  ]);
});

it('returns the error rather than throwing it', async () => {
  respondWith({ data: null, error: { message: 'JWT expired' } });

  expect(await fetchLists()).toEqual({ lists: null, error: 'JWT expired' });
});

/**
 * The bin travels in the same round trip as everything else — there is no `deleted_at is null`
 * filter here or in the policies, because a member has to see a tombstone to restore it.
 *
 * Asserted at **both** embed levels deliberately. Drop `deleted_at` from either half of the select
 * string and the column arrives `undefined`, which the `?? null` in `toItem`/`toList` quietly turns
 * into "not deleted" — a mapping bug that no `toEqual` would catch, since `toEqual` ignores
 * `undefined` in the first place.
 */
it('carries the tombstone on a list and on an item', async () => {
  const { select } = respondWith({
    data: [
      {
        role: 'owner',
        lists: {
          id: 'l1',
          name: 'Groceries',
          deleted_at: '2026-09-10T08:00:00Z',
          items: [{ ...MILK, deleted_at: '2026-09-09T07:00:00Z' }],
        },
      },
    ],
    error: null,
  });

  const { lists } = await fetchLists();

  expect(select).toHaveBeenCalledWith(expect.stringContaining('name, deleted_at'));
  expect(select).toHaveBeenCalledWith(expect.stringContaining('done_at, deleted_at'));
  expect(lists?.[0].deletedAt).toBe('2026-09-10T08:00:00Z');
  expect(lists?.[0].items[0].deletedAt).toBe('2026-09-09T07:00:00Z');
});

// --- The writes that can land on something in the bin -----------------------------------------

/**
 * These four moved off the tables and onto `security definer` functions when deletion arrived, so
 * what is worth asserting moved with them: the argument *names*, because PostgREST resolves an RPC
 * by name and a typo comes back as "function not found" rather than as a bad argument.
 *
 * `renameList` used to be the app's one direct `PATCH`, guarded by a `.select('id')` because
 * row-level security filters a refused rename to zero rows and PostgREST answers that with 204 and
 * no error. That guard is gone because the write is gone: the function raises instead, and it can
 * also say the thing zero rows never could — whether the list was **deleted** or the caller was
 * **demoted**.
 */
describe('the writes that go through the outbox', () => {
  it('renames through the RPC, by argument name', async () => {
    const rpc = respondToRpcWith({ data: 'applied', error: null, status: 200 });

    expect(await renameList('l1', 'Weekly shop')).toEqual({ error: null, verdict: 'ok' });
    expect(rpc).toHaveBeenCalledWith('rename_list', { p_list_id: 'l1', p_name: 'Weekly shop' });
  });

  it('adds an item through the RPC, by argument name', async () => {
    const rpc = respondToRpcWith({ data: 'applied', error: null, status: 200 });

    expect(await addItem('i1', 'l1', 'Milk')).toEqual({ error: null, verdict: 'ok' });
    expect(rpc).toHaveBeenCalledWith('add_item', {
      p_id: 'i1',
      p_list_id: 'l1',
      p_title: 'Milk',
    });
  });

  it('sends the boolean the delete RPCs take, not a verb', async () => {
    const rpc = respondToRpcWith({ data: null, error: null, status: 200 });

    await setListDeleted('l1', true);
    expect(rpc).toHaveBeenCalledWith('set_list_deleted', { p_list_id: 'l1', p_deleted: true });

    await setItemDeleted('i1', false);
    expect(rpc).toHaveBeenCalledWith('set_item_deleted', { p_item_id: 'i1', p_deleted: false });
  });

  /**
   * The contract the whole conflict prompt rests on. `target_deleted` rides along with `ok` on
   * purpose: the request was accepted and the caller was allowed to make it, so the outbox is right
   * to treat it as delivered — it is the provider that decides whether to offer a restore.
   */
  it('carries a target_deleted outcome without calling it a failure', async () => {
    respondToRpcWith({ data: 'target_deleted', error: null, status: 200 });

    expect(await setItemDone('i1', true)).toEqual({
      error: null,
      verdict: 'ok',
      outcome: 'target_deleted',
    });
  });

  it('leaves an applied outcome off the result entirely', async () => {
    respondToRpcWith({ data: 'applied', error: null, status: 200 });

    expect(await setItemDone('i1', true)).toEqual({ error: null, verdict: 'ok' });
  });

  /**
   * A refusal reaches a red banner minutes or days after the tap that caused it, so these six get a
   * sentence rather than the database's own words. The membership RPCs deliberately do not — see
   * below, where `share_list`'s message is asserted verbatim.
   */
  it('rewrites a permission refusal into something a person can read', async () => {
    respondToRpcWith({
      data: null,
      error: { message: 'not allowed to change this item', code: '42501' },
      status: 403,
    });

    expect(await setItemDone('i1', true)).toEqual({
      error: 'You no longer have permission to make that change.',
      verdict: 'permanent',
    });
  });

  it('leaves an error it has no better words for alone', async () => {
    respondToRpcWith({ data: null, error: { message: 'JWT expired' }, status: 401 });

    expect(await renameList('l1', 'Weekly shop')).toEqual({
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
