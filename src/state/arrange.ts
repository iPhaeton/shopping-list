import { byStamp } from './listsReducer';
import type { Item, List } from './types';

/**
 * Search and sort over the rows a screen holds — the live lists, or one list's live rows — computed
 * on the device. Pure: the screens memoise `arrangeLists`/`arrangeItems` in place of the
 * `inJoinOrder`/`inCreationOrder` they used before, and nothing here knows about paging. Whether the
 * rows held are all of them is the screen's to say (`useCompletion`, the coverage line).
 */

export type Direction = 'asc' | 'desc';

/**
 * The sort as a set of keys, each its own toggle button, compared in a fixed priority: `todo` (if
 * on), then `az` (if on), then `date`. `date` is never off: it is the last key, so it breaks every
 * tie the others leave — names are not unique, no database rule says so — and no key after it could
 * change anything, since no two rows share a stamp.
 */
export type ListSort = { az: Direction | null; date: Direction };
export type ItemSort = ListSort & { todo: 'first' | 'last' | null };
export type SortKey = 'todo' | 'az' | 'date';

/** Oldest first and nothing else: the order both screens showed before there was a sort. */
export const DEFAULT_LIST_SORT: ListSort = { az: null, date: 'asc' };
export const DEFAULT_ITEM_SORT: ItemSort = { todo: null, az: null, date: 'asc' };

/**
 * Non-default decides three things: the magnifier's dot, whether the sort is stored, and whether the
 * stream needs completing.
 */
export function isDefaultSort(sort: ListSort | ItemSort): boolean {
  const todo = 'todo' in sort ? sort.todo : null;
  return todo === null && sort.az === null && sort.date === 'asc';
}

/** One tap on `key`'s button: `todo` and `az` cycle off → on → reversed → off; `date` only flips. */
export function nextSort<S extends ListSort | ItemSort>(sort: S, key: SortKey): S {
  switch (key) {
    case 'date':
      return { ...sort, date: sort.date === 'asc' ? 'desc' : 'asc' };
    case 'az':
      return { ...sort, az: sort.az === null ? 'asc' : sort.az === 'asc' ? 'desc' : null };
    case 'todo': {
      const todo = 'todo' in sort ? sort.todo : null;
      return { ...sort, todo: todo === null ? 'first' : todo === 'first' ? 'last' : null };
    }
  }
}

/** `liveLists(...)` output, filtered by `query` and sorted by `sort`. A new array. */
export function arrangeLists(lists: List[], { sort, query }: { sort: ListSort; query: string }): List[] {
  return arrange(lists, { ...sort, todo: null }, query, {
    text: (list) => list.name,
    stamp: (list) => list.joinedAt,
  });
}

/** `liveItems(...)` output, filtered by `query` and sorted by `sort`. A new array. */
export function arrangeItems(items: Item[], { sort, query }: { sort: ItemSort; query: string }): Item[] {
  return arrange(items, sort, query, {
    text: (item) => item.title,
    stamp: (item) => item.createdAt,
    done: (item) => item.doneAt !== null,
  });
}

type Fields<T> = {
  text: (row: T) => string;
  stamp: (row: T) => string | null;
  done?: (row: T) => boolean;
};

/**
 * Each row carries its input index, because `date` `desc` is `asc` reversed exactly — unstamped rows
 * (optimistic, so the newest) first, the latest added first — and no comparator can reverse the
 * stable sort's order among rows it calls equal. `asc` uses the same index, so it equals
 * `inCreationOrder`/`inJoinOrder`: `byStamp`, unstamped last in the order they were added.
 */
