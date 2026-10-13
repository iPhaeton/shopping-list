import { defineConfig } from '@lingui/cli';
import { formatter } from '@lingui/format-po';

import { LOCALES, PSEUDO_LOCALE } from './src/i18n/locales';

/**
 * Catalogs are extracted to PO, then compiled to TypeScript (`npm run i18n:compile`) and committed,
 * so what ships is reviewable and Jest needs no `.po` transform. `npm run i18n:check` fails when
 * either step would change a committed file.
 *
 * The English source text identifies each message (Lingui hashes it, with `context` if any), so an
 * edited English sentence becomes a new, untranslated message in every other catalog. Until a
 * catalog has a translation, compiling fills it from `en`.
 */
export default defineConfig({
  sourceLocale: 'en',
  locales: [...LOCALES, PSEUDO_LOCALE],
  fallbackLocales: { default: 'en' },
  // English, accented and 40% longer — padded on both sides with a visible dot and bracketed, so a
  // label that clips or wraps shows it, and so does any text that never went through a catalog.
  pseudoLocale: { locale: PSEUDO_LOCALE, extend: 0.4, extendCharacter: '·', prepend: '[', append: ']' },
  catalogs: [
    {
      path: '<rootDir>/src/locales/{locale}/messages',
      include: ['<rootDir>/src', '<rootDir>/App.tsx'],
      exclude: ['<rootDir>/src/locales/**', '**/*.test.ts', '**/*.test.tsx'],
    },
  ],
  // Origins without line numbers, and messages in English alphabetical order: a diff of a catalog
  // shows only messages that came, went or changed, never ones that moved down a file.
  format: formatter({ lineNumbers: false }),
  orderBy: 'message',
});
