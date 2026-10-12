# Step 1 — Languages: the foundations, and one screen converted

User requests (2026-10-11 and 2026-10-12), verbatim, in order. This whole task comes from them:

1. "I want the app to support multiple languages. Suggest a way to do that."
2. "Explain clearly, Why not a library like i18next or Lingui."
3. "Compare approaches if I wnat all available languages"
4. "Will the translation be pre-created or happen on the fly?"
5. "How many languages are we talking if it is only european languages available in ios?"
6. "How does difficulty depend on the number of languages? E.g. how much are 20 languages more difficult
   than 10 languages?"
7. "I want these languages: English, German, French, Spanish, Italian, Portuguese, Swedish, Norwegian,
   Finnish, Polish, Czech, Slovak, Slovenian, Croatian, Hungarian, Serbian, Belarusian, Russian,
   Ukrainian, Bulgarian. Create the tasks for "Lingui, with your own AI translation script.""
8. Four answers given with request 7, to questions asked in chat:
   - Portuguese: "Portugal (pt-PT)".
   - Spanish: "Spain (es-ES)".
   - Serbian: "Both" — Cyrillic is translated; Latin is generated from it letter by letter.
   - Tone: "Like iOS does" — per language, the formal or informal "you" that iOS itself uses.

The design was argued in chat only; there is no suggestion document. These descriptions are the spec.

## Decisions — settled, not open

| # | decision |
|---|---|
| D1 | **21 catalogs for 20 languages:** `en` (the source), `de`, `fr`, `es` (Spain), `it`, `pt-PT`, `sv`, `nb`, `fi`, `pl`, `cs`, `sk`, `sl`, `hr`, `hu`, `sr-Cyrl`, `sr-Latn`, `be`, `ru`, `uk`, `bg`. Plus `pseudo`, in dev builds only (D10). |
| D2 | **The device decides. There is no in-app picker.** Walk `getLocales()` in order, and the first entry that maps to a catalog wins. If none maps, use `en`. Map by `languageCode`, except: any `pt` (Brazil included) → `pt-PT`; `no`, `nb`, `nn` → `nb`; `sr` → `sr-Latn` when `languageScriptCode` is `Latn`, else `sr-Cyrl`. There is no cross-language fallback, so Bosnian does not get Croatian. iOS's per-app Language setting comes from expo-localization's `supportedLocales`. |
| D3 | **Lingui 6** (6.9.1 on 2026-10-12), with PO catalogs and macros. The English source text identifies each message (Lingui derives the ID), so a changed English sentence shows as *missing* in every other catalog. When the same English text needs two translations ("Done" as a button vs. as a state), the messages differ by `context`. |
| D4 | **Translations are made ahead of time, never at runtime.** Catalogs are committed and compiled into the bundle. Nothing translates on the device or over the network. Anything a person typed is never translated: list names, item titles, people's names, email addresses. |
| D5 | **English copy does not change.** Every string the app shows in English after this task is the string it shows today, byte for byte, unless a step says otherwise. The proof is the suites' verbatim assertions and label queries, which pass with their expected text unedited. Jest runs in `en`. |
| D6 | **Every message containing a number is an ICU `plural` on that number**, even where English reads the same either way ("This list is full: 1,000 items at most."). Polish, Czech, Slovak, Russian, Ukrainian, Belarusian, Croatian and Serbian have 3–4 forms, and Slovenian has a separate form for two. Numbers are formatted for the active locale (`1,000` in `en`, `1.000` in `de`, `1000` in `pl`). |
| D7 | **Names are never inflected and never gendered.** `{name}` and `{list}` are inserted as typed, in the nominative. The app does not know anyone's gender. In D1's Slavic languages a past-tense verb agrees with its subject's gender ("Anna zaprosiła" / "Jan zaprosił"), so a sentence about a named person must use a present tense, a passive, or a label form instead. This is carried as a translator comment on every such message (step 2) and as a rule in the translation prompt (step 4). |
| D8 | **The tone follows iOS** (request 8). Each language uses the form of address iOS itself uses in that language. Step 4 records the choice per language in the glossary, and the user checks it. |
| D9 | **Polyfills, not hand-written rules.** A string search of the built engines on 2026-10-12 found `Collator`, `DateTimeFormat` and `NumberFormat`, but no `PluralRules` and no `RelativeTimeFormat`. The binaries searched were the iOS 27 simulator's `hermesvm.framework` and the Android `libhermesvm.so` built 2026-09-27. So the app ships `@formatjs/intl-locale` and `@formatjs/intl-pluralrules`, imported from `/polyfill-force` as Lingui's React Native guide says, with locale data for every catalog. There is no `RelativeTimeFormat` polyfill, because `ago()` becomes plural messages (step 2). The string search is evidence, not a measurement: this step measures at runtime. |
| D10 | **A pseudo-locale and a dev-only language switch** exist for checking. Neither is in a production bundle. |
| D11 | **Server messages are translated on the phone** (step 3). The database is not changed. Text the app does not recognise is shown as it arrives, in English. |
| D12 | **Translations come from `scripts/translate.mjs`** (step 4), which sends only missing entries to the Claude API. `sr-Latn` is never sent to the model: it is transliterated from `sr-Cyrl`. |
| D13 | **Unchanged by this task:**<br>• the brand `ShoppingLoop` and `support@shopping-loop.com`;<br>• collation and the search fold ([search-fold-fallbacks-ship](../../kb/entries/search-fold-fallbacks-ship.md));<br>• how clock times are formatted: the device locale, as today;<br>• fonts: Nunito Sans and Source Serif 4 have every letter of D1's languages, Serbian and Belarusian included (checked with fontTools on 2026-10-12);<br>• layout direction: left to right only. |
| D14 | **Out of this task:** the App Store listing, the website, App Store screenshots, verification on Android (testing is iOS-only, and the Android dev client is stale), and any language beyond D1. |

