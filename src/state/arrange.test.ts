import {
  arrangeItems,
  arrangeLists,
  DEFAULT_ITEM_SORT,
  DEFAULT_LIST_SORT,
  fold,
  isDefaultSort,
  nextSort,
  type ItemSort,
} from './arrange';
import { inCreationOrder, inJoinOrder } from './listsReducer';
import type { Item, List } from './types';

/**
 * Pure, so no provider and no mocks. The comparisons jest runs here are Node's full ICU, which
 * proves nothing about Hermes — the device checks in the step-3 log do that. What this suite pins is
 * the model: which key decides first, how unstamped rows sit, and that the fallbacks behave like the
 * real thing.
 */

const at = (n: number) => `2026-09-01T00:00:${String(n).padStart(2, '0')}+00:00`;

function item(id: string, title: string, created: number | null, done = false): Item {
  return {
    id,
    title,
    doneAt: done ? '2026-09-02T00:00:00+00:00' : null,
    deletedAt: null,
    createdAt: created === null ? null : at(created),
  };
}

function list(id: string, name: string, joined: number | null): List {
  return {
    id,
    name,
    role: 'owner',
    deletedAt: null,
    joinedAt: joined === null ? null : at(joined),
    itemsLoaded: false,
    items: [],
    nextLive: null,
    nextBin: null,
  };
}

const titles = (items: Item[]) => items.map((row) => row.title);
const sorted = (items: Item[], sort: Partial<ItemSort>, query = '') =>
  titles(arrangeItems(items, { sort: { ...DEFAULT_ITEM_SORT, ...sort }, query }));

describe('matching', () => {
  const ITEMS = [
    item('i1', 'Crème fraîche', 1),
    item('i2', 'Cream', 2),
    item('i3', 'Milk', 3),
    item('i4', 'ÉCLAIRS', 4),
  ];

  it('ignores accents and case, on both sides', () => {
    expect(sorted(ITEMS, {}, 'creme')).toEqual(['Crème fraîche']);
    expect(sorted(ITEMS, {}, 'CRÈME')).toEqual(['Crème fraîche']);
    expect(sorted(ITEMS, {}, 'éclair')).toEqual(['ÉCLAIRS']);
  });

  it('matches a substring anywhere in the name', () => {
    expect(sorted(ITEMS, {}, 'rea')).toEqual(['Cream']);
    expect(sorted(ITEMS, {}, 'aich')).toEqual(['Crème fraîche']);
  });

  it('matches everything with an empty query, or one of spaces', () => {
    expect(sorted(ITEMS, {}, '')).toHaveLength(4);
    expect(sorted(ITEMS, {}, '   ')).toHaveLength(4);
  });

  it('trims the query', () => {
    expect(sorted(ITEMS, {}, '  milk ')).toEqual(['Milk']);
  });

  /** Deliberately crude, and accepted: every combining mark goes, nothing else is folded. */
  it('strips every mark, and leaves letters that do not decompose alone', () => {
    expect(fold('Йогурт')).toBe('иогурт');
    expect(fold('Łódź')).toBe('łodz');
    expect(fold('Straße')).toBe('straße');
  });

  it('filters lists by name the same way', () => {
    const lists = [list('l1', 'Groceries', 1), list('l2', 'Hardware', 2), list('l3', 'Grove Street', 3)];

    expect(arrangeLists(lists, { sort: DEFAULT_LIST_SORT, query: 'GRO' }).map((row) => row.name)).toEqual([
      'Groceries',
      'Grove Street',
    ]);
  });

  it('returns a new array, even when nothing moved', () => {
    const items = [item('i1', 'Milk', 1)];
    expect(arrangeItems(items, { sort: DEFAULT_ITEM_SORT, query: '' })).not.toBe(items);
  });
});

describe('the default sort', () => {
  /** The order both screens showed before there was a sort, unstamped rows included. */
  it('is inCreationOrder for items', () => {
    const items = [
      item('i3', 'Eggs', 3),
      item('n1', 'Optimistic one', null),
      item('i1', 'Milk', 1),
      item('i2b', 'Tie b', 2),
      item('n2', 'Optimistic two', null),
      item('i2a', 'Tie a', 2),
    ];

    expect(arrangeItems(items, { sort: DEFAULT_ITEM_SORT, query: '' })).toEqual(inCreationOrder(items));
  });

  it('is inJoinOrder for lists', () => {
    const lists = [
      list('l3', 'C', 3),
      list('n1', 'New', null),
      list('l1', 'A', 1),
      list('l2', 'B', 2),
    ];

    expect(arrangeLists(lists, { sort: DEFAULT_LIST_SORT, query: '' })).toEqual(inJoinOrder(lists));
  });

  it('is the only default', () => {
    expect(isDefaultSort(DEFAULT_ITEM_SORT)).toBe(true);
    expect(isDefaultSort(DEFAULT_LIST_SORT)).toBe(true);
    expect(isDefaultSort({ ...DEFAULT_ITEM_SORT, todo: 'first' })).toBe(false);
    expect(isDefaultSort({ ...DEFAULT_LIST_SORT, az: 'asc' })).toBe(false);
    expect(isDefaultSort({ ...DEFAULT_LIST_SORT, date: 'desc' })).toBe(false);
  });
});

