#!/usr/bin/env node
/**
 * Translates the catalogs (D12): sends every message a catalog is missing to the Claude API, checks
 * what comes back, and writes it into that catalog's `msgstr`. Only what is missing is ever sent — an
 * empty `msgstr`, which is how `lingui extract` leaves a new or changed English message — so every run
 * after the first costs only the messages changed since. `sr-Latn` is never sent: it is regenerated
 * from `sr-Cyrl` on every run, so it must never be edited by hand.
 *
 *   node scripts/translate.mjs --dry-run        what a run would send, and its price; spends nothing
 *   node scripts/translate.mjs --glossary-only  writes the missing glossary entries, then stops
 *   node scripts/translate.mjs                  glossary entries still missing, then translations
 *   node scripts/translate.mjs --review         back-translates and compares; writes the review report
 *
 *   --locale <tag>               only this catalog (repeatable)
 *   --force <id> [--note <text>] translate a message again, though it has a translation (repeatable)
 *   --message <id>               with --review: review only these messages (repeatable)
 *
 * The first real run costs money: run --dry-run first, and translate only on the owner's go-ahead.
 * The key is the SDK's to find — ANTHROPIC_API_KEY in the environment, or an `ant auth login`
 * profile. This script never reads `.env` and never writes a key anywhere.
 *
 * Every request carries the same system text for its kind — rules, glossary, the whole English
 * catalog — marked for the prompt cache. The first locale runs alone so it writes the cache, and the
 * others, four at a time, read it.
 */

import Anthropic from '@anthropic-ai/sdk';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { validate } from './translate/icu.mjs';
import { readCatalog, writeTranslations } from './translate/po.mjs';
import {
  SCHEMAS,
  TERMS,
  backRequest,
  backSystem,
  compareRequest,
  compareSystem,
  glossaryRequest,
  glossarySystem,
  retryRequest,
  targetLocales,
  translationRequest,
  translationSystem,
} from './translate/prompts.mjs';
import { toLatin } from './translate/serbian.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES_DIR = path.join(ROOT, 'src/locales');
const GLOSSARY = path.join(LOCALES_DIR, 'glossary.json');
const REVIEW_JSON = path.join(ROOT, 'ai/tasks/29-languages/translation-review.json');
const REVIEW_MD = path.join(ROOT, 'ai/tasks/29-languages/translation-review.md');

/** Set explicitly: this model's default effort is `medium`, and its thinking cannot be turned off. */
const MODEL = 'claude-opus-5-5';
const EFFORT = 'high';
const MAX_TOKENS = 64000;
const CONCURRENCY = 4;
/** On a refusal, the API re-runs the request on the fallback Anthropic recommends for its category. */
const BETAS = ['server-side-fallback-2026-07-01'];

/**
 * Dollars per million tokens (the claude-api skill's table, cached 2026-10-06). A cache write is the
 * 5-minute one, 1.25× input. A fallback attempt bills at its own model's rates.
 */
const PRICES = {
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
};

const { values: args } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    'glossary-only': { type: 'boolean', default: false },
    review: { type: 'boolean', default: false },
    locale: { type: 'string', multiple: true, default: [] },
    force: { type: 'string', multiple: true, default: [] },
    note: { type: 'string' },
    message: { type: 'string', multiple: true, default: [] },
  },
});

const read = (file) => readFileSync(file, 'utf8');
const catalogPath = (locale) => path.join(LOCALES_DIR, locale, 'messages.po');

const english = readCatalog(read(catalogPath('en')));
const englishById = new Map(english.map((entry) => [entry.id, entry]));
const allTargets = targetLocales(read(path.join(ROOT, 'src/i18n/locales.ts')));

for (const locale of args.locale) {
  if (locale === 'sr-Latn') fail('sr-Latn is generated from sr-Cyrl: translate sr-Cyrl instead.');
  if (!allTargets.includes(locale)) fail(`Not a translated catalog: ${locale}`);
}
if (args.note && args.force.length === 0) fail('--note goes with --force.');
for (const id of [...args.force, ...args.message]) if (!englishById.has(id)) fail(`No message with id ${id}.`);

