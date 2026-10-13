# Step 1 — implementation log (2026-10-12): Lingui foundations, SetNameScreen converted

Lingui 6.9.1 wired into Metro, Babel, Jest and the CLI; the plural polyfills; `pickLocale` (D2);
`supportedLocales` in `app.json`; the dev-only pseudo-locale and deep-link switch; `SetNameScreen`
converted. English unchanged: every existing suite passes unedited. Built on `55432c1`. Uncommitted.

**Not done: every simulator verification (3–6) and the `supportedLocales` tag search.** The agent's
Xcode build drove the 8 GB Mac's load to ~160 and the Mac was restarted mid-build; the user then
built and installed the dev client themselves, but the booted simulator left `simctl` hanging, and
the user chose to skip the simulator part (Problems hit). What stands in for it: Jest under Node's
ICU, the web build in Chromium, and a production iOS bundle export.

## What changed

**Packages.** All `@lingui/*` pinned exactly (no caret) — they depend on each other at exact versions.

| package | version | kind |
|---|---|---|
| `@lingui/core`, `@lingui/react` | 6.9.1 | runtime |
| `@lingui/cli`, `@lingui/babel-plugin-lingui-macro`, `@lingui/format-po` | 6.9.1 | dev |
| `@formatjs/intl-locale` | ^5.3.12 | runtime |
| `@formatjs/intl-pluralrules` | ^6.3.15 | runtime |
| `expo-localization` | ~57.0.2 (`npx expo install`) | runtime |

`@lingui/metro-transformer` is not installed: catalogs are precompiled TypeScript, never `.po` imports.

**Config and tooling**
- `babel.config.js` (new): `babel-preset-expo` + `@lingui/babel-plugin-lingui-macro`. jest-expo's
  `resolveBabelOptions` finds it and `extends` it; Metro's `loadBabelConfig` does the same.
- `lingui.config.ts` (new): `locales` = `[...LOCALES, PSEUDO_LOCALE]` imported from
  `src/i18n/locales.ts` (jiti loads the TS); `fallbackLocales: { default: 'en' }`; one catalog
  `<rootDir>/src/locales/{locale}/messages` over `src` + `App.tsx`, excluding `src/locales/**` and
  tests; `format: formatter({ lineNumbers: false })`; `orderBy: 'message'`; `pseudoLocale` as an object
  (below). `defineConfig` comes from `@lingui/cli`, which re-exports `@lingui/conf`'s.
- `package.json` scripts: `i18n:extract` (`lingui extract --clean`), `i18n:compile` (`lingui compile
  --typescript`), `i18n:check` (`node scripts/i18n-check.mjs`).
- `package.json` Jest: `"transform": { "\\.mjs$": "babel-jest" }` (Jest merges it with the preset's,
  ours first) and `@lingui/.*|@formatjs/.*|@messageformat/.*` appended to the
  `transformIgnorePatterns` allowlist.
- `scripts/i18n-check.mjs` (new): `lingui check sync --clean` (Lingui 6's own non-writing extract
  check), then a compile check: snapshot every `src/locales/*/messages.ts`, compile in place, compare,
  and on any difference restore the snapshot (deleting files that were not there) and exit 1 listing
  them.
- `app.json`: `["expo-localization", { "supportedLocales": { "ios": D1, "android": D1 } }]`, the 21 tags
  exactly as D1 spells them. `allowDynamicLocaleChangesAndroid` unset. **The iOS tags are unverified**
  (not opened in Settings).

**Catalogs** — `src/locales/<22 locales>/messages.po` + `messages.ts`, generated, committed with the
code. 5 messages, all `SetNameScreen`'s. The 20 non-English catalogs have empty `msgstr`s and compile
to the English text (fallback), so the production bundle carries "Pick a name" 21 times.

