# Step 4 — implementation log (2026-10-13): the translation script, the glossary, 19 translated catalogs, review

Spec: [description-step-4.md](description-step-4.md). Decisions D1–D14: [description-step-1.md](description-step-1.md).

**Commits.** The user committed in three steps:
- `14bb94b` *29-i18n-4 glossary*: the script, tests, smoke test, SDK, `glossary.json`;
- `7a05a9d` *29-i18n-4 translations*;
- `eace9f6` *29-i18n-4 review*: the review report, the `SortButtons` comment fix, repeatable `--locale`.

This log and `screenshots/step-4/` are uncommitted. `/librarian deposit 29` was not run (step 7).

**Who ran what.**
- The session had no credentials: no `ANTHROPIC_API_KEY`, no `~/.config/anthropic`, and `ant` was not installed.
  `api.anthropic.com` was reachable (it answered 401), so credentials, not network, were the limit.
- The user installed `ant` (`brew install anthropics/tap/ant`), ran `ant auth login` (an OAuth profile), and chose
  to run every API command in their own terminal.
- Each run was `tee`d to `/tmp/translate-<n>-*.txt`. I read those files, judged the results and wrote the fix
  commands. No key ever entered the session, `.env` or the repo.

## What was built

| file | role |
|---|---|
| `scripts/translate.mjs` | The CLI. The only module with `import.meta` or the SDK. Orchestration, the pool, the run report, `npm run i18n:compile`. |
| `scripts/translate/po.mjs` | A line-based PO reader and writer. `readCatalog` gives `{ id, context, source, translation, comments, references, msgstrLines }`. `writeTranslations(text, Map<id, msgstr>)` replaces only those `msgstr` lines. `messageId` is `@lingui/message-utils/generateMessageId`; all 285 IDs equal the compiled `messages.ts` keys. |
| `scripts/translate/icu.mjs` | `validate({ locale, source, translation, comments })` → `{ errors, flags }`, using `@messageformat/parser` (5.2.0, the parser Lingui uses). |
| `scripts/translate/serbian.mjs` | `transliterate(text)`, and `toLatin(message)`, which replaces each content token's raw text at its `ctx.offset`, recursing into cases. It throws if a run's text does not match the source at its offset. |
| `scripts/translate/prompts.mjs` | Pure builders: `targetLocales` (regex over `src/i18n/locales.ts`), `LANGUAGES`, `TERMS`, `catalogText`, the system and user texts per kind, and `SCHEMAS`. |
| `scripts/translate/*.test.ts` | 24 tests: po 5, icu 10, serbian 5, prompts 4. No API call. |
| `src/i18n/catalogs.test.tsx` | The smoke test: 21 catalogs × {Lists, Notifications} = 42 tests. |
| `src/locales/glossary.json` | 19 locales: `{ address, example, terms }`. |
| `ai/tasks/29-languages/translation-review.{json,md}` | The review rounds, and the report rendered from them. |
| `package.json` | Adds the devDependency `@anthropic-ai/sdk` **0.133.0**, exact. Its types carry `fallbacks: BetaFallbacksParam` (`'default'` included), `output_config.format` and `usage.iterations`. |

### Requests

- **Call:** `client.beta.messages.stream(…).finalMessage()`, with `new Anthropic({ maxRetries: 4 })`.
- **Model and output:** `model: 'claude-opus-5-5'`, `max_tokens: 64000`,
  `output_config: { effort: 'high', format: { type: 'json_schema', schema } }`. `thinking` is omitted: the
  model's thinking cannot be disabled, and its default effort is `medium`, hence `high` set explicitly.
- **Fallbacks:** `betas: ['server-side-fallback-2026-07-01']`, `fallbacks: 'default'`. `countTokens` sends no
  betas.
- **System:** one text block with `cache_control: { type: 'ephemeral' }`.
  - Translation: rules, then `# Glossary` (the whole glossary in `LOCALES` order, from `orderedGlossary()`), then
    `# The English catalog`.
  - The catalog renders each entry as `id:`, `context:`, `note:` (de-duplicated), `where:` and
    `english: <JSON string>`.
- **User turn:** the language and variant, the form of address and example from the glossary, the IDs, and any
  notes.