const targets = args.locale.length ? allTargets.filter((locale) => args.locale.includes(locale)) : allTargets;
const glossary = existsSync(GLOSSARY) ? JSON.parse(read(GLOSSARY)) : {};

function fail(message) {
  console.error(message);
  process.exit(1);
}

/** The target catalog's entries, held to the English: a catalog out of step needs extracting first. */
function targetCatalog(locale) {
  const entries = readCatalog(read(catalogPath(locale)));
  const ids = new Set(entries.map(({ id }) => id));
  if (entries.length !== english.length || english.some(({ id }) => !ids.has(id))) {
    fail(`${locale}/messages.po does not hold the English catalog's messages: run npm run i18n:extract.`);
  }
  return entries;
}

/** What a locale's run sends: every empty `msgstr`, and anything forced. In the English's order. */
function wanted(locale) {
  const empty = new Set(targetCatalog(locale).filter(({ translation }) => translation === '').map(({ id }) => id));
  return english.map(({ id }) => id).filter((id) => empty.has(id) || args.force.includes(id));
}

// --- The API -----------------------------------------------------------------------------------

let client;
const usageRows = [];

function api() {
  client ??= new Anthropic({ maxRetries: 4 });
  return client;
}

function request(system, user, schema) {
  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    betas: BETAS,
    fallbacks: 'default',
    output_config: { effort: EFFORT, format: { type: 'json_schema', schema } },
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  };
}

function cost(model, { input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens }) {
  const price = PRICES[model] ?? PRICES[MODEL];
  return (
    (input_tokens * price.input +
      (cache_creation_input_tokens ?? 0) * price.cacheWrite +
      (cache_read_input_tokens ?? 0) * price.cacheRead +
      output_tokens * price.output) /
    1e6
  );
}

/**
 * One request, its usage recorded. Answers the parsed JSON, or why there is none: a refusal that
 * the fallback could not rescue, a cut-off answer, or an error. The caller writes nothing for those.
 */
async function ask(label, system, user, schema) {
  const started = Date.now();
  console.log(`… ${label}`);
  let message;
  try {
    message = await api().beta.messages.stream(request(system, user, schema)).finalMessage();
  } catch (error) {
    const status = error instanceof Anthropic.APIError ? ` (HTTP ${error.status})` : '';
    usageRows.push({ label, error: `${error.message}${status}` });
    console.log(`✗ ${label}: ${error.message}${status}`);
    return { failure: `error${status}: ${error.message}` };
  }

  const iterations = (message.usage.iterations ?? []).filter((it) => it.type === 'message' || it.type === 'fallback_message');
  const attempts = iterations.length ? iterations : [{ ...message.usage, model: message.model }];
  usageRows.push({
    label,
    model: message.model,
    fallback: iterations.some((it) => it.type === 'fallback_message'),
    input: message.usage.input_tokens,
    cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
    cacheRead: message.usage.cache_read_input_tokens ?? 0,
    output: message.usage.output_tokens,
    cost: attempts.reduce((sum, it) => sum + cost(it.model ?? MODEL, it), 0),
    stop: message.stop_reason,
  });
  const row = usageRows.at(-1);
  console.log(`✓ ${label}: ${row.stop}, ${Math.round((Date.now() - started) / 1000)} s, $${row.cost.toFixed(3)}, cache read ${row.cacheRead}`);

  if (message.stop_reason === 'refusal') return { failure: `refused (${message.stop_details?.category ?? 'no category'})` };
  if (message.stop_reason === 'max_tokens') return { failure: 'cut off at max_tokens' };
  const text = message.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
  try {
    return { data: JSON.parse(text) };
  } catch {
    return { failure: 'the answer is not JSON' };
  }
}

/** Runs `work` over `items`: the first alone, so it writes the prompt cache, then four at a time. */
async function warmThenPool(items, work) {
  if (items.length === 0) return;
  await work(items[0]);
  const queue = items.slice(1);
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length) await work(queue.shift());
    })
  );
}

// --- The glossary ------------------------------------------------------------------------------

/** The glossary in `LOCALES` order, whatever order its entries arrived in: it is part of the cached prefix. */
function orderedGlossary() {
  return Object.fromEntries(allTargets.filter((locale) => glossary[locale]).map((locale) => [locale, glossary[locale]]));
}

