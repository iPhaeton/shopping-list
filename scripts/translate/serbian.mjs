/**
 * Serbian in Latin script, made from Serbian in Cyrillic (D12): the model translates `sr-Cyrl` once,
 * and `sr-Latn` is this letter-for-letter transliteration of it, never sent to the model and never
 * edited by hand. Serbian's two scripts map one to one, so nothing is lost.
 *
 * Only a message's text is converted. Placeholders, tags and ICU keywords are found by parsing, and
 * each text run is replaced in place at its offset, so everything else keeps its bytes.
 */

import { parse } from '@messageformat/parser';

const LETTERS = {
  А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Ђ: 'Đ', Е: 'E', Ж: 'Ž', З: 'Z', И: 'I',
  Ј: 'J', К: 'K', Л: 'L', Љ: 'Lj', М: 'M', Н: 'N', Њ: 'Nj', О: 'O', П: 'P', Р: 'R',
  С: 'S', Т: 'T', Ћ: 'Ć', У: 'U', Ф: 'F', Х: 'H', Ц: 'C', Ч: 'Č', Џ: 'Dž', Ш: 'Š',
};
for (const [cyrillic, latin] of Object.entries(LETTERS)) LETTERS[cyrillic.toLowerCase()] = latin.toLowerCase();

/** The digraph capitals, in the form an all-capitals word takes. */
const ALL_CAPS = { Љ: 'LJ', Њ: 'NJ', Џ: 'DŽ' };

const isUpper = (char) => char !== undefined && /\p{Lu}/u.test(char);
const isLetter = (char) => char !== undefined && /\p{L}/u.test(char);

/**
 * Plain text, letter by letter. `Љ`, `Њ` and `Џ` are `LJ`, `NJ` and `DŽ` inside an all-capitals word
 * — the next letter is a capital, or, at a word's end, the one before it was — and `Lj`, `Nj` and
 * `Dž` otherwise.
 */
export function transliterate(text) {
  const chars = [...text];
  return chars
    .map((char, i) => {
      if (char in ALL_CAPS) {
        const next = chars[i + 1];
        const caps = isLetter(next) ? isUpper(next) : isUpper(chars[i - 1]);
        return caps ? ALL_CAPS[char] : LETTERS[char];
      }
      return LETTERS[char] ?? char;
    })
    .join('');
}

/** Every text run of a parsed message, cases included. */
function* textRuns(tokens) {
  for (const token of tokens) {
    if (token.type === 'content') yield token.ctx;
    if (token.cases) for (const { tokens: inner } of token.cases) yield* textRuns(inner);
  }
}

/** An ICU message in Cyrillic, with its text in Latin and its syntax untouched. */
export function toLatin(message) {
  const runs = [...textRuns(parse(message))].sort((a, b) => b.offset - a.offset);
  let latin = message;
  for (const { offset, text } of runs) {
    if (message.slice(offset, offset + text.length) !== text) throw new Error(`Cannot place a text run in: ${message}`);
    latin = latin.slice(0, offset) + transliterate(text) + latin.slice(offset + text.length);
  }
  return latin;
}
