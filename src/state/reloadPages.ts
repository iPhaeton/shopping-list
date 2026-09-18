import { listsReducer } from './listsReducer';
import type { Cursor, Item, List, Stream } from './types';

/** One page of one stream, as `fetchItems` answers it; `items: null` means the read failed. */
export type FetchPage = (
  listId: string,
  stream: Stream,
  after: Cursor | null
) => Promise<{ items: Item[] | null; next: Cursor | null }>;

/**
 * Brings a fresh fetch back up to how much of each list was loaded before it.
 *
 * `lists/loaded` replaces state wholesale, and a fresh fetch never carries any items — `fetchLists`
 * only reads list metadata now. Left alone, a nudge while the user has a list open (or has had one
 * open earlier this session) would collapse it back to `itemsLoaded: false` and flash a spinner.
 * So for every list that was `itemsLoaded` before, this re-fetches each stream **one page at a
 * time, starting from page 1** — every request stays one page — until it holds at least as many
 * rows as before or the stream ends, and folds each page in with the reducer's own
 * `items/pageLoaded`, then flips `itemsLoaded` back on. The result is still one array for one
 * `lists/loaded`: the reducer never sees a merge, and this lives above it for the same reason
 * `replay` does.
 *
 * A list that was never opened (`itemsLoaded` false, or not present before at all) is skipped
 * entirely — there is nothing to re-expand.
 *
 * Only rows the database stamped count as "loaded before". Optimistic rows are folded back on top
 * afterwards by `replay` and must not make this ask for a page that was never read.
 *
 * **A page that fails snaps that list back to what the fetch returned** — `itemsLoaded: false`
 * included. Keeping the previous copy's rows is not an option: it would splice stale rows onto
 * fresh ones with nothing to say which half is which. One list loses its items until the next
 * visit reloads it; the others are untouched.
 */
export async function reloadPages(
  fetched: List[],
  previous: List[],
  fetchPage: FetchPage
): Promise<List[]> {
  let lists = fetched;

  for (const list of fetched) {
    const before = previous.find((candidate) => candidate.id === list.id);
    if (!before?.itemsLoaded) continue;
    // `hydrateLists` leaves a list it was not asked about exactly as `previous` held it —
    // `itemsLoaded` still `true` on that same object — rather than replacing it with a bare fetch.
    // That is not "a fresh read with 0 rows so far", it is "nothing to catch up"; only a list this
    // round actually re-read (`itemsLoaded: false`, the one shape every real `fetchLists`/`fetchList`
    // row carries) needs the loop below at all.
    if (list.itemsLoaded) continue;

    let failed = false;

    streams: for (const stream of ['live', 'bin'] as const) {
      const wanted = loadedRows(before, stream);

      let current = lists.find((candidate) => candidate.id === list.id) ?? list;
      // Starts `null` — a fresh list carries no items at all now, so the first request is always
      // for page 1. `exhausted`, not `next !== null`, is what ends the loop: `null` here means
      // "haven't asked yet," not "stream ended".
      let next = cursorOf(current, stream);
      let exhausted = false;
      let asked = false;
      // At least one page always goes out, even when `wanted` is 0: a stream that was empty last
      // time is not proof it still is, and skipping the fetch left a list opened before its first
      // item existed permanently stuck empty — every later hydrate and realtime nudge saw "0
      // wanted, 0 held" and called that already caught up.
      while (!exhausted && (!asked || loadedRows(current, stream) < wanted)) {
        const page = await fetchPage(list.id, stream, next);
        asked = true;
        if (page.items === null) {
          lists = replace(lists, list);
          failed = true;
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
        exhausted = next === null;
      }
    }

    // Flipped even when neither stream needed a fetch — a previously-opened, genuinely empty list
    // still counts as loaded, or a nudge would flash it into a spinner for nothing.
    if (!failed) {
      lists = lists.map((candidate) =>
        candidate.id === list.id ? { ...candidate, itemsLoaded: true } : candidate
      );
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
