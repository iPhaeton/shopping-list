# Step 2 — implementation log (2026-10-13): every user-facing string in the catalog

Every string the app shows or speaks now goes through Lingui. English is unchanged: the 1052 existing
tests pass, and the only suite edits are reference changes (`LISTS_FULL` → `listsFull()`). Built on
`3a8145b`. Uncommitted.

**No simulator, at the user's request** ("Do not test on simulator"). Every screenshot is from web in
Chromium (Playwright, 390×844) against the local stack. A dev-only web language switch was added for
that (below).

## What changed

**Helpers outside React.** `t`/`plural`/`msg` from `@lingui/core/macro`, evaluated at call time. Every
module constant that held text is now a function.
- `src/lib/limits.ts`
  - `grouped()` removed.
  - `OWNED_LISTS_FULL`/`LISTS_FULL`/`ITEMS_FULL` → `ownedListsFull()`/`listsFull()`/`itemsFull()`, each
    a plural on its limit.
  - `listLimitSentence` calls them.
- `src/lib/searchCopy.ts`
  - `coverageLine`: 16 whole-sentence plurals, one per status × searching/sorting × shape. `total` is
    in the type for `rows: 'lists'` only, since items never pass one.
  - `noMatchesTitle`: plurals, plus `No matches for "{query}"`.
  - `NO_MATCHES_HINT` → `noMatchesHint()`.
  - `searchSummary`: `Searching {query}`, the six sort phrases, `{order}, then {next}`, all joined by
    `spokenList()`.
- `src/i18n/spokenList.ts` (new): joins a spoken list with a translated `", "`. Used by
  `searchSummary` and the Notifications card's `accessibilityValue`.
- `src/lib/ago.ts`: `just now`, then `{minutes|hours|days, plural, other {# min|h|d ago}}`. Same
  boundaries; still takes `now`.
- `src/state/resolveTheme.ts`: `TITLES` removed. Four whole messages: `Day|Night from {time}` and
  `Day|Night all day today`. `clockTime` is unchanged (D13).
- Error sentences:
  - `listsApi.ts` `humanize` (two sentences, plus the limit functions);
  - `notificationsApi.ts` `acceptInvitation`;
  - `useListWrites.ts` (6), `useOutbox.ts`, `reloadPages.ts`;
  - `SessionContext.tsx` (`notSignedIn()`);
  - `appleSignIn.ts` (`resetStarted()`, a plural on its 5 minutes, and `resetFailed()`);
  - `appleSignIn.ts` and `googleSignIn.ts` (`Sign-in did not return an identity token`).

  No code compared any of these strings to a literal (grepped first).
- `ThemeProvider` calls `useLingui()` so that the Auto hint is rebuilt on a language change.

**Components.** Each calls `useLingui()`:
- `AddBar`, `BlockedBanner`, `CoverageLine`, `ModeButton`, `ScreenHeader`, `SearchField`,
  `ShowDeletedToggle`, `SyncBanner` (a `one`/`other` plural), `ItemRow`, `ListRow`, `UserAutocomplete`.
- `RolePicker` builds its options in render.
- `SortButtons` keeps `labelFor`/`describe` outside the component, using core `t`. The component calls
  `useLingui()` only to re-render.

**Screens and navigator**
- `SignInScreen`
  - `NOTICES` → a switch in render;
  - `Sign in` is two messages, `context` `heading` and `button`;
  - `We sent a six-digit code to {address}.` uses `t`;
  - `Resend code in #s` is a plural;
  - the `you@example.com` placeholder is translatable, with a comment allowing a local example
    address.
- `AccountScreen`: `APPEARANCES`/`appearanceLabel` moved into render; `saveNameLabel`.
- `BlockedPeopleScreen`, `ListsScreen`, `ListDetailScreen`: the `30 days` hints are plurals on a local
  `PURGE_DAYS`, and `setOptions` has a `List` fallback.
