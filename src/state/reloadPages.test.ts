import { reloadListPages, reloadPages, type FetchListPage, type FetchPage } from './reloadPages';
import type { BinCursor, Cursor, Item, List, Stream } from './types';

/**
 * When bin row `k` was deleted: each one earlier than the last, since the bin is paged newest
 * deletion first and row `k` comes `k`th.
 */
const binnedAt = (k: number) => `2026-09-10T09:00:00.${String(999999 - k).padStart(6, '0')}Z`;

/** `n` fetched rows of one stream, ids ascending from `from`, in the order the stream pages them. */
function rows(stream: Stream, from: number, n: number): Item[] {
  return Array.from({ length: n }, (_, i) => {
    const k = from + i;
    return {
      id: `${stream}-${String(k).padStart(4, '0')}`,
      title: `Row ${k}`,
      doneAt: null,
      deletedAt: stream === 'bin' ? binnedAt(k) : null,
      createdAt: `2026-09-01T00:00:00.${String(k).padStart(6, '0')}Z`,
    };
  });
}

const cursorAfter = (items: Item[]): Cursor => {
  const last = items[items.length - 1];
  return { createdAt: last.createdAt as string, id: last.id };
};

const binCursorAfter = (items: Item[]): BinCursor => {
  const last = items[items.length - 1];
  return { deletedAt: last.deletedAt as string, id: last.id };
};

type AnyCursor = Cursor | BinCursor;

/**
 * A fake `fetchItems` / `fetchLists`, typed loosely: each fake pairs a stream with its own cursor by
 * construction, which the generic signature cannot see inside a plain function.
 */
const fakeItems = (
  fetch: (listId: string, stream: Stream, after: AnyCursor | null) => Promise<{ items: Item[] | null; next: AnyCursor | null }>
) => fetch as FetchPage;
const fakeLists = (
  fetch: (stream: Stream, after: AnyCursor | null) => Promise<{ lists: List[] | null; next: AnyCursor | null; error: string | null }>
) => fetch as FetchListPage;

/** A list exactly as `fetchLists` returns it now: metadata only, nothing fetched. */
function bare(id: string): List {
  return {
    id,
    name: id,
    role: 'owner',
    deletedAt: null,
    joinedAt: null,
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
    joinedAt: null,
    itemsLoaded: true,
    items: [...live, ...bin],
    nextLive: next.nextLive ?? null,
    nextBin: next.nextBin ?? null,
  };
}

/**
 * Pages of `size` rows per stream, cut from a `live` stream `total` rows long, recording every
 * call. `binTotal` defaults to 0 — a genuinely empty bin, which the fix under test now asks about
 * once per reload instead of never — and is only worth overriding when a test cares about bin rows.
 */