**`src/i18n/`** (new)
- `locales.ts` — `LOCALES` (D1, `as const`), `AppLocale`, `PSEUDO_LOCALE = 'pseudo'`,
  `SUPPORTED_LOCALES` (`{ ios, android }`, both `LOCALES` today — the place a platform-specific tag
  goes once the Settings search finds one), and pure `pickLocale` (D2). No React Native import,
  because the CLI loads it in plain Node. `locales.test.ts`: the 10 mapping cases the step lists, an
  unsupported language before a supported one, Bosnian alone → `en`, no match → `en`, device order
  kept, and `app.json`'s two lists equal `SUPPORTED_LOCALES` (android also equals `LOCALES`).
- `polyfills.ts` — `@formatjs/intl-locale/polyfill-force.js`, `@formatjs/intl-pluralrules/polyfill-force.js`,
  then `locale-data/en.js` first and one file per D1 language. `polyfills.test.ts`: the polyfill
  replaced Node's `PluralRules`; `supportedLocalesOf([tag])` returns each of the 21 tags; `pl` 5→many,
  `pt-PT` 0→other, `sl` 2→two, `sr-Latn` and `sr-Cyrl` 3→few, `nb` 1→one; `pseudo` resolves to `en`.
- `devLink.ts` — `parseDevLocaleLink` (regex on `shopping-list://dev/locale/<x>`, optional trailing
  `/`; `x` ∈ `LOCALES` ∪ `pseudo` ∪ `device`) and `listenForDevLocaleLinks` (RN `Linking`: `url`
  events and `getInitialURL`). `devLink.test.ts`: 6 accepted, 6 rejected (the dev client's own
  `exp+shopping-list://expo-development-client/…` link among them).
- `index.ts` — imports the 21 compiled catalogs into a `Record<AppLocale, Messages>` (a catalog
  missing from it is a type error) and `i18n.load`s them; `followDevice()` at module load
  (synchronous, before the first render); a module-level `AppState` listener re-runs it on `active`;
  `show()` activates only when the locale differs. Under `__DEV__`: `require` the pseudo catalog and
  `./devLink`; a link sets `devOverride` (held across foregrounds) or, for `device`, clears it and
  follows the device again.

**App wiring**
- `index.ts` (root): `import './src/i18n/polyfills'` first, before `expo` and `App`.
- `App.tsx`: `<I18nProvider i18n={i18n}>` outermost, above `SafeAreaProvider`. No `defaultComponent`.
- `jest.setup.ts`: imports at the top; `i18n.loadAndActivate({ locale: 'en', messages })` from
  `src/locales/en/messages`; `jest.mock('@lingui/react')` whose `useLingui` returns
  `useContext(LinguiContext) ?? { i18n, _: i18n.t.bind(i18n) }` and whose `Trans` wraps the real one in
  `LinguiContext.Provider` with that fallback when no provider is above.
- `src/screens/SetNameScreen.tsx`: title and hint → `<Trans comment="…">` inside their `<Text>`;
  `placeholder` and `accessibilityLabel` → one `t\`Your name\``; `label={t\`Continue\`}`; the retryable
  error → `t\`You need a connection to set your name.\``. `const { t } = useLingui()` sits with the
  other hooks, above the `if (!session) return null`. The server's `failure` text is untouched (step 3).
- `.maestro/flows/set-locale.yaml` (new, **never run**): `openLink: shopping-list://dev/locale/${LOCALE}`,
  optional `Open` tap.

## The pattern for step 2

Verified by compiling with the macro plugin (`@babel/core` `transformSync`) and running
`@lingui/core` in Node, 2026-10-12.

