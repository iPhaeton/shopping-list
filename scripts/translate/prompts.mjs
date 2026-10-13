/**
 * What `translate.mjs` sends, built from the catalogs and the glossary alone. Every builder is pure:
 * the system text of a kind of request is byte-identical for every locale, so the first request
 * writes it to the prompt cache and the other eighteen read it. Anything that varies — the locale,
 * the IDs, notes — goes in the user turn, after the cached prefix.
 */

/**
 * The 19 catalogs the model writes, in `LOCALES` order: every catalog but the English source and
 * `sr-Latn`, which is transliterated from `sr-Cyrl`. Read from `src/i18n/locales.ts`'s text, since
 * a Node script cannot import TypeScript.
 */
export function targetLocales(localesSource) {
  const list = /export const LOCALES = \[([\s\S]*?)\] as const;/.exec(localesSource);
  if (!list) throw new Error('LOCALES not found in src/i18n/locales.ts');
  return [...list[1].matchAll(/'([^']+)'/g)].map(([, tag]) => tag).filter((tag) => tag !== 'en' && tag !== 'sr-Latn');
}

/** Each target as the model is told it: the language, and the variant where there is a choice. */
export const LANGUAGES = {
  de: 'German',
  fr: 'French',
  es: 'Spanish, as written in Spain',
  it: 'Italian',
  'pt-PT': 'European Portuguese, as written in Portugal (not Brazilian Portuguese)',
  sv: 'Swedish',
  nb: 'Norwegian Bokmål',
  fi: 'Finnish',
  pl: 'Polish',
  cs: 'Czech',
  sk: 'Slovak',
  sl: 'Slovenian',
  hr: 'Croatian',
  hu: 'Hungarian',
  'sr-Cyrl': 'Serbian, in Cyrillic script (ekavian, as standard in Serbia)',
  be: 'Belarusian',
  ru: 'Russian',
  uk: 'Ukrainian',
  bg: 'Bulgarian',
};

/** The glossary's fixed terms (D8), each with the sense this app uses it in. */
export const TERMS = [
  ['list', 'a named shopping list (noun)'],
  ['item', 'one thing on a list, to buy (noun)'],
  ['bin', 'where deleted lists and items wait; "Show deleted" opens it, and they can be restored from it (noun)'],
  ['owner', 'a member role: can share, rename and delete the list (noun)'],
  ['writer', 'a member role: can add and change items (noun)'],
  ['reader', 'a member role: can only see the list (noun)'],
  ['invitation', 'an offer to join someone else\'s list, accepted or declined (noun)'],
  ['notification', 'an entry on the Notifications screen (noun)'],
  ['block', 'to stop receiving invitations from a person (verb); "Blocked people" lists them'],
  ['Day', 'the light theme, an option of the Appearance picker'],
  ['Night', 'the dark theme, an option of the Appearance picker'],
  ['Auto', 'the theme that switches between Day and Night at sunrise and sunset, an option of the Appearance picker'],
  ['sign in', 'to sign in to the app (verb), and the Sign in screen'],
  ['code', 'the six-digit sign-in code sent by email (noun)'],
];

