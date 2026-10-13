# Step 3 — implementation log (2026-10-13): server messages, translated on the phone

Every server message that can reach a screen is now recognised on the phone and shown from the
catalog. This covers database `raise`s, GoTrue errors and Edge Function answers. Text the app does not
recognise shows as it arrives (D11). English is byte for byte (D5): no existing suite was edited, and
1,097 tests pass. No migration, and no Edge Function change. Built on `e80388c`. Uncommitted.

**No simulator, at the user's request** ("No testing on simulator"). The browser checks ran on web in
Chromium (Playwright, 390×844) against the local stack, through step 2's `__setDevLocale` switch.

## What changed

**`src/lib/serverMessages.ts` (new).** It imports nothing from supabase-js. It takes a structural
`ServerFailure = { message: string; code?: string | null }`, which auth-js `AuthError`, postgrest-js
errors and an Edge Function body all satisfy.
- **`recognise(failure): string | null`** tries three tables. The codes are disjoint, and the test
  asserts it.
  1. **`DATABASE`:** SQLSTATE, then exact text. 24 mappings.
  2. **`EDGE_FUNCTIONS`:** `code` alone. The 6 `FAILURES` codes of `supabase/functions/_shared/apple.ts`,
     plus `unauthorized` from `_shared/supabase.ts`.
  3. **`fromAuth`:** a `switch` on the GoTrue code.
- **`serverMessage(failure)`** is `recognise(failure) ?? failure.message`.
- **`NOT_DISPLAYED`:** one pair, `42501 / this device has been signed out`, with its reason. It is
  never shown: it redirects.
- **`SESSION_REVOKED_MESSAGE`** moved here from `listsApi.ts`, and `listsApi.ts` imports it back. The
  line `sessionRevoked: error.code === '42501' && error.message === SESSION_REVOKED_MESSAGE` is
  unchanged, because the KB audit greps it.
- **Exports for the drift test:** `AUTH_SAMPLES` (the recorded GoTrue errors), `DATABASE_MESSAGES` and
  `EDGE_FUNCTION_CODES`.
- **Lookups** use own properties only (`hasOwnProperty`), so a code like `constructor` returns `null`.
  The test covers it.

**Call sites.** Every `error.message` that passes server text through is now `serverMessage(error)`.

| file | sites |
|---|---|
| `listsApi.ts` | `resultFor` (`error`), `humanize`'s `default:`, the 5 reads (`fetchLists`, `fetchItems`, `fetchItem`, `fetchList`, `fetchListCounts`) |
| `membersApi.ts` | the 3 reads (`fetchMembers`, `searchUsers`, `fetchInvitations`); its 5 writes go through `resultFor` |
| `notificationsApi.ts` | the 3 reads (`fetchNotifications`, `fetchUnreadCount`, `fetchBlockedUsers`); its writes go through `resultFor` |
| `profileApi.ts` | `fetchProfile`; `setName`, `deleteAccount` and `deleteAccountWithApple` go through `resultFor`, which now recognises the Edge codes |
| `SessionContext.tsx` | `requestCode`, `verifyCode`, `performSignOut` |
| `googleSignIn.ts`, `appleSignIn.ts` | the `signInWithIdToken` error; Apple's `status === 500` check still reads the raw error first |

- **What still reads the raw error:**
  - `resultFor`'s `sessionRevoked` and `verdictFor`;
  - `notificationsApi`'s `isRetryable`;
  - `acceptInvitation`'s limit rephrasing (by code);
  - `humanize`'s switch (by code).
- **Comparisons with a literal.** The only code that compares a returned error string to a literal is
  that `sessionRevoked` check (searched across `src/`, tests excluded).
- **Unchanged, not server text:**
  - Apple's native `signInAsync` rejection (`(error as Error).message`);
  - `fetchUnreadCount`'s `'unexpected answer'`, which `NotificationsContext` never displays.

