# Step 6 — The sign-in code email in every language

The user requests, decisions D1–D14 and the step plan are in
[description-step-1.md](description-step-1.md). This step needs step 4's script.

## What this step delivers

The sign-in code email arrives in the app's language. The language is saved on the account as
`user_metadata.locale`, and one generated template chooses its text from it. English stays word for word
what [task 27](../27-sign-in-email/description-step-1.md) shipped (D5).

## Why `user_metadata`

GoTrue renders the email, and the email is sent before the person is signed in. The only per-user data
the template sees is `.Data`: the user's `user_metadata`. So the app writes the language there, and the
template reads it.

**The accepted limit.** A returning user's email uses the language saved at their last signed-in session.
The first email after they change their device's language arrives in the old one. Apple and Google
sign-ins never send this email.

## The app

- **A new address.** `requestCode` in [SessionContext.tsx](../../../src/state/SessionContext.tsx) passes
  `options.data: { locale }`, the active catalog (D1), beside `shouldCreateUser: true`.
  - Under autoconfirm, `/otp` creates the user and sends `magic_link`
    ([otp-email-templates-carry-the-code](../../kb/entries/otp-email-templates-carry-the-code.md)).
  - Confirm that the metadata is already set when that first email renders.
- **A signed-in session.** When `session.user.user_metadata.locale` differs from the active catalog, call
  `supabase.auth.updateUser({ data: { locale } })`.
  - **When:** once per session start, and again when the language changes.
  - **On failure:** ignore it, and it is retried at the next start.
  - **Confirm it merges:** `full_name`, which [appleSignIn.ts](../../../src/lib/appleSignIn.ts) saves into
    the same object and [SetNameScreen](../../../src/screens/SetNameScreen.tsx) reads, must survive.
  - **Confirm the `USER_UPDATED` event** keeps the signed-in state as it is, without a flash or a re-gate.
    `SessionContext`'s comment on metadata updates says it does.
- **Tests:** both calls carry the active catalog, and nothing is written when the saved value already
  matches.

## The email's text: a second catalog

- **Declare the email's messages** with `msg` in a small module of their own, e.g.
  `supabase/templates/otp-code.messages.ts`, one message per block of
  [otp-code.html](../../../supabase/templates/otp-code.html):
  - the subject;
  - the heading;
  - the intro, with `{email}`;
  - the expiry;
  - the safety line;
  - the footer, with the address as a placeholder inside a tag.

  The English is task 27's text exactly. "One hour" stays words, matching `otp_expiry = 3600`.
- **A second catalog.** `lingui.config.ts` gets a second entry, at
  `supabase/templates/locales/{locale}/messages`, that includes only that module. The app's catalog
  excludes it, so the email's text never ships in the bundle.
- **Same script, same rules.** `scripts/translate.mjs` translates both catalogs, including the
  transliteration to `sr-Latn`. It also rejects any translation containing `{{`, or a six-digit number.

## The generator

`scripts/build-email.mjs` writes two things from the email catalog.

### 1. `supabase/templates/otp-code.html`

- **The rationale comment comes first**, closed with `*/ -}}`, and names fields without braces, as today.
- **Then** `{{ $l := or .Data.locale "en" }}`, then the document.
- **Each text block** is a chain: `{{ if eq $l "de" }}…{{ else if eq $l "fr" }}…{{ else }}English{{ end }}`.
- **`<html lang>`** comes from the same chain.
- **Translations are HTML-escaped.** `{email}` becomes `{{ .Email }}`. `{{ .Token }}` stays in the
  skeleton.
- **Confirm in Mailpit:**
  - that `.Data` is the user's metadata in both slots;
  - that `or` turns a missing `locale` into `en`;
  - that an empty metadata object does not break the template.

### 2. The two `subject` lines

These are `[auth.email.template.confirmation]` and `[auth.email.template.magic_link]` in
[config.toml](../../../supabase/config.toml).

