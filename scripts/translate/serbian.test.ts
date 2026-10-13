import { toLatin, transliterate } from './serbian.mjs';

/** D12's table, as step 4's description gives it. */
const TABLE = `
  А A   Б B   В V   Г G   Д D   Ђ Đ   Е E   Ж Ž   З Z   И I
  Ј J   К K   Л L   Љ Lj  М M   Н N   Њ Nj  О O   П P   Р R
  С S   Т T   Ћ Ć   У U   Ф F   Х H   Ц C   Ч Č   Џ Dž  Ш Š
`;
const PAIRS = [...TABLE.matchAll(/(\S)\s+(\S+)/g)].map(([, cyrillic, latin]) => [cyrillic, latin]);

describe('transliterate', () => {
  it('maps all thirty letters, capital and small', () => {
    expect(PAIRS).toHaveLength(30);
    for (const [cyrillic, latin] of PAIRS) {
      expect(transliterate(cyrillic)).toBe(latin);
      expect(transliterate(cyrillic.toLowerCase())).toBe(latin.toLowerCase());
    }
  });

  it('writes a digraph capital as two capitals inside an all-capitals word, and as one otherwise', () => {
    expect(transliterate('ЉУБАВ ЊЕГОШ ЏАК')).toBe('LJUBAV NJEGOŠ DŽAK');
    expect(transliterate('Љубав Његош Џак')).toBe('Ljubav Njegoš Džak');
    expect(transliterate('љубав његош џак')).toBe('ljubav njegoš džak');
    expect(transliterate('КОЊ Коњ')).toBe('KONJ Konj');
    expect(transliterate('Џ.')).toBe('Dž.');
  });

  it('leaves everything that is not Cyrillic alone', () => {
    expect(transliterate('ShoppingLoop, support@shopping-loop.com — 1.000 · “ok”')).toBe(
      'ShoppingLoop, support@shopping-loop.com — 1.000 · “ok”'
    );
  });
});

describe('toLatin', () => {
  it('converts the text of a plural with a tag and a placeholder, and keeps its syntax byte for byte', () => {
    const cyrillic =
      '{count, plural, one {<0>{name}</0> има # листу} few {<0>{name}</0> има # листе} other {<0>{name}</0> има # листа}}';
    expect(toLatin(cyrillic)).toBe(
      '{count, plural, one {<0>{name}</0> ima # listu} few {<0>{name}</0> ima # liste} other {<0>{name}</0> ima # lista}}'
    );
  });

  it('converts text around quoted ICU and a select', () => {
    expect(toLatin("Ђак '{'ћао'}' {role, select, owner {Власник} other {Читалац}}")).toBe(
      "Đak '{'ćao'}' {role, select, owner {Vlasnik} other {Čitalac}}"
    );
  });
});
