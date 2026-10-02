import type { List, ListCursors } from './types';
import { withinLoadedRange } from './useHydration';

// Only the pure range check is under test; the hook's reads and cache stay out of it.
jest.mock('../lib/listsApi', () => ({}));
jest.mock('../lib/listCache', () => ({}));

const JOINED = '2026-09-01T08:00:00+00:00';

function list(id: string, deletedAt: string | null, joinedAt: string | null = JOINED): List {
  return { id, name: id, role: 'owner', deletedAt, joinedAt, itemsLoaded: false, items: [], nextLive: null, nextBin: null };
}

/**
 * A list a nudge names, never seen before, is shown only if it sorts inside its stream's loaded
 * pages. The bin is paged newest deletion first, so "inside" is at or *above* the bin cursor — get
 * the direction wrong and a list binned elsewhere stays hidden until a scroll brings it, which
 * nothing else would catch.
 */
describe('withinLoadedRange, for the bin', () => {
  const CURSOR = { deletedAt: '2026-09-10T09:00:00+00:00', id: 'm5' };
  const cursors: ListCursors = { live: null, bin: CURSOR };

  it('keeps a list deleted after the cursor’s row, which sorts above it', () => {
    expect(withinLoadedRange(list('m9', '2026-09-10T10:00:00+00:00'), cursors)).toBe(true);
  });

  it('leaves a list deleted before the cursor’s row for the page that brings it', () => {
    expect(withinLoadedRange(list('m1', '2026-09-10T08:00:00+00:00'), cursors)).toBe(false);
  });

  /** Equal stamps fall back to the id, descending: a larger id sorts first. */
  it('breaks an equal stamp by id, on either side of the cursor', () => {
    expect(withinLoadedRange(list('m6', CURSOR.deletedAt), cursors)).toBe(true);
    expect(withinLoadedRange(list('m5', CURSOR.deletedAt), cursors)).toBe(true);
    expect(withinLoadedRange(list('m4', CURSOR.deletedAt), cursors)).toBe(false);
  });

  it('keeps any binned list once the bin has ended', () => {
    expect(withinLoadedRange(list('m1', '2020-01-01T00:00:00+00:00'), { live: null, bin: null })).toBe(true);
  });

  /** The live cursor says nothing about the bin, nor the bin's about live lists. */
  it('judges each stream by its own cursor', () => {
    const live = { createdAt: '2026-09-01T09:00:00+00:00', id: 'm5' };
    expect(withinLoadedRange(list('m1', '2026-09-10T08:00:00+00:00'), { live, bin: null })).toBe(true);
    expect(withinLoadedRange(list('m9', null, '2026-09-01T10:00:00+00:00'), { live, bin: CURSOR })).toBe(false);
    expect(withinLoadedRange(list('m1', null, JOINED), { live, bin: CURSOR })).toBe(true);
  });
});
