# Step 4 — The translation script, and the 19 translated catalogs

The user requests, decisions D1–D14 and the step plan are in
[description-step-1.md](description-step-1.md). This step needs step 2's English catalog. If step 3 has not
landed yet, rerun the script after it: only the missing entries are sent.

**Load the `claude-api` skill before writing the script.** It holds the current SDK calls, model IDs and
request shapes. Where this file and the skill disagree on an API detail, the skill wins.

## What this step delivers

- `scripts/translate.mjs` (Node ESM) and its tests.
- `src/locales/glossary.json`.
- Every catalog in D1 with no missing entry: 19 written by the model, and `sr-Latn` generated from
  `sr-Cyrl`.
- A back-translation review report for the user.

## The script

### Input and output

- **What it reads:**
  - `src/locales/en/messages.po`: source text, translator comments, `context`, and references, all
    written in step 2;
  - each target `src/locales/<locale>/messages.po`. An empty `msgstr` is "missing". `lingui extract`
    leaves every new or changed message empty (D3).
- **What it writes:** only `msgstr`, back into the target PO. Everything else in the file stays byte for
  byte, including order and comments. A round-trip test proves it.
- **Then** it runs `npm run i18n:compile`.

### The requests

- **One request per locale** that has missing entries, at most four at a time.
- **Model `claude-opus-5-5`, effort `high`, set explicitly.** This model defaults to `medium`, and its
  thinking cannot be turned off.
- **Server-side fallbacks on** (`fallbacks: "default"`, as the skill describes). On a final
  `stop_reason: "refusal"`, leave that locale's entries empty and report it.
- **Structured output.** The model returns `{ "translations": [{ "id": string, "translation": string }] }`,
  keyed by message ID, through the SDK's structured-output support.
- **Prompt caching.** The system part is identical for all 19 locales, so it goes first with
  `cache_control`:
  - the instructions;
  - the glossary;
  - the whole English catalog with its comments, as context even for messages not being translated.

  The locale, its tone and the missing IDs come after it. Check that `usage.cache_read_input_tokens` is
  non-zero from the second locale on, and record it.
- **No Message Batches.** There are 19 small requests. The batch discount would save cents, results can
  take up to 24 hours, and batches reject `fallbacks`.

### What the instructions say

- **Write as iOS writes in that language:** short, plain interface language, with the form of address the
  glossary records for it (D8).
- **D7:**
  - names and list names are inserted unchanged, in the nominative;
  - the person's gender is unknown, so never use a gendered past tense or adjective for them;
  - use a present tense, a passive, or a label form instead.
- **Keep every placeholder (`{name}`) and tag (`<0>…</0>`) exactly.** The ICU syntax must stay valid, and
  a plural carries every category the language needs, including Slovenian's `two`.
- **Never translate `ShoppingLoop` or `support@shopping-loop.com`.**
- **Respect a comment's length hint**, such as "about 12 characters", for tight controls.
- **Return only the translations.**

### Validation of every returned message

1. It parses as ICU MessageFormat.
2. It has the same set of placeholders and tags as the English.
3. Every `plural` has every category `new Intl.PluralRules(locale).resolvedOptions().pluralCategories`
   lists. Node has full ICU, so it can check this.
4. It is not identical to the English, unless the English is only placeholders or a brand. Flag this; do
   not reject it.
5. It is within a comment's length hint. Flag this; do not reject it.

A message failing 1–3 goes back once, in a follow-up request carrying the validator's complaint. If it
still fails, it stays empty and is listed in the run report.

### Options and money

- **`--dry-run`:** per locale, the missing count and a token estimate (`count_tokens`) priced at the
  skill's current rate for the model. It spends nothing else.
- **`--locale <tag>`** limits a run to one locale. **`--force <messageId>`** re-translates one message.
- **The first real run costs money.** Show the user the dry-run estimate and run only on their go-ahead.
  Every later run sends only what is missing.
- **Credentials:** `ANTHROPIC_API_KEY` in the environment, or an `ant auth login` profile. `.env` holds no
  such key today. The script never writes a key anywhere.
  - If this sandbox cannot reach `api.anthropic.com`, the user runs the script in their own terminal, the
    same way as task 26's Apple builds.

### `sr-Latn` (D12)

- **Generated from `sr-Cyrl`, never sent to the model.**
- **Only the text parts of the parsed ICU message are transliterated.** Placeholders, tags and ICU keywords
  are left alone.
- **The table:**

  ```
  А A   Б B   В V   Г G   Д D   Ђ Đ   Е E   Ж Ž   З Z   И I
  Ј J   К K   Л L   Љ Lj  М M   Н N   Њ Nj  О O   П P   Р R
  С S   Т T   Ћ Ć   У U   Ф F   Х H   Ц C   Ч Č   Џ Dž  Ш Š
  ```

  Lowercase letters map the same way.
- **Digraph capitals:** `Љ`, `Њ` and `Џ` become `LJ`, `NJ` and `DŽ` when the next letter is also a capital
  (an all-caps word), and `Lj`, `Nj` and `Dž` otherwise.
- **Unit tests** cover each letter, the digraph cases, and a message with a plural and a tag.

### The glossary (D8)

- **Each language's entry** in `src/locales/glossary.json` holds two things:
  - **its tone:** the form of address iOS uses in that language, with one example sentence;
  - **fixed terms:** list, item, bin, owner, writer, reader, invitation, notification, block, Day, Night,
    Auto, sign in, code.
- **How it is made:** the first run asks the model for each language's glossary in a separate request, and
  writes it. Every translation request then carries it.
- **The user reviews it.** Paste the tone column into the log as a table for the user to confirm or
  change.
- **Changing an entry later** means re-translating the affected messages with `--force`.

## The back-translation review

Most of these languages cannot be checked by reading, so the review is done by the model.

- **`--review`** asks, per locale and in a separate request that does not see the English, for every
  message translated back into English. A second call then compares each back-translation with the source
  and flags any change of meaning.
- **The report** goes to `ai/tasks/29-languages/translation-review.md`: per locale, every flagged message
  with its source, translation, back-translation and the reason.
- **Fix what is flagged** with `--force` and a note, then review again.
- **What reaches the user:** the summary at the top (flags per locale, before and after fixes).
- **A native speaker's read before release**, where the user has one, is the user's call and outside this
  task.

## Verification

1. **Tests for the script:**
   - the PO round trip (nothing but `msgstr` changes);
   - the validator's three rejections;
   - the transliteration.

   These run in `npm test`, and none calls the API.
2. **The run:**
   - every catalog reports 0 missing;
   - `npm run i18n:compile` succeeds;
   - `npm run i18n:check` is clean;
   - `npm test` and `npm run typecheck` pass.
3. **A smoke test:** a Jest test renders Lists and Notifications in each of the 21 catalogs, asserts
   nothing throws, and asserts no ICU source syntax shows (`{`, `plural,`).
4. **On the simulator:** Lists and Notifications in `pl` and `de` through the dev switch, in
   `screenshots/step-4/`. Step 5 does the full pass.
5. **The log:**
   - tokens and cost per run, from `usage`;
   - cache reads;
   - refusals and validation failures;
   - the glossary's tone table;
   - the review summary.

## After this step

- Write `implementation-log-step-4.md` beside this file.
- Run `/librarian deposit 29`.

## KB impact

| entry | change |
|---|---|
| new candidates | how a translation run works: only missing entries, money only on the user's go-ahead, credentials never in `.env`; `sr-Latn` is generated, so never edit it by hand; the glossary fixes tone and terms, and a change means `--force` |
