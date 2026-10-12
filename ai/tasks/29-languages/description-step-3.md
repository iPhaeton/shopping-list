# Step 3 — Server messages, translated on the phone

The user requests, decisions D1–D14 and the step plan are in
[description-step-1.md](description-step-1.md). This step needs step 2.

## What this step delivers

Every message the server writes that can reach a screen is recognised on the phone and shown from the
catalog. Text that is not recognised still shows as it arrives, in English (D11). English output does not
change (D5): each mapping's English message is today's raw text exactly, so the suites' verbatim
assertions keep passing.

**No migration.**
- **The lookup:** a database message is recognised by its SQLSTATE plus its exact text.
- **Why not `hint` codes:** adding them would mean re-declaring the latest definition of the 21 functions
  and triggers that raise these messages, only to attach a hint. That risks them for no visible gain.
- **Precedent:** `SESSION_REVOKED_MESSAGE` in [listsApi.ts](../../../src/lib/listsApi.ts) already matches
  on exact text.
- **Drift guard:** a test reads the migrations (below), so a reworded message fails the suite instead of
  silently falling back to English.

## The three sources

### 1. The database: 25 distinct messages

These were scanned from the latest definition of each function in `supabase/migrations/` on 2026-10-12,
with dropped functions excluded:

| errcode | message | raised by |
|---|---|---|
| 22023 | please enter a name | set_name |
| 22023 | please enter at least 3 characters | set_name |
| 22023 | that name is taken | set_name |
| 22023 | they already have this list | invite_to_list |
| 22023 | they have already been invited | invite_to_list |
| 22023 | you already have this list | invite_to_list |
| 23514 | a list must keep at least one owner | keep_last_owner |
| 42501 | not allowed to add to this list | add_item |
| 42501 | not allowed to change this item | rename_item, set_item_deleted, set_item_done |
| 42501 | only an owner can change roles on this list | set_member_role |
| 42501 | only an owner can delete or restore this list | set_list_deleted |
| 42501 | only an owner can invite people to this list | invite_to_list |
| 42501 | only an owner can remove members from this list | remove_member |
| 42501 | only an owner can rename this list | rename_list |
| 42501 | this device has been signed out | eighteen write RPCs |
| LM001 | they already own 100 lists | check_list_limits |
| LM002 | they are already on 1,000 lists | check_list_limits |
| LM003 | this list already has 1,000 items | check_item_limit |
| P0002 | that account no longer exists | invite_to_list |
| P0002 | that person is not a member of this list | remove_member, set_member_role |
| P0002 | this invitation is no longer open | accept_invitation, decline_invitation, withdraw_invitation |
| P0002 | this invitation is no longer valid | accept_invitation |
| P0002 | this list has been deleted | accept_invitation |
| P0002 | this list is in the bin | invite_to_list |
| P0002 | you are not a member of this list | leave_list |

How each row is handled:

- **`this device has been signed out` is never shown.** It redirects
  ([session-revoked-write-redirects](../../kb/entries/session-revoked-write-redirects.md)). Keep it on an
  explicit "not displayed" list. The flag must still be read from the raw text *before* anything is
  translated, exactly as `resultFor` does today before `humanize()`.
- **The outbox's writes are already rephrased** by `humanize()`, from step 2's catalog. Its `default:`
  branch, `error.message`, now goes through the lookup too.
- **The rest reach the screen as the database wrote them**, lowercase and without a full stop. Examples are
  the Sharing screen's refusals, `set_name` on Set name and Account, and the invitation answers on
  Notifications.
  - Their English stays exactly that (D5).
  - Each one is a catalog message with a comment saying it is shown as a sentence on screen, so
    translators write a natural sentence, capitalised as their language's UI would be.
  - **Rewording the English is not this step's.** List these lines in the log as a candidate for the user.
- **`LM001`–`LM003` carry numbers**, so their messages are plurals (D6). Take the numbers from the
  constants in [limits.ts](../../../src/lib/limits.ts), never from the text. Keep the existing split:
  third person ("they") on Sharing, second person through `humanize()`.

### 2. GoTrue, through supabase-js

`error.message` is passed through in [SessionContext.tsx](../../../src/state/SessionContext.tsx)
(`requestCode`, `verifyCode`, `performSignOut`), [googleSignIn.ts](../../../src/lib/googleSignIn.ts) and
[appleSignIn.ts](../../../src/lib/appleSignIn.ts).

