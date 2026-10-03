import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DEFAULT_ITEM_SORT,
  DEFAULT_LIST_SORT,
  type ItemSort,
  type ListSort,
} from '../state/arrange';
import { inOrder } from './storageQueue';

const VERSION = 1;

/**
 * One key per device, not per account, and not cleared on sign-out — as the theme is. List ids are
 * globally unique, so two accounts on one device never collide; a list both of them are on shares
 * its sort, which is accepted. Never sent to the server.
 */
const KEY = 'sort-preference';

/**
 * The sorts somebody changed, and nothing else: the Lists screen's, and one item sort per list.
 * **Only non-default keys are stored** (the user's words) — `az` and `todo` only while on, `date`
 * only as `'desc'` — so a key set back to its default is deleted, a list left with nothing is
 * deleted, and with nothing left anywhere the storage key itself is removed.
 *
 * **Never pruned.** The client cannot tell a list that is gone from one past the pages it loaded,
 * an entry is ~50 bytes, and only lists somebody re-sorted have one.
 */
export type StoredSorts = {
  lists?: Partial<ListSort>;
  items?: Record<string, Partial<ItemSort>>;
};

export const NO_STORED_SORTS: StoredSorts = {};

export function listSortOf(stored: StoredSorts): ListSort {
  return { ...DEFAULT_LIST_SORT, ...stored.lists };
}

export function itemSortOf(stored: StoredSorts, listId: string): ItemSort {
  return { ...DEFAULT_ITEM_SORT, ...stored.items?.[listId] };
}

export function withListSort(stored: StoredSorts, sort: ListSort): StoredSorts {
  const next = { ...stored };
  const lists = changed({ az: sort.az, date: sort.date });
  if (lists) next.lists = lists;
  else delete next.lists;
  return next;
}

export function withItemSort(stored: StoredSorts, listId: string, sort: ItemSort): StoredSorts {
  const items = { ...stored.items };
  const entry = changed(sort);
  if (entry) items[listId] = entry;
  else delete items[listId];

  const next = { ...stored };
  if (Object.keys(items).length > 0) next.items = items;
  else delete next.items;
  return next;
}

/** The keys of `sort` that differ from the default, or `undefined` when none do. */
function changed(sort: Partial<ItemSort>): Partial<ItemSort> | undefined {
  const entry: Partial<ItemSort> = {};
  if (sort.todo === 'first' || sort.todo === 'last') entry.todo = sort.todo;
  if (sort.az === 'asc' || sort.az === 'desc') entry.az = sort.az;
  if (sort.date === 'desc') entry.date = sort.date;
  return Object.keys(entry).length > 0 ? entry : undefined;
}

/**
 * Never rejects. Absent, unreadable, or another version all read as every default — a sort is not
 * worth a startup failure. Below that, damage stays local: a value this version does not recognise
 * drops that one key, and an entry that is not an object drops that one entry, never the rest.
 */
export async function readSortPreference(): Promise<StoredSorts> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return NO_STORED_SORTS;

    const stored = JSON.parse(raw) as { v?: unknown; lists?: unknown; items?: unknown };
    if (stored.v !== VERSION) return NO_STORED_SORTS;

    let sorts: StoredSorts = NO_STORED_SORTS;
    if (isObject(stored.lists)) sorts = withListSort(sorts, listSortOf({ lists: keysOf(stored.lists) }));
    if (isObject(stored.items)) {
      for (const [listId, entry] of Object.entries(stored.items)) {
        if (!isObject(entry)) continue;
        sorts = withItemSort(sorts, listId, itemSortOf({ items: { [listId]: keysOf(entry) } }, listId));
      }
    }
    return sorts;
  } catch {
    return NO_STORED_SORTS;
  }
}

/** Removes the key once nothing non-default is left, rather than storing an empty shell. */
export function writeSortPreference(sorts: StoredSorts): Promise<void> {
  const empty = sorts.lists === undefined && sorts.items === undefined;
  return inOrder(() =>
    empty
      ? AsyncStorage.removeItem(KEY)
      : AsyncStorage.setItem(KEY, JSON.stringify({ v: VERSION, ...sorts }))
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The recognised keys of one stored entry; anything else is dropped here, key by key. */
function keysOf(entry: Record<string, unknown>): Partial<ItemSort> {
  const keys: Partial<ItemSort> = {};
  if (entry.todo === 'first' || entry.todo === 'last') keys.todo = entry.todo;
  if (entry.az === 'asc' || entry.az === 'desc') keys.az = entry.az;
  if (entry.date === 'asc' || entry.date === 'desc') keys.date = entry.date;
  return keys;
}