- **Schemas:** static, with no per-request enum, so the prefix stays stable. Unknown or duplicate IDs are
  dropped client-side.
- **Order:** the first locale alone, so it writes the cache, then four at a time (`warmThenPool`).
- **Stop reasons:**
  - `refusal`: the locale fails, stays empty, and the category is reported;
  - `max_tokens`: fails;
  - unparseable JSON: fails.

  Each request logs a `…`/`✓`/`✗` line with time, cost and cache read. Cost is summed over
  `usage.iterations` (`message` and `fallback_message`), each at its own model's price.
- **Glossary:** one request per locale, using the rules, `TERMS` (the 14 terms, each with its sense in this app)
  and the English catalog. Schema `{ address, example, terms: [{ term (enum), translation }] }`. A locale
  missing a term fails.
- **Review:** two requests per locale.
  - Back-translation: a system of rules only, with no English and no comments. It is under 512 tokens, so never
    cached.
  - Comparison: rules plus the English catalog, cached. It flags changes of meaning, plus gendered past tense or
    adjectives for a person (D7).
  - Rounds are stored in `translation-review.json`. The `.md` shows per locale: reviewed, first-round flags, and
    flags now (a message is open if the last round that reviewed it flagged it).
- **Options:**
  - `--dry-run`, `--glossary-only`, `--review`;
  - `--locale <tag>`, made repeatable mid-step;
  - `--force <id>` (repeatable), with `--note <text>` applying to **every** forced ID in that run;
  - `--message <id>` (repeatable, review only).

  `--locale sr-Latn` and `--note` without `--force` are refused.
- **`sr-Latn`:** regenerated from `sr-Cyrl` at the end of every translation run, all 285 entries overwritten.
  - Digraph capitals follow the spec: `LJ`/`NJ`/`DŽ` when the next character is an uppercase letter.
  - **One extension:** when no letter follows, the previous letter decides, so `КОЊ` → `KONJ`, not `KONj`.

### Validation

1. **Parse error → reject.** Lingui's runtime `compileMessage` **swallows** parse errors and shows the raw
   source, so this check and the smoke test are the only guards against ICU on screen.
2. **Placeholders and tags → reject.** The set of `arg`s, and the sorted multiset of `<n>`, `</n>` and `<n/>`
   tags.
3. **Plurals → reject.**
   - Every `plural`/`selectordinal` must cover `Intl.PluralRules(locale).resolvedOptions().pluralCategories`.
     `=N` keys are ignored.
   - An English plural must stay a plural on the same argument.
4. **Identical to the English → flag**, unless the English has no letters outside placeholders, tags and the
   brand.
5. **Over a length hint → flag.** `/about (\d+) characters/` in a comment is compared with the longest case's
   visible text, with `#` counted as one character.

A rejected message, or an ID with no answer, goes back once in a follow-up request carrying the complaint. **No
follow-up was ever needed** (0 rejections in every run), so that path has unit coverage only and was never run
against the API.

## Runs: tokens and cost

| run | requests | uncached input | cache write | cache read | output | $ |
|---|---|---|---|---|---|---|
| `--dry-run` | `countTokens` ×≈45 | — | — | — | — | 0 (estimate: $20.78) |
| `--glossary-only` | 19 | 385 | 24,208 | 435,744 | 20,097 | 0.61 (est. 1.35) |
| translate | 19 | 39,044 | 28,837 | 519,066 | 440,174 | 9.21 (est. 8.69) |
| `--review` | 38 | 647,456 | 23,814 | 428,652 | 258,421 | 7.96 (est. 10.74) |
| fixes (6 commands) | 16 | 5,022 | 28,845 | 432,675 | 8,061 | 0.42 |
| re-review | 24 | 18,853 | 23,822 | 262,042 | 10,417 | 0.46 |
| **total** | 116 | | | | | **18.66** |

- **Every request** was served by `claude-opus-5-5` (no `fallback_message`), stopped at `end_turn`, and none
  errored or refused.
- **Cache reads:**
  - every glossary request after `de` read 24,208 tokens;
  - every translation after `de` read 28,837;
  - every comparison after the first read 23,814.
- **The fixes' first request** wrote 28,845 tokens: the corrected `SortButtons` comment changed the prefix. The
  rest of that run, and the next five commands, read it.