- **Recognise by `AuthError.code`**, e.g. `otp_expired`, `over_email_send_rate_limit`,
  `over_request_rate_limit`, `email_address_invalid` and `validation_failed`.
- **Find the real list on the local stack by provoking each failure** the sign-in screen can meet:
  - a wrong code;
  - an expired code (shorten `otp_expiry` locally, then restore it);
  - asking for codes in a quick burst;
  - a malformed address, if client-side checks let one through.

  Record each code and its English text.
- **A message with a number in it**, such as the rate limit's seconds, is matched by code. The number is
  parsed from the text into a plural message whose English output is identical. If the parse fails, show
  the raw text.

### 3. The Edge Functions

These already answer `{ code, message }`, and
[profileApi.ts](../../../src/lib/profileApi.ts) reads both.

- **Codes from `FAILURES` in [apple.ts](../../../supabase/functions/_shared/apple.ts):** `invalid_request`,
  `apple_not_linked`, `apple_code_rejected`, `apple_account_mismatch`, `apple_unavailable`,
  `apple_not_configured`.
- **Codes from [supabase.ts](../../../supabase/functions/_shared/supabase.ts):** `unauthorized` (`Not
  signed in.`). Its `42501` revoked answer redirects, as above.
- **Recognise by `code`.** The functions do not change.

## Where it lives

- **One module,** `src/lib/serverMessages.ts`, whose function turns `{ code, message }` into the
  catalog's text, or the raw text when nothing matches.
- **Every passthrough calls it,** after every check that reads the raw text:
  - `writeResult`/`humanize` and `resultFor`'s callers in [listsApi.ts](../../../src/lib/listsApi.ts);
  - [membersApi.ts](../../../src/lib/membersApi.ts) (three);
  - [notificationsApi.ts](../../../src/lib/notificationsApi.ts) (three);
  - [profileApi.ts](../../../src/lib/profileApi.ts);
  - `SessionContext.tsx`, `googleSignIn.ts`, `appleSignIn.ts`.
- **Check for code that compares a returned error string** to a literal. A translated string would break
  that comparison.
- **Raw library text for a failed fetch** (no connection) is left as it is today. Where it reaches a
  screen, list the case in the log as a candidate for the user (D5).

## The drift test

`serverMessages.test.ts`:

- **Database:** reads `supabase/migrations/*.sql` in order, keeps the last definition of each function
  (dropping dropped ones), and collects every `errcode = '…', message = '…'` pair. Each pair must have a
  mapping, or sit on the "not displayed" list with its reason.
- **Edge Functions:** reads [apple.ts](../../../supabase/functions/_shared/apple.ts) and
  [supabase.ts](../../../supabase/functions/_shared/supabase.ts) as text and does the same for their
  codes.
- **GoTrue:** the codes found above are listed in the module, and each has a mapping.
- **English:** every mapping's English output equals its raw text, with the number restored for plurals.

## Verification

1. `npm test` (no expected string changed), `npm run typecheck`, `npm run i18n:check`.
2. **In the browser against local** ([supabase-local-stack](../../kb/entries/supabase-local-stack.md)), in
   `pseudo` through the dev switch, then in `en`. Provoke:
   - an invite to someone already on the list;
   - a taken name on Set name;
   - a wrong sign-in code;
   - an invitation answered twice (accept, then accept from a stale screen).

   `pseudo` shows pseudo text and `en` shows today's text. Never `db reset`; local may hold the
   load-test users.
3. **The log lists** the GoTrue codes found with their English, and the candidates for the user: the
   lowercase database lines and the raw fetch-failure text.

## After this step

- Write `implementation-log-step-3.md` beside this file. End it with a **KB candidates** table: this
  step's KB impact rows below, as actually built, plus anything else the step taught.
- Do not run `/librarian deposit 29`, whatever CLAUDE.md says. Step 7 deposits the whole task.

## KB impact

| entry | change |
|---|---|
| session-revoked-write-redirects | the revoked flag is still read from raw text, now before translation as well as before `humanize()` |
| new candidate | server messages are recognised by SQLSTATE + exact text, or by GoTrue/Edge Function `code`; the drift test parses the migrations; a reworded `raise` needs its mapping updated |