function writeGlossary() {
  writeFileSync(GLOSSARY, `${JSON.stringify(orderedGlossary(), null, 2)}\n`);
}

async function fillGlossary() {
  const missing = targets.filter((locale) => !glossary[locale]);
  const failures = [];
  await warmThenPool(missing, async (locale) => {
    const { data, failure } = await ask(`glossary ${locale}`, glossarySystem(english), glossaryRequest(locale), SCHEMAS.glossary);
    const terms = data && Object.fromEntries(data.terms.map(({ term, translation }) => [term, translation]));
    if (failure || TERMS.some(([term]) => !terms[term])) {
      failures.push(`${locale}: ${failure ?? 'a fixed term is missing'}`);
      return;
    }
    glossary[locale] = {
      address: data.address,
      example: data.example,
      terms: Object.fromEntries(TERMS.map(([term]) => [term, terms[term]])),
    };
  });
  writeGlossary();
  return failures;
}

function printTone() {
  console.log('\n| locale | address | example |\n|---|---|---|');
  for (const locale of allTargets) {
    const entry = glossary[locale];
    if (entry) console.log(`| ${locale} | ${entry.address} | ${entry.example} |`);
  }
}

// --- Translation -------------------------------------------------------------------------------

/** Each locale's outcome, for the run report. */
const outcomes = new Map();

/** Validates each returned translation of `ids`: the accepted, and the rejected with complaints. */
function check(locale, ids, data) {
  const returned = new Map();
  for (const { id, translation } of data.translations) if (ids.includes(id) && !returned.has(id)) returned.set(id, translation);

  const accepted = new Map();
  const rejected = [];
  const flags = [];
  for (const id of ids) {
    const translation = returned.get(id);
    if (translation === undefined || translation === '') {
      rejected.push({ id, translation: '', errors: ['No translation was returned for this id.'] });
      continue;
    }
    const { source, comments } = englishById.get(id);
    const result = validate({ locale, source, translation, comments });
    if (result.errors.length) {
      rejected.push({ id, translation, errors: result.errors });
    } else {
      accepted.set(id, translation);
      for (const flag of result.flags) flags.push({ id, translation, flag });
    }
  }
  return { accepted, rejected, flags };
}

async function translateLocale(locale, system) {
  const ids = wanted(locale);
  const outcome = { asked: ids.length, written: 0, rejected: [], flags: [], failure: null };
  outcomes.set(locale, outcome);
  if (ids.length === 0) return;

  const notes = new Map(args.note ? args.force.map((id) => [id, args.note]) : []);
  const first = await ask(`translate ${locale}`, system, translationRequest(locale, glossary[locale], ids, notes), SCHEMAS.translations);
  if (first.failure) {
    outcome.failure = first.failure;
    return;
  }
  const result = check(locale, ids, first.data);

  if (result.rejected.length) {
    const retryIds = result.rejected.map(({ id }) => id);
    const second = await ask(`retry ${locale}`, system, retryRequest(locale, glossary[locale], result.rejected), SCHEMAS.translations);
    if (second.failure) {
      outcome.rejected = result.rejected;
      outcome.failure = `the follow-up: ${second.failure}`;
    } else {
      const retried = check(locale, retryIds, second.data);
      for (const [id, translation] of retried.accepted) result.accepted.set(id, translation);
      result.flags.push(...retried.flags);
      outcome.rejected = retried.rejected;
    }
  }

  outcome.flags = result.flags;
  outcome.written = result.accepted.size;
  if (result.accepted.size) {
    writeFileSync(catalogPath(locale), writeTranslations(read(catalogPath(locale)), result.accepted));
  }
}

/** `sr-Latn` from `sr-Cyrl`, every message, overwriting: it is generated, never translated. */
function regenerateSerbianLatin() {
  const cyrillic = readCatalog(read(catalogPath('sr-Cyrl')));
  const latin = new Map(cyrillic.map(({ id, translation }) => [id, translation === '' ? '' : toLatin(translation)]));
  const before = read(catalogPath('sr-Latn'));
  const after = writeTranslations(before, latin);
  if (after !== before) writeFileSync(catalogPath('sr-Latn'), after);
  return [...latin.values()].filter((text) => text !== '').length;
}

// --- The review --------------------------------------------------------------------------------

