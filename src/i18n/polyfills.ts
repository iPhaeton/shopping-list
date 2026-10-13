/**
 * Hermes ships `Intl.NumberFormat`, `DateTimeFormat` and `Collator`, but no `Intl.PluralRules`,
 * and Lingui picks every plural form through it — without it, every message with a number throws.
 *
 * Imported first in the root `index.ts`, before anything that formats a message. `polyfill-force`
 * rather than `polyfill`: the conditional entry runs a feature test on every launch, the forced one
 * just installs, as Lingui's React Native guide advises — and it behaves the same on web, where the
 * browser's own would have done.
 *
 * Plural data for every catalog in `locales.ts`. `en` comes first because the polyfill falls back to
 * the first locale it was given, which is what the dev-only `pseudo` catalog resolves to. `pt-PT`
 * needs its own file — Portugal's `one` excludes 0, Brazil's `pt` includes it. Serbian has one file
 * for both scripts: `sr-Latn` and `sr-Cyrl` resolve to `sr`. Norwegian's file is `nb`.
 *
 * The `.js` suffixes are required: the packages' `exports` map them literally.
 */
import '@formatjs/intl-locale/polyfill-force.js';
import '@formatjs/intl-pluralrules/polyfill-force.js';

import '@formatjs/intl-pluralrules/locale-data/en.js';
import '@formatjs/intl-pluralrules/locale-data/de.js';
import '@formatjs/intl-pluralrules/locale-data/fr.js';
import '@formatjs/intl-pluralrules/locale-data/es.js';
import '@formatjs/intl-pluralrules/locale-data/it.js';
import '@formatjs/intl-pluralrules/locale-data/pt-PT.js';
import '@formatjs/intl-pluralrules/locale-data/sv.js';
import '@formatjs/intl-pluralrules/locale-data/nb.js';
import '@formatjs/intl-pluralrules/locale-data/fi.js';
import '@formatjs/intl-pluralrules/locale-data/pl.js';
import '@formatjs/intl-pluralrules/locale-data/cs.js';
import '@formatjs/intl-pluralrules/locale-data/sk.js';
import '@formatjs/intl-pluralrules/locale-data/sl.js';
import '@formatjs/intl-pluralrules/locale-data/hr.js';
import '@formatjs/intl-pluralrules/locale-data/hu.js';
import '@formatjs/intl-pluralrules/locale-data/sr.js';
import '@formatjs/intl-pluralrules/locale-data/be.js';
import '@formatjs/intl-pluralrules/locale-data/ru.js';
import '@formatjs/intl-pluralrules/locale-data/uk.js';
import '@formatjs/intl-pluralrules/locale-data/bg.js';
