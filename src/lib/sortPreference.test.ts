import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_ITEM_SORT, DEFAULT_LIST_SORT } from '../state/arrange';
import {
  itemSortOf,
  listSortOf,
  NO_STORED_SORTS,
  readSortPreference,
  withItemSort,
  withListSort,
  writeSortPreference,
  type StoredSorts,
} from './sortPreference';

const KEY = 'sort-preference';

beforeEach(async () => {
  await AsyncStorage.clear();
});

async function stored(): Promise<unknown> {
  const raw = await AsyncStorage.getItem(KEY);
  return raw === null ? null : JSON.parse(raw);
}

describe('reading', () => {
  it('reads every default when nothing was ever stored', async () => {
    const sorts = await readSortPreference();

    expect(listSortOf(sorts)).toEqual(DEFAULT_LIST_SORT);
    expect(itemSortOf(sorts, 'l1')).toEqual(DEFAULT_ITEM_SORT);
  });

  it('round-trips what was written', async () => {
    let sorts = withListSort(NO_STORED_SORTS, { az: 'desc', date: 'desc' });
    sorts = withItemSort(sorts, 'l1', { todo: 'first', az: 'asc', date: 'asc' });
    await writeSortPreference(sorts);

    const read = await readSortPreference();
    expect(listSortOf(read)).toEqual({ az: 'desc', date: 'desc' });
    expect(itemSortOf(read, 'l1')).toEqual({ todo: 'first', az: 'asc', date: 'asc' });
    expect(itemSortOf(read, 'l2')).toEqual(DEFAULT_ITEM_SORT);
  });

  it('reads every default for anything it cannot parse', async () => {
    await AsyncStorage.setItem(KEY, '{not json');

    expect(await readSortPreference()).toEqual(NO_STORED_SORTS);
  });

  it('reads every default for another version', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify({ v: 2, lists: { az: 'asc' } }));

    expect(await readSortPreference()).toEqual(NO_STORED_SORTS);
  });

  it('reads every default when storage cannot be read at all', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk on fire'));

    expect(await readSortPreference()).toEqual(NO_STORED_SORTS);
  });

  /** Damage stays where it is: one bad value costs that key, one bad entry that entry. */
  it('drops one bad key or entry and keeps the rest', async () => {
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({
        v: 1,
        lists: { az: 'sideways', date: 'desc' },
        items: {
          good: { todo: 'last', az: 'asc' },
          mixed: { todo: 'sometimes', date: 'desc' },
          broken: 'az',
          gone: { todo: 7 },
        },
      })
    );

    const read = await readSortPreference();
    expect(read).toEqual({
      lists: { date: 'desc' },
      items: { good: { todo: 'last', az: 'asc' }, mixed: { date: 'desc' } },
    });
  });

  /** A default value stored anyway is no harm, and is not kept. */
  it('reads a stored default as not stored', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify({ v: 1, lists: { date: 'asc' }, items: { l1: { date: 'asc' } } }));

    expect(await readSortPreference()).toEqual(NO_STORED_SORTS);
  });
});

/** Only what differs from the default is stored — the user's words. */
describe('writing', () => {
  it('stores only the keys that are not the default', async () => {
    await writeSortPreference(
      withItemSort(withListSort(NO_STORED_SORTS, { az: null, date: 'desc' }), 'l1', {
        todo: null,
        az: 'asc',
        date: 'asc',
      })
    );

    expect(await stored()).toEqual({ v: 1, lists: { date: 'desc' }, items: { l1: { az: 'asc' } } });
  });

  it('deletes a key set back to its default', () => {
    const sorts = withItemSort(NO_STORED_SORTS, 'l1', { todo: 'first', az: 'desc', date: 'desc' });

    expect(withItemSort(sorts, 'l1', { todo: 'first', az: null, date: 'desc' })).toEqual({
      items: { l1: { todo: 'first', date: 'desc' } },
    });
  });

  it('deletes a list entry left empty, and keeps the others', () => {
    let sorts: StoredSorts = withItemSort(NO_STORED_SORTS, 'l1', { todo: 'first', az: null, date: 'asc' });
    sorts = withItemSort(sorts, 'l2', { todo: null, az: 'asc', date: 'asc' });

    expect(withItemSort(sorts, 'l1', DEFAULT_ITEM_SORT)).toEqual({ items: { l2: { az: 'asc' } } });
  });

  it('removes the storage key once nothing is left', async () => {
    const sorts = withItemSort(NO_STORED_SORTS, 'l1', { todo: 'last', az: null, date: 'asc' });
    await writeSortPreference(sorts);
    expect(await stored()).toEqual({ v: 1, items: { l1: { todo: 'last' } } });

    await writeSortPreference(withItemSort(sorts, 'l1', DEFAULT_ITEM_SORT));

    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });

  it('removes the storage key when the Lists sort goes back to the default too', async () => {
    const sorts = withListSort(NO_STORED_SORTS, { az: 'asc', date: 'asc' });
    await writeSortPreference(sorts);

    await writeSortPreference(withListSort(sorts, DEFAULT_LIST_SORT));

    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });

  it('never stores a to-do key for the Lists screen', () => {
    expect(withListSort(NO_STORED_SORTS, { ...DEFAULT_ITEM_SORT, todo: 'first' } as never)).toEqual({});
  });
});
