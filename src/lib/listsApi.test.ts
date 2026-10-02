import { ITEMS_FULL, LISTS_FULL, OWNED_LISTS_FULL } from './limits';
import {
  addItem,
  fetchItem,
  fetchItems,
  fetchList,
  fetchListCounts,
  fetchLists,
  LIST_PAGE_SIZE,
  MAX_ROWS,
  PAGE_SIZE,
  renameItem,
  renameList,
  resultFor,
  setItemDeleted,
  setItemDone,
  setListDeleted,
} from './listsApi';
import { supabase } from './supabase';

/**
 * `src/lib/supabase.ts` is mocked at the module boundary, the same seam the auth suites use — so
 * `@supabase/supabase-js` is never loaded here.
 *
 * What is worth asserting is the *shape* of each read: `fetchLists` is rooted at `list_members`,
 * each row carries the caller's `role` and when they joined, the list hangs off it as an embed
 * carrying no items at all — those come from `fetchItems`, read separately once a list is opened —
 * and it is paged by the same keyset `fetchItems` is.
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
  for (const method of ['select', 'eq', 'is', 'not', 'or', 'gte', 'lte', 'order', 'limit', 'maybeSingle']) {
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

/** When membership `n` was created: distinct, ascending, in the database's own format. */
const joined = (n: number) => `2026-09-01T00:00:00.${String(n).padStart(6, '0')}+00:00`;