**`src/lib/serverMessages.test.ts` (new, 11 tests).** The first suite that reads repo files
(`node:fs`, paths from `__dirname`).
- **Database.**
  - It strips `--` comments, then walks `supabase/migrations/*.sql` in filename order.
  - One regex takes `create [or replace] function public.<name>(… $$body$$` and
    `drop function [if exists] public.<name>`, in source order. The last body per name wins, and a
    drop deletes the name, as the KB audit's own parse in `session-still-valid-guards-writes` does.
  - The header part may not contain `create `, so a function without a `$$` body cannot swallow the
    next one.
  - It collects `errcode = '…', message = '…'` pairs (with `''` unescaped). It finds exactly the
    spec's 25.
  - It asserts that the set equals `DATABASE_MESSAGES` plus `NOT_DISPLAYED`, in both directions: a new
    or reworded raise fails, and so does a stale mapping.
  - Every mapping's `en` output equals its raw text, `1,000` and `100` included.
- **Edge Functions.**
  - It parses `FAILURES` (`code: { status, message: "…" }`; one message sits on its own line).
  - It parses `_shared/supabase.ts`'s `?? 'unauthorized'` / `?? 'Not signed in.'` and its literal
    `code: '42501', message: '…'`.
  - The codes must equal `EDGE_FUNCTION_CODES`, and the English must equal the files' messages.
  - The `42501` pair must equal `NOT_DISPLAYED`.
  - It throws with a clear message if `supabase.ts` no longer matches those patterns.
- **GoTrue.**
  - Every `AUTH_SAMPLES` entry is recognised, with English identical to the recorded text.
  - The rate limit's seconds round-trip for 1 and 59.
  - These come back `null` and raw: an unparseable text under a known code (including `Email rate
    limit exceeded`), an unknown code, `constructor`, and no code at all.
  - The code sets are disjoint.
- **Pseudo.** With `pseudo` loaded and active, every mapping's output differs from its English, which
  proves all of them are in the catalog.
- **Mutation-checked.** Renaming the key `'that name is taken'` to `'that name is in use'` failed 2
  tests and printed the diff; the key was then restored.

## Recognition rules, as built

- **Database: SQLSTATE plus exact text.** The codes are shared (every permission refusal is `42501`),
  so only the text says which refusal it was.
  - **The English is the database's words exactly:** lowercase, no full stop.
  - **Each comment** says where the text shows, and that it is shown as a sentence: the English is the
    database's own words, so write a natural sentence, capitalised and punctuated as the language's
    UI would be.
  - **Messages about "they"** add "one person whose gender is unknown: avoid gendered forms" (D7).
- **Numbers (D6) come from the code, never parsed from the database's text.**
  - **The limits:** `LM001`, `LM002` and `LM003` are plurals on `MAX_OWNED_LISTS`, `MAX_LISTS` and
    `MAX_ITEMS` (`limits.ts`): `they already own # lists`, `they are already on # lists`,
    `this list already has # items`.
    - They stay in the third person, the existing split. `humanize()` and `acceptInvitation` still
      rephrase them in the second person.
    - **`please enter at least 3 characters`** is also a plural (`{characters, plural, other {…}}`),
      on a local `const characters = 3`. No client constant exists; `SetNameScreen` and
      `AccountScreen` compare with a literal `3`.
- **Outbox-only messages are mapped too.** These are `not allowed to add to this list`, `not allowed to
  change this item`, `only an owner can rename this list`, `only an owner can delete or restore this
  list` and `LM003`.
  - Only the 7 outbox writes raise them, and `humanize()` rephrases them by code, so today they never
    show.
  - The spec's "every pair mapped or not displayed" allowed either choice. Mapping costs 5 catalog
    messages and keeps a future non-outbox caller from showing English.
  - Their comments say "Rarely shown; the app usually says this in its own words".
- **Edge Functions: `code` alone.** Each code has one message, written in this repo. `unauthorized`
  → `Not signed in.` carries the same comment as `SessionContext`'s `notSignedIn()`, so extraction
  merges them into one message with two origins. That is the only merge.
- **GoTrue: the code, plus the text's shape where needed.**
  - **`otp_expired`: the code alone.** A GoTrue that rewords it still gets the translation. In `en` it
    would then show the catalog's English rather than the new text, a theoretical D5 drift accepted
    for robustness.
  - **`validation_failed`:** GoTrue uses this code for unrelated failures, so the exact text is
    required too.
  - **`over_email_send_rate_limit`:** an anchored regex parses the seconds into
    `plural(seconds, { other: 'For security purposes, you can only request this after # seconds.' })`.
    The same code also answers the hourly limit with `Email rate limit exceeded`. That text has no
    number, so the regex returns `null` and the text shows raw.
  - **Only codes observed on the local stack are mapped** (below).