describe('each key', () => {
  const ITEMS = [
    item('i1', 'Bread', 1, true),
    item('i2', 'apples', 2),
    item('i3', 'Coffee', 3, true),
    item('i4', 'Dates', 4),
  ];

  it('sorts by date, oldest first or newest first', () => {
    expect(sorted(ITEMS, { date: 'asc' })).toEqual(['Bread', 'apples', 'Coffee', 'Dates']);
    expect(sorted(ITEMS, { date: 'desc' })).toEqual(['Dates', 'Coffee', 'apples', 'Bread']);
  });

  it('sorts A to Z and Z to A, ignoring case', () => {
    expect(sorted(ITEMS, { az: 'asc' })).toEqual(['apples', 'Bread', 'Coffee', 'Dates']);
    expect(sorted(ITEMS, { az: 'desc' })).toEqual(['Dates', 'Coffee', 'Bread', 'apples']);
  });

  it('puts what is still to do first, or last', () => {
    expect(sorted(ITEMS, { todo: 'first' })).toEqual(['apples', 'Dates', 'Bread', 'Coffee']);
    expect(sorted(ITEMS, { todo: 'last' })).toEqual(['Bread', 'Coffee', 'apples', 'Dates']);
  });

  it('compares numbers in names by value', () => {
    const items = [item('a', 'Item 10', 1), item('b', 'Item 2', 2), item('c', 'item 1', 3)];
    expect(sorted(items, { az: 'asc' })).toEqual(['item 1', 'Item 2', 'Item 10']);
  });
});

describe('several keys at once', () => {
  const ITEMS = [
    item('i1', 'Milk', 1, true),
    item('i2', 'Bread', 2),
    item('i3', 'Apples', 3, true),
    item('i4', 'Milk', 4),
    item('i5', 'apples', 5),
  ];

  it('decides by to do first, then A to Z, then date', () => {
    expect(sorted(ITEMS, { todo: 'first', az: 'asc' })).toEqual(['apples', 'Bread', 'Milk', 'Apples', 'Milk']);
    expect(titlesAndIds(ITEMS, { todo: 'first', az: 'asc' })).toEqual(['i5', 'i2', 'i4', 'i3', 'i1']);
  });

  it('reverses only the key that is reversed', () => {
    expect(titlesAndIds(ITEMS, { todo: 'last', az: 'asc' })).toEqual(['i3', 'i1', 'i5', 'i2', 'i4']);
    expect(titlesAndIds(ITEMS, { todo: 'first', az: 'desc' })).toEqual(['i4', 'i2', 'i5', 'i1', 'i3']);
  });

  /** Names are not unique, so date breaks the tie — in its own direction. */
  it('breaks an A to Z tie by date', () => {
    expect(titlesAndIds(ITEMS, { az: 'asc' })).toEqual(['i3', 'i5', 'i2', 'i1', 'i4']);
    expect(titlesAndIds(ITEMS, { az: 'asc', date: 'desc' })).toEqual(['i5', 'i3', 'i2', 'i4', 'i1']);
  });

  function titlesAndIds(items: Item[], sort: Partial<ItemSort>) {
    return arrangeItems(items, { sort: { ...DEFAULT_ITEM_SORT, ...sort }, query: '' }).map((row) => row.id);
  }
});

/**
 * An optimistic row has no stamp yet, and is the newest. Last under oldest-first, as today; first
 * under newest-first, the latest added first — or a list created under newest-first would appear
 * at the bottom and jump to the top once the database acknowledged it.
 */
describe('rows the database has not stamped', () => {
  const ITEMS = [
    item('i1', 'Milk', 1),
    item('n1', 'First new', null),
    item('i2', 'Bread', 2),
    item('n2', 'Second new', null),
  ];

  it('go last oldest first, in the order they were added', () => {
    expect(sorted(ITEMS, { date: 'asc' })).toEqual(['Milk', 'Bread', 'First new', 'Second new']);
  });

  it('go first newest first, the latest added first', () => {
    expect(sorted(ITEMS, { date: 'desc' })).toEqual(['Second new', 'First new', 'Bread', 'Milk']);
  });

  it('stay within the group to do leaves them in', () => {
    const items = [...ITEMS, item('d1', 'Done', 3, true)];
    expect(sorted(items, { todo: 'last', date: 'desc' })).toEqual([
      'Done',
      'Second new',
      'First new',
      'Bread',
      'Milk',
    ]);
  });
});

