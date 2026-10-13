import appJson from '../../app.json';
import { LOCALES, pickLocale, SUPPORTED_LOCALES } from './locales';

/** A device locale as expo-localization reports it, reduced to the two fields `pickLocale` reads. */
function device(languageCode: string | null, languageScriptCode: string | null = null) {
  return { languageCode, languageScriptCode };
}

describe('pickLocale', () => {
  it.each([
    ['pt-BR', device('pt'), 'pt-PT'],
    ['pt-PT', device('pt'), 'pt-PT'],
    ['no', device('no'), 'nb'],
    ['nb', device('nb'), 'nb'],
    ['nn', device('nn'), 'nb'],
    ['sr with Latn', device('sr', 'Latn'), 'sr-Latn'],
    ['sr with no script', device('sr'), 'sr-Cyrl'],
    ['sr with Cyrl', device('sr', 'Cyrl'), 'sr-Cyrl'],
    ['en-GB', device('en', 'Latn'), 'en'],
    ['es-MX', device('es', 'Latn'), 'es'],
  ])('maps %s', (_tag, locale, expected) => {
    expect(pickLocale([locale])).toBe(expected);
  });

  it('skips a language it has no catalog for and takes the next one', () => {
    expect(pickLocale([device('bs', 'Latn'), device('de', 'Latn')])).toBe('de');
  });

  it('never lends a neighbouring language: Bosnian alone gets English, not Croatian', () => {
    expect(pickLocale([device('bs', 'Latn')])).toBe('en');
  });

  it('falls back to English when nothing maps', () => {
    expect(pickLocale([device('ja', 'Jpan'), device(null)])).toBe('en');
  });

  it('keeps the device order: the first match wins, not the first catalog', () => {
    expect(pickLocale([device('uk', 'Cyrl'), device('ru', 'Cyrl')])).toBe('uk');
  });
});

/**
 * JSON cannot import TypeScript, so `app.json`'s copy of the language list is held to
 * `locales.ts` here.
 */
it("app.json's supportedLocales match locales.ts", () => {
  const plugin = (appJson.expo.plugins as unknown[]).find(
    (entry) => Array.isArray(entry) && entry[0] === 'expo-localization'
  ) as [string, { supportedLocales: { ios: string[]; android: string[] } }] | undefined;

  expect(plugin?.[1].supportedLocales).toEqual({
    ios: [...SUPPORTED_LOCALES.ios],
    android: [...SUPPORTED_LOCALES.android],
  });
  expect(SUPPORTED_LOCALES.android).toEqual(LOCALES);
});