function loadReview() {
  return existsSync(REVIEW_JSON) ? JSON.parse(read(REVIEW_JSON)) : { rounds: [] };
}

async function reviewLocale(locale, round) {
  const translated = readCatalog(read(catalogPath(locale))).filter(
    ({ id, translation }) => translation !== '' && (args.message.length === 0 || args.message.includes(id))
  );
  if (translated.length === 0) return;

  const back = await ask(`back ${locale}`, backSystem(), backRequest(locale, translated), SCHEMAS.back);
  if (back.failure) {
    round.failures[locale] = `back-translation: ${back.failure}`;
    return;
  }
  const backById = new Map(back.data.back.map(({ id, english: text }) => [id, text]));
  const items = translated.map(({ id, translation }) => ({ id, translation, back: backById.get(id) ?? '' }));

  const compared = await ask(`compare ${locale}`, compareSystem(english), compareRequest(locale, items), SCHEMAS.flags);
  if (compared.failure) {
    round.failures[locale] = `comparison: ${compared.failure}`;
    return;
  }
  const itemById = new Map(items.map((item) => [item.id, item]));
  round.locales[locale] = {
    reviewed: items.map(({ id }) => id),
    flags: compared.data.flags
      .filter(({ id }) => itemById.has(id))
      .map(({ id, reason }) => ({ id, source: englishById.get(id).source, ...itemById.get(id), reason })),
  };
}

/**
 * Per locale and message, the latest review's verdict. A message counts as flagged now when the
 * last round that reviewed it flagged it.
 */
function reviewState(review) {
  const state = {};
  review.rounds.forEach((round, index) => {
    for (const [locale, { reviewed, flags }] of Object.entries(round.locales)) {
      state[locale] ??= { reviewed: reviewed.length, first: flags.length, firstRound: index, messages: {} };
      const flagged = new Map(flags.map((flag) => [flag.id, flag]));
      for (const id of reviewed) {
        const entry = (state[locale].messages[id] ??= { history: [] });
        if (flagged.has(id)) entry.history.push({ round: index + 1, ...flagged.get(id) });
        else if (entry.history.length) entry.history.push({ round: index + 1, cleared: true });
      }
    }
  });
  return state;
}