## The steps

| step | delivers |
|---|---|
| 1 (this) | Lingui wired into Metro, Babel, Jest and the CLI; the polyfills; locale choice; `supportedLocales`; the pseudo-locale and dev switch; `SetNameScreen` converted as the pattern. English unchanged |
| 2 | every other user-facing string in the catalog: screens, components, helpers, sentence builders, accessibility props. English unchanged |
| 3 | server messages translated on the phone: the database's 25 messages, GoTrue's error codes, the Edge Functions' codes |
| 4 | `scripts/translate.mjs`, the glossary, the 19 translated catalogs, the `sr-Latn` transliteration, and a back-translation review |
| 5 | the layout pass: every screen in German, Finnish, Hungarian and pseudo on the iPhone 18 Pro simulator; fixes; the user's sign-off |
| 6 | the sign-in code email in every language: `user_metadata.locale`, a generated template and subject, Mailpit; the production push is the user's |

Dependencies:
- 1 → 2 → 3.
- Step 4 needs 2. If step 3 lands after it, rerun the script for 3's new messages; it translates only what is missing.
- Steps 5 and 6 both need 4.

Each step ends with its log and `/librarian deposit 29`, as CLAUDE.md says. There is no separate deposit
step.

**Scope change.** [scope-boundaries](../../kb/entries/scope-boundaries.md) gains: the interface in D1's
languages, chosen by the device.

## This step

