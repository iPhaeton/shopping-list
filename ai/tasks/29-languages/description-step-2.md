# Step 2 — Every user-facing string into the catalog, English unchanged

The user requests, decisions D1–D14 and the step plan are in
[description-step-1.md](description-step-1.md). This step needs step 1, and follows the macro pattern its
log records.

## What this step delivers

Every string a person can see or hear goes through Lingui, so `pseudo` turns the whole app into pseudo text.
English stays byte for byte what it is today (D5). No other catalog gets content yet: that is step 4's job.

## What counts as user-facing

**In:**

- **JSX text** in every screen ([src/screens/](../../../src/screens/)) and component
  ([src/components/](../../../src/components/)).
- **Spoken or visible props:** `accessibilityLabel`, `accessibilityHint`, `accessibilityValue.text`,
  `placeholder`, and the app's own text props (`EmptyState`'s `title`, pill and button labels, and the
  like).
- **Navigation `title` options** in [RootNavigator](../../../src/navigation/RootNavigator.tsx): `Choose a
  name`, `My Lists`, `Blocked people`, plus List detail's `setOptions` title. No screen has a native
  header, but web uses these as the document title.
- **Sentences that code sets as errors:**
  - [useListWrites.ts](../../../src/state/useListWrites.ts) (six);
  - [useOutbox.ts](../../../src/state/useOutbox.ts);
  - [reloadPages.ts](../../../src/state/reloadPages.ts);
  - `'Not signed in.'` in [SessionContext.tsx](../../../src/state/SessionContext.tsx);
  - `RESET_STARTED` and `RESET_FAILED` in [appleSignIn.ts](../../../src/lib/appleSignIn.ts);
  - `'Sign-in did not return an identity token'` in `appleSignIn.ts` and
    [googleSignIn.ts](../../../src/lib/googleSignIn.ts);
  - the screens' `OFFLINE_*` constants and inline `You need a connection to …` sentences.
