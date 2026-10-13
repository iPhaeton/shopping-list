/**
 * Checks a translation against its English before it is written. Lingui's runtime compiler swallows
 * a parse error and shows the message's raw source instead, so a malformed translation would reach
 * the screen as ICU syntax: this is the only place that stops one.
 *
 * Rejections (the message goes back to the model once, then stays empty):
 *   1. it does not parse as ICU MessageFormat;
 *   2. its placeholders or tags differ from the English;
 *   3. a plural lacks a category the language needs, or a plural of the English is missing.
 * Flags (written, but listed in the run report):
 *   4. it is identical to the English, which has words to translate;
 *   5. it is longer than a translator comment's "about N characters".
 */

import { parse } from '@messageformat/parser';

const TAG = /<\/?\d+\s*\/?>/g;
const BRANDS = ['ShoppingLoop', 'support@shopping-loop.com'];

/** Every token of a parsed message, cases included, depth first. */
function* walk(tokens) {
  for (const token of tokens) {
    yield token;
    if (token.cases) for (const { tokens: inner } of token.cases) yield* walk(inner);
  }
}

/** The parsed message, or the parser's complaint. */
function tryParse(message) {
  try {
    return { tokens: parse(message) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Argument names, tags (sorted, repeats kept) and plurals of a parsed message. */
function shape(tokens) {
  const args = new Set();
  const tags = [];
  const plurals = [];
  for (const token of walk(tokens)) {
    if (token.type === 'content') tags.push(...(token.value.match(TAG) ?? []).map((tag) => tag.replace(/\s/g, '')));
    if ('arg' in token) args.add(token.arg);
    if (token.type === 'plural' || token.type === 'selectordinal') {
      plurals.push({ arg: token.arg, type: token.type, keys: token.cases.map(({ key }) => key) });
    }
  }
  return { args, tags: tags.sort(), plurals };
}

/** The longest text the message can show, placeholders left out and `#` as one digit. */
function longestText(tokens) {
  let text = '';
  for (const token of tokens) {
    if (token.type === 'content') text += token.value;
    else if (token.type === 'octothorpe') text += '0';
    else if (token.cases) {
      text += token.cases.map(({ tokens: inner }) => longestText(inner)).reduce((a, b) => (b.length > a.length ? b : a), '');
    }
  }
  return text;
}

/** "about 12 characters" in a translator comment, as a number. */
export function lengthHint(comments) {
  for (const comment of comments) {
    const match = /about (\d+) characters/i.exec(comment);
    if (match) return Number(match[1]);
  }
  return null;
}

/** The plural categories `locale` needs, for cardinal or ordinal numbers. */
export function pluralCategories(locale, type = 'plural') {
  const rules = new Intl.PluralRules(locale, { type: type === 'selectordinal' ? 'ordinal' : 'cardinal' });
  return rules.resolvedOptions().pluralCategories;
}

/** Whether the English has anything to translate once placeholders, tags and brands are removed. */
function hasWords(tokens) {
  let text = '';
  for (const token of walk(tokens)) if (token.type === 'content') text += token.value;
  for (const brand of BRANDS) text = text.split(brand).join('');
  return /\p{L}/u.test(text.replace(TAG, ''));
}

/**
 * @param {{ locale: string, source: string, translation: string, comments?: string[] }} message
 * @returns {{ errors: string[], flags: string[] }}
 */
export function validate({ locale, source, translation, comments = [] }) {
  const english = tryParse(source);
  if (english.error) throw new Error(`The English does not parse: ${source}`);
  const translated = tryParse(translation);
  if (translated.error) return { errors: [`It does not parse as ICU MessageFormat: ${translated.error}`], flags: [] };

  const errors = [];
  const want = shape(english.tokens);
  const got = shape(translated.tokens);

  const missing = [...want.args].filter((arg) => !got.args.has(arg));
  const extra = [...got.args].filter((arg) => !want.args.has(arg));
  if (missing.length) errors.push(`Placeholders missing: ${missing.map((arg) => `{${arg}}`).join(', ')}.`);
  if (extra.length) errors.push(`Placeholders not in the English: ${extra.map((arg) => `{${arg}}`).join(', ')}.`);
  if (want.tags.join(' ') !== got.tags.join(' ')) {
    errors.push(`Tags differ from the English: expected ${want.tags.join(' ') || 'none'}, found ${got.tags.join(' ') || 'none'}.`);
  }

  for (const plural of want.plurals) {
    if (!got.plurals.some(({ arg, type }) => arg === plural.arg && type === plural.type)) {
      errors.push(`The English is a ${plural.type} on {${plural.arg}}: the translation must be one too.`);
    }
  }
  for (const plural of got.plurals) {
    const lacking = pluralCategories(locale, plural.type).filter((category) => !plural.keys.includes(category));
    if (lacking.length) {
      errors.push(`The ${plural.type} on {${plural.arg}} lacks ${lacking.join(', ')}: ${locale} needs every one of ${pluralCategories(locale, plural.type).join(', ')}.`);
    }
  }

  const flags = [];
  if (translation === source && hasWords(english.tokens)) flags.push('Identical to the English.');
  const limit = lengthHint(comments);
  const length = [...longestText(translated.tokens)].length;
  if (limit !== null && length > limit) flags.push(`${length} characters, over the comment's "about ${limit}".`);

  return { errors, flags };
}
