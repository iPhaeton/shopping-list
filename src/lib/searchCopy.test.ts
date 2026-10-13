import { coverageLine, noMatchesHint, noMatchesTitle, searchSummary } from './searchCopy';

/**
 * Every sentence these build, in English, exactly as task 24 signed it off: each shape is a whole
 * catalog message now, so this pins each one to the text it replaced (D5).
 */
describe('coverageLine', () => {
  it.each([
    ['running', true, 250, 1234, 'Searching 250 of 1,234 lists · loading the rest…'],
    ['running', false, 250, 1234, 'Sorting 250 of 1,234 lists · loading the rest…'],
    ['failed', true, 1234, 5000, 'Searched 1,234 of 5,000 lists. The rest need a connection.'],
    ['failed', false, 1234, 5000, 'Sorted 1,234 of 5,000 lists. The rest need a connection.'],
    ['running', true, 1, undefined, 'Searching 1 loaded lists · loading the rest…'],
    ['running', false, 1234, undefined, 'Sorting 1,234 loaded lists · loading the rest…'],
    ['failed', true, 250, undefined, 'Searched the 250 loaded lists. The rest need a connection.'],
    ['failed', false, 1, undefined, 'Sorted the 1 loaded lists. The rest need a connection.'],
    // A total no bigger than what is held says nothing about it.
    ['running', true, 250, 250, 'Searching 250 loaded lists · loading the rest…'],
    ['capped', true, 2000, 5000, 'Searched the first 2,000 lists.'],
    ['capped', false, 2000, undefined, 'Sorted the first 2,000 lists.'],
  ] as const)('lists, %s, searching %s, %d held of %s', (status, searching, held, total, sentence) => {
    expect(coverageLine({ rows: 'lists', status, searching, held, total })).toBe(sentence);
  });

  it.each([
    ['running', true, 100, 'Searching 100 loaded items · loading the rest…'],
    ['running', false, 1, 'Sorting 1 loaded items · loading the rest…'],
    ['failed', true, 1234, 'Searched the 1,234 loaded items. The rest need a connection.'],
    ['failed', false, 100, 'Sorted the 100 loaded items. The rest need a connection.'],
    ['capped', true, 2000, 'Searched the first 2,000 items.'],
    ['capped', false, 2000, 'Sorted the first 2,000 items.'],
  ] as const)('items, %s, searching %s, %d held', (status, searching, held, sentence) => {
    expect(coverageLine({ rows: 'items', status, searching, held })).toBe(sentence);
  });
});

describe('noMatchesTitle', () => {
  it('quotes the trimmed query over complete data', () => {
    expect(noMatchesTitle({ query: '  mi ', rows: 'lists', partial: false, held: 3 })).toBe('No matches for "mi"');
  });

  it('says how much was searched over partial data', () => {
    expect(noMatchesTitle({ query: 'mi', rows: 'lists', partial: true, held: 1234 })).toBe(
      'No matches in the 1,234 loaded lists'
    );
    expect(noMatchesTitle({ query: 'mi', rows: 'items', partial: true, held: 1 })).toBe(
      'No matches in the 1 loaded items'
    );
  });

  it('has its hint', () => {
    expect(noMatchesHint()).toBe('Check the spelling, or try fewer letters.');
  });
});

describe('searchSummary', () => {
  it('reads the query and every sort key in priority order', () => {
    expect(searchSummary(' mi ', { todo: 'first', az: 'asc', date: 'asc' })).toBe(
      'Searching mi, to do first, then A to Z, oldest first'
    );
    expect(searchSummary('', { todo: 'last', az: 'desc', date: 'desc' })).toBe(
      'to do last, then Z to A, newest first'
    );
    expect(searchSummary('', { az: 'asc', date: 'asc' })).toBe('A to Z, oldest first');
  });

  it('says nothing about the default sort, or with nothing at all', () => {
    expect(searchSummary('mi', { az: null, date: 'asc' })).toBe('Searching mi');
    expect(searchSummary('  ', { az: null, date: 'asc' })).toBeUndefined();
  });
});
