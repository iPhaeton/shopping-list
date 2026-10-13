import { lengthHint, pluralCategories, validate } from './icu.mjs';

/**
 * The three rejections send a translation back to the model; the two flags only report it. Lingui's
 * runtime shows a message's raw source when it cannot parse it, so a rejection is what keeps ICU
 * syntax off the screen.
 */
const check = (locale: string, source: string, translation: string, comments: string[] = []) =>
  validate({ locale, source, translation, comments });

describe('rejects', () => {
  it('a message that does not parse as ICU MessageFormat', () => {
    const { errors } = check('de', 'Hi {name}', 'Hallo {name');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^It does not parse as ICU MessageFormat/);
  });

  it('a placeholder lost, renamed or added', () => {
    expect(check('de', 'Hi {name}', 'Hallo').errors).toEqual(['Placeholders missing: {name}.']);
    expect(check('de', 'Hi {name}', 'Hallo {Name}').errors).toEqual([
      'Placeholders missing: {name}.',
      'Placeholders not in the English: {Name}.',
    ]);
    expect(check('de', '{name} left', '{name} hat {list} verlassen').errors).toEqual(['Placeholders not in the English: {list}.']);
  });

  it('a tag lost or renumbered', () => {
    expect(check('de', 'Tap <0>Undo</0>', 'Tippe auf Rückgängig').errors).toEqual([
      'Tags differ from the English: expected </0> <0>, found none.',
    ]);
    expect(check('de', 'Tap <0>Undo</0>', 'Tippe auf <1>Rückgängig</1>').errors).toHaveLength(1);
  });

  it('a plural without every category the language needs', () => {
    const source = '{count, plural, other {# items}}';
    expect(check('pl', source, '{count, plural, one {# element} other {# elementów}}').errors).toEqual([
      'The plural on {count} lacks few, many: pl needs every one of one, few, many, other.',
    ]);
    expect(check('sl', source, '{count, plural, one {# element} few {# elementi} other {# elementov}}').errors).toEqual([
      'The plural on {count} lacks two: sl needs every one of one, two, few, other.',
    ]);
  });

  it('an English plural translated as plain text', () => {
    expect(check('de', '{count, plural, other {# items}}', '{count} Einträge').errors).toEqual([
      'The English is a plural on {count}: the translation must be one too.',
    ]);
  });
});

describe('accepts', () => {
  it('a plural with every category, exact matches aside', () => {
    const translation = '{count, plural, =0 {Brak} one {# element} few {# elementy} many {# elementów} other {# elementu}}';
    expect(check('pl', '{count, plural, other {# items}}', translation)).toEqual({ errors: [], flags: [] });
  });

  it('placeholders and tags in another order', () => {
    expect(check('de', '<0>{name}</0> invited you to {list}', 'Einladung zu {list} von <0>{name}</0>').errors).toEqual([]);
  });
});

describe('flags', () => {
  it('a message identical to its English, unless the English is only placeholders or the brand', () => {
    expect(check('de', 'Undo', 'Undo').flags).toEqual(['Identical to the English.']);
    expect(check('de', '{name}', '{name}').flags).toEqual([]);
    expect(check('de', 'ShoppingLoop', 'ShoppingLoop').flags).toEqual([]);
  });

  it("a translation over a comment's length hint, counting a plural's longest case", () => {
    const comments = ['Button (verb) beside the field. Fits about 10 characters.'];
    expect(check('de', 'Add', 'Hinzufügen', comments).flags).toEqual([]);
    expect(check('de', 'Add', 'Zur Liste hinzufügen', comments).flags).toEqual(['20 characters, over the comment\'s "about 10".']);
  });
});

it('reads the length hint and the plural categories', () => {
  expect(lengthHint(['Fits about 12 characters, half of a row.'])).toBe(12);
  expect(lengthHint(['Short, small print.'])).toBeNull();
  expect([...pluralCategories('sl')].sort()).toEqual(['few', 'one', 'other', 'two']);
  expect([...pluralCategories('sr-Cyrl')].sort()).toEqual(['few', 'one', 'other']);
});
