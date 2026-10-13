import { i18n } from '@lingui/core';
import { compileMessage } from '@lingui/message-utils/compileMessage';
import { generateMessageId } from '@lingui/message-utils/generateMessageId';

import { ago } from './ago';

/**
 * `ago`'s messages are plurals on the count, so a language with more forms than English picks the
 * right one. Polish has four — 1 is `one`, 2–4 and 22–24 `few`, 5–21 `many` — and has no
 * translation yet (step 4), so this loads one by hand, keyed by the English source message as the
 * catalog is. Its `en` boundaries are `ago.test.ts`'s.
 */
const POLISH: Record<string, string> = {
  '{minutes, plural, other {# min ago}}':
    '{minutes, plural, one {# minutę temu} few {# minuty temu} many {# minut temu} other {# minuty temu}}',
  '{days, plural, other {# d ago}}':
    '{days, plural, one {# dzień temu} few {# dni temu} many {# dni temu} other {# dnia temu}}',
};

const NOW = Date.parse('2026-10-13T12:00:00Z');
const before = (ms: number) => new Date(NOW - ms).toISOString();

beforeAll(() => {
  i18n.load(
    'pl',
    Object.fromEntries(Object.entries(POLISH).map(([en, pl]) => [generateMessageId(en), compileMessage(pl)]))
  );
  i18n.activate('pl');
});

afterAll(() => {
  i18n.activate('en');
});

it.each([
  [1, '1 minutę temu'],
  [2, '2 minuty temu'],
  [5, '5 minut temu'],
  [22, '22 minuty temu'],
])('%d minutes in Polish', (minutes, text) => {
  expect(ago(before(minutes * 60_000), NOW)).toBe(text);
});

it.each([
  [1, '1 dzień temu'],
  [2, '2 dni temu'],
  [5, '5 dni temu'],
  [22, '22 dni temu'],
])('%d days in Polish', (days, text) => {
  expect(ago(before(days * 86_400_000), NOW)).toBe(text);
});
