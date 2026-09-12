import {
  addItem,
  fetchItem,
  fetchItems,
  fetchLists,
  fetchMembers,
  MAX_ROWS,
  PAGE_SIZE,
  removeMember,
  renameItem,
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
 * What is worth asserting is the *shape* of each read: `fetchLists` is rooted at `list_members`,
 * each row carries the caller's `role`, and the list hangs off it as an embed carrying no items at
 * all — those come from `fetchItems`, read separately once a list is opened.
 */
jest.mock('./supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

type Response = { data: unknown; error: { message: string; code?: string } | null; status?: number };

/** One builder method as it was called: `['limit', [400, { referencedTable: 'lists.live' }]]`. */
type Call = [method: string, args: unknown[]];

/**
 * Stands in for the postgrest builder. Every method returns the builder and records itself, and
 * awaiting the builder resolves to `response` — so a test can assert the *shape* of a read
 * (`calls`) without the stub having to know which methods the read chains, or in what order.
 * `from` is recorded too, as the first call.
 */
function respondWith(response: Response) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {
    then: (resolve: (value: Response) => unknown) => Promise.resolve(response).then(resolve),
  };
  for (const method of ['select', 'eq', 'is', 'not', 'or', 'gte', 'order', 'limit', 'maybeSingle']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, args]);
      return builder;
    };
  }
  const from = jest.fn((table: string) => {
    calls.push(['from', [table]]);
    return builder;
  });
  jest.mocked(supabase.from).mockImplementation(from as unknown as typeof supabase.from);
  return { calls };
}

