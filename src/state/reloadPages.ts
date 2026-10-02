import { initialState, listsReducer } from './listsReducer';
import type { CursorOf, Item, List, ListCursors, Stream, StreamPage } from './types';

/**
 * One page of one stream, as `fetchItems` answers it; `items: null` means the read failed. Each
 * stream pages by its own cursor — the live rows by `(createdAt, id)`, the bin by `(deletedAt, id)`.
 */
export type FetchPage = <S extends Stream>(
  listId: string,
  stream: S,
  after: CursorOf<S> | null
) => Promise<{ items: Item[] | null; next: CursorOf<S> | null }>;

/** One page of one stream of lists, as `fetchLists` answers it; `lists: null` means it failed. */
export type FetchListPage = <S extends Stream>(
  stream: S,
  after: CursorOf<S> | null
) => Promise<{ lists: List[] | null; next: CursorOf<S> | null; error: string | null }>;

export type ListPages =
  | { lists: List[]; cursors: ListCursors; error: null }
  | { lists: null; cursors: null; error: string };

/**
 * The lists themselves, brought back up to how many of each stream were loaded before —
 * `reloadPages`' rule one level up, and run in front of it: `lists/loaded` replaces state wholesale,
 * so a re-read that fetched only page 1 would snap a Lists screen scrolled three pages deep back to
 * one, on every foreground and every nudge.
 *
 * Each stream is re-read **one page per request, from page 1**, until it holds at least as many
 * lists the database stamped (`joinedAt !== null`) as `previous` held of that stream, or the stream
 * ends. At least page 1 always goes out, since a stream empty last time is not proof it still is.
 * Optimistic lists are folded back on top afterwards by `replay`, so counting them here would ask
 * for a page never read. The two streams are read side by side; pages are folded with the reducer's
 * own `lists/pageLoaded`, live first, so a list caught in both — binned between the two reads — is
 * kept once.
 *
 * **Any page that fails fails the whole re-read**, and the caller dispatches nothing. That is
 * deliberately not `reloadPages`' per-list snap-back: snapping the list pages back would drop lists
 * from state — the one open on List detail, or one with writes still queued — for a hiccup. Leaving
 * state untouched is what a failed read of every list always did.
 */
export async function reloadListPages(
  previous: List[],
  fetchPage: FetchListPage
): Promise<ListPages> {
  type Page = { lists: List[]; stream: StreamPage };
  const reread = async <S extends Stream>(stream: S): Promise<Page[] | string> => {
    const wanted = stampedLists(previous, stream);
    const pages: Page[] = [];
    let held = 0;
    let next: CursorOf<S> | null = null;

    do {
      // Annotated: `next` is fed from this page, so TypeScript cannot infer the one from the other.
      const page: { lists: List[] | null; next: CursorOf<S> | null; error: string | null } =
        await fetchPage(stream, next);
      if (page.lists === null) return page.error ?? 'Could not load your lists.';
      pages.push({ lists: page.lists, stream: streamPage(stream, page.next) });
      held += stampedLists(page.lists, stream);
      next = page.next;
    } while (next !== null && held < wanted);

    return pages;
  };

  const [live, bin] = await Promise.all([reread('live'), reread('bin')]);
  if (typeof live === 'string') return { lists: null, cursors: null, error: live };
  if (typeof bin === 'string') return { lists: null, cursors: null, error: bin };

  let state = initialState;
  for (const page of [...live, ...bin]) {
    state = listsReducer(state, { type: 'lists/pageLoaded', lists: page.lists, stream: page.stream });
  }

  return { lists: state.lists, cursors: state.listCursors, error: null };
}

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

    // One stream re-read into `lists`; `false` when a page failed.
    const reread = async <S extends Stream>(stream: S, after: CursorOf<S> | null): Promise<boolean> => {
      const wanted = loadedRows(before, stream);

      let current = lists.find((candidate) => candidate.id === list.id) ?? list;
      // Starts `null` — a fresh list carries no items at all now, so the first request is always
      // for page 1. `exhausted`, not `next !== null`, is what ends the loop: `null` here means
      // "haven't asked yet," not "stream ended".
      let next = after;
      let exhausted = false;
      let asked = false;
      // At least one page always goes out, even when `wanted` is 0: a stream that was empty last
      // time is not proof it still is, and skipping the fetch left a list opened before its first
      // item existed permanently stuck empty — every later hydrate and realtime nudge saw "0
      // wanted, 0 held" and called that already caught up.
      while (!exhausted && (!asked || loadedRows(current, stream) < wanted)) {
        const page = await fetchPage(list.id, stream, next);
        asked = true;
        if (page.items === null) return false;

        lists = listsReducer(
          { ...initialState, lists },
          {
            type: 'items/pageLoaded',
            listId: list.id,
            items: page.items,
            stream: streamPage(stream, page.next),
          }
        ).lists;
        current = lists.find((candidate) => candidate.id === list.id) ?? list;
        next = page.next;
        exhausted = next === null;
      }
      return true;
    };

    const failed = !(await reread('live', list.nextLive)) || !(await reread('bin', list.nextBin));
    if (failed) lists = replace(lists, list);

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

/** How many database-stamped lists of `stream` there are in `lists`. */
function stampedLists(lists: List[], stream: Stream): number {
  return lists.filter((list) => {
    if (list.joinedAt === null) return false;
    return stream === 'live' ? list.deletedAt === null : list.deletedAt !== null;
  }).length;
}

/** How many database-stamped rows of `stream` the list holds. */
function loadedRows(list: List, stream: Stream): number {
  return list.items.filter((item) => {
    if (item.createdAt === null) return false;
    return stream === 'live' ? item.deletedAt === null : item.deletedAt !== null;
  }).length;
}

/**
 * A page's `stream` payload, for a stream known here only as a type parameter. The cast is the one
 * place that holds: TypeScript cannot narrow `S` from `name`, and `CursorOf<S>` is exactly the
 * cursor the union pairs with that name.
 */
function streamPage<S extends Stream>(name: S, next: CursorOf<S> | null): StreamPage {
  return { name, next } as StreamPage;
}

function replace(lists: List[], list: List): List[] {
  return lists.map((candidate) => (candidate.id === list.id ? list : candidate));
}