function arrange<T extends { id: string }>(
  rows: T[],
  sort: ItemSort,
  query: string,
  fields: Fields<T>
): T[] {
  const needle = fold(query.trim());
  const kept = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => needle === '' || fold(fields.text(row)).includes(needle));

  kept.sort((a, b) => {
    if (sort.todo !== null && fields.done) {
      // Undone (0) before done (1) for `first`.
      const todo = Number(fields.done(a.row)) - Number(fields.done(b.row));
      if (todo !== 0) return sort.todo === 'first' ? todo : -todo;
    }
    if (sort.az !== null) {
      const az = compareText(fields.text(a.row), fields.text(b.row));
      if (az !== 0) return sort.az === 'asc' ? az : -az;
    }
    const date =
      byStamp(fields.stamp(a.row), a.row.id, fields.stamp(b.row), b.row.id) || a.index - b.index;
    return sort.date === 'asc' ? date : -date;
  });

  return kept.map(({ row }) => row);
}

/** The combining diacritical marks, U+0300–U+036F: what `NFD` splits an accent into. */
const MARKS = /[̀-ͯ]/g;

/**
 * How a name and a query are compared: case- and accent-insensitive, so `creme` finds `Crème
 * fraîche`. Deliberately crude — it strips every combining mark, so `й` matches `и`, and leaves
 * letters that do not decompose (`ł`, `ø`, `ß`) as they are.
 *
 * `normalize` is checked once, at load, rather than trusted: the app runs on Hermes, not on the
 * Node jest runs on. Without it, a table covers Latin-1 and Latin Extended-A — exactly the letters
 * there that `NFD` decomposes, mapped to their base (checked against Node's `normalize` in the
 * tests) — and anything already decomposed still loses its marks.
 */
export const fold: (text: string) => string = normalizes()
  ? (text) => text.normalize('NFD').replace(MARKS, '').toLowerCase()
  : (text) => foldByTable(text).replace(MARKS, '').toLowerCase();

function normalizes(): boolean {
  try {
    return typeof ''.normalize === 'function' && 'é'.normalize('NFD').length === 2;
  } catch {
    return false;
  }
}

const ACCENTED =
  'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽž';
const BASE =
  'AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyyAaAaAaCcCcCcCcDdEeEeEeEeEeGgGgGgGgHhIiIiIiIiIJjKkLlLlLlNnNnNnOoOoOoRrRrRrSsSsSsSsTtTtUuUuUuUuUuUuWwYyYZzZzZz';
const TABLE = new Map([...ACCENTED].map((letter, i) => [letter, BASE[i]]));

function foldByTable(text: string): string {
  let out = '';
  for (const letter of text) out += TABLE.get(letter) ?? letter;
  return out;
}

/**
 * `A–Z`'s comparison: the collator with `sensitivity: 'base'`, so `a` equals `Á` and `date` breaks
 * the tie, and `numeric`, so `Item 2` sorts before `Item 10`. Built once. Checked at load for both
 * options, as `fold` checks `normalize`; without them, folded strings compare by code unit with
 * runs of digits compared as numbers.
 */
const compareText: (a: string, b: string) => number = collator() ?? compareFolded;

function collator(): ((a: string, b: string) => number) | null {
  try {
    if (typeof Intl === 'undefined' || typeof Intl.Collator !== 'function') return null;
    const intl = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
    if (intl.compare('Item 2', 'Item 10') >= 0 || intl.compare('a', 'Á') !== 0) return null;
    return (a, b) => intl.compare(a, b);
  } catch {
    return null;
  }
}

const RUNS = /\d+|\D+/g;

function compareFolded(a: string, b: string): number {
  const x = fold(a).match(RUNS) ?? [];
  const y = fold(b).match(RUNS) ?? [];

  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const order = isDigits(x[i]) && isDigits(y[i]) ? compareNumbers(x[i], y[i]) : compareUnits(x[i], y[i]);
    if (order !== 0) return order;
  }
  return x.length - y.length;
}

function isDigits(run: string): boolean {
  return run.charCodeAt(0) >= 48 && run.charCodeAt(0) <= 57;
}

/** By value, as strings, so a run longer than a double holds still compares exactly. */
function compareNumbers(a: string, b: string): number {
  const x = a.replace(/^0+(?=\d)/, '');
  const y = b.replace(/^0+(?=\d)/, '');
  return x.length !== y.length ? x.length - y.length : compareUnits(x, y);
}

function compareUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
