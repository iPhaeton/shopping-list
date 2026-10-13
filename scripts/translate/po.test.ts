import { formatter } from '@lingui/format-po';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { messages as englishMessages } from '../../src/locales/en/messages';
import { readCatalog, writeTranslations } from './po.mjs';

/**
 * A translation run writes `msgstr` and nothing else (step 4's round trip). The reference for how a
 * `msgstr` is written is Lingui's own PO formatter, configured as `lingui.config.ts` configures it:
 * what this writer produces must be what `lingui extract` would write back, or `npm run i18n:check`
 * would fail after every run.
 */
const LOCALES_DIR = join(__dirname, '..', '..', 'src', 'locales');
const po = (locale: string) => readFileSync(join(LOCALES_DIR, locale, 'messages.po'), 'utf8');
const lingui = formatter({ lineNumbers: false });

const english = readCatalog(po('en'));
const german = po('de');

describe('readCatalog', () => {
  it('reads every message under the ID the compiled catalog uses', () => {
    expect(english.map(({ id }) => id).sort()).toEqual(Object.keys(englishMessages).sort());
  });

  it('reads contexts, translator comments and references', () => {
    expect(english.filter(({ context }) => context !== null)).toHaveLength(5);
    const separator = english.find(({ source }) => source === ', ');
    expect(separator?.comments[0]).toMatch(/^VoiceOver only/);
    expect(separator?.references).toEqual(['src/i18n/spokenList.ts']);
  });
});

describe('writeTranslations', () => {
  it('leaves a catalog byte for byte when there is nothing to write', () => {
    expect(writeTranslations(german, new Map())).toBe(german);
  });

  it('changes only the msgstr lines of the messages it was given', () => {
    const chosen = [english[0], english[100], english[200]];
    const written = writeTranslations(german, new Map(chosen.map(({ id }, i) => [id, `Übersetzung ${i}`])));

    const before = german.split('\n');
    const after = written.split('\n');
    expect(after).toHaveLength(before.length);
    const changed = after.flatMap((line, i) => (line === before[i] ? [] : [i]));
    const msgstrs = readCatalog(german)
      .filter(({ id }) => chosen.some((entry) => entry.id === id))
      .map(({ msgstrLines: [first] }) => first);
    expect(changed).toEqual(msgstrs.sort((a, b) => a - b));
    expect(changed.map((i) => after[i])).toEqual(['msgstr "Übersetzung 0"', 'msgstr "Übersetzung 1"', 'msgstr "Übersetzung 2"']);
  });

  it("writes what Lingui's formatter writes, escapes and line breaks included", async () => {
    const translations = new Map([
      [english[0].id, 'Zwei\nZeilen, die zweite endet mit\n'],
      [english[1].id, 'Anführungszeichen "so", ein Backslash \\ und ein\tTab'],
      [english[2].id, '{count, plural, one {# Eintrag} other {# Einträge}}'],
      [english[3].id, 'Кириллица и ’апостроф’'],
    ]);
    const catalog = await lingui.parse(german, { locale: 'de', sourceLocale: 'en', filename: 'messages.po' });
    for (const [id, translation] of translations) catalog[id].translation = translation;
    const expected = await lingui.serialize(catalog, { locale: 'de', sourceLocale: 'en', existing: german, filename: 'messages.po' });

    expect(writeTranslations(german, translations)).toBe(expected);
    expect(readCatalog(expected).filter(({ id }) => translations.has(id)).map(({ id, translation }) => [id, translation])).toEqual([
      ...translations,
    ]);
  });
});