- **Sentence builders and copy tables:**
  - [searchCopy.ts](../../../src/lib/searchCopy.ts): `coverageLine`, `noMatchesTitle`, `NO_MATCHES_HINT`,
    `searchSummary`;
  - [limits.ts](../../../src/lib/limits.ts): `OWNED_LISTS_FULL`, `LISTS_FULL`, `ITEMS_FULL`,
    `listLimitSentence`;
  - [ago.ts](../../../src/lib/ago.ts);
  - the sentences `humanize()` returns in [listsApi.ts](../../../src/lib/listsApi.ts) (step 3 adds the
    server's own);
  - `TITLES` and `describeNextChange` in [resolveTheme.ts](../../../src/state/resolveTheme.ts);
  - [NotificationsScreen](../../../src/screens/NotificationsScreen.tsx)'s `verb` sentences,
    `ROLE_ARTICLE` and outcomes;
  - role names wherever they are shown.

**Out:**

- developer-facing text: the missing-env message in [supabase.ts](../../../src/lib/supabase.ts), and
  `throw new Error(...)` that never reaches a banner;
- console output;
- the feature-test strings in [arrange.ts](../../../src/state/arrange.ts) (`'Item 2'`);
- text in tests;
- everything D4 names: anything a person typed.

## Rules

1. **One sentence is one message.** Never concatenate translated fragments, because word order differs by
   language.
   - **Notifications:** the sentence is built today as `` `${n.actorName}${verb}${n.listName}` ``. It
     becomes three whole messages, one per `kind`, each a `<Trans>` with the two bold `<Text>`s as
     components, e.g. `<0>{actorName}</0> invited you to <1>{listName}</1>`. Lingui keeps nested elements
     as numbered tags, so a language may reorder them.
   - **`coverageLine`:** each English sentence shape becomes its own message, or one message with an ICU
     `select` when the shapes share structure. Its variants are status × searching/sorting × "of total" or
     not × lists/items.
   - **`searchSummary`:** the comma-joined accessibility value. Its parts may stay separate messages joined
     by a translated list separator, because it is a list. Say so in the comment.
   - **Role phrases:** `as a writer` and the like become whole messages selected by role, not an article
     table plus a translated noun.
   - **`describeNextChange`:** `Night from {time}`, `Day from {time}`, `{theme} all day today`. Each theme
     name gets its own whole message. The time keeps today's formatting (D13).
2. **Plurals on every number (D6).**
   - Lingui's `#` and `{n, number}` format with the active locale through `Intl.NumberFormat`, which Hermes
     has (step 1 measured it).
   - **`grouped()`** in `limits.ts` goes. Anything that still needs a bare formatted number calls
     `Intl.NumberFormat(i18n.locale)`. English output is unchanged (`1,000`).
   - **`ago()`** becomes four messages: `just now`, `{n, plural, other {# min ago}}`, and likewise for `h`
     and `d`. Keep its `now` parameter and its boundaries. No `RelativeTimeFormat` (D9).
3. **No constant holds translated text.** `OWNED_LISTS_FULL`, `LISTS_FULL`, `ITEMS_FULL`,
   `NO_MATCHES_HINT`, the screens' `OFFLINE_*`, `RESET_*` and similar become functions, or `msg`
   descriptors resolved at render, so the active locale applies at use, not at import.
4. **Comments for translators.** Each one is written into the PO file as context for step 4.
   - **Every message with a person's name or a list name** carries D7's rule: inserted as typed, never
     inflected, gender unknown, so no gendered past tense.
   - **Short labels that are ambiguous out of context** say what they are and where:
     - `Share`, `Done`, `Back`, `Edit`, `Cancel`, `Day`, `Night`, `Auto`, `Owner`, `Writer`, `Reader`,
       `Bin`, `Restore`;
     - verb or noun; button, heading or state.
   - **Strings only VoiceOver reads** say so.
   - **Tight controls** (pills, segmented pickers, header buttons, the add bar) state roughly how many
     characters fit. Step 5 tunes these numbers.
5. **`context`** separates identical English with different meanings (D3). Look for them: the extract
   merges identical source text silently.

## The suites

D5 holds: no expected string changes.

- **What may change.** Seven suites import a constant that rule 3 turns into a function:
  - `ListsScreen.test.tsx`, `ListsContext.test.tsx`, `BlockedPeopleScreen.test.tsx`;
  - `notificationsApi.test.ts`, `NotificationsScreen.test.tsx`, `listsApi.test.ts`, `appleSignIn.test.ts`.

  They may change only how they reference it: `LISTS_FULL` becomes `listsFull()`.
- **Nothing else.** If any other edit to a suite seems needed, English changed, and that is a bug in this
  step.
- **New tests:**
  - `ago()` keeps its boundaries in `en`, and in `pl` gives the right forms for 1, 2, 5 and 22;
  - `coverageLine` produces each of today's English sentences;
  - activating `pseudo` in Jest makes a screen render no plain English. Pick two screens.

## Finding what was missed

- **Pseudo screenshots.** Every screen is touched by this step, so every screen and state with text is shot
  in `pseudo`, through the dev switch, on the iPhone 18 Pro simulator. Shoot targeted flows, not
  `shoot-all.sh`. Any plain English left is a miss; fix it and shoot again.

  | screen | states |
  |---|---|
  | Sign in | email entry, code entry, an error |
  | Set name | (as in step 1) |
  | Lists | empty, with lists, search with coverage line, no matches, bin, at a limit |
  | List detail | items, search, bin, read-only, the list-full banner |
  | Sharing | roster, Invited, role picker, a refusal |
  | Account | Appearance with the Auto hint, the sign-out and delete confirms |
  | Notifications | each `kind`, each outcome, the block confirm |
  | Blocked people | empty, with rows |

- **A grep.** List JSX text nodes and the props named above that are still plain string literals outside a
  macro. Paste the empty result, or the justified leftovers, into the log.

## Verification

1. `npm test` and `npm run typecheck` pass, with only the suite edits allowed above.
2. `npm run i18n:check` is clean.
3. **The catalog's size.** Record in the log: the number of messages in `src/locales/en/messages.po`, and
   how many are plurals. Step 4 estimates cost from them.
4. **The pseudo shots** above, in `screenshots/step-2/pseudo-*.png`.
5. **English unchanged.** Shoot Lists, List detail and Notifications in English and compare them with the
   same screens before this step, in `screenshots/step-2/en-before-*.png` and `en-after-*.png`. Any visible
   difference is a bug.

## After this step

- Write `implementation-log-step-2.md` beside this file.
- Run `/librarian deposit 29`.

## KB impact

| entry | change |
|---|---|
| queries-go-through-a11y-labels | labels and empty-state copy are catalog messages; suites still assert the English verbatim |
| new candidates | one sentence per message (no glued fragments); no constant holds translated text; names are never inflected (D7) |
