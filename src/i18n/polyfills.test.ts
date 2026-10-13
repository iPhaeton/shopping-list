import './polyfills';

import { LOCALES } from './locales';

/**
 * Node has a complete `Intl.PluralRules` of its own; `polyfill-force` replaces it here exactly as it
 * does on the phone, so this checks the data the app bundles, not Node's.
 */
it('replaced the engine’s PluralRules with the polyfill', () => {
  expect('__addLocaleData' in Intl.PluralRules).toBe(true);
});

it.each(LOCALES)('has plural data for %s', (locale) => {
  expect(Intl.PluralRules.supportedLocalesOf([locale])).toEqual([locale]);
});

it.each([
  ['pl', 5, 'many'],
  ['pt-PT', 0, 'other'],
  ['sl', 2, 'two'],
  ['sr-Latn', 3, 'few'],
  ['sr-Cyrl', 3, 'few'],
  ['nb', 1, 'one'],
])('%s puts %d in %s', (locale, n, category) => {
  expect(new Intl.PluralRules(locale).select(n)).toBe(category);
});

it('falls back to English for the pseudo-locale', () => {
  expect(new Intl.PluralRules('pseudo').resolvedOptions().locale).toBe('en');
});
