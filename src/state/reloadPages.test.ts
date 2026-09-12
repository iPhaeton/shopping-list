import { reloadPages, type FetchPage } from './reloadPages';
import type { Cursor, Item, List, Stream } from './types';

/** `n` fetched rows of one stream, ids and timestamps ascending from `from`. */
function rows(stream: Stream, from: number, n: number): Item[] {
  return Array.from({ length: n }, (_, i) => {
    const k = from + i;
    return {
      id: `${stream}-${String(k).padStart(4, '0')}`,
      title: `Row ${k}`,
      doneAt: null,
      deletedAt: stream === 'bin' ? '2026-09-10T09:00:00.000Z' : null,
      createdAt: `2026-09-01T00:00:00.${String(k).padStart(6, '0')}Z`,
    };
  });
}

const cursorAfter = (items: Item[]): Cursor => {
  const last = items[items.length - 1];
  return { createdAt: last.createdAt as string, id: last.id };
};

/** A list exactly as `fetchLists` returns it now: metadata only, nothing fetched. */
function bare(id: string): List {
  return {
    id,
    name: id,
    role: 'owner',
    deletedAt: null,
    itemsLoaded: false,
    items: [],
    nextLive: null,
    nextBin: null,
  };
}

/** A list already opened earlier in the session, holding whatever rows it had loaded. */
function open(
  id: string,
  live: Item[],
  bin: Item[] = [],
  next: Partial<Pick<List, 'nextLive' | 'nextBin'>> = {}
): List {
  return {
    id,
    name: id,
    role: 'owner',
    deletedAt: null,
    itemsLoaded: true,
    items: [...live, ...bin],
    nextLive: next.nextLive ?? null,
    nextBin: next.nextBin ?? null,
  };
}

/** Pages of `size` rows per stream, cut from a stream `total` rows long, recording every call. */
function pagesOf(total: number, size: number) {
  const calls: [string, Stream, Cursor | null][] = [];
  const fetchPage: FetchPage = async (listId, stream, after) => {
    calls.push([listId, stream, after]);
    const from = after === null ? 1 : Number(after.id.split('-')[1]) + 1;
    const items = rows(stream, from, Math.min(size, total - from + 1));
    return { items, next: items.length === size ? cursorAfter(items) : null };
  };
  return { calls, fetchPage };
}

it('skips a list that was never opened', async () => {
  const fetched = [bare('l1')];
  const { calls, fetchPage } = pagesOf(9, 3);

  const result = await reloadPages(fetched, [bare('l1')], fetchPage);

  expect(result).toBe(fetched);
  expect(calls).toEqual([]);
});

it('ignores a list the previous state did not have', async () => {
  const fetched = [bare('l9')];
  const { calls, fetchPage } = pagesOf(9, 3);

  const result = await reloadPages(fetched, [open('l1', rows('live', 1, 9))], fetchPage);

  expect(result).toBe(fetched);
  expect(calls).toEqual([]);
});

it('marks a previously-loaded, empty list loaded again with no fetch at all', async () => {
  const fetched = [bare('l1')];
  const previous = [open('l1', [], [])];
  const { calls, fetchPage } = pagesOf(9, 3);

  const result = await reloadPages(fetched, previous, fetchPage);

  expect(calls).toEqual([]);
  expect(result[0].itemsLoaded).toBe(true);
});

it('re-reads, one page at a time starting from page 1, as many rows as were loaded before', async () => {
  const fetched = [bare('l1')];
  const previous = [open('l1', rows('live', 1, 8), [], { nextLive: cursorAfter(rows('live', 1, 8)) })];
  const { calls, fetchPage } = pagesOf(9, 3);

  const result = await reloadPages(fetched, previous, fetchPage);

  // Eight rows held before, three per page: the third page carries it past eight, so it stops there.
  expect(calls.map(([, stream, after]) => [stream, after?.id ?? null])).toEqual([
    ['live', null],
    ['live', 'live-0003'],
    ['live', 'live-0006'],
  ]);
  expect(result[0].items.map((item) => item.id)).toEqual(rows('live', 1, 9).map((item) => item.id));
  expect(result[0].nextLive).toEqual(cursorAfter(rows('live', 7, 3)));
  expect(result[0].itemsLoaded).toBe(true);
});

it('stops at a short page, since that is the last one', async () => {
  const fetched = [bare('l1')];
  const previous = [open('l1', rows('live', 1, 20))];
  const { calls, fetchPage } = pagesOf(5, 3);

  const result = await reloadPages(fetched, previous, fetchPage);

  expect(calls).toHaveLength(2);
  expect(result[0].items).toHaveLength(5);
  expect(result[0].nextLive).toBeNull();
  expect(result[0].itemsLoaded).toBe(true);
});

it('re-reads each stream on its own, from page 1 of each', async () => {
  const fetched = [bare('l1')];
  const previous = [open('l1', rows('live', 1, 2), rows('bin', 1, 4))];
  const { calls, fetchPage } = pagesOf(6, 2);

  const result = await reloadPages(fetched, previous, fetchPage);

  // Live needed one page (2 wanted, 2 per page); the bin needed two (4 wanted, 2 per page).
  expect(calls.map(([, stream]) => stream)).toEqual(['live', 'bin', 'bin']);
  expect(result[0].items.filter((item) => item.deletedAt !== null)).toHaveLength(4);
  expect(result[0].items.filter((item) => item.deletedAt === null)).toHaveLength(2);
  expect(result[0].itemsLoaded).toBe(true);
});

/** Optimistic rows are folded back afterwards; counting them here would ask for a page never read. */
it('does not count rows the database has not stamped', async () => {
  const stamped = rows('live', 1, 3);
  const optimistic: Item = { id: 'new', title: 'Eggs', doneAt: null, deletedAt: null, createdAt: null };
  const fetched = [bare('l1')];
  const previous = [open('l1', [...stamped, optimistic])];
  // A fourth real row exists on the server: if the optimistic one were miscounted as "wanted", a
  // second page would be requested to reach it. Correctly wanting 3, one full page is enough.
  const { calls, fetchPage } = pagesOf(4, 3);

  await reloadPages(fetched, previous, fetchPage);

  expect(calls).toHaveLength(1);
});

/**
 * Splicing the previous copy's rows onto a fresh page 1 would be a merge with nothing to say
 * which half is server truth. The list snaps back to what the fetch returned instead — including
 * `itemsLoaded: false` — and a visit reloads it. The other lists are untouched.
 */
it('snaps a list back to its bare fetched shape when a continuation fails, and leaves the others', async () => {
  const fetched = [bare('l1'), bare('l2')];
  const previous = [open('l1', rows('live', 1, 9)), open('l2', rows('live', 1, 6))];
  const { fetchPage } = pagesOf(9, 3);
  const failing: FetchPage = async (listId, stream, after) =>
    listId === 'l1' && after?.id === 'live-0006'
      ? { items: null, next: null }
      : fetchPage(listId, stream, after);

  const result = await reloadPages(fetched, previous, failing);

  expect(result[0]).toBe(fetched[0]);
  expect(result[0].itemsLoaded).toBe(false);
  expect(result[1].items).toHaveLength(6);
  expect(result[1].itemsLoaded).toBe(true);
});