- **Translation per locale:** 131–229 s, $0.37–0.59, and 17.8K–28.6K output tokens (translations, JSON and
  thinking). The Slavic and Cyrillic languages ran highest.
- **The dry run's output estimate** was 414,694 for translation against an actual 440,174. Its rule is
  `2 × (2 × English tokens + 15 × ids)`.

## The glossary: tone (for the user to confirm)

| locale | form of address | example |
|---|---|---|
| de | informal du | Du verlierst den Zugriff auf diese Liste, bis dich jemand erneut einlädt. |
| fr | formal vous | Nous vous avons envoyé un code à six chiffres à {address}. |
| es | informal tú | Te enviaremos un código de seis dígitos por correo electrónico. No necesitas contraseña. |
| it | informal tu | Ti invieremo via email un codice di sei cifre. Non serve nessuna password. |
| pt-PT | formal third person (o seu; você implied, not written) | Vamos enviar-lhe um código de seis dígitos por e-mail. Não precisa de palavra-passe. |
| sv | informal du | Du förlorar åtkomsten till den här listan tills någon bjuder in dig igen. |
| nb | informal du | Vi sender deg en sekssifret kode på e-post. Du trenger ikke passord. |
| fi | informal sinä | Tarvitset verkkoyhteyden, jotta voit vastata kutsuun. |
| pl | informal ty | Wyślemy Ci e-mailem sześciocyfrowy kod. Nie potrzebujesz hasła. |
| cs | **formal vy (vykání)**: changed by hand from the model's informal *ty* | Ztratíte přístup k tomuto seznamu, dokud vás někdo znovu nepozve. |
| sk | formal vy (vykanie) | Na zmenu mena potrebujete pripojenie. |
| sl | formal vi (vikanje) | Po e-pošti vam bomo poslali šestmestno kodo. Geslo ni potrebno. |
| hr | formal vi | Poslat ćemo vam šesteroznamenkasti kôd e-poštom. Lozinka nije potrebna. |
| hu | informal te (tegeződés) | Elveszíted a hozzáférést ehhez a listához, amíg valaki újra meg nem hív. |
| sr-Cyrl | formal Ви | Потребна вам је интернет веза да бисте одговорили на позивницу. |
| be | formal вы (iOS has no Belarusian UI) | Вы страціце доступ да гэтага спіса, пакуль хтосьці зноў вас не запросіць. |
| ru | formal **Вы, capitalised** | Вы потеряете доступ к этому списку, пока Вас снова не пригласят. |
| uk | formal ви, lowercase | Ми надішлемо вам шестизначний код електронною поштою. Пароль не потрібен. |
| bg | formal вие | Ще ви изпратим шестцифрен код по имейл. Не е нужна парола. |

**User decisions (2026-10-13, at the glossary pause, before any translation):**
- cs → formal: the file was edited by hand, so no `--force` was needed;
- hu: keep informal, though my recollection leaned formal, with low confidence;
- ru: keep the capitalised `Вы`, against my suggestion of lowercase;
- de: keep "writer" = **Autor**, against my suggestion of "Bearbeiter".

The 14 terms per locale are in `src/locales/glossary.json`. Changing one means `--force` on the messages that use
it.

## Validation results

- **Main run:** 285/285 written in every locale, **0 rejected, 116 flagged.**
  - **37 identical, all correct:**
    - `A–Z` and `Z–A`;
    - `Auto` (de, fr, pt-PT, sv, nb, pl, cs, sk, hr, hu);
    - loanwords: de/it `Account`, de `Name`, fr `Date` and `Notifications`, it `Email`;
    - ru and uk keep the sample `you@example.com`.
  - **79 over a length hint, by 1–5 characters**, all on buttons and badges. The largest:
    - "Owner" (about 7): es `Propietario` 11, it `Proprietario` 12, be `Уладальнік` 10, bg `Собственик` 10;
    - "Withdrawing…" (about 12): nb `Trekker tilbake …` 17;
    - "To Do First" (about 10): it `Prima da fare` 13.

    Left for step 5's layout pass. Pseudo is +40% plus two brackets, which is longer than every overrun.