function renderReview(review) {
  const state = reviewState(review);
  const lines = [
    '# Translation review',
    '',
    'Each catalog was back-translated into English by a request that never saw the English, then a second request compared the back-translation with the source and flagged changes of meaning. Written by `node scripts/translate.mjs --review`, from `translation-review.json`; do not edit by hand.',
    '',
    `Rounds: ${review.rounds.map((round, i) => `${i + 1} (${round.at}${round.messages ? `, ${round.messages} messages` : ''})`).join(', ')}.`,
    '',
    '| locale | messages reviewed | flags, first review | flags now |',
    '|---|---|---|---|',
  ];
  const locales = allTargets.filter((locale) => state[locale]);
  for (const locale of locales) {
    const open = Object.values(state[locale].messages).filter(({ history }) => history.length && !history.at(-1).cleared).length;
    lines.push(`| ${locale} | ${state[locale].reviewed} | ${state[locale].first} | ${open} |`);
  }
  for (const locale of locales) {
    const flagged = Object.entries(state[locale].messages).filter(([, { history }]) => history.length);
    if (flagged.length === 0) continue;
    lines.push('', `## ${locale}`);
    for (const [id, { history }] of flagged) {
      lines.push('', `### \`${id}\` — ${history.at(-1).cleared ? `fixed (round ${history.at(-1).round})` : 'open'}`, '');
      lines.push(`- **English:** ${JSON.stringify(englishById.get(id).source)}`);
      for (const step of history) {
        if (step.cleared) {
          lines.push(`- **Round ${step.round}:** no longer flagged.`);
        } else {
          lines.push(
            `- **Round ${step.round}:** ${JSON.stringify(step.translation)}`,
            `  - back-translation: ${JSON.stringify(step.back)}`,
            `  - reason: ${step.reason}`
          );
        }
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

// --- The dry run -------------------------------------------------------------------------------

async function countTokens(system, user, schema) {
  const { input_tokens } = await api().beta.messages.countTokens({
    model: MODEL,
    output_config: { effort: EFFORT, format: { type: 'json_schema', schema } },
    system: [{ type: 'text', text: system }],
    messages: [{ role: 'user', content: user }],
  });
  return input_tokens;
}

/**
 * Input is counted exactly. Output is not knowable ahead: it is estimated as twice the English being
 * translated plus 15 tokens of JSON per message — a translation is longer than its English, and more
 * so in Cyrillic — and as much again for thinking at high effort.
 */
async function dryRun() {
  const price = PRICES[MODEL];
  const rows = [];
  const placeholder = { address: 'informal (example)', example: 'An example sentence in that language.', terms: Object.fromEntries(TERMS.map(([term]) => [term, term])) };
  const fullGlossary = Object.fromEntries(allTargets.map((locale) => [locale, glossary[locale] ?? placeholder]));

  const allEnglish = await countTokens('Count.', JSON.stringify(english.map(({ source }) => source)), SCHEMAS.back);
  const allChars = english.reduce((sum, { source }) => sum + source.length, 0);
  const englishTokens = (ids) => Math.round((allEnglish * ids.reduce((sum, id) => sum + englishById.get(id).source.length, 0)) / allChars);
  const estimateOutput = (ids) => 2 * (2 * englishTokens(ids) + 15 * ids.length);

  const priced = (phase, locales, system, user, schema, output) => async () => {
    if (locales.length === 0) return;
    const prefix = await countTokens(system, '.', schema);
    let input = 0;
    let dollars = 0;
    let out = 0;
    for (const [i, locale] of locales.entries()) {
      const total = await countTokens(system, user(locale), schema);
      const own = total - prefix;
      input += total;
      out += output(locale);
      dollars += ((i === 0 ? prefix * price.cacheWrite : prefix * price.cacheRead) + own * price.input + output(locale) * price.output) / 1e6;
    }
    rows.push({ phase, requests: locales.length, input, output: out, dollars });
  };

  const missingGlossary = targets.filter((locale) => !glossary[locale]);
  await priced('glossary', missingGlossary, glossarySystem(english), glossaryRequest, SCHEMAS.glossary, () => 3000)();

  const toTranslate = targets.map((locale) => [locale, wanted(locale)]).filter(([, ids]) => ids.length);
  const idsOf = new Map(toTranslate);
  await priced(
    'translation',
    toTranslate.map(([locale]) => locale),
    translationSystem(english, fullGlossary),
    (locale) => translationRequest(locale, fullGlossary[locale], idsOf.get(locale)),
    SCHEMAS.translations,
    (locale) => estimateOutput(idsOf.get(locale))
  )();

  // The review reads every message of a catalog, translated by then: priced from the English.
  const all = english.map(({ id }) => id);
  const translatedTokens = 2 * englishTokens(all) + 15 * all.length;
  const backSys = await countTokens(backSystem(), '.', SCHEMAS.back);
  const compareSys = await countTokens(compareSystem(english), '.', SCHEMAS.flags);
  const review = targets.length;
  rows.push({
    phase: 'review: back-translation',
    requests: review,
    input: review * (backSys + translatedTokens),
    output: review * estimateOutput(all) * 0.6,
    dollars: (review * ((backSys + translatedTokens) * price.input + estimateOutput(all) * 0.6 * price.output)) / 1e6,
  });
  rows.push({
    phase: 'review: comparison',
    requests: review,
    input: review * (compareSys + 2 * translatedTokens),
    output: review * 8000,
    dollars:
      (compareSys * price.cacheWrite + (review - 1) * compareSys * price.cacheRead + review * (2 * translatedTokens * price.input + 8000 * price.output)) / 1e6,
  });

  console.log('Missing per catalog:');
  for (const locale of targets) console.log(`  ${locale.padEnd(8)} ${String(wanted(locale).length).padStart(4)}`);
  console.log(`\nPriced for ${MODEL} at $${price.input} in, $${price.output} out, $${price.cacheWrite} cache write, $${price.cacheRead} cache read per million tokens.`);
  console.log('Input is counted; output is an estimate (see dryRun in the script).\n');
  console.log('| phase | requests | input tokens | output tokens (est.) | dollars (est.) |\n|---|---|---|---|---|');
  for (const row of rows) {
    console.log(`| ${row.phase} | ${row.requests} | ${row.input.toLocaleString('en')} | ${Math.round(row.output).toLocaleString('en')} | ${row.dollars.toFixed(2)} |`);
  }
  console.log(`| total | | | | ${rows.reduce((sum, row) => sum + row.dollars, 0).toFixed(2)} |`);
}

// --- The report --------------------------------------------------------------------------------

function printUsage() {
  if (usageRows.length === 0) return;
  console.log('\n| request | model | input | cache write | cache read | output | stop | dollars |\n|---|---|---|---|---|---|---|---|');
  for (const row of usageRows) {
    if (row.error) {
      console.log(`| ${row.label} | error: ${row.error} | | | | | | |`);
      continue;
    }
    const model = row.fallback ? `${row.model} (fallback)` : row.model;
    console.log(`| ${row.label} | ${model} | ${row.input} | ${row.cacheWrite} | ${row.cacheRead} | ${row.output} | ${row.stop} | ${row.cost.toFixed(3)} |`);
  }
  const total = usageRows.reduce((sum, row) => sum + (row.cost ?? 0), 0);
  console.log(`\nSpent: $${total.toFixed(2)} over ${usageRows.length} requests.`);
}

function printOutcomes() {
  console.log('\n| locale | asked | written | rejected | flagged | failure |\n|---|---|---|---|---|---|');
  for (const [locale, outcome] of outcomes) {
    console.log(`| ${locale} | ${outcome.asked} | ${outcome.written} | ${outcome.rejected.length} | ${outcome.flags.length} | ${outcome.failure ?? ''} |`);
  }
  for (const [locale, outcome] of outcomes) {
    for (const { id, translation, errors } of outcome.rejected) {
      console.log(`rejected ${locale} ${id} ${JSON.stringify(translation)}: ${errors.join(' ')}`);
    }
    for (const { id, translation, flag } of outcome.flags) {
      console.log(`flagged ${locale} ${id} ${JSON.stringify(translation)} (${JSON.stringify(englishById.get(id).source)}): ${flag}`);
    }
  }
}

function printMissing() {
  console.log('\nStill missing:');
  for (const locale of [...allTargets, 'sr-Latn']) {
    const missing = readCatalog(read(catalogPath(locale))).filter(({ translation }) => translation === '').length;
    console.log(`  ${locale.padEnd(8)} ${String(missing).padStart(4)}`);
  }
}

// --- Main --------------------------------------------------------------------------------------

if (args['dry-run']) {
  await dryRun();
} else if (args.review) {
  const review = loadReview();
  const round = { at: new Date().toISOString().slice(0, 10), messages: args.message.length || undefined, locales: {}, failures: {} };
  await warmThenPool(targets, (locale) => reviewLocale(locale, round));
  review.rounds.push(round);
  writeFileSync(REVIEW_JSON, `${JSON.stringify(review, null, 2)}\n`);
  writeFileSync(REVIEW_MD, renderReview(review));
  printUsage();
  for (const [locale, failure] of Object.entries(round.failures)) console.log(`review failed ${locale}: ${failure}`);
  for (const [locale, { reviewed, flags }] of Object.entries(round.locales)) console.log(`reviewed ${locale}: ${reviewed.length} messages, ${flags.length} flagged`);
  if (Object.keys(round.failures).length) process.exitCode = 1;
} else {
  const glossaryFailures = await fillGlossary();
  for (const failure of glossaryFailures) console.log(`glossary failed ${failure}`);
  if (args['glossary-only'] || glossaryFailures.length) {
    printTone();
    printUsage();
    if (glossaryFailures.length) process.exitCode = 1;
  } else {
    const system = translationSystem(english, orderedGlossary());
    await warmThenPool(targets, (locale) => translateLocale(locale, system));
    const latin = regenerateSerbianLatin();
    console.log(`\nsr-Latn: ${latin} messages transliterated from sr-Cyrl.`);
    execFileSync('npm', ['run', 'i18n:compile'], { cwd: ROOT, stdio: 'inherit' });
    printUsage();
    printOutcomes();
    printMissing();
    if ([...outcomes.values()].some(({ failure, rejected }) => failure || rejected.length)) process.exitCode = 1;
  }
}