describe('a tap on a sort button', () => {
  it('cycles to do and A to Z off, on, reversed, off', () => {
    let sort: ItemSort = DEFAULT_ITEM_SORT;
    const seen: (string | null)[] = [];
    for (let tap = 0; tap < 3; tap++) {
      sort = nextSort(sort, 'todo');
      seen.push(sort.todo);
    }
    expect(seen).toEqual(['first', 'last', null]);

    const az = [1, 2, 3].map((taps) =>
      Array.from({ length: taps }).reduce<ItemSort>((s) => nextSort(s, 'az'), DEFAULT_ITEM_SORT).az
    );
    expect(az).toEqual(['asc', 'desc', null]);
  });

  it('only ever flips date, never turns it off', () => {
    const once = nextSort(DEFAULT_LIST_SORT, 'date');
    expect(once.date).toBe('desc');
    expect(nextSort(once, 'date').date).toBe('asc');
  });

  it('moves no other key', () => {
    expect(nextSort({ todo: 'first', az: 'desc', date: 'desc' } as ItemSort, 'az')).toEqual({
      todo: 'first',
      az: null,
      date: 'desc',
    });
  });
});

/**
 * Hermes is not Node. `fold` and the collator are each picked once, at load, by a feature test, so
 * each fallback is reached here by loading the module afresh with the feature taken away.
 */
describe('without the engine features', () => {
  function loadWith(stub: () => () => void): typeof import('./arrange') {
    const restore = stub();
    try {
      let module: typeof import('./arrange') | undefined;
      jest.isolateModules(() => {
        module = require('./arrange');
      });
      return module!;
    } finally {
      restore();
    }
  }

  const withoutNormalize = () => {
    const original = String.prototype.normalize;
    // A `normalize` that does nothing, as on an engine built without the Unicode data.
    String.prototype.normalize = function (this: string) {
      return String(this);
    };
    return () => {
      String.prototype.normalize = original;
    };
  };

  const withoutCollator = () => {
    const original = Intl.Collator;
    (Intl as { Collator: unknown }).Collator = undefined;
    return () => {
      (Intl as { Collator: unknown }).Collator = original;
    };
  };

  /** The table must fold exactly what `NFD` folds, across the whole range it covers. */
  it('folds Latin-1 and Latin Extended-A by table, as normalize would', () => {
    const fallback = loadWith(withoutNormalize);
    // Proof the table is what answered: `ḿ` lies past its range, and `NFD` would fold it.
    expect(fold('ḿ')).toBe('m');
    expect(fallback.fold('ḿ')).toBe('ḿ');

    for (let code = 0xc0; code <= 0x17f; code++) {
      const letter = String.fromCharCode(code);
      expect([letter, fallback.fold(letter)]).toEqual([letter, fold(letter)]);
    }
  });

  it('still finds Crème fraîche from creme, and strips marks already decomposed', () => {
    const fallback = loadWith(withoutNormalize);
    const items = [item('i1', 'Crème fraîche', 1), item('i2', 'Café', 2), item('i3', 'Milk', 3)];

    const found = (query: string) =>
      titles(fallback.arrangeItems(items, { sort: fallback.DEFAULT_ITEM_SORT, query }));
    expect(found('creme')).toEqual(['Crème fraîche']);
    expect(found('café')).toEqual(['Café']);
  });

  it('compares folded names, with runs of digits by value', () => {
    const fallback = loadWith(withoutCollator);
    const items = [
      item('a', 'Item 10', 1),
      item('b', 'item 2', 2),
      item('c', 'Ítem 3', 3),
      item('d', 'Item 02', 4),
      item('e', 'Apple', 5),
      item('f', 'Item 99999999999999999999', 6),
      item('g', 'Item 100000000000000000000', 7),
    ];

    const order = fallback
      .arrangeItems(items, { sort: { ...fallback.DEFAULT_ITEM_SORT, az: 'asc' }, query: '' })
      .map((row) => row.title);
    // `Item 02` equals `item 2` by value, so date decides between them.
    expect(order).toEqual([
      'Apple',
      'item 2',
      'Item 02',
      'Ítem 3',
      'Item 10',
      'Item 99999999999999999999',
      'Item 100000000000000000000',
    ]);
  });

  it('treats a and Á as equal, so date decides', () => {
    const fallback = loadWith(withoutCollator);
    const items = [item('x', 'Á', 2), item('y', 'a', 1)];

    expect(
      fallback.arrangeItems(items, { sort: { ...fallback.DEFAULT_ITEM_SORT, az: 'asc' }, query: '' }).map((row) => row.id)
    ).toEqual(['y', 'x']);
  });

  /** A collator present but without `numeric` is no better than none. */
  it('rejects a collator that sorts Item 10 before Item 2', () => {
    const fallback = loadWith(() => {
      const original = Intl.Collator;
      (Intl as { Collator: unknown }).Collator = function Plain() {
        return { compare: (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0) };
      };
      return () => {
        (Intl as { Collator: unknown }).Collator = original;
      };
    });
    const items = [item('a', 'Item 10', 1), item('b', 'Item 2', 2)];

    expect(
      fallback.arrangeItems(items, { sort: { ...fallback.DEFAULT_ITEM_SORT, az: 'asc' }, query: '' }).map((row) => row.title)
    ).toEqual(['Item 2', 'Item 10']);
  });
});