function pagesOf(total: number, size: number, binTotal = 0) {
  const calls: [string, Stream, AnyCursor | null][] = [];
  const fetchPage = fakeItems(async (listId, stream, after) => {
    calls.push([listId, stream, after]);
    const streamTotal = stream === 'bin' ? binTotal : total;
    const from = after === null ? 1 : Number(after.id.split('-')[1]) + 1;
    const items = rows(stream, from, Math.max(0, Math.min(size, streamTotal - from + 1)));
    const full = items.length === size;
    return { items, next: full ? (stream === 'live' ? cursorAfter(items) : binCursorAfter(items)) : null };
  });
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

it('still asks once per stream for a previously-loaded, empty list, in case rows arrived since', async () => {
  const fetched = [bare('l1')];
  const previous = [open('l1', [], [])];
  const calls: Stream[] = [];
  const empty = fakeItems(async (_id, stream) => {
    calls.push(stream);
    return { items: [], next: null };
  });

  const result = await reloadPages(fetched, previous, empty);

  expect(calls).toEqual(['live', 'bin']);
  expect(result[0].items).toEqual([]);
  expect(result[0].itemsLoaded).toBe(true);
});

/**
 * The bug this guards: a list opened before it had any items cached `itemsLoaded: true` with 0
 * rows, and the old guard read that as "already caught up" forever — no later hydrate or realtime
 * nudge ever asked again, so a list stayed empty on screen no matter how much was added elsewhere.
 */
it('picks up rows that arrived after the list was last seen empty', async () => {
  const fetched = [bare('l1')];
  const previous = [open('l1', [], [])];
  const liveRows = rows('live', 1, 3);
  const fetchPage = fakeItems(async (_id, stream) =>
    stream === 'live' ? { items: liveRows, next: null } : { items: [], next: null }
  );

  const result = await reloadPages(fetched, previous, fetchPage);

  expect(result[0].items.map((item) => item.id)).toEqual(liveRows.map((item) => item.id));
  expect(result[0].itemsLoaded).toBe(true);
});

it('re-reads, one page at a time starting from page 1, as many rows as were loaded before', async () => {
  const fetched = [bare('l1')];
  const previous = [open('l1', rows('live', 1, 8), [], { nextLive: cursorAfter(rows('live', 1, 8)) })];
  const { calls, fetchPage } = pagesOf(9, 3);

  const result = await reloadPages(fetched, previous, fetchPage);

  // Eight rows held before, three per page: the third page carries it past eight, so it stops there.
  // The bin was empty before too, so it still gets one page asked of it — just none of it comes back.
  expect(calls.map(([, stream, after]) => [stream, after?.id ?? null])).toEqual([
    ['live', null],
    ['live', 'live-0003'],
    ['live', 'live-0006'],
    ['bin', null],
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

  // Two live pages to exhaust the 5-row stream, plus one bin page for the (empty) bin.
  expect(calls).toHaveLength(3);
  expect(result[0].items).toHaveLength(5);
  expect(result[0].nextLive).toBeNull();
  expect(result[0].itemsLoaded).toBe(true);
});

it('re-reads each stream on its own, from page 1 of each', async () => {
  const fetched = [bare('l1')];
  const previous = [open('l1', rows('live', 1, 2), rows('bin', 1, 4))];
  const { calls, fetchPage } = pagesOf(6, 2, 6);

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

  expect(calls.filter(([, stream]) => stream === 'live')).toHaveLength(1);
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
  const failing = fakeItems(async (listId, stream, after) =>
    listId === 'l1' && after?.id === 'live-0006'
      ? { items: null, next: null }
      : fetchPage(listId, stream, after as never)
  );

  const result = await reloadPages(fetched, previous, failing);

  expect(result[0]).toBe(fetched[0]);
  expect(result[0].itemsLoaded).toBe(false);
  expect(result[1].items).toHaveLength(6);
  expect(result[1].itemsLoaded).toBe(true);
});

/** The bin pages by `(deletedAt, id)`, newest first, so its re-read continues on that key. */
it('re-reads two loaded pages of the bin as two, with a bin cursor', async () => {
  const fetched = [bare('l1')];
  const binned = rows('bin', 1, 4);
  const previous = [open('l1', [], binned, { nextBin: binCursorAfter(binned) })];
  const { calls, fetchPage } = pagesOf(0, 2, 9);

  const result = await reloadPages(fetched, previous, fetchPage);

  expect(calls.filter(([, stream]) => stream === 'bin').map(([, , after]) => after)).toEqual([
    null,
    { deletedAt: binnedAt(2), id: 'bin-0002' },
  ]);
  expect(result[0].items.map((item) => item.id)).toEqual(binned.map((item) => item.id));
  expect(result[0].nextBin).toEqual({ deletedAt: binnedAt(4), id: 'bin-0004' });
});

/**
 * Task 24 step 2's question: a row binned on this device is stamped (it has `createdAt`) and carries
 * a device-minted `deletedAt`, so `loadedRows` counts it toward the bin. When the loaded bin pages
 * are full, that asks for one page more than was loaded. Pinned both ways it can land.
 */
describe('a row binned on this device', () => {
  const SHOWN = rows('bin', 1, 2); // page 1 of the bin, full at a page size of 2
  const MINE: Item = { ...rows('live', 1, 1)[0], deletedAt: '2026-10-02T12:00:00.000Z' };

  function serving(bin: Item[]) {
    const calls: (AnyCursor | null)[] = [];
    const fetchPage = fakeItems(async (_id, stream, after) => {
      if (stream === 'live') return { items: [], next: null };
      calls.push(after);
      const from = after === null ? 0 : bin.findIndex((item) => item.id === after.id) + 1;
      const items = bin.slice(from, from + 2);
      return { items, next: items.length === 2 ? binCursorAfter(items) : null };
    });
    return { calls, fetchPage };
  }

  const previous = [open('l1', [], [...SHOWN, MINE], { nextBin: binCursorAfter(SHOWN) })];

  /** The new deletion is page 1's first row, so the page grew by one: page 2 holds a row shown before. */
  it('asks one page further once the database has it, which keeps every row shown before', async () => {
    const acknowledged = { ...MINE, deletedAt: '2026-10-02T12:00:00.123456Z' };
    const { calls, fetchPage } = serving([acknowledged, ...rows('bin', 1, 5)]);

    const result = await reloadPages([bare('l1')], previous, fetchPage);

    expect(calls).toHaveLength(2);
    expect(result[0].items.map((item) => item.id)).toEqual(expect.arrayContaining(SHOWN.map((item) => item.id)));
  });

  /** Still queued, the database's page 1 is what was shown, and the page after it was never asked for. */
  it('asks one page further while the write is still queued, which it does not need', async () => {
    const { calls, fetchPage } = serving(rows('bin', 1, 6));

    const result = await reloadPages([bare('l1')], previous, fetchPage);

    expect(calls).toHaveLength(2);
    expect(result[0].items.filter((item) => item.deletedAt !== null)).toHaveLength(4);
  });
});

// --- The lists themselves -----------------------------------------------------------------------

/** `n` lists of one stream as `fetchLists` returns them, in the order it pages them from `from`. */
function lists(stream: Stream, from: number, n: number): List[] {
  return Array.from({ length: n }, (_, i) => {
    const k = from + i;
    return {
      ...bare(`${stream}-${String(k).padStart(4, '0')}`),
      deletedAt: stream === 'bin' ? binnedAt(k) : null,
      joinedAt: `2026-09-01T00:00:00.${String(k).padStart(6, '0')}+00:00`,
    };
  });
}

/** Where the page after `page` starts, in its stream's own key. */
function listCursorAfter(stream: Stream, page: List[]): AnyCursor {
  const last = page[page.length - 1];
  return stream === 'live'
    ? { createdAt: last.joinedAt as string, id: last.id }
    : { deletedAt: last.deletedAt as string, id: last.id };
}

/** Pages of `size` lists per stream, cut from streams `live` and `bin` lists long, recording calls. */
function listPagesOf(live: number, bin: number, size: number) {
  const calls: [Stream, AnyCursor | null][] = [];
  const fetchPage = fakeLists(async (stream, after) => {
    calls.push([stream, after]);
    const total = stream === 'live' ? live : bin;
    const from = after === null ? 1 : Number(after.id.split('-')[1]) + 1;
    const page = lists(stream, from, Math.max(0, Math.min(size, total - from + 1)));
    const next = page.length === size ? listCursorAfter(stream, page) : null;
    return { lists: page, next, error: null };
  });
  return { calls, fetchPage };
}

describe('reloadListPages', () => {
  it('always asks for page 1 of each stream, even with nothing loaded before', async () => {
    const { calls, fetchPage } = listPagesOf(5, 5, 3);

    const result = await reloadListPages([], fetchPage);

    expect(calls).toEqual([
      ['live', null],
      ['bin', null],
    ]);
    expect(result.lists?.map((list) => list.id)).toEqual([
      'live-0001', 'live-0002', 'live-0003', 'bin-0001', 'bin-0002', 'bin-0003',
    ]);
    expect(result.cursors?.live?.id).toBe('live-0003');
    expect(result.cursors?.bin?.id).toBe('bin-0003');
  });

  /** The case the Lists screen cares about: a nudge must not snap a deep scroll back to page 1. */
  it('re-reads, one page at a time from page 1, as many lists of each stream as were loaded before', async () => {
    const { calls, fetchPage } = listPagesOf(9, 9, 3);
    const previous = [...lists('live', 1, 6), ...lists('bin', 1, 4)];

    const result = await reloadListPages(previous, fetchPage);

    // Six live lists held before, three per page: two pages. Four in the bin: two pages as well.
    expect(calls.filter(([stream]) => stream === 'live').map(([, after]) => after?.id ?? null)).toEqual([
      null,
      'live-0003',
    ]);
    expect(calls.filter(([stream]) => stream === 'bin').map(([, after]) => after?.id ?? null)).toEqual([
      null,
      'bin-0003',
    ]);
    expect(result.lists).toHaveLength(12);
    // Each stream's cursor in its own key: the bin's is where it was deleted, not joined.
    expect(result.cursors).toEqual({
      live: { createdAt: lists('live', 6, 1)[0].joinedAt, id: 'live-0006' },
      bin: { deletedAt: binnedAt(6), id: 'bin-0006' },
    });
  });

  /** Two pages of the bin loaded and a nudge: still two, continued on `(deletedAt, id)`. */
  it('re-reads two loaded pages of the bin as two, with a bin cursor', async () => {
    const { calls, fetchPage } = listPagesOf(0, 9, 3);

    const result = await reloadListPages(lists('bin', 1, 6), fetchPage);

    expect(calls.filter(([stream]) => stream === 'bin').map(([, after]) => after)).toEqual([
      null,
      { deletedAt: binnedAt(3), id: 'bin-0003' },
    ]);
    expect(result.lists).toHaveLength(6);
    expect(result.cursors?.bin).toEqual({ deletedAt: binnedAt(6), id: 'bin-0006' });
  });

  /** `reloadPages`' "a row binned on this device", one level up: one bin page further. */
  it('asks one bin page further for a list binned on this device and not yet sent', async () => {
    const { calls, fetchPage } = listPagesOf(0, 9, 3);
    const mine = { ...lists('live', 1, 1)[0], deletedAt: '2026-10-02T12:00:00.000Z' };

    await reloadListPages([...lists('bin', 1, 3), mine], fetchPage);

    expect(calls.filter(([stream]) => stream === 'bin')).toHaveLength(2);
  });

  it('stops at a short page, since that is the last one', async () => {
    const { calls, fetchPage } = listPagesOf(4, 0, 3);

    const result = await reloadListPages(lists('live', 1, 9), fetchPage);

    expect(calls.filter(([stream]) => stream === 'live')).toHaveLength(2);
    expect(result.lists).toHaveLength(4);
    expect(result.cursors).toEqual({ live: null, bin: null });
  });

  /** Optimistic lists are folded back afterwards by `replay`; counting them would ask for a page never read. */
  it('does not count lists the database has not stamped', async () => {
    const { calls, fetchPage } = listPagesOf(9, 0, 3);
    const optimistic = { ...bare('new'), joinedAt: null };

    await reloadListPages([...lists('live', 1, 3), optimistic], fetchPage);

    expect(calls.filter(([stream]) => stream === 'live')).toHaveLength(1);
  });

  /**
   * Snapping the list pages back, as `reloadPages` does for one list's items, would drop lists from
   * state — the one open on List detail, or one with writes queued. The whole re-read fails instead.
   */
  it('fails as a whole when any continuation fails', async () => {
    const { fetchPage } = listPagesOf(9, 9, 3);
    const failing = fakeLists(async (stream, after) =>
      stream === 'bin' && after?.id === 'bin-0003'
        ? { lists: null, next: null, error: 'Failed to fetch' }
        : fetchPage(stream, after as never)
    );

    const result = await reloadListPages([...lists('live', 1, 6), ...lists('bin', 1, 6)], failing);

    expect(result).toEqual({ lists: null, cursors: null, error: 'Failed to fetch' });
  });

  /** Binned between the live read and the bin read: in both answers, kept once. */
  it('keeps a list caught in both streams once', async () => {
    const moved = lists('live', 1, 1)[0];
    const fetchPage = fakeLists(async (stream) => ({
      lists: stream === 'live' ? [moved] : [{ ...moved, deletedAt: '2026-09-10T09:00:00.000Z' }],
      next: null,
      error: null,
    }));

    const result = await reloadListPages([], fetchPage);

    expect(result.lists?.map((list) => list.id)).toEqual(['live-0001']);
  });
});