## GoTrue: what the local stack answered

The setup:
- supabase-js 2.112.4 (the app's own), in a scratch Node script (`createRequire` on the repo's
  `package.json`, `persistSession: false`), so `code` and `message` are exactly what the app receives;
- GoTrue v2.196.0 (`supabase/.temp/gotrue-version`), CLI 2.116.0.

| provoked | status | `code` | `message` | mapped |
|---|---|---|---|---|
| a wrong code (`000000`) | 403 | `otp_expired` | Token has expired or is invalid | yes (code alone) |
| a code with a letter (`12345a`) | 403 | `otp_expired` | Token has expired or is invalid | yes |
| the right code, 70 s after it was sent with `otp_expiry = 60` | 403 | `otp_expired` | Token has expired or is invalid | yes |
| addresses `maya3`, `maya3@`, `@example.com`, `a b@example.com`, `maya3@@example.com` | 400 | `validation_failed` | Unable to validate email address: invalid format | yes (exact text) |
| a second code request within `max_frequency` (local 1 s) | 429 | `over_email_send_rate_limit` | For security purposes, you can only request this after 0 seconds. | yes (seconds parsed) |
| addresses `a@b`, `maya3@example` | — | — | accepted: a code was sent and an account created; both deleted with psql | — |
| 3 requests sent concurrently | — | — | all accepted: concurrent requests read the old send time; only sequential ones trip the limit | — |
| 45 wrong verifications in about 2 s | 403 | `otp_expired` every time | no rate limit | — |

- **Not provokable locally, so unmapped.** These show raw English until someone records them:
  - **`over_request_rate_limit`:** GoTrue applies its per-IP request limits only when a rate-limit
    header is configured, and the local auth container sets none (`GOTRUE_RATE_LIMIT_VERIFY=30` is
    present but inert). That is how 45 verifications went through. The cloud sets the header.
  - **The hourly `Email rate limit exceeded`:** the local container has
    `GOTRUE_RATE_LIMIT_EMAIL_SENT=360000`.
  - **`email_address_invalid`:** nothing local produced it; `a@b` was accepted.
  - **`signInWithIdToken` failures for Apple and Google:** neither runs on web.
- **The expired-code probe.** It set `otp_expiry = 60` in `supabase/config.toml`, then ran
  `supabase stop && start`. The auth container showed `GOTRUE_MAILER_OTP_EXP=60`. After the probe
  the file was restored, with another stop && start (`GOTRUE_MAILER_OTP_EXP=3600`), and
  `git diff supabase/config.toml` came back empty.
- **The local wait reads 0 seconds** because local `max_frequency` is 1 s. On the cloud (60 s) the
  sentence carries the real wait. The app's own 60-second resend cooldown hides it except after Use a
  different email, followed by the same address.

## Catalog

- **285 messages:** 252 before, plus 33 new. That is 24 database, 6 Edge Function (7 codes, with
  `Not signed in.` merged) and 3 GoTrue.
- **35 plurals:** 30 before, plus `characters`, the three limits and `seconds`.
- **5 contexts:** unchanged.
- **Every new msgid equals its raw text**, apart from the plural wrappers. They were read in
  `en/messages.po` after extraction, and nothing merged by accident.
- **The 20 other catalogs** carry the new messages untranslated (step 4).

## Browser checks (web, local stack)

Each case was provoked under `__setDevLocale('pseudo')`, then provoked again under `'device'` (`en`).
An error held in state keeps the language it was made in, so each was re-provoked after the switch.
Shots are in `screenshots/step-3/`.

| case | how | pseudo | en |
|---|---|---|---|
| a taken name on Set name | `i18n-s2-1`'s name nulled with psql; its persisted web session landed on Set name; typed `Maya3`, Continue | `[···ţĥàţ ńàḿē ĩś ţàķēń···]` | `that name is taken` |
| a wrong sign-in code | maya3, Send code, `000000` | `[······Ţōķēń ĥàś ēxƥĩŕēď ōŕ ĩś ĩńvàĺĩď······]` | `Token has expired or is invalid` |
| an invite to someone already on the list | as maya3, Sharing on Hardware store, Priya selected, then Priya inserted into `list_members` with psql, then Invite | `[·····ţĥēŷ àĺŕēàďŷ ĥàvē ţĥĩś ĺĩśţ·····]` | `they already have this list` |
| an invitation answered twice | two tabs on Notifications; tab B's `rpc/my_notifications` aborted with `page.route`, so it stayed stale; Accept in A, then Accept in B. "Bake sale" for pseudo, "Road trip" for en | `[······ţĥĩś ĩńvĩţàţĩōń ĩś ńō ĺōńĝēŕ ōƥēń······]` | `this invitation is no longer open` |

