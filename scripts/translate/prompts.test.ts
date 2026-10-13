import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LOCALES } from '../../src/i18n/locales';
import { readCatalog } from './po.mjs';
import { LANGUAGES, SCHEMAS, TERMS, targetLocales, translationRequest, translationSystem } from './prompts.mjs';

/**
 * The prompt cache matches a prefix byte for byte, so the system text may depend on nothing but the
 * English catalog and the glossary. What varies by locale lives in the user turn.
 */
const ROOT = join(__dirname, '..', '..');
const english = readCatalog(readFileSync(join(ROOT, 'src/locales/en/messages.po'), 'utf8'));
const glossary = {
  de: { address: 'informal du', example: 'Melde dich an.', terms: { list: 'Liste' } },
  pl: { address: 'informal ty', example: 'Zaloguj się.', terms: { list: 'Lista' } },
};

it('translates every catalog but the English and the transliterated Serbian, in LOCALES order', () => {
  const targets = targetLocales(readFileSync(join(ROOT, 'src/i18n/locales.ts'), 'utf8'));
  expect(targets).toEqual(LOCALES.filter((locale) => locale !== 'en' && locale !== 'sr-Latn'));
  expect(Object.keys(LANGUAGES)).toEqual(targets);
});

it('builds one system text for every locale, holding the whole English catalog', () => {
  const system = translationSystem(english, glossary);
  expect(translationSystem(english, glossary)).toBe(system);
  for (const { id } of english) expect(system).toContain(`id: ${id}\n`);
  expect(system).not.toMatch(/\b(German|Polish)\b/);
});

it('puts the locale, its tone and the IDs in the user turn', () => {
  const ids = [english[0].id, english[1].id];
  const user = translationRequest('pl', glossary.pl, ids, new Map([[ids[1], 'Keep it short.']]));
  expect(user).toContain('Language: Polish (pl).');
  expect(user).toContain('Form of address: informal ty. For example: Zaloguj się.');
  expect(user).toContain(`${ids[0]}\n${ids[1]}`);
  expect(user).toContain(`- ${ids[1]}: Keep it short.`);
});

it('asks for the glossary terms D8 names, under a fixed schema', () => {
  expect(TERMS.map(([term]) => term)).toEqual([
    'list', 'item', 'bin', 'owner', 'writer', 'reader', 'invitation', 'notification', 'block',
    'Day', 'Night', 'Auto', 'sign in', 'code',
  ]);
  expect(JSON.stringify(SCHEMAS.translations)).toBe(
    '{"type":"object","properties":{"translations":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string"},"translation":{"type":"string"}},"required":["id","translation"],"additionalProperties":false}}},"required":["translations"],"additionalProperties":false}'
  );
});