/** The English catalog as context: every message, with what a translator is told about it. */
export function catalogText(entries) {
  return entries
    .map((entry) => {
      const lines = [`id: ${entry.id}`];
      if (entry.context) lines.push(`context: ${entry.context}`);
      for (const comment of new Set(entry.comments)) lines.push(`note: ${comment}`);
      if (entry.references.length) lines.push(`where: ${[...new Set(entry.references)].join(', ')}`);
      lines.push(`english: ${JSON.stringify(entry.source)}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

const APP = `The app is ShoppingLoop, an iPhone app for shared shopping lists: a person signs in with a code sent by email, makes named lists, adds items, shares a list with other people as owner, writer or reader, and answers invitations to other people's lists.`;

const TRANSLATION_RULES = `You translate ShoppingLoop's user interface from English. ${APP}

The English catalog below lists every message: its id, any context, the notes written for translators, the source files it appears in, and the English as a JSON string. Each request names a language and the ids to translate. Translate only those, using the whole catalog as context: other messages show where a message sits and which words the app already uses for things.

Rules:
- Write as iOS itself writes in that language: short, plain interface language, the register and conventions of Apple's own apps, with the form of address the glossary records for the language. Use the glossary's terms for its fixed terms, every time.
- Names, list names and email addresses are inserted as typed, in the nominative, so never inflect a placeholder or build a sentence that needs it in another case. The app does not know anyone's gender: never use a gendered past tense or adjective for a person a message is about. Use a present tense, a passive, or a label form instead (e.g. "Invitation from {name}" rather than a verb in the past tense).
- The messages are ICU MessageFormat. Keep every placeholder ({name}, {list}, {count}, ...) and every tag (<0>...</0>) exactly as written, with the same names. Never translate the ICU keywords (plural, select, one, few, many, other, #). Keep the syntax valid.
- A plural must carry every plural category your language needs, even where the English has only "other": one, few, many and other as your language requires, and Slovenian's two. # stands for the number, already formatted for the language.
- In ICU an ASCII apostrophe (') next to a brace or # starts a quoted literal and can swallow a placeholder. Write the typographic apostrophe (’) instead wherever your language uses one.
- Never translate ShoppingLoop or support@shopping-loop.com.
- Some notes say a control fits about N characters. Stay within it, using the short form iOS uses in that language for such a control.
- Some English is the server's own words, lowercase with no full stop; the note says so. Write a natural sentence, capitalised and punctuated as your language's interface would be.
- Use the language's own punctuation and quotation marks.
- Return only the translations, one for each id asked for, in the JSON format required.`;

const GLOSSARY_RULES = `You prepare a translation glossary for ShoppingLoop's user interface. ${APP}

The English catalog below lists every message the app shows, with notes for translators. For the language a request names, record:
- address: the form of address iOS itself uses for the person in that language (for example "informal du" or "formal Sie"), in a few words, in English;
- example: one sentence from this app's interface, translated into the language in that form of address;
- terms: the translation of each fixed term, in the sense given, as an iOS-style interface in that language would word it.

Fixed terms:
${TERMS.map(([term, sense]) => `- ${term}: ${sense}`).join('\n')}`;

/** The cached system text of a translation request: the rules, the glossary, the English catalog. */
export function translationSystem(entries, glossary) {
  return `${TRANSLATION_RULES}

# Glossary
${JSON.stringify(glossary, null, 2)}

# The English catalog
${catalogText(entries)}`;
}

/** The cached system text of a glossary request: no glossary yet, the rules and the catalog. */
export function glossarySystem(entries) {
  return `${GLOSSARY_RULES}

# The English catalog
${catalogText(entries)}`;
}

/** The variable half of a translation request. */
export function translationRequest(locale, glossaryEntry, ids, notes = new Map()) {
  const lines = [
    `Language: ${LANGUAGES[locale]} (${locale}).`,
    `Form of address: ${glossaryEntry.address}. For example: ${glossaryEntry.example}`,
    '',
    `Translate these ${ids.length} messages, by id:`,
    ...ids,
  ];
  const noted = ids.filter((id) => notes.has(id));
  if (noted.length) {
    lines.push('', 'Notes on some of them:', ...noted.map((id) => `- ${id}: ${notes.get(id)}`));
  }
  return lines.join('\n');
}

/** The follow-up for translations the validator rejected: each with its text and the complaint. */
export function retryRequest(locale, glossaryEntry, rejected) {
  return [
    `Language: ${LANGUAGES[locale]} (${locale}).`,
    `Form of address: ${glossaryEntry.address}. For example: ${glossaryEntry.example}`,
    '',
    `These ${rejected.length} translations were rejected by the validator. Translate each again, fixing what it found:`,
    ...rejected.flatMap(({ id, translation, errors }) => [
      '',
      `id: ${id}`,
      `rejected: ${JSON.stringify(translation)}`,
      ...errors.map((error) => `problem: ${error}`),
    ]),
  ].join('\n');
}

/** The variable half of a glossary request. */
export function glossaryRequest(locale) {
  return `Language: ${LANGUAGES[locale]} (${locale}).`;
}

const BACK_RULES = `You translate the user interface of ShoppingLoop back into English. ${APP}

Each request gives messages in one language, by id. Translate each into English as literally as reads naturally, so its meaning can be checked: keep what it says, add nothing, and do not improve it. The messages are ICU MessageFormat: keep placeholders ({name}) and tags (<0>) as they are, keep the plural and select structure, and translate the text of every case.`;

const COMPARE_RULES = `You check translations of ShoppingLoop's user interface. ${APP}

The English catalog below lists every message with its id and the notes its translators were given. Each request gives, for one language, messages by id: the translation, and an English back-translation made without seeing the original. Compare each back-translation with the original English and flag only a change of meaning: something added, lost or different — another action, role, number, person or state, a statement where the English asks, a different tone toward the reader — or a gendered past tense or adjective for a person a message is about (the app does not know anyone's gender). Do not flag synonyms, word order, a sentence capitalised and punctuated where the English is lowercase server text, or ambiguity that comes only from the back-translation. Give each flag a one-sentence reason. Return no entry for a message that is fine.`;

export function backSystem() {
  return BACK_RULES;
}

export function compareSystem(entries) {
  return `${COMPARE_RULES}

# The English catalog
${catalogText(entries)}`;
}

export function backRequest(locale, items) {
  return [`Language: ${LANGUAGES[locale]} (${locale}).`, '', JSON.stringify(items.map(({ id, translation }) => ({ id, translation })), null, 1)].join('\n');
}

export function compareRequest(locale, items) {
  return [`Language: ${LANGUAGES[locale]} (${locale}).`, '', JSON.stringify(items.map(({ id, translation, back }) => ({ id, translation, back })), null, 1)].join('\n');
}

const object = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const list = (items) => ({ type: 'array', items });

/** The structured outputs. Fixed, never built per request: the format is part of what is cached. */
export const SCHEMAS = {
  translations: object({ translations: list(object({ id: { type: 'string' }, translation: { type: 'string' } })) }),
  glossary: object({
    address: { type: 'string' },
    example: { type: 'string' },
    terms: list(object({ term: { type: 'string', enum: TERMS.map(([term]) => term) }, translation: { type: 'string' } })),
  }),
  back: object({ back: list(object({ id: { type: 'string' }, english: { type: 'string' } })) }),
  flags: object({ flags: list(object({ id: { type: 'string' }, reason: { type: 'string' } })) }),
};