- `SharingScreen`
  - `LAST_OWNER` is inline;
  - `roleBadge` (lowercase, `context: 'badge'`; the style's `textTransform: 'capitalize'` stays);
  - `inviteAs`, and `setRoleOf(name, role)`, which is one whole message per role;
  - `{name} (you)`;
  - `Invited {age}`;
  - the confirm sentences.
- `NotificationsScreen`: see Decisions.
- `RootNavigator`: titles via core `t`, plus `useLingui()`. `ShoppingLoop` stays (D13).
- `SetNameScreen` (step 1's): its three messages gained comments; their IDs are unchanged.

**Dev-only web switch (D10).**
- `devLink.ts` `exposeDevLocaleSwitch(apply)` sets `globalThis.__setDevLocale(target)`. It validates
  through `parseDevLocaleLink`, and answers whether the target was accepted.
- `src/i18n/index.ts` calls it inside the existing `if (__DEV__)` block, only when
  `Platform.OS === 'web'`, with the same `apply` the link listener uses.

**Catalogs:**
- 252 messages, 30 of them plurals.
- 5 with a `context`: `Sign in` ×2, and the badges `reader`/`writer`/`owner`.
- Every message has a translator comment.
- The 20 other catalogs are still empty (step 4).

**Tests**
- Reference-only edits in five suites:
  - `listsApi.test.ts`, `notificationsApi.test.ts`, `ListsScreen.test.tsx`,
    `NotificationsScreen.test.tsx`, `ListsContext.test.tsx`;
  - 22+/22− lines in all.
  - The spec's other two named suites, `BlockedPeopleScreen.test.tsx` and `appleSignIn.test.ts`, keep
    their own string copies and needed nothing.
- New `src/lib/searchCopy.test.ts` (22 tests):
  - every `coverageLine` shape in English, with 1 and 1,234 held;
  - a total that is not bigger than what is held;
  - `capped` ignoring the total;
  - `noMatchesTitle`, `noMatchesHint`;
  - `searchSummary`, including its documented example.
- New `src/lib/ago.pl.test.ts` (8): a hand-compiled `pl` catalog (`generateMessageId` and
  `compileMessage` from `@lingui/message-utils`):
  - minutes 1/2/5/22 → `minutę`/`minuty`/`minut`/`minuty temu`;
  - days 1/2/5/22.
- New `src/i18n/pseudo.test.tsx` (4):
  - renders Sign in (email and code steps) and Account (Auto hint, relay note, sign-out confirm;
    editing name, delete confirm) in English, inside a real `I18nProvider`;
  - switches to `pseudo` in place;
  - asserts that no host text, `accessibilityLabel`, `accessibilityHint`, `accessibilityValue.text`
    or `placeholder` has two ASCII letters in a row.

  Pseudolocale leaves `v` and `x` unaccented, hence "two in a row". Allowed: user text, `ShoppingLoop`
  and clock times (D13). Its first run caught `ShoppingLoop` and `9:01 PM`, both allowed.

## Decisions beyond the description

- **Notifications sentence: element values, not numbered tags.**
  - `sentence(kind, name, listName)` returns a `msg` descriptor: `{name} invited you to {listName}`, and
    so on, one per `kind`.
  - **JSX:** runtime `<Trans {...descriptor} />` from `@lingui/react`, with the two bold `<Text>`s as
    `name`/`listName`. Runtime `Trans` turns any non-string value into a component (`<0/>`), so a
    language still reorders them.
  - **`accessibilityValue`:** the same descriptor through `i18n._()` with plain strings.
  - **Why not the spec's `<0>{actorName}</0>`:** it needs a second message for the a11y string, and
    it parses user text (next point).
- **A message carrying user-typed text renders through `t`, never `<Trans>`.**
  - `<Trans>` runs `formatElements` (`@lingui/react/dist/shared/react.*.mjs`) over the translated
    string *after* interpolating string values.
  - So a list or person named `a<b>c</b>` loses its tags, and `x<0/>` loses the `<0/>` (D4). Read in
    Lingui 6.9.1's source; not reproduced in the app.
  - Element values (above) are never parsed.
- **English exactness over grammar.**
  - Where today's English does not change with the count, the plural has `other` only: `# loaded lists`
    even for 1, which is today's text.
  - Only `SyncBanner` had `1 change`/`n changes`, so it alone has `one`.
- **Known English change, ≥ 1000 only.** `#` groups digits in `en`, where today's text did not. This
  affects SyncBanner's pending count, the bell's unread count, `ago`'s days and `Resend code in #s`.
  None of these reaches 1000 in practice; D6 asks for locale formatting.
- **`coverageLine`'s `{loaded} of # lists`.** `loaded` governs no noun, so it is `i18n.number(held)`;
  the plural is on the total.
- **Strings already in state keep their language.**
  - An error banner set before a switch stays in the old language until it is replaced.
  - Seen while shooting: the list-full banner had to be raised after switching to pseudo.
  - Only a dev switch, or an Android/web language change, can hit this.
- **Kept as literals:**
  - Notifications' ` · ` between the lead and the age, a typographic separator;
  - Set name/Sign in's `123456` placeholder, which is digits;
  - `ShoppingLoop` (D13).
- **Shared messages.** These have the same English and the same meaning, so each is one message
  carrying one comment:
  - `Back`, `Cancel` (two comment variants), `Account`, `Notifications`, `Blocked people` (title, pill
    and nav title);
  - `Share`, `Save`, `Email`, `Name`;
  - `List not found` and its hint (List detail and Sharing);
  - `Restore {listName}` (VoiceOver label on Lists, visible pill on List detail; its comment says so);
  - `A to Z`/`Z to A` (sort value and summary).

  Lingui writes an identical comment once per use, so the `.po` repeats some `#.` lines.
- **Comments:**
  - D7's wording is repeated in every message with a person's name: as typed, never inflected, gender
    unknown, so no gendered past tense.
  - It is also in `Invited {age}`, which in Slavic languages is a participle that agrees with the
    person invited.
  - Possessives (`Withdraw {name}'s invitation`) carry a note to rephrase so the name needs no ending.
  - Tight controls state character estimates from their width and font:
    - pills about 10;
    - half-row confirm pills about 12;
    - the small role picker about 7;
    - Appearance about 9;
    - sort faces about 10.

    Step 5 tunes them.

## The pattern, refined from step 1's

| case | write |
|---|---|
| props in a component | `const { t } = useLingui()` (`@lingui/react/macro`); `t({ comment, message })` |
| JSX text, no user value | `<Trans comment="…">…</Trans>` inside its `<Text>` |
| JSX text with a user value | `t({ message: \`…${name}…\` })` as a child — never `<Trans>` |
| bold user values inside a sentence | a `msg` descriptor, rendered with runtime `<Trans {...d} />` and element values |
| outside React, or render-time helpers | core `t`/`plural`/`msg`; the rendering component calls `useLingui()` to re-render |
| a whole message per variant | a `switch` returning `t(...)` per case (`roleBadge`, `inviteAs`, `setRoleOf`, `roleLead`, `noticeFor`) |
| a list read aloud | `spokenList(parts)`, a translated separator |
| a constant placeholder name | `const days = PURGE_DAYS;` then `plural(days, …)` → `{days, plural, …}` |

A component whose child is typed `string` (`BarSentence`) takes `t(...)`, not `<Trans>`.

## Problems hit

- **`plural` is not in `@lingui/react/macro`.** `SyncBanner` first imported it from there; it comes
  from `@lingui/core/macro`.
- **Name collisions with the new constants:**
  - `AccountScreen` already had a `saveName` function, so the constant is `saveNameLabel`;
  - `SharingScreen` imports `leaveList` from `membersApi`, so the constant is `leaveListLabel`.
- **`react-test-renderer` has no types here.** RNTL 14 renders through `test-renderer`, so
  `pseudo.test.tsx` declares the node shape it reads.
- **Web check-state.** The web build exposes no `aria-checked` on `ShowDeletedToggle` (as the KB says),
  so a script that relied on it left the bin on.
- **Reaching the coverage line on web.**
  - Web pages ahead on its own, and hydration re-reads every page the cache holds.
  - The shot needed the list cache entry (`lists:<uid>`) removed from `localStorage`, a reload, then
    Playwright aborting keyset continuation requests (`or=` on `list_members`/`items`).
  - Lists gave the `failed` variant (`Searched 100 of 150 lists. The rest need a connection.`). Items
    gave `running` (`Searching 400 loaded items · loading the rest…`), since completion retries.
- **The `Invite …` refusal could not be provoked.** The suggestions leave out anyone already invited
  or a member. The refusal shot is the offline one, our own sentence. The database refusals are
  step 3's anyway.
- **The local stack's load-test users crowd the name search** (KB). `Jor` matched `Aaliyah Jordan …`,
  so the full name `Jorja` was typed.

## Verification

1. **Tests:** 43 suites, 1086 tests, all pass: 1052 existing plus 34 new.
   - `npm run typecheck`: clean.
   - `git diff --stat -- '*.test.*'`: the 5 suites above, 22+/22−, and 3 new files.
   - **Act warnings, compared against HEAD in a throwaway worktree:** 3–8 on HEAD and 3 now, all
     `VirtualizedList` timer updates. They predate this step.
2. **`npm run i18n:check`:** `PASS sync` and `PASS compiled`.
3. **Catalog size:** `en/messages.po` has **252 messages, 30 plurals**, and 5 with a context.
4. **English against HEAD.** A scratch script matched every msgid against HEAD's non-test source (JSX
   whitespace collapsed; placeholders and `#` as wildcards). 225 of 252 matched as literals. The other
   27 are exactly the sentences HEAD built from fragments:
   - `coverageLine`'s 16 shapes and the 2 partial `noMatchesTitle`s;
   - SyncBanner;
   - `as a writer`;
   - `Day|Night all day today`;
   - `Invite as …`;
   - two `Set {name} to …`.

   Covered by the new `searchCopy` test and the existing suites (Notifications' `as a writer · 2 min
   ago`, `resolveTheme`'s `Day all day today`).
5. **Leftovers scan.** A scratch `@babel/parser` script over non-test `src/**/*.{ts,tsx}` and
   `App.tsx`. It flags JSX text outside `<Trans>`, and string or template literals in
   `accessibilityLabel|accessibilityHint|placeholder|title|hint|label|visibleLabel|buttonLabel|newLabel|message|text`
   and `accessibilityValue.text`. On HEAD it lists 146; now:
   ```
   src/components/AuthFrame.tsx:45  JSX text  "ShoppingLoop"
   src/screens/NotificationsScreen.tsx:417  visibleLabel={…}  "block"
   src/screens/NotificationsScreen.tsx:438  visibleLabel={…}  "decline"
   src/screens/NotificationsScreen.tsx:453  visibleLabel={…}  "accept"
   ```
   - The brand stays (D13).
   - The other three are `running === 'block'` comparisons, not text.
6. **Pseudo shots on web.** All are in `screenshots/step-2/`, 35 in all, via `__setDevLocale` (English
   to navigate, then pseudo, shoot, back):

   | screen | shots (`pseudo-*.png`) |
   |---|---|
   | Sign in | `sign-in`, `sign-in-code`, `sign-in-error` |
   | Set name | `set-name` |
   | Lists | `lists-empty`, `lists`, `lists-coverage-line`, `lists-no-matches`, `lists-bin`, `lists-bin-empty`, `lists-at-limit` |
   | List detail | `list-detail`, `list-detail-search`, `list-detail-add`, `list-detail-bin`, `list-detail-read-only`, `list-detail-coverage-line`, `list-detail-full`, `list-detail-binned` |
   | Sharing | `sharing`, `sharing-remove-confirm`, `sharing-suggestions`, `sharing-picked`, `sharing-invited`, `sharing-withdraw-confirm`, `sharing-offline` |
   | Account | `account-auto`, `account-edit-name`, `account-sign-out-confirm`, `account-delete-confirm` |
   | Notifications | `notifications` (every kind and outcome), `notifications-block-confirm` |
   | Blocked people | `blocked-people-empty`, `blocked-people` |
   | (banner) | `sync-banner` |

   **No plain English was found** apart from:
   - user text;
   - numbers and the clock time (`5:46 PM`, D13);
   - `ShoppingLoop`;
   - GoTrue's `Token has expired or is invalid` on `sign-in-error`, which is step 3's.

   **Not shot:**
   - `BlockedBanner` (a write landing on a tombstone);
   - the revoked/deleted notices on Sign in;
   - the Apple and Google buttons, which don't render on web.

   The Jest pseudo test covers both sign-in buttons, as jest-expo renders as iOS. The notices and
   `BlockedBanner` are covered only by the leftovers scan, and by reading: each is a `t(...)`.

   **For step 5:** the pseudo text overflows these. Expected; step 5's to tune:
   - the `To Do First` sort face;
   - the small invite role picker;
   - `Yes, delete my account`.
7. **English unchanged on web.** `en-before-*` (on `3a8145b`, before any edit) and `en-after-*` of
   Lists, List detail (Groceries) and Notifications, as maya3, with maya3's unread state restored in
   between. Pixel diff:
   - **Lists:** 0 px.
   - **List detail:** 4 px at x=25, the checkbox rings' anti-aliasing.
   - **Notifications:** only the age lines ("1 min ago" → "21 min ago").
8. **Browser console**, across the whole session, in both languages:
   - no Lingui or polyfill errors;
   - every error is a request failed or aborted on purpose (offline, blocked pages), or a deliberate
     refusal (400 for the wrong code, and for the full list);
   - the two warnings predate this step (`RNGoogleSignIn` on web, `props.pointerEvents`).
9. **Production web export.** `npx expo export --platform web` gives a 1.98 MB bundle (489 KB
   gzipped). It contains 0× each of `__setDevLocale`, `exposeDevLocaleSwitch`, `dev/locale` and
   pseudo text; English messages appear 21× (the empty catalogs compile to English).

## State left

- **Uncommitted.**
- **maya3 (local) now has six notification cards**, seeded through the API by a scratch copy of
  `.maestro/seed.mjs`:
  - Priya's pending `Picnic` invitation;
  - `Garden center` (joined) and `Ski trip` (declined);
  - `Old shopping` (no longer available);
  - Jorge declined `Book club`, and Jordan accepted `Camping trip`.

  It also gained three lists behind them: `Camping trip`, `Book club` and `Garden center`. Priya was
  blocked and unblocked, `Grove Street party` binned and restored, and Jorja invited and withdrawn.
- **`i18n-s2-1@example.com` ("Limit Tester S2") exists locally**, with no lists left. Its 100 owned
  lists, 50 shared ones (owned by maya3 through the creator trigger) and 1,000 items were deleted
  afterwards.
- **Machine state:** the web server, the browser and Supabase are stopped (data kept), and Docker
  Desktop has quit, as at the start. The simulator was not touched.
- **No `/librarian deposit 29`** (request 9): step 7 deposits.

## KB candidates

| entry | candidate fact |
|---|---|
| queries-go-through-a11y-labels | labels and empty-state copy are catalog messages; Jest runs in `en`, so the suites still assert the English verbatim, and a constant that held text is a function the suite calls (`listsFull()`) |
| new: one sentence per message | never glue translated fragments: a whole message per variant (switch per role/kind/theme), `plural` on every count with `other` only where English does not vary; parts read as a list join through `spokenList()`; `coverageLine` is 16 messages |
| new: no constant holds translated text | text is produced at call time — core `t` outside React, `useLingui().t` in components; a component rendering helper output must call `useLingui()` to re-render on a switch (`ThemeProvider`, `RootNavigator`, `SortButtons`); text already in state keeps its language until replaced |
| new: user text is never parsed by `<Trans>` | Lingui 6's runtime `Trans` runs `formatElements` after interpolating string values, so a name with `<b>…</b>` or `<0/>` would be mangled: a message carrying user text renders through `t`; bold names go in as element values (`NotificationsScreen`'s `sentence()`) |
| new: names never inflected (D7) | every message with a person's name carries the comment: as typed, never inflected, gender unknown, no gendered past tense; possessives and `Invited {age}` carry a rephrase note |
| new: dev-only web language switch | `globalThis.__setDevLocale('pseudo' \| <catalog> \| 'device')` under `__DEV__` on web (`exposeDevLocaleSwitch`), absent from the production export; how the web pseudo shots were taken (Playwright `browser_evaluate`) |
| maestro-drives-the-native-ui / supabase-local-stack | reaching a paged state on web: remove `lists:<uid>` from `localStorage`, reload, abort keyset continuation requests (`or=`) with Playwright `page.route`; offline via `context.setOffline` gives the app's own connection sentences |
| phone-is-the-product | web's `ShowDeletedToggle` exposes no `aria-checked`, so scripts cannot read it (already: web shows no checked state) |