Read Expo's v57 docs for `expo-localization` before writing code (AGENTS.md):
https://docs.expo.dev/versions/v57.0.0/sdk/localization/. Read Lingui's React Native tutorial
(https://lingui.dev/tutorials/react-native) and its v6 migration notes
(https://lingui.dev/releases/migration-6).

### Packages

- **Runtime:** `@lingui/core`, `@lingui/react`, `@formatjs/intl-locale`, `@formatjs/intl-pluralrules`, and
  `expo-localization` through `npx expo install` (57.0.2 on 2026-10-12).
- **Dev:** `@lingui/cli`, `@lingui/babel-plugin-lingui-macro`, `@lingui/format-po`.

**Lingui 6 ships only as ES modules.** Its migration guide makes `@lingui/metro-transformer` the one
CommonJS exception, and it needs Node ≥ 22.19 (this machine has 24.11). Three loaders must accept it:

- **Metro**, when bundling.
- **Babel 7.29**, loading the macro plugin. Metro and babel-jest load plugins synchronously, which works
  for an ES module only under Node's `require(esm)`.
- **Jest 29 under jest-expo**, for runtime imports of `@lingui/*`. These likely need adding to the
  `transformIgnorePatterns` allowlist in `package.json`.

If any of the three cannot be made to work with reasonable effort, pin Lingui 5.x (CommonJS) instead.
Record the failure verbatim in the log. Do not mix major versions.

### Config and catalogs

- **`babel.config.js` (new):** `babel-preset-expo` plus `@lingui/babel-plugin-lingui-macro`. The repo has
  none today, so check that jest-expo and Metro both pick it up.
- **`lingui.config.ts`:**
  - `sourceLocale: 'en'`;
  - `locales`: D1 plus `pseudo`;
  - `pseudoLocale: 'pseudo'`;
  - `fallbackLocales: { default: 'en' }`;
  - one catalog at `src/locales/{locale}/messages`, including `src/` and `App.tsx`;
  - PO through `@lingui/format-po`'s formatter function (v6 dropped the `format` string);
  - a deterministic message order, so a diff shows only what changed.
- **Compiled TypeScript catalogs, committed.** `lingui compile --typescript` writes `messages.ts` beside
  each `.po`.
  - **Why not the Metro transformer's `.po` imports:** Jest would need its own `.po` transform, and
    committed output makes what ships reviewable.
  - **`pseudo` is excluded from production** (D10). It is loaded only under `__DEV__`.
- **`package.json` scripts:**
  - `i18n:extract`: `lingui extract --clean`;
  - `i18n:compile`;
  - `i18n:check`: fails if extracting or compiling would change a committed file. Every later step runs it
    as part of its verification.

### `src/i18n/`

- **`locales.ts`:** D1's list, as the one source of truth.
  - `pickLocale(locales)` implements D2. It is pure.
  - Unit tests cover every mapping rule: `pt-BR`, `pt-PT`, `no`, `nb`, `nn`, `sr` with `Latn`, `sr` with no
    script, `sr` with `Cyrl`, `en-GB`, `es-MX`, an unsupported language before a supported one, and no
    match at all.
- **`polyfills.ts`:**
  - imports `@formatjs/intl-locale/polyfill-force` and `@formatjs/intl-pluralrules/polyfill-force`;
  - adds plural data for every D1 locale. `pt-PT` needs its own data, because its `one` differs from
    `pt`'s (`pt` puts 0 in `one`). Check how the package names the `nb` and `sr` data files.
  - It is imported first in `index.ts`, before `App`.
- **`index.ts`:**
  - loads every compiled catalog; all of them are bundled;
  - activates `pickLocale(getLocales())` synchronously at module load, before the first render, so there
    is no flash of English;
  - `I18nProvider` goes outermost in `App.tsx`, above `ThemeProvider`, because the theme's Auto hint is
    text;
  - on `AppState` → `active`, it activates `pickLocale(...)` again if the result changed. iOS relaunches the
    app when its per-app language changes, so this is for Android and web.
- **The rule for code outside React**, stated here for step 2: helpers use `msg`/`t` from
  `@lingui/core/macro` against the global `i18n`, at call time. A module-level constant would freeze the
  locale active at import, so such constants become functions.

### `app.json`

- Add `["expo-localization", { "supportedLocales": { "ios": [...], "android": [...] } }]`.
- **The tags that work are to be found.** `supportedLocales.ios` becomes `CFBundleLocalizations` (from
  reading the 57.0.2 plugin's source). Apple's own folders in the iOS 27 runtime use `no` and `pt_PT`, and
  the runtime has no Serbian or Belarusian at all.
  - Try `nb`, `pt-PT`, `sr-Cyrl`, `sr-Latn` and `be`.
  - Open Settings → ShoppingLoop → Language on the simulator, adjust until every D1 language that iOS can
    offer is listed, and record the working list.
  - Record whether Belarusian and the two Serbians are offered at all. If not, a person reaches them only
    through the device's preferred-language list, which D2 already handles.
- **Leave `allowDynamicLocaleChangesAndroid` unset.**
- **A config plugin change means a prebuild and a new dev client** (`npm run ios`). Follow
  [native-build-toolchain](../../kb/entries/native-build-toolchain.md): check disk space first, and
  `pod install` needs `LANG=en_US.UTF-8`.
- **A test** asserts that `app.json`'s two lists equal `locales.ts`'s (JSON cannot import TypeScript).

### The pseudo-locale and the dev switch (D10)

- **`pseudo`** is compiled from `en` by Lingui's pseudolocalization. If its output is not clearly longer
  than English, pad each message by about 40% in a small post-compile step, so text that overflows shows.
- **The dev switch.** Under `__DEV__` only, the app's scheme handles
  `shopping-list://dev/locale/<catalog>`, which activates that catalog in place (Lingui re-renders).
  `shopping-list://dev/locale/device` returns to `pickLocale`.
  - **Why:** a Maestro flow can navigate by English labels, switch, shoot, and switch back
    ([maestro-drives-the-native-ui](../../kb/entries/maestro-drives-the-native-ui.md)).
  - Confirm the dev client lets the link through to the app.

### `SetNameScreen` as the pattern

Convert [SetNameScreen](../../../src/screens/SetNameScreen.tsx) completely. It is the smallest screen
that has visible text, a placeholder, accessibility props and an error banner.

- **Its own strings only.** Its database errors ("please enter a name", …) are step 3's.
- **Write the pattern into the log for step 2:**
  - which macro for which case: JSX text → `<Trans>`; props such as `accessibilityLabel`, `placeholder` and
    `title` → `useLingui().t`; code outside React → `msg`/`t` from `@lingui/core/macro`;
  - how a translator comment is written (`comment`);
  - how a plural is written;
  - how a `context` is written.

## Verification

1. **Tests:** `npm test` and `npm run typecheck` pass. No suite changes except the new tests (D5).
2. **Catalogs:** `npm run i18n:check` is clean.
3. **The engine, measured.** In the running dev build, through Metro's inspector
   ([metro-inspector-reads-live-app-state](../../kb/entries/metro-inspector-reads-live-app-state.md)),
   record:
   - with the polyfill import temporarily disabled: `typeof Intl.PluralRules` and
     `typeof Intl.RelativeTimeFormat`;
   - with it enabled:
     - `new Intl.PluralRules('pl').select(5)` → `many`;
     - `('pt-PT').select(0)` → `other`;
     - `('sl').select(2)` → `two`;
     - `('sr-Latn').select(3)` → `few`;
   - `new Intl.NumberFormat('de').format(1000)` → `1.000`, and `('pl')` → `1000`.

   This also settles part of [search-fold-fallbacks-ship](../../kb/entries/search-fold-fallbacks-ship.md)'s
   open question for iOS. Hand the results to the deposit.
4. **English unchanged.** On the iPhone 18 Pro simulator, against local
   ([supabase-target-picked-at-runtime](../../kb/entries/supabase-target-picked-at-runtime.md)), the Set
   name screen looks as before. Shoot before and after into `screenshots/step-1/`.
5. **Pseudo:** the dev switch to `pseudo` on Set name shows every string pseudo-localized. Shoot it.
6. **Per-app language:** in Settings, choose German. The app relaunches, finds no German translation yet,
   falls back to English, and does not crash.
7. **Web:** `npm run web` still loads.

## After this step

- Write `implementation-log-step-1.md` beside this file.
- Run `/librarian deposit 29`.

## KB impact

| entry | change |
|---|---|
| scope-boundaries | languages in (D1, D2) |
| search-fold-fallbacks-ship | Android's Hermes has `Collator` (binary strings, 2026-10-12); the iOS runtime numbers from verification 3 |
| native-build-toolchain | the expo-localization plugin, and the `supportedLocales` tags that work |
| queries-go-through-a11y-labels | labels are catalog messages now; Jest runs in `en`, so queries stay English |
| new candidates | Hermes lacks `Intl.PluralRules`, hence `polyfill-force`; how Lingui 6 (ES modules only) loads in Metro, Babel and Jest; the locale choice (D2); the dev switch |