/** A membership row as PostgREST returns it now — no items, just list metadata. */
function membership(n: number, role = 'owner', deletedAt: string | null = null) {
  return {
    role,
    created_at: joined(n),
    lists: { id: `l${n}`, name: `List ${n}`, deleted_at: deletedAt },
  };
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

/**
 * Lists are paged the way items are: two streams, the live one keyset on `(created_at, list_id)` of
 * the membership, the bin on the list's own `(deleted_at, id)`, newest first. What is worth pinning
 * is the root, the stream filter through the inner embed, each keyset with its redundant bound, and
 * the order that makes each cursor mean anything.
 */
describe('fetchLists', () => {
  const AFTER = { createdAt: '2026-09-01T10:00:00+00:00', id: 'l1' };
  const BIN_AFTER = { deletedAt: '2026-09-10T08:00:00+00:00', id: 'l7' };

  it('reads the live stream from list_members, in the order each list entered the account', async () => {
    const { calls } = respondWith({ data: [], error: null });

    await fetchLists('live', null);

    expect(argsOf(calls, 'from')).toEqual([['list_members']]);
    // The embed is inner-joined, so a membership can never arrive without its list — and a filter
    // on the embed's column drops the membership row itself, which is what picks the stream.
    expect(argsOf(calls, 'select')[0][0]).toContain('lists!inner');
    expect(argsOf(calls, 'is')).toEqual([['lists.deleted_at', null]]);
    expect(argsOf(calls, 'not')).toEqual([]);
    // No user filter: row-level security supplies it, and an `.eq()` here could only disagree.
    expect(argsOf(calls, 'eq')).toEqual([]);
    expect(argsOf(calls, 'order')).toEqual([['created_at'], ['list_id']]);
    expect(argsOf(calls, 'limit')).toEqual([[LIST_PAGE_SIZE]]);
    // Page 1: no cursor, so no keyset.
    expect(argsOf(calls, 'or')).toEqual([]);
    expect(argsOf(calls, 'gte')).toEqual([]);
  });

  /**
   * The bin is shown newest deletion first, so it is paged that way. `lists(deleted_at)` orders the
   * membership rows by the to-one embed's column; `referencedTable` would order the embed's own
   * rows, which does nothing for a to-one — checked against PostgREST v14.5, task 24 step 2.
   */
  it('reads the bin from list_members too, newest deletion first', async () => {
    const { calls } = respondWith({ data: [], error: null });

    await fetchLists('bin', null);

    expect(argsOf(calls, 'from')).toEqual([['list_members']]);
    expect(argsOf(calls, 'select')[0][0]).toContain('lists!inner');
    expect(argsOf(calls, 'is')).toEqual([]);
    expect(argsOf(calls, 'not')).toEqual([['lists.deleted_at', 'is', null]]);
    expect(argsOf(calls, 'eq')).toEqual([]);
    expect(argsOf(calls, 'order')).toEqual([
      ['lists(deleted_at)', { ascending: false }],
      ['list_id', { ascending: false }],
    ]);
    expect(argsOf(calls, 'limit')).toEqual([[LIST_PAGE_SIZE]]);
    expect(argsOf(calls, 'or')).toEqual([]);
    expect(argsOf(calls, 'lte')).toEqual([]);
    expect(argsOf(calls, 'gte')).toEqual([]);
  });

  /** With `!inner`, a filter on the embed drops the membership row, so the keyset goes there. */
  it('continues the bin from a cursor on the list’s (deleted_at, id), through the embed', async () => {
    const { calls } = respondWith({ data: [], error: null });

    await fetchLists('bin', BIN_AFTER);

    expect(argsOf(calls, 'lte')).toEqual([['lists.deleted_at', BIN_AFTER.deletedAt]]);
    expect(argsOf(calls, 'or')).toEqual([
      [
        'deleted_at.lt."2026-09-10T08:00:00+00:00",and(deleted_at.eq."2026-09-10T08:00:00+00:00",id.lt."l7")',
        { referencedTable: 'lists' },
      ],
    ]);
    expect(argsOf(calls, 'gte')).toEqual([]);
    expect(argsOf(calls, 'order')).toEqual([
      ['lists(deleted_at)', { ascending: false }],
      ['list_id', { ascending: false }],
    ]);
  });

  it('hands back a bin cursor in the bin’s own key', async () => {
    respondWith({
      data: [
        membership(3, 'owner', '2026-09-10T09:00:00+00:00'),
        membership(1, 'owner', '2026-09-10T08:00:00+00:00'),
      ],
      error: null,
    });

    const { next } = await fetchLists('bin', null, 2);

    expect(next).toEqual({ deletedAt: '2026-09-10T08:00:00+00:00', id: 'l1' });
  });

  it('continues from a cursor on (created_at, list_id)', async () => {
    const { calls } = respondWith({ data: [], error: null });

    await fetchLists('live', AFTER);

    expect(argsOf(calls, 'gte')).toEqual([['created_at', AFTER.createdAt]]);
    // Quoted: a timestamp carries `:` and `+`, both reserved inside PostgREST's logic tree.
    expect(argsOf(calls, 'or')).toEqual([
      [
        'created_at.gt."2026-09-01T10:00:00+00:00",and(created_at.eq."2026-09-01T10:00:00+00:00",list_id.gt."l1")',
      ],
    ]);
    expect(argsOf(calls, 'lte')).toEqual([]);
    expect(argsOf(calls, 'order')).toEqual([['created_at'], ['list_id']]);
  });

  it('hands back a cursor only when the page came back full', async () => {
    respondWith({ data: [membership(1), membership(2), membership(3)], error: null });
    const full = await fetchLists('live', null, 3);
    expect(full.lists).toHaveLength(3);
    expect(full.next).toEqual({ createdAt: joined(3), id: 'l3' });

    respondWith({ data: [membership(1), membership(2)], error: null });
    expect((await fetchLists('live', null, 3)).next).toBeNull();
  });

  /** A page silently shortened by the cap would read as "the last page", and the rest would vanish. */
  it('refuses a page size the cap would silently shorten', async () => {
    respondWith({ data: [], error: null });

    await expect(fetchLists('live', null, MAX_ROWS + 1)).rejects.toThrow(/capped/);
    await expect(fetchLists('live', null, MAX_ROWS)).resolves.toBeTruthy();
  });

  /**
   * Opening the Lists screen once fetched a first page of every list's items, which is exactly what
   * made it laggy. `fetchLists` sends no item embed at all — `fetchItems` is what a list's items
   * come from, read once that list is actually opened.
   */
  it('sends no item embed — items arrive only once a list is entered', async () => {
    const { calls } = respondWith({ data: [], error: null });

    await fetchLists('live', null);

    expect(String(argsOf(calls, 'select')[0][0])).not.toContain('items');
  });

  it('carries the role and the join time from the membership row, with nothing fetched yet', async () => {
    respondWith({
      data: [membership(1, 'owner'), membership(2, 'reader')],
      error: null,
    });

    const { lists } = await fetchLists('live', null);

    expect(lists).toEqual([
      { id: 'l1', name: 'List 1', role: 'owner', deletedAt: null, joinedAt: joined(1), itemsLoaded: false, items: [], nextLive: null, nextBin: null },
      { id: 'l2', name: 'List 2', role: 'reader', deletedAt: null, joinedAt: joined(2), itemsLoaded: false, items: [], nextLive: null, nextBin: null },
    ]);
  });

  it('returns the error rather than throwing it', async () => {
    respondWith({ data: null, error: { message: 'JWT expired' } });

    expect(await fetchLists('live', null)).toEqual({ lists: null, next: null, error: 'JWT expired' });
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

    const { lists } = await fetchLists('bin', null);

    const select = String(argsOf(calls, 'select')[0][0]);
    expect(select).toContain('name, deleted_at');
    expect(select).toMatch(/^role, created_at, lists!inner/);
    expect(lists?.[0].deletedAt).toBe('2026-09-10T08:00:00Z');
  });
});

// --- The next page of a stream ----------------------------------------------------------------

/**
 * The one read rooted at `items`. What is worth pinning is each stream's keyset: the `or` that
 * continues from `(created_at, id)` — or, for the bin, from `(deleted_at, id)` downwards — the
 * redundant bound that gives the planner a range to start from, and the order that makes the cursor
 * mean anything.
 */
describe('fetchItems', () => {
  const AFTER = { createdAt: '2026-09-01T10:00:00+00:00', id: 'i1' };
  const BIN_AFTER = { deletedAt: '2026-09-10T08:00:00+00:00', id: 'i7' };

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
    expect(argsOf(calls, 'lte')).toEqual([]);
  });

  it('reads page 1 of the bin newest deletion first', async () => {
    const { calls } = respondWith({ data: [], error: null });

    await fetchItems('l1', 'bin', null);

    expect(argsOf(calls, 'from')).toEqual([['items']]);
    expect(argsOf(calls, 'eq')).toEqual([['list_id', 'l1']]);
    expect(argsOf(calls, 'is')).toEqual([]);
    expect(argsOf(calls, 'not')).toEqual([['deleted_at', 'is', null]]);
    expect(argsOf(calls, 'order')).toEqual([
      ['deleted_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    expect(argsOf(calls, 'limit')).toEqual([[PAGE_SIZE]]);
    expect(argsOf(calls, 'or')).toEqual([]);
    expect(argsOf(calls, 'lte')).toEqual([]);
  });

  /** The `lte` is the descending twin of the live stream's `gte`: the range the index walk starts at. */
  it('continues the bin downwards from a cursor on (deleted_at, id)', async () => {
    const { calls } = respondWith({ data: [], error: null });

    await fetchItems('l1', 'bin', BIN_AFTER);

    expect(argsOf(calls, 'lte')).toEqual([['deleted_at', BIN_AFTER.deletedAt]]);
    expect(argsOf(calls, 'or')).toEqual([
      [
        'deleted_at.lt."2026-09-10T08:00:00+00:00",and(deleted_at.eq."2026-09-10T08:00:00+00:00",id.lt."i7")',
      ],
    ]);
    expect(argsOf(calls, 'gte')).toEqual([]);
  });

  it('hands back a bin cursor in the bin’s own key', async () => {
    const rows = page(3).map((row, i) => ({ ...row, deleted_at: `2026-09-10T0${9 - i}:00:00+00:00` }));
    respondWith({ data: rows, error: null });

    const { next } = await fetchItems('l1', 'bin', null, 3);

    expect(next).toEqual({ deletedAt: '2026-09-10T07:00:00+00:00', id: rows[2].id });
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

/**
 * `fetchList` is `fetchLists` narrowed to one list — the read a realtime nudge naming a list uses
 * instead of asking for every list again.
 */
describe('fetchList', () => {
  it('reads one membership row, filtered to the one list', async () => {
    const { calls } = respondWith({ data: membership(1), error: null });

    const { list } = await fetchList('l1');

    expect(argsOf(calls, 'from')).toEqual([['list_members']]);
    // The same columns as a page, `created_at` included: a list fetched by id is placed and
    // counted by when you joined it, like one that arrived with its page.
    expect(argsOf(calls, 'select')[0][0]).toMatch(/^role, created_at, lists!inner/);
    expect(argsOf(calls, 'eq')).toEqual([['list_id', 'l1']]);
    expect(argsOf(calls, 'maybeSingle')).toEqual([[]]);
    expect(list).toEqual({
      id: 'l1',
      name: 'List 1',
      role: 'owner',
      deletedAt: null,
      joinedAt: joined(1),
      itemsLoaded: false,
      items: [],
      nextLive: null,
      nextBin: null,
    });
  });

  /** Not visible to the caller — unshared, or the list is gone — same answer either way. */
  it('answers null for a list that is not there', async () => {
    respondWith({ data: null, error: null });

    expect(await fetchList('l9')).toEqual({ list: null, error: null });
  });

  /**
   * Deletion is a tombstone: a list still shared with the caller but put in the bin must not read
   * as "not there" — it comes back like any other list, with `deletedAt` set.
   */
  it('still returns a list that is merely binned, not gone', async () => {
    respondWith({ data: membership(1, 'owner', '2026-09-01T00:00:00Z'), error: null });

    const { list } = await fetchList('l1');

    expect(list?.deletedAt).toBe('2026-09-01T00:00:00Z');
  });

  it('reports the database error rather than swallowing it', async () => {
    respondWith({ data: null, error: { message: 'JWT expired' } });

    expect(await fetchList('l1')).toEqual({ list: null, error: 'JWT expired' });
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
      sessionRevoked: false,
    });
  });

  it('leaves an error it has no better words for alone', async () => {
    respondToRpcWith({ data: null, error: { message: 'JWT expired' }, status: 401 });

    expect(await renameList('l1', 'Weekly shop')).toEqual({
      error: 'JWT expired',
      verdict: 'retryable',
      sessionRevoked: false,
    });
  });

  /**
   * The signal a kicked device's write is told apart from an ordinary refusal by: both raise
   * `42501`, so the message text is the only thing that distinguishes `session_still_valid()`
   * failing from any other permission check. Matched exactly, not as a substring.
   */
  it('flags the exact message session_still_valid() raises, and nothing that merely shares its code', async () => {
    respondToRpcWith({
      data: null,
      error: { message: 'this device has been signed out', code: '42501' },
      status: 403,
    });
    expect(await setItemDone('i1', true)).toMatchObject({ sessionRevoked: true });

    respondToRpcWith({
      data: null,
      error: { message: 'only an owner can delete or restore this list', code: '42501' },
      status: 403,
    });
    expect(await setListDeleted('l1', true)).toMatchObject({ sessionRevoked: false });
  });
});

describe('fetchListCounts', () => {
  it('reads both counts from my_list_counts, which answers one row', async () => {
    const rpc = respondToRpcWith({ data: [{ owned: 100, total: 412 }], error: null, status: 200 });

    expect(await fetchListCounts()).toEqual({ counts: { owned: 100, total: 412 }, error: null });
    expect(rpc).toHaveBeenCalledWith('my_list_counts');
  });

  it('returns the error rather than throwing it', async () => {
    respondToRpcWith({ data: null, error: { message: 'network down' }, status: 0 });

    expect(await fetchListCounts()).toEqual({ counts: null, error: 'network down' });
  });
});

/**
 * Each limit raises its own SQLSTATE (`20261001000000_list_limits.sql`), and all three must be
 * `permanent`: a limit refusal read as `retryable` would be resent every 30 s forever, since the
 * outbox has no attempt cap, and stall every write behind it. They arrive as 400 — measured — but
 * the code decides, as it does for `P0002`, so each is asserted here at 500 as well.
 */
describe('the three limits', () => {
  const cases = [
    { code: 'LM001', message: 'they already own 100 lists', sentence: OWNED_LISTS_FULL },
    { code: 'LM002', message: 'they are already on 1,000 lists', sentence: LISTS_FULL },
    { code: 'LM003', message: 'this list already has 1,000 items', sentence: ITEMS_FULL },
  ];

  it.each(cases)('classifies $code as permanent whatever the status', async ({ code, message }) => {
    for (const status of [400, 500]) {
      respondToRpcWith({ data: null, error: { message, code }, status });
      expect(await addItem('i1', 'l1', 'Milk')).toMatchObject({ verdict: 'permanent' });
    }
  });

  /** Asserted verbatim: these are the banner's words, and the Lists screen shows the first two too. */
  it('says each limit in the second person on a queued write', async () => {
    respondToRpcWith({ data: null, error: cases[0], status: 400 });
    expect((await setListDeleted('l1', false)).error).toBe(
      'You own 100 lists. Delete one or hand one over to make room.'
    );

    respondToRpcWith({ data: null, error: cases[1], status: 400 });
    expect((await setListDeleted('l1', false)).error).toBe(
      "You're on 1,000 lists. Delete or leave one to make room."
    );

    respondToRpcWith({ data: null, error: cases[2], status: 400 });
    expect((await addItem('i1', 'l1', 'Milk')).error).toBe('This list is full: 1,000 items at most.');
  });

  /** The Sharing screen's reader is an owner reading about somebody else: the database's own words. */
  it('keeps the database words for the membership calls', () => {
    expect(resultFor(cases[0], 400)).toEqual({
      error: 'they already own 100 lists',
      verdict: 'permanent',
      sessionRevoked: false,
    });
    expect(resultFor(cases[1], 400)).toEqual({
      error: 'they are already on 1,000 lists',
      verdict: 'permanent',
      sessionRevoked: false,
    });
  });
});
