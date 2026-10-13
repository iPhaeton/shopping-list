import type { Locale } from 'expo-localization';

/**
 * The catalogs the app ships — one per language, two for Serbian (Cyrillic is translated, Latin is
 * transliterated from it). `en` is the source every other catalog translates. This list is the one
 * source of truth: `lingui.config.ts` reads it, `index.ts` types its catalog map with it, and a test
 * holds `app.json`'s `supportedLocales` to it.
 *
 * Pure on purpose — no React Native import — because the Lingui CLI loads this file through
 * `lingui.config.ts` in plain Node.
 */
export const LOCALES = [
  'en',
  'de',
  'fr',
  'es',
  'it',
  'pt-PT',
  'sv',
  'nb',
  'fi',
  'pl',
  'cs',
  'sk',
  'sl',
  'hr',
  'hu',
  'sr-Cyrl',
  'sr-Latn',
  'be',
  'ru',
  'uk',
  'bg',
] as const;

export type AppLocale = (typeof LOCALES)[number];

/** English run through Lingui's pseudolocalization, for spotting untranslated and clipped text.
 * Compiled like any catalog, but loaded only in a dev build and never chosen by `pickLocale`. */
export const PSEUDO_LOCALE = 'pseudo';

/**
 * What `app.json`'s expo-localization plugin must list per platform, which is what puts the app's
 * languages in the system's per-app Language setting. iOS writes them to `CFBundleLocalizations`;
 * Android to `locales_config.xml`. They are D1's tags unless a platform knows a catalog by another.
 */
export const SUPPORTED_LOCALES: { ios: readonly string[]; android: readonly string[] } = {
  ios: LOCALES,
  android: LOCALES,
};

const SUPPORTED: ReadonlySet<string> = new Set(LOCALES);

/**
 * The catalog for the device's languages, in the order the person ranked them: the first that maps
 * to a catalog wins, and with none, English. There is no cross-language fallback — Bosnian does not
 * get Croatian — because a near neighbour read as a mistake is worse than plain English.
 *
 * Portuguese is Portugal's whichever Portuguese the device asks for. Norwegian arrives as `no`,
 * `nb` or `nn`, and Bokmål serves all three. Serbian is Latin only when the device says so; plain
 * `sr` is Cyrillic, as it is in Serbia's own standard.
 */
export function pickLocale(
  locales: readonly Pick<Locale, 'languageCode' | 'languageScriptCode'>[]
): AppLocale {
  for (const { languageCode, languageScriptCode } of locales) {
    const code = languageCode?.toLowerCase();
    if (!code) continue;

    if (code === 'pt') return 'pt-PT';
    if (code === 'no' || code === 'nb' || code === 'nn') return 'nb';
    if (code === 'sr') return languageScriptCode === 'Latn' ? 'sr-Latn' : 'sr-Cyrl';
    if (SUPPORTED.has(code)) return code as AppLocale;
  }
  return 'en';
}
