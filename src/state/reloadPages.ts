import { listsReducer } from './listsReducer';
import type { Cursor, Item, List, Stream } from './types';

/** One page of one stream, as `fetchItems` answers it; `items: null` means the read failed. */
export type FetchPage = (
  listId: string,
  stream: Stream,
  after: Cursor
) => Promise<{ items: Item[] | null; next: Cursor | null }>;

/**
 * Brings a fresh fetch back up to how much of each list was loaded before it.
 *
 * `lists/loaded` replaces state wholesale, and a fetch carries a first page of each stream. Left
 * alone, a nudge while the user is three pages into a list would shrink it to page 1 and jump the
 * scroll — and long lists are precisely where nudges are most frequent. So for every list whose
 * previous copy held more rows of a stream than the fetch brought, this follows that stream's
 * cursor **one page at a time** — every request stays one page — until it holds at least as many
 * rows as before or the stream ends, and folds each page in with the reducer's own
 * `items/pageLoaded`. The result is still one array for one `lists/loaded`: the reducer never sees
 * a merge, and this lives above it for the same reason `replay` does.
 *
 * Only rows the database stamped count as "loaded before". Optimistic rows are folded back on top
 * afterwards by `replay` and must not make this ask for a page that was never read.
 *
 * **A page that fails snaps that list back to what the fetch returned.** Keeping the previous
 * copy's rows beyond page 1 is not an option: it would splice stale rows onto fresh ones with
 * nothing to say which half is which. One list loses its scroll position until the next scroll
 * reloads it; the others are untouched.
 */
export async function reloadPages(
  fetched: List[],
  previous: List[],
  fetchPage: FetchPage
): Promise<List[]> {
  let lists = fetched;

  for (const list of fetched) {
    const before = previous.find((candidate) => candidate.id === list.id);
    if (!before) continue;

    streams: for (const stream of ['live', 'bin'] as const) {
      const wanted = loadedRows(before, stream);
      if (wanted <= loadedRows(list, stream)) continue;

      let current = lists.find((candidate) => candidate.id === list.id) ?? list;
      let next = cursorOf(current, stream);
      while (next !== null && loadedRows(current, stream) < wanted) {
        const page = await fetchPage(list.id, stream, next);
        if (page.items === null) {
          lists = replace(lists, list);
          break streams;
        }

        lists = listsReducer(
          { lists },
          {
            type: 'items/pageLoaded',
            listId: list.id,
            items: page.items,
            stream: { name: stream, next: page.next },
          }
        ).lists;
        current = lists.find((candidate) => candidate.id === list.id) ?? list;
        next = page.next;
      }
    }
  }

  return lists;
}

/** How many database-stamped rows of `stream` the list holds. */
function loadedRows(list: List, stream: Stream): number {
  return list.items.filter((item) => {
    if (item.createdAt === null) return false;
    return stream === 'live' ? item.deletedAt === null : item.deletedAt !== null;
  }).length;
}

function cursorOf(list: List, stream: Stream): Cursor | null {
  return stream === 'live' ? list.nextLive : list.nextBin;
}

function replace(lists: List[], list: List): List[] {
  return lists.map((candidate) => (candidate.id === list.id ? list : candidate));
}