| case | write | compiles to |
|---|---|---|
| JSX text | `<Text style={…}><Trans>Pick a name</Trans></Text>` (`Trans` from `@lingui/react/macro`) | `<Trans id message />` from `@lingui/react`; renders a bare string, so the host tree is unchanged |
| string prop: `accessibilityLabel`, `placeholder`, `title`, `label`, `accessibilityHint` | `const { t } = useLingui()` (from `@lingui/react/macro`), then ``t`Your name` `` | `_useLingui()._({…})` — the context's `_`, so the component re-renders on a switch |
| outside React | `msg`/`t`/`plural` from `@lingui/core/macro`, called at call time | `i18n._({…})` on the global `i18n` |
| translator comment | `<Trans comment="…">`; `t({ message: '…', comment: '…' })`; `msg({ message, comment })` | `#.` lines in every `.po` |
| context | `<Trans context="button">Done</Trans>`; `t({ message: 'Done', context: 'state' })` | a different ID per context |
| plural, in React | `t({ message: plural(count, { one: '# item', other: '# items' }), comment })` | one `_t({ message: '{count, plural, …}', values: { count } })` |
| plural, JSX | `<Plural value={count} one="# list" other="# lists" />` (`@lingui/react/macro`) | `<Trans … values={{ count }} />` |

Rules that came out of it:
- **`<Trans>` always inside a `<Text>`.** No `defaultComponent`, deliberately: with `Text` as default,
  every `<Trans>` would add a nested host `Text`.
- **Never `t(plural(…))`.** `plural()` from `@lingui/core/macro` is already a complete lookup
  (`i18n._({…})`); wrapping it in `t` looks its English result up a second time. Put `plural(…)` in
  `message:` (or `` t`${plural(…)}` ``).
- **The plural's value must be a plain identifier.** `plural(list.count, …)` produces `{0, plural, …}`;
  `const count = list.count; plural(count, …)` produces `{count, plural, …}`, which a translator can
  read. The same holds for `${…}` placeholders.
- **`#` is formatted by the active locale** (Node ICU): 1000 → `1,000` en, `1.000` de, `1000` pl,
  `1 000` fr. Not yet measured on Hermes.
- **Module-level constants become functions.** `OWNED_LISTS_FULL` and friends in `src/lib/limits.ts`
  freeze the locale active at import; `grouped()` there is the hand-rolled formatting D6 retires.
- **Same English, same meaning → one message.** `SetNameScreen`'s placeholder and label share
  "Your name" and so share one catalog entry.
- **Jest:** a suite that calls `jest.resetModules()` gets a fresh `@lingui/core` with no active locale
  (`arrange.test.ts` and `supabaseTarget.test.ts` do, today without translated code).

## Decisions beyond the description

- **Pseudo padding is Lingui's own, not a post-compile step.** Lingui 6 accepts `pseudoLocale` as an
  object passed to the `pseudolocale` library: `{ locale: 'pseudo', extend: 0.4, extendCharacter: '·',
  prepend: '[', append: ']' }`. `pad()` adds 20% on each side. "Pick a name" → `[··Ƥĩćķ à ńàḿē··]`.
  The string form `pseudoLocale: 'pseudo'` that the step names is deprecated in 6.
- **The provider gap in Jest is closed by a mock, not by editing suites.** `useLingui()` and `Trans`
  throw `useLingui hook was used without I18nProvider` whenever `NODE_ENV !== 'production'`, and suites
  render screens bare. Same shape as the existing safe-area mock in `jest.setup.ts`.
- **`en` is activated explicitly in Jest**, not through `pickLocale(getLocales())`, so jest-expo's
  mocked device (`en-US`) cannot change what suites assert, and helpers using `@lingui/core/macro`
  outside React see an active locale.
- **The dev switch is `require`d behind `if (__DEV__)`**, which Metro constant-folds out of production,
  `require`s included — confirmed in an exported bundle (Verification).
- **The listeners live in `src/i18n/index.ts` at module level**, as the step places them, not in a
  component.
- **`i18n:check` restores what it compiled over**, so a failed check leaves the tree unchanged.
- **The "before" plan**: Phase A was to build the dev client and shoot "before" on old JS. After the
  build failed, the plan became serving HEAD's `App.tsx`, `index.ts` and `SetNameScreen.tsx` for the
  shot, with backups kept in gitignored `.expo/` because `/private/tmp` does not survive a reboot. The
  swap was done and undone without a shot; the restored files were `cmp`-identical to the backups.

## Verification