- **After the fixes,** 19 new length flags on the reworded To Do labels: 12–17 characters against about 10, the
  longest es `Pendientes arriba` (17). These too are for step 5. The sort row is List detail's, three equal
  buttons.

## The review

**Round 1:** 19 × 285 messages, **39 flags**. Per locale:

| de | fr | es | it | pt-PT | sv | nb | fi | pl | cs | sk | sl | hr | hu | sr-Cyrl | be | ru | uk | bg |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | 3 | 2 | 1 | 3 | 2 | 0 | 1 | 4 | 3 | 3 | 0 | 0 | 0 | 5 | 2 | 2 | 3 | 3 |

**Round 2:** a re-review of 12 locales × 12 messages, the fixed IDs: **0 flags.** Flags open now: 9, all kept on
purpose (below).

### Root cause of 18 of the 39

The step-2 translator comment on `To Do Last` (`src/components/SortButtons.tsx`) said *"done items go last"*. In
fact items still to do go last, and done items come first, as its VoiceOver sibling `To do last` says.
- **What the models did:** in 9 locales they collapsed the pair to state words that read as filters
  ("Pendientes"/"Hechos", "À faire"/"Terminés", "Не куплено"/"Куплено"…).
- **The fix:** the comment now reads *"items still to do go last, so done items come first."* Re-extracting
  changed exactly that one `#.` line in all 22 catalogs: no `msgid` and no translation moved, and the compiled
  catalogs were unchanged.
- **The other 10 locales** were already right, e.g. de `Offen unten`, fi `Tehdyt ensin`, hr `Prvo gotovo`.

### Fixed (30 flags, 6 commands, `--force` with a note)

