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

function list(id: string, live: Item[], bin: Item[] = [], next: Partial<Pick<List, 'nextLive' | 'nextBin'>> = {}): List {
  return {
    id,
    name: id,
    role: 'owner',
    deletedAt: null,
    items: [...live, ...bin],
    nextLive: next.nextLive ?? null,
    nextBin: next.nextBin ?? null,
  };
}

/** Pages of `size` rows per stream, cut from a stream `total` rows long, recording every call. */
function pagesOf(total: number, size: number) {
  const calls: [string, Stream, Cursor][] = [];
  const fetchPage: FetchPage = async (listId, stream, after) => {
    calls.push([listId, stream, after]);
    const from = Number(after.id.split('-')[1]) + 1;
    const items = rows(stream, from, Math.min(size, total - from + 1));
    return { items, next: items.length === size ? cursorAfter(items) : null };
  };
  return { calls, fetchPage };
}

it('leaves a fetch alone when nothing more was loaded before', async () => {
  const page1 = rows('live', 1, 3);
  const fetched = [list('l1', page1, [], { nextLive: cursorAfter(page1) })];
  const { calls, fetchPage } = pagesOf(9, 3);

  const result = await reloadPages(fetched, [list('l1', page1)], fetchPage);

  expect(result).toBe(fetched);
  expect(calls).toEqual([]);
});

it('re-reads, one page at a time, as many rows as were loaded before', async () => {
  const page1 = rows('live', 1, 3);
  const fetched = [list('l1', page1, [], { nextLive: cursorAfter(page1) })];
  const previous = [list('l1', rows('live', 1, 8), [], { nextLive: cursorAfter(rows('live', 1, 8)) })];
  const { calls, fetchPage } = pagesOf(9, 3);

  const result = await reloadPages(fetched, previous, fetchPage);

  // Three pages held eight rows before; the third page carries it past eight, so it stops there.
  expect(calls.map(([, stream, after]) => [stream, after.id])).toEqual([
    ['live', 'live-0003'],
    ['live', 'live-0006'],
  ]);
  expect(result[0].items.map((item) => item.id)).toEqual(rows('live', 1, 9).map((item) => item.id));
  expect(result[0].nextLive).toEqual(cursorAfter(rows('live', 7, 3)));
});

it('stops at a short page, since that is the last one', async () => {
  const page1 = rows('live', 1, 3);
  const fetched = [list('l1', page1, [], { nextLive: cursorAfter(page1) })];
  const previous = [list('l1', rows('live', 1, 20))];
  const { calls, fetchPage } = pagesOf(5, 3);

  const result = await reloadPages(fetched, previous, fetchPage);

  expect(calls).toHaveLength(1);
  expect(result[0].items).toHaveLength(5);
  expect(result[0].nextLive).toBeNull();
});

it('re-reads each stream on its own', async () => {
  const live1 = rows('live', 1, 2);
  const bin1 = rows('bin', 1, 2);
  const fetched = [list('l1', live1, bin1, { nextLive: cursorAfter(live1), nextBin: cursorAfter(bin1) })];
  const previous = [list('l1', rows('live', 1, 2), rows('bin', 1, 4))];
  const { calls, fetchPage } = pagesOf(6, 2);

  const result = await reloadPages(fetched, previous, fetchPage);

  expect(calls.map(([, stream]) => stream)).toEqual(['bin']);
  expect(result[0].items.filter((item) => item.deletedAt !== null)).toHaveLength(4);
  expect(result[0].items.filter((item) => item.deletedAt === null)).toHaveLength(2);
});

/** Optimistic rows are folded back afterwards; counting them here would ask for a page never read. */
it('does not count rows the database has not stamped', async () => {
  const page1 = rows('live', 1, 3);
  const fetched = [list('l1', page1, [], { nextLive: cursorAfter(page1) })];
  const optimistic: Item = { id: 'new', title: 'Eggs', doneAt: null, deletedAt: null, createdAt: null };
  const previous = [list('l1', [...page1, optimistic])];
  const { calls, fetchPage } = pagesOf(9, 3);

  await reloadPages(fetched, previous, fetchPage);

  expect(calls).toEqual([]);
});

/**
 * Splicing the previous copy's rows onto a fresh page 1 would be a merge with nothing to say
 * which half is server truth. The list snaps back to what the fetch returned instead; a scroll
 * reloads it. The other lists are untouched.
 */
it('snaps a list back to its first page when a continuation fails, and leaves the others', async () => {
  const page1 = rows('live', 1, 3);
  const fetched = [
    list('l1', page1, [], { nextLive: cursorAfter(page1) }),
    list('l2', page1, [], { nextLive: cursorAfter(page1) }),
  ];
  const previous = [list('l1', rows('live', 1, 9)), list('l2', rows('live', 1, 6))];
  const { fetchPage } = pagesOf(9, 3);
  const failing: FetchPage = async (listId, stream, after) =>
    listId === 'l1' && after.id === 'live-0006'
      ? { items: null, next: null }
      : fetchPage(listId, stream, after);

  const result = await reloadPages(fetched, previous, failing);

  expect(result[0]).toBe(fetched[0]);
  expect(result[1].items).toHaveLength(6);
});

it('ignores a list the previous state did not have', async () => {
  const page1 = rows('live', 1, 3);
  const fetched = [list('l9', page1, [], { nextLive: cursorAfter(page1) })];
  const { calls, fetchPage } = pagesOf(9, 3);

  const result = await reloadPages(fetched, [list('l1', rows('live', 1, 9))], fetchPage);

  expect(result).toBe(fetched);
  expect(calls).toEqual([]);
});
