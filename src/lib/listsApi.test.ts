import { fetchLists } from './listsApi';
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
jest.mock('./supabase', () => ({ supabase: { from: jest.fn() } }));

type Response = { data: unknown; error: { message: string; code?: string } | null };

/** Stands in for the postgrest builder: `.from(...).select(...).order(...)` and then a promise. */
function respondWith(response: Response) {
  const order = jest.fn().mockResolvedValue(response);
  const select = jest.fn(() => ({ order }));
  const from = jest.fn(() => ({ select }));
  jest.mocked(supabase.from).mockImplementation(from as unknown as typeof supabase.from);
  return { from, select, order };
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