/** The recorded arguments of every call to `method`, in order. */
function argsOf(calls: Call[], method: string): unknown[][] {
  return calls.filter(([name]) => name === method).map(([, args]) => args);
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

const BREAD = { id: 'i3', title: 'Bread', done_at: null, deleted_at: '2026-09-09T07:00:00Z', created_at: '2026-09-01T11:00:00Z' };

/** A membership row as PostgREST returns it now — no items, just list metadata. */
function membership(n: number, role = 'owner', deletedAt: string | null = null) {
  return { role, lists: { id: `l${n}`, name: `List ${n}`, deleted_at: deletedAt } };
}

/** A full page of `n` rows with distinct, ascending `created_at`. */
function page(n: number, prefix = 'p') {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${String(i).padStart(4, '0')}`,
    title: `Row ${i}`,
    done_at: null,
    deleted_at: null,
    created_at: `2026-09-01T00:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(6, '0')}Z`,
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('reads from list_members, ordered by when each list entered the account', async () => {
  const { calls } = respondWith({ data: [], error: null });

  await fetchLists();

  expect(argsOf(calls, 'from')).toEqual([['list_members']]);
  // The embed is inner-joined, so a membership can never arrive without its list.
  expect(argsOf(calls, 'select')[0][0]).toContain('lists!inner');
  // No user filter: row-level security supplies it, and an `.eq()` here could only disagree.
  expect(argsOf(calls, 'eq')).toEqual([]);
  expect(argsOf(calls, 'order')).toContainEqual(['created_at']);
});

/**
 * PostgREST's `max_rows` is a silent ceiling: ask for more and exactly that many come back, with
 * no error and no header. Sending the limit ourselves is what makes the cap visible in code, and
 * landing on it exactly is the only signal that lists were cut off.
 */
it('caps the membership scan at MAX_ROWS and says when it hit the cap', async () => {
  const { calls } = respondWith({
    data: Array.from({ length: MAX_ROWS }, (_, n) => membership(n)),
    error: null,
  });
  const full = await fetchLists();
  expect(argsOf(calls, 'limit')).toContainEqual([MAX_ROWS]);
  expect(full.truncated).toBe(true);
  expect(full.lists).toHaveLength(MAX_ROWS);

  respondWith({ data: [membership(1)], error: null });
  expect((await fetchLists()).truncated).toBe(false);
});

/**
 * The point of this step: opening the Lists screen used to fetch a first page of every list's
 * items, which is exactly what made it laggy. `fetchLists` now sends no item embed at all —
 * `fetchItems` is what a list's items come from, read once that list is actually opened.
 */
it('sends no item embed — items arrive only once a list is entered', async () => {
  const { calls } = respondWith({ data: [], error: null });

  await fetchLists();

  const select = String(argsOf(calls, 'select')[0][0]);
  expect(select).not.toContain('items');
  expect(argsOf(calls, 'is')).toEqual([]);
  expect(argsOf(calls, 'not')).toEqual([]);
  expect(argsOf(calls, 'order')).toEqual([['created_at']]);
  expect(argsOf(calls, 'limit')).toEqual([[MAX_ROWS]]);
});

it('carries the role from the membership row onto the list, with nothing fetched yet', async () => {
  respondWith({
    data: [membership(1, 'owner'), membership(2, 'reader')],
    error: null,
  });

  const { lists } = await fetchLists();

  expect(lists).toEqual([
    { id: 'l1', name: 'List 1', role: 'owner', deletedAt: null, itemsLoaded: false, items: [], nextLive: null, nextBin: null },
    { id: 'l2', name: 'List 2', role: 'reader', deletedAt: null, itemsLoaded: false, items: [], nextLive: null, nextBin: null },
  ]);
});

it('returns the error rather than throwing it', async () => {
  respondWith({ data: null, error: { message: 'JWT expired' } });

  expect(await fetchLists()).toEqual({ lists: null, error: 'JWT expired', truncated: false });
});

/**
 * `?? null` rather than a bare read: a column missing from the select string arrives `undefined`,
 * and `undefined !== null` is `true` everywhere downstream, so a typo here would silently render
 * every list as deleted — a mapping bug `toEqual` would not catch, since it ignores `undefined`.
 */
it('carries the tombstone on a list', async () => {
  const { calls } = respondWith({
    data: [membership(1, 'owner', '2026-09-10T08:00:00Z')],
    error: null,
  });

  const { lists } = await fetchLists();

  const select = String(argsOf(calls, 'select')[0][0]);
  expect(select).toContain('name, deleted_at');
  expect(lists?.[0].deletedAt).toBe('2026-09-10T08:00:00Z');
});

// --- The next page of a stream ----------------------------------------------------------------

/**
 * The one read rooted at `items`. What is worth pinning is the keyset: the `or` that continues
 * from `(created_at, id)`, the redundant `gte` that gives the planner a range to start from, and
 * the order that makes the cursor mean anything.
 */
describe('fetchItems', () => {
  const AFTER = { createdAt: '2026-09-01T10:00:00+00:00', id: 'i1' };

  it('reads one stream of one list from a cursor, in cursor order', async () => {
    const { calls } = respondWith({ data: [], error: null });

    await fetchItems('l1', 'live', AFTER);

    expect(argsOf(calls, 'from')).toEqual([['items']]);
    expect(argsOf(calls, 'eq')).toEqual([['list_id', 'l1']]);
    expect(argsOf(calls, 'is')).toEqual([['deleted_at', null]]);
    expect(argsOf(calls, 'gte')).toEqual([['created_at', AFTER.createdAt]]);
    // Quoted: a timestamp carries `:` and `+`, both reserved inside PostgREST's logic tree.
    expect(argsOf(calls, 'or')).toEqual([
      [
        'created_at.gt."2026-09-01T10:00:00+00:00",and(created_at.eq."2026-09-01T10:00:00+00:00",id.gt."i1")',
      ],
    ]);
    expect(argsOf(calls, 'order')).toEqual([['created_at'], ['id']]);
    expect(argsOf(calls, 'limit')).toEqual([[PAGE_SIZE]]);
  });

  it('reads the bin with the opposite filter', async () => {
    const { calls } = respondWith({ data: [], error: null });

    await fetchItems('l1', 'bin', AFTER);

    expect(argsOf(calls, 'is')).toEqual([]);
    expect(argsOf(calls, 'not')).toEqual([['deleted_at', 'is', null]]);
  });

  it('starts from the beginning when there is no cursor', async () => {
    const { calls } = respondWith({ data: [], error: null });

    await fetchItems('l1', 'live', null);

    expect(argsOf(calls, 'or')).toEqual([]);
    expect(argsOf(calls, 'gte')).toEqual([]);
  });

  it('hands back a cursor only when the page came back full', async () => {
    const rows = page(3);
    respondWith({ data: rows, error: null });
    const full = await fetchItems('l1', 'live', null, 3);
    expect(full.items).toHaveLength(3);
    expect(full.next).toEqual({ createdAt: rows[2].created_at, id: rows[2].id });

    respondWith({ data: rows.slice(0, 2), error: null });
    expect((await fetchItems('l1', 'live', null, 3)).next).toBeNull();
  });

  /** A page silently shortened by the cap would read as "the last page", and the rest would vanish. */
  it('refuses a page size the cap would silently shorten', async () => {
    respondWith({ data: [], error: null });

    await expect(fetchItems('l1', 'live', null, MAX_ROWS + 1)).rejects.toThrow(/capped/);
    await expect(fetchItems('l1', 'live', null, MAX_ROWS)).resolves.toBeTruthy();
  });

  it('returns the error rather than throwing it', async () => {
    respondWith({ data: null, error: { message: 'JWT expired' } });

    expect(await fetchItems('l1', 'live', null)).toEqual({
      items: null,
      next: null,
      error: 'JWT expired',
    });
  });
});

describe('fetchItem', () => {
  it('reads one row by primary key', async () => {
    const { calls } = respondWith({ data: BREAD, error: null });

    const { item } = await fetchItem('i3');

    expect(argsOf(calls, 'from')).toEqual([['items']]);
    expect(argsOf(calls, 'eq')).toEqual([['id', 'i3']]);
    expect(argsOf(calls, 'maybeSingle')).toEqual([[]]);
    expect(item).toEqual({
      id: 'i3',
      title: 'Bread',
      doneAt: null,
      deletedAt: '2026-09-09T07:00:00Z',
      createdAt: '2026-09-01T11:00:00Z',
    });
  });

  /** A row the caller may not see — purged, or the account was removed — is `null`, not an error. */
  it('answers null for a row that is not there', async () => {
    respondWith({ data: null, error: null });

    expect(await fetchItem('i9')).toEqual({ item: null, error: null });
  });
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

  it('renames an item through the RPC, by argument name', async () => {
    const rpc = respondToRpcWith({ data: 'applied', error: null, status: 200 });

    expect(await renameItem('i1', 'Oat milk')).toEqual({ error: null, verdict: 'ok' });
    expect(rpc).toHaveBeenCalledWith('rename_item', { p_item_id: 'i1', p_title: 'Oat milk' });
  });

  /** The same contract `set_item_done` keeps: a rename of a binned item is delivered, not refused. */
  it('carries a target_deleted outcome on a rename too', async () => {
    respondToRpcWith({ data: 'target_deleted', error: null, status: 200 });

    expect(await renameItem('i1', 'Oat milk')).toEqual({
      error: null,
      verdict: 'ok',
      outcome: 'target_deleted',
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