- **The browser console** had no Lingui errors. The only errors were the expected network failures:
  the 400 from `set_name`, and the offline requests.
- **Tab A fell back to My Lists** when tab B opened. It was reopened; the cause was not investigated.
- **A pseudo artifact from step 2.** Pseudo labels with a trailing placeholder put the closing `]`
  before the inserted name, e.g. `[····Àććēƥţ ĩńvĩţàţĩōń ţō ····]Bake sale`. The name is still
  untranslated (D4).

## Candidates for the user (not changed: D5)

**1. The lowercase database lines.** These reach the screen as the database wrote them, lowercase and
without a full stop. Rewording the English would mean editing the `raise` itself (a migration
re-declaring the function), plus its mapping. Not this step's job.

| screen | messages |
|---|---|
| Sharing | they already have this list, they have already been invited, you already have this list, a list must keep at least one owner, only an owner can change roles on this list, only an owner can invite people to this list, only an owner can remove members from this list, that account no longer exists, that person is not a member of this list, this invitation is no longer open (withdraw), this list is in the bin, you are not a member of this list, they already own 100 lists, they are already on 1,000 lists |
| Set name, Account | that name is taken (please enter a name and please enter at least 3 characters are blocked client-side first) |
| Notifications | this invitation is no longer open, this invitation is no longer valid, this list has been deleted |
| none today (`humanize()` rephrases them) | not allowed to add to this list, not allowed to change this item, only an owner can rename this list, only an owner can delete or restore this list, this list already has 1,000 items |

GoTrue's `Token has expired or is invalid` has no full stop either, while
`Unable to validate email address: invalid format` and the rate-limit sentence have their own
punctuation.

**2. Raw library text for a failed fetch.** This passes through as it is: it has no code, so
`serverMessage` returns it unchanged. Web shows the texts below; iOS's fetch says
`Network request failed` instead.

| where | text on web | evidence |
|---|---|---|
| Sign in: Send code (and Verify) offline | `Failed to fetch` (auth-js `AuthRetryableFetchError`) | seen: `en-offline-sign-in.png` |
| Sharing: opening the roster offline (`load()` → `setError(roster.error)`) | `TypeError: Failed to fetch` (postgrest-js) | seen: `en-offline-sharing.png` |
| Lists: the first hydration fails with no cache (`ListsContext` → `setError(failure)`; `reloadPages` keeps `page.error` when one exists) | `TypeError: Failed to fetch` | by reading |
| Account: Sign out or Sign out of all devices offline | not seen: auth-js `_signOut` removes the local session even when `/logout` fails, so the screen unmounts first. The raw text shows only if loading the stored session itself fails (an expired access token whose refresh fails offline) | tried on web: signed out silently; auth-js source read |

