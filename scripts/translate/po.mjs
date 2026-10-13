/**
 * Lingui's PO catalogs, read and written line by line. A translation run may change a `msgstr` and
 * nothing else: comments, references, order and the header stay byte for byte, so a catalog's diff
 * shows only what was translated. A PO library would re-serialize the whole file instead.
 *
 * The format is what `@lingui/format-po` writes: entries separated by a blank line, `#.` translator
 * comments, `#:` references, an optional `msgctxt`, then `msgid` and `msgstr`. Strings are never
 * folded (`foldLength: 0`), so a string spans more than one line only where it holds a newline.
 */

import { generateMessageId } from '@lingui/message-utils/generateMessageId';

/**
 * @typedef {{
 *   id: string,
 *   context: string | null,
 *   source: string,
 *   translation: string,
 *   comments: string[],
 *   references: string[],
 *   msgstrLines: [number, number],
 * }} Entry
 *
 * `id` is Lingui's: the key the compiled `messages.ts` uses. `msgstrLines` is the first and last line
 * index of the entry's `msgstr`.
 */

/** Lingui's ID for a message: a hash of its English and its context. */
export function messageId(source, context) {
  return generateMessageId(source, context ?? undefined);
}

const ESCAPES = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\' };

function unquote(line) {
  const quoted = line.slice(line.indexOf('"') + 1, line.lastIndexOf('"'));
  return quoted.replace(/\\(.)/g, (_, c) => ESCAPES[c] ?? c);
}

function quote(text) {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\t/g, '\\t').replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`;
}

/**
 * The `msgstr` lines for `text`, as `pofile-ts` writes them: one line, or, for a string holding
 * newlines, one line per segment, each but the last ending in its `\n`.
 */
export function msgstrLines(text) {
  const segments = text.split('\n').map((segment, i, all) => (i < all.length - 1 ? `${segment}\n` : segment));
  return segments.map((segment, i) => (i === 0 ? `msgstr ${quote(segment)}` : quote(segment)));
}

/** Every entry but the header, in file order. */
export function readCatalog(text) {
  const lines = text.split('\n');
  /** @type {Entry[]} */
  const entries = [];
  let entry = null;
  let field = null;

  const finish = () => {
    if (entry && entry.source !== '') {
      entries.push({ ...entry, id: messageId(entry.source, entry.context) });
    }
    entry = null;
    field = null;
  };

  lines.forEach((line, index) => {
    if (line.trim() === '') {
      finish();
      return;
    }
    entry ??= { context: null, source: '', translation: '', comments: [], references: [], msgstrLines: [-1, -1] };
    if (line.startsWith('#.')) {
      entry.comments.push(line.slice(2).trim());
    } else if (line.startsWith('#:')) {
      entry.references.push(...line.slice(2).trim().split(/\s+/));
    } else if (line.startsWith('#')) {
      // Flags and other comments: kept in the file, not needed here.
    } else if (line.startsWith('msgctxt ')) {
      field = 'context';
      entry.context = unquote(line);
    } else if (line.startsWith('msgid ')) {
      field = 'source';
      entry.source = unquote(line);
    } else if (line.startsWith('msgstr ')) {
      field = 'translation';
      entry.translation = unquote(line);
      entry.msgstrLines = [index, index];
    } else if (line.startsWith('"') && field) {
      entry[field] += unquote(line);
      if (field === 'translation') entry.msgstrLines[1] = index;
    } else {
      throw new Error(`Unreadable PO line ${index + 1}: ${line}`);
    }
  });
  finish();
  return entries;
}

/**
 * `text` with the `msgstr` of each entry named in `translations` (by ID) replaced, and every other
 * byte as it was.
 *
 * @param {string} text
 * @param {Map<string, string>} translations
 */
export function writeTranslations(text, translations) {
  const lines = text.split('\n');
  const entries = readCatalog(text)
    .filter((entry) => translations.has(entry.id))
    .sort((a, b) => b.msgstrLines[0] - a.msgstrLines[0]);
  for (const entry of entries) {
    const [first, last] = entry.msgstrLines;
    lines.splice(first, last - first + 1, ...msgstrLines(translations.get(entry.id)));
  }
  return lines.join('\n');
}