1. **Tests.** `npm test` at load 15: 40 suites, 1052 tests, all pass. The only new suites are the 3 in
   `src/i18n/`; `git diff` touches no existing suite. A later full run at load ~75 (simulator up) timed
   out 9 tests in `ListsContext`, `ListsScreen` and `ListDetailScreen` (122–370 s per suite); each
   passed alone (174/174, 57/57) on the same code. `npm run typecheck` clean.
2. **Catalogs.** `npm run i18n:check` passes on the current tree. Shown failing both ways, then put
   back: a changed `` t`Continue` `` → `FAIL sync: Found 22 out-of-sync catalog file(s).`; a German
   `msgstr` edited without compiling → `FAIL compiled: … src/locales/de/messages.ts`, and that file was
   byte-identical to its original afterwards. A second `i18n:extract` a minute later left `en/messages.po`
   byte-identical: `POT-Creation-Date` is written once and kept.
3. **The engine — not measured on the phone.** In its place:
   - Jest (Node's ICU, behind `polyfill-force`): the polyfill test above.
   - Web (Chromium, dev server, `Intl.PluralRules` forced): `__addLocaleData` present, `pl` 5 → `many`,
     `pt-PT` 0 → `other`.
   - Node `@lingui/core`: `#` per locale as in the pattern section.
   - Still owed on the iPhone 18 Pro: `typeof Intl.PluralRules` / `RelativeTimeFormat` without the
     polyfill, the four selects with it, `NumberFormat('de'|'pl').format(1000)`. The probe script was
     written and not run.
4. **English unchanged on the phone — not shot.** In its place: the suites' verbatim queries ("Pick a
   name" is not queried, but `Your name`, `Continue` and the retryable sentence are), and web's Sign
   in screen loading. `SetNameScreen`'s host tree is identical by construction (`<Trans>` returns a
   string inside the same `<Text>`).
5. **Pseudo on the phone — not shot**, and whether the dev client passes
   `shopping-list://dev/locale/…` through to `Linking` is **unknown**. The compiled pseudo catalog is
   shown above.
6. **Per-app language (German) — not done.**
7. **Web.** `npm run web` (cleared cache) loads Sign in with 0 errors; 2 warnings, both older
   (`RNGoogleSignIn … not-implemented method on web`, `props.pointerEvents is deprecated`).
8. **Production bundle** (`npx expo export --platform ios --no-bytecode`): "Pick a name" 21×,
   `__addLocaleData` 21×, and 0× each of `Ƥĩćķ`, `dev/locale` and `listenForDevLocaleLinks` — D10 holds.

## Problems hit

- **`@messageformat/*` is ES modules too.** The first Jest run failed in every suite:
  `node_modules/@messageformat/date-skeleton/lib/options.js:11 export class DateFormatError extends
  Error {` — `SyntaxError: Unexpected token 'export'`, via `@lingui/message-utils/dist/compileMessage.mjs`
  ← `@lingui/core/dist/index.mjs` ← `jest.setup.ts`. Adding `@messageformat/.*` to the allowlist fixed
  it. Lingui's own `.mjs` loaded as CommonJS once transformed: without `--experimental-vm-modules`,
  `vm.SyntheticModule` is absent, so jest-resolve's `shouldLoadAsEsm` returns false for every file.
- **The 8 GB Mac could not build the dev client under load.**
  - Before the build: swap at 6.8 of 8 GB. Supabase was stopped (`npx supabase stop`, data kept).
  - `npx expo prebuild --platform ios --no-clean` and `LANG=en_US.UTF-8 pod install` worked:
    `CFBundleLocalizations` has the 21 tags, and the `ExpoLocalization` pod (57.0.2) is installed.
  - `npx expo run:ios --device "iPhone 18 Pro" --no-bundler` reached the pod targets at load 160. The
    Mac was then restarted at 20:31: `/Library/Logs/DiagnosticReports/shutdown_stall_2026-10-12-203145_MacBook-Pro.shutdownStall`
    exists, and DerivedData still held the Oct 6 app. **Agents should not run this build on this
    machine.** The user built and installed it (app binary 21:12, `CFBundleLocalizations` present).