Every other synchronous caller (Set name, Account's name and delete, Notifications, Blocked people)
classifies a fetch failure as `retryable` and shows its own "You need a connection…" sentence.

## Problems hit

- **Docker Desktop came up half-started.** Its backend had stayed alive after step 2's shutdown, and
  its VM was unreachable: the monitor log showed `dialing 192.168.65.7:2376: no route to host`, and
  `docker ps` returned a 500.
  - **Fix:** `osascript -e 'quit app "Docker"'`, then `open -a Docker`. The daemon was ready in 5 s.
  - **At the end:** `quit app "Docker"` reopened the tray instead of quitting. `docker desktop stop`
    stopped it cleanly, with 0 backend processes left. Use it.
- **The first burst probe never tripped the limit.** Concurrent requests all read the old send time.
  Sequential requests trip it at once.
- **The rate limits can't be provoked locally** (above). The plan's "map only what was observed" held,
  so `over_request_rate_limit` is unmapped.
- **The step-2 browser profile was still signed in as `i18n-s2-1`.** Once its name was nulled, the
  restored session's background refresh moved it to Set name, so the taken-name case needed no fresh
  sign-in.

## Verification

1. `npx jest`: 44 suites, 1,097 tests passed (1,086 before, plus 11). `git diff --stat -- '*.test.*'`
   is empty: no existing suite changed, and the only new one is `serverMessages.test.ts`.
2. `npm run typecheck`: clean.
3. `npm run i18n:check`: PASS (sync) and PASS (compiled).
4. `npm run kb:audit`: 6 errors, the same 6 as HEAD (step 2's; step 7 owns them). Nothing new.
   - The two lines this step could have broken still match:
     - the `sessionRevoked` line, and `insertList`'s insert (`session-still-valid-guards-writes`);
     - the module seam, with no supabase-js import outside `supabase.ts` (`supabase-client-module-boundary`).
5. **The browser checks** above: 4 cases × 2 locales, plus 2 offline shots, in `screenshots/step-3/`.

## State left

- **Nothing committed.** No `/librarian deposit 29` (step 7).
- **Stopped:** the web server, Supabase (`supabase stop`, data kept) and Docker
  (`docker desktop stop`). The simulator was not touched.
- **`supabase/config.toml`:** unchanged, after its temporary `otp_expiry = 60`.
- **Local data:**
  - **maya3:** the same six step-2 notification cards (verified). A membership for Priya on "Hardware
    store" was inserted, then deleted.
  - **Priya:** the seeded lists "Bake sale" and "Road trip" were hard-deleted with psql. That cascaded
    to `list_members`, `list_invitations` and `notifications`, including Priya's two
    `invitation_accepted` cards.
  - **`i18n-s2-1@example.com`:** its name was nulled, then saved back as `Limit Tester S2` through Set
    name.
  - **The probe accounts** `a@b` and `maya3@example` were created, then deleted (`auth.users`,
    cascading to `public.users`).
  - **Mailpit** holds about a dozen extra code emails for maya3, priya and i18n-s2-1.
- **The web browser profile:** signed out, on Sign in.

## KB candidates

| entry | change |
|---|---|
| session-revoked-write-redirects | The revoked flag is still read from the raw text: `resultFor` computes `sessionRevoked` from `error.message` while `error` itself goes through `serverMessage`. So it is read before translation as well as before `humanize()`. `SESSION_REVOKED_MESSAGE` now lives in `src/lib/serverMessages.ts`, where `NOT_DISPLAYED` lists it; `listsApi.ts` imports it, and the audited line is unchanged. |
| new: server messages are recognised on the phone | `src/lib/serverMessages.ts` recognises by: database SQLSTATE plus exact text; Edge Function `code`; GoTrue `code`, plus the text's shape where it carries a number or the code covers unrelated texts. Unrecognised text stays English (D11). Every `error.message` passthrough in `src/lib/*Api.ts`, `SessionContext` and the sign-in modules calls `serverMessage`. **A reworded or new `raise`, or a new `FAILURES` code, fails `serverMessages.test.ts`**, which parses the migrations (last definition per function, drops removed) and the Edge Function sources: add or update the mapping, then extract and compile. |
| new candidate: GoTrue texts observed | GoTrue v2.196.0: `otp_expired` / "Token has expired or is invalid" covers a wrong code, a malformed code and an expired one; `validation_failed` / "Unable to validate email address: invalid format"; `over_email_send_rate_limit` / "For security purposes, you can only request this after N seconds." (the same code also answers "Email rate limit exceeded"). Locally, `over_request_rate_limit` cannot be provoked (no rate-limit header) and neither can the hourly email limit (360,000/h), so both are unmapped. Concurrent OTP requests slip past `max_frequency`. |
| supabase-local-stack (or native-build-toolchain's environment notes) | Docker Desktop can stay half-started after a quit (backend alive, VM unreachable, `docker ps` 500). Quit and reopen it. Stop it with `docker desktop stop`, since `osascript quit` may reopen the tray. |
| new candidate: suites may read repo files | `serverMessages.test.ts` is the first suite to read files outside `src/` (`node:fs`, `__dirname`-relative); `tsconfig`'s `types` already has `node`. |
| candidates for the user | The lowercase database lines, and the raw fetch-failure text on Sign in, Sharing and Lists (tables above): D5 left them as they are. |