| locales | ids | before → after |
|---|---|---|
| es, pt-PT, fr, pl, cs, sr-Cyrl, be, ru, uk | `NMVMEI` To Do First, `iImVrZ` To Do Last | state words → the order, e.g. es `Pendientes arriba`/`Pendientes abajo`, pt-PT `Por fazer 1.º`/`Feitos 1.º`, ru `Активные сверху`/`Активные снизу`, uk `Виконані внизу`/`Виконані вгорі` |
| de | `tuS5Jz` Unblock, `zel8Hf` Unblocking… | `Freigeben` (the app's word for Sharing, "Freigabe") → `Entsperren` / `Entsperren…` |
| fr, sv | `bzSI52` Discard, `d2Vli_` Discard my change | `Ignorer`/`Ignorera` → fr `Abandonner` / `Abandonner ma modification`, sv `Släng` / `Släng min ändring` |
| sr-Cyrl | `jxIZ0A`, `rQScU1`, `KaNUsm` Set {name} to owner/reader/writer (VoiceOver) | `Улога особе {name}: власник` (a statement) → `Постави особу {name} за власника` (the action, name in the nominative) |
| uk, bg | `2wxgft` Rename | `Змінити` ("Change") and `Ново име` ("New name") → `Перейменувати` and `Преименуване` |
| bg | `wyHzBd`, `Ew8DOx` Day/Night all day today | dropped "today" → `Днес през целия ден: Ден` / `…: Нощ` |

### Kept (9 flags), with reasons

| locale | message | translation | why kept |
|---|---|---|---|
| it, sk | You joined | `Accettato`, `Prijatá` ("Accepted") | A label agreeing with the word "invitation". The literal forms are gendered past tense (it "Ti sei unito/unita"), against D7. |
| sk | Not signed in. | `Najprv sa prihláste.` ("Sign in first.") | "Nie ste prihlásený/á" is gendered under formal vy. |
| sk | Invited (heading) | `Pozvaní` | The generic plural for a group of people (ru `Приглашенные`, uk `Запрошені` likewise). D7 is about a named person. |
| cs | {name}'s invitation will be withdrawn. | `Pozvánka bude odvolána a {name} ji už nebude moci přijmout.` | The added clause is true, and it keeps `{name}` in the nominative, as the comment asks. |
| pt-PT | {name} (you) | `{name} (eu)` | pt-PT Apple style labels one's own entry in the first person ("O meu cartão"). |
| fi | Cancel | `Kumoa` | Finnish iOS's own word for Cancel. |
| pl | No lists yet, No notifications yet | `Brak list`, `Brak powiadomień` | The standard Polish empty-state form; "yet" is unidiomatic there. |

## Problems hit

- **The wrong `To Do Last` comment** from step 2 (above). A translator comment is context the model trusts; a
  wrong one produced 9 wrong pairs.
- **The length hint pressed the To Do labels into state words.** The fix note allowed "a little longer".
- **`--locale` took one value.** I made it repeatable before the fixes, so they took 6 commands instead of 20.
- **The smoke test's first draft** used `getByLabelText(/Weekend BBQ/)`, which matches both a Lists row and its
  delete button's label. Now `getAllByLabelText`.
- **I removed `.playwright-mcp/`** (gitignored Playwright MCP output) after the browser checks without listing it
  first, so any older snapshot or console logs from earlier sessions are gone.

## Verification

1. **Script tests:** 24 pass. The PO round trip compares `writeTranslations` with `@lingui/format-po`'s own
   `parse` → set → `serialize`, as `lingui.config.ts` configures it (`lineNumbers: false`). The output is
   byte-identical, including `\n`, `"`, `\` and tab. With no translations, the bytes are identical. A line diff
   shows only the target `msgstr` lines.
2. **Smoke test:** 42 pass, with the real translations too.
   - It renders Lists and Notifications with one real provider tree (`I18nProvider` › `SessionProvider` ›
     `SortProvider` › `ListsProvider` › `NotificationsProvider`), with the seams mocked as in the screens' own
     suites.
   - Rows cover the three roles, the three notification kinds, and ages in minutes, hours and days.
   - It asserts that no text node, `accessibilityLabel`, `accessibilityHint` or `placeholder` contains `{` or
     `plural,`.
   - **Mutation:** a temporary copy fed `de` a catalog of raw `{count, plural, other {raw}}` messages, and both
     `de` tests failed.
3. **0 missing:** each of the 20 target `.po` files has exactly one empty `msgstr`, the header.
4. **Only `msgstr` changed** in the main run: `git diff -U0` of the 20 `.po` files showed no other line (5,720
   lines = 20 × 285 `msgstr` + 20 compiled lines).
5. **Catalogs:** `npm run i18n:compile` succeeded inside every run. `npm run i18n:check`: PASS sync, PASS
   compiled.
6. **The suite:** `npm test`: 49 suites, **1,163 tests** (1,097 + 24 + 42). `git diff --stat 2c0d4df -- '*.test.*'`
   lists only the 5 new files. `npm run typecheck` is clean.
7. **KB audit:** `npm run kb:audit` fails 6 entries, the same 6 as at `2c0d4df` (audited in a temporary worktree):
   - account-deletion-forces-signed-out-and-clears-twice;
   - apple-revoke-leaves-an-email-less-returning-sheet;
   - queries-go-through-a11y-labels;
   - screens-take-navigation-props;
   - session-revoked-write-redirects;
   - session-still-valid-guards-writes.

   Step 2 broke them, and step 7 owns them.
8. **Web, Chromium, 390×844, against local** (`.env` target `local`), signed in as maya3 with a Mailpit code,
   switched with `__setDevLocale`. Shots are in `screenshots/step-4/`:
   - `pl-lists.png`: "Moje listy", `Szukaj list`, `A–Z`/`Data ↑`, shared rows "Udostępniona Ci · możesz edytować"
     / "· tylko do odczytu".
   - `pl-notifications.png`: "Powiadomienia". Present tense for every name ("Priya zaprasza Cię…", "Jorge odrzuca
     Twoje zaproszenie…", "Jordan przyjmuje…"), "Dołączono", "Już niedostępne", "12 godz. temu".
   - `de-notifications.png`: "Mitteilungen". The German perfect ("hat dich zu … eingeladen") has no gender.
     "Beigetreten", "Nicht mehr verfügbar", "vor 12 Std.".
   - `de-lists.png`: "Meine Listen", `Listen durchsuchen`, "Mit dir geteilt · bearbeitbar" / "· nur ansehen".
     **The title wraps to two lines** beside the three header buttons, where "My Lists" and "Moje listy" fit
     one. This is for step 5's layout pass (German is in it), and web is not the sign-off.

   The console had no errors, only the two existing warnings (Google sign-in on web, `pointerEvents`).

## State left

- **Commits:** the user's `14bb94b`, `7a05a9d` and `eace9f6`. **Uncommitted:** this log and `screenshots/step-4/`
  (4 PNGs).
- **Services:** web server, Supabase (data kept, no rows changed: sign-in only) and Docker (`docker desktop
  stop`) are stopped, and the browser is closed. Mailpit holds one more code email for maya3.
- **The user's machine:** `ant` installed, with an OAuth profile. `ANTHROPIC_API_KEY` is unset. The run outputs
  `/tmp/translate-1-dry-run.txt` to `/tmp/translate-6-rereview.txt` will not survive a reboot; their numbers are
  in this log.

## KB candidates

| entry | change |
|---|---|
| new: how a translation run works | `node scripts/translate.mjs` sends only entries whose `msgstr` is empty (what `lingui extract` leaves for a new or edited English message), plus `--force <id>`.<br>• **Money only on the owner's go-ahead:** `--dry-run` first (`countTokens` only, free). A full 285-message × 19-locale run cost $9.21 and a full review $7.96 on 2026-10-13, at `claude-opus-5-5` / effort `high`.<br>• **Credentials:** the SDK finds an `ant auth login` profile or `ANTHROPIC_API_KEY`. Never `.env`; the script never writes a key. The owner runs paid commands in their own terminal.<br>• **Fixes:** `--locale` (repeatable) `--force <id> --note "<reason>"`. `--note` applies to every forced ID in that run, so group commands by note.<br>• The first locale runs alone to write the prompt cache, and the rest (4 at a time) read it. |
| new: `sr-Latn` is generated | Every translation run rewrites all of `sr-Latn` from `sr-Cyrl` (`scripts/translate/serbian.mjs`). Never edit it by hand: fix `sr-Cyrl`, then run the script (a `--force` run on `sr-Cyrl` regenerates it too). Digraph capitals are all-caps when the next letter is a capital, or, word-final, when the previous one was. |
| new: the glossary fixes tone and terms | `src/locales/glossary.json` holds, per locale, the form of address with an example, plus 14 fixed terms. It is part of every translation request. A change means `--force` on every message the term or tone touches.<br>Owner decisions 2026-10-13: cs formal (changed from the model's informal), hu informal, ru capitalised `Вы`, de writer = `Autor`. iOS's own choices were not verified against real iOS strings. |
| new: translator comments steer the model | The model trusts a comment over the English. A wrong step-2 comment ("To Do Last: done items go last") produced 9 wrong pairs. A comment edit needs only `npm run i18n:extract`: the `msgid` is unchanged, so translations stay. It also changes the cached prompt prefix (one cache write). |
| new: ICU errors are silent at runtime | Lingui's `compileMessage` catches a parse error and shows the message's raw source. The guards are `scripts/translate/icu.mjs` (parse, placeholders and tags, plural categories per `Intl.PluralRules`) and `src/i18n/catalogs.test.tsx` (no `{` or `plural,` on Lists or Notifications in any catalog). |
| new: the PO writer equals Lingui's | `scripts/translate/po.mjs` rewrites only `msgstr` lines. `po.test.ts` holds it byte-equal to `@lingui/format-po`'s serializer (`foldLength: 0`; a newline splits a string over lines). If the formatter's options change, that test is where it shows. |
| environment | `@anthropic-ai/sdk` 0.133.0 (devDependency, exact). Server-side refusal fallback is `betas: ['server-side-fallback-2026-07-01']` + `fallbacks: 'default'`; `claude-opus-5-5`'s default effort is `medium`, so `high` is set. The prompt-cache minimum on this model is 512 tokens, so the back-translation system (rules only) is never cached. |
| queries-go-through-a11y-labels | A suite rendering a non-English catalog cannot query by English labels. `catalogs.test.tsx` finds rows by the untranslated list name instead. |
| for step 5 (layout) | Length-hint overruns (largest: "Owner" badge 10–12 characters in es/it/be/bg against about 7, nb "Trekker tilbake …" 17 against about 12, the To Do sort labels 12–17 against about 10), and German "Meine Listen" wrapping to two lines on web at 390 px. |