- **The same chain, standalone:** `{{ $l := or .Data.locale "en" }}{{ if eq $l "de" }}…{{ end }}`.
- **Written as TOML literal strings** (`'…'`), so the template's double quotes need no escaping.
- **Rewrite only those two lines.** They stay at the root and production inherits them. Nothing is
  restated under `[remotes.production]`.
- **Evidence that GoTrue renders a subject as a template:** its own default reauthentication subject is
  `{{ .Token }} is your verification code`, in `internal/mailer/templatemailer` of supabase/auth.
  Confirm it in Mailpit.

### The generator's check mode

`--check` fails if either output would change. Add it to `npm run i18n:check`.

### What must stay true

From [otp-email-templates-carry-the-code](../../kb/entries/otp-email-templates-carry-the-code.md):

- exactly two `content_path` lines;
- no `<!--`;
- `{{ .Token }}` after the comment;
- no all-digit hex colours;
- **the code is the first standalone six-digit run in Mailpit's `Text`, in every language.** Maestro and
  the seed script read it from there.

`npm run kb:audit` checks the first three.

## Verification

1. **Restart the local stack:** `npx supabase stop && npx supabase start`. Never `db reset`
   ([supabase-local-stack](../../kb/entries/supabase-local-stack.md)).
2. **In Mailpit** (http://127.0.0.1:54324), for each case check the subject, the body, `lang`, and the
   first six-digit run in `Text`, then finish a sign-in with the code through Playwright on web.
   - **A new address in German:** the app on web in `de` through the dev switch, or
     `POST /auth/v1/otp` with `"data": {"locale": "de"}`.
   - **`maya3@example.com` in Polish:** sign in on web in `pl` so `updateUser` runs, sign out, then ask
     for a code.
   - **A user with no `locale`:** English.
   - **`sr-Latn` and `be`:** the right script.
3. **Shots for the user's sign-off:** the German and Polish emails in Mailpit, saved to
   `screenshots/step-6/`.
4. `npm test`, `npm run typecheck`, `npm run i18n:check` and `npm run kb:audit` pass.
5. **Production. The user runs this; the agent never does.**
   - **Why the user:** `config push` asks `[Y/n]` with Y as the default, and under automation it once
     fired on production
     ([supabase-config-push-sends-the-whole-root](../../kb/entries/supabase-config-push-sends-the-whole-root.md)).
   - **The commands**, at a real terminal, without `--yes`. They are task 27 step 1's:

     ```bash
     set -a; . ./.env; set +a
     test -n "$RESEND_API_KEY" && echo "key set"
     npx supabase config push
     ```

   - **Expect in the diff** the two subjects and the template. The user confirms anything else in it, or
     stops the push.
   - Paste the printed diff into the log.
6. **After the push:**
   - the user asks for a code on their phone (cloud) with the app in a language other than English, and
     reports the subject's and body's language;
   - record inbox or spam as well
     ([cloud-auth-mail-goes-through-resend](../../kb/entries/cloud-auth-mail-goes-through-resend.md)).

## After this step

- Write `implementation-log-step-6.md` beside this file. End it with a **KB candidates** table: this
  step's KB impact rows below, as actually built, plus anything else the step taught.
- Do not run `/librarian deposit 29`, whatever CLAUDE.md says. Step 7 deposits the whole task.

## KB impact

| entry | change |
|---|---|
| otp-email-templates-carry-the-code | the template and both subjects are generated by `scripts/build-email.mjs` from a second catalog, so never edit them by hand; they choose by `.Data.locale` with `en` as the default; GoTrue renders subjects as templates (if confirmed) |
| support-address-and-mail-domains | the footer's address is a placeholder in every language, never translated |
| new candidate | the app writes `user_metadata.locale` (new address: `signInWithOtp` data; signed in: `updateUser` when it differs); the accepted limit of a stale language on the first email after a change |