- **The simulator afterwards.**
  - It sat at load 200 → 50 for 30+ minutes, with `diskimagesiod` at ~100% CPU and
    `parsec-fbf`/`amsaccountsd` at ~25%, while 36% of memory was free.
  - `simctl spawn … defaults read`, `simctl terminate`, `simctl openurl` (×2) and `simctl io …
    screenshot` each hung for more than a minute at 0% CPU, while `simctl bootstatus` answered
    "Device already booted".
  - Metro's `/json/list` stayed `[]`: the app never connected. The user then said to skip the simulator.

## State left

- Uncommitted. `ios/` is regenerated (`--no-clean`) with the plugin and pods.
- The iPhone 18 Pro simulator is booted with the 21:12 dev client.
- Metro is stopped; the supabase stack is stopped (data kept); Docker Desktop is not running since the
  reboot.
- `app.json`'s iOS tags are D1's as written; nobody has looked at Settings.
- **`/librarian deposit 29` was not run** (the user skipped it). The KB candidates below are
  undeposited; step 7 deposits them with every other step's (description-step-1.md, request 9).

## Still owed (for whoever picks the simulator up)

1. Settings → ShoppingLoop → Language. iOS may show it only with two or more preferred languages.
   Record the listed languages, whether `be`, `sr-Cyrl` and `sr-Latn` appear, and whether `nb`/`pt-PT`
   need `no`/`pt_PT`. Then fix `SUPPORTED_LOCALES.ios` and `app.json` together; the test holds them
   equal.
2. The engine numbers through Metro's inspector (step 3 of this description). HEAD's `index.ts` has no
   polyfill import, so it gives the "disabled" reading with no edit.
3. Set name before/after shots, the `set-locale` pseudo shot, and whether the dev client passes the link
   through; then German via Settings → relaunch → English, no crash.

## KB candidates

| entry | candidate fact |
|---|---|
| scope-boundaries | the interface in D1's 20 languages (21 catalogs), chosen by the device (D2), no in-app picker |
| search-fold-fallbacks-ship | D9's string search: Android's Hermes (`libhermesvm.so`, 2026-09-27) contains `Collator`. iOS runtime numbers were not measured in step 1 |
| native-build-toolchain | expo-localization's plugin → `CFBundleLocalizations` (21 D1 tags, unverified in Settings); on the 8 GB Mac the agent's Xcode build at load ~160 ended in a restart, so the user builds the dev client; after the user's install, the booted simulator hung `simctl terminate`/`openurl`/`spawn`/`io` for minutes while `bootstatus` said booted |
| queries-go-through-a11y-labels | labels are catalog messages now; Jest runs in `en` (`jest.setup.ts`), so queries stay English |
| new: Lingui 6 in Metro/Babel/Jest | ES-modules-only; Jest needs the `.mjs` transform and `@lingui|@formatjs|@messageformat` allowlisted (why: no vm modules → CommonJS); Babel's `require esm` path + Node 24's `require(esm)`; Metro unchanged |
| new: Jest's Lingui fallback | `jest.setup.ts` activates `en` and mocks `@lingui/react` to fall back to the global `i18n` without a provider; the `resetModules` caveat |
| new: plural polyfill | Hermes lacks `Intl.PluralRules` (string search only); `polyfill-force` + per-locale data; `.js` suffixes required by `exports`; `en` first (default/pseudo); `pt-PT` own file; one `sr` file for both scripts |
| new: the catalog workflow | extract → compile `--typescript` → commit; `i18n:check` both halves; PO header stable; `orderBy: 'message'`, no line numbers; untranslated catalogs compile to English |
| new: locale choice and dev switch | D2 in `pickLocale`; the module-load activation; `devOverride` held across foregrounds; `shopping-list://dev/locale/<x>`, dev only, folded out of production (bundle-checked); untested on a device |
| new: the macro pattern | the table and rules above, especially `t(plural())` and identifier-only plural values |
