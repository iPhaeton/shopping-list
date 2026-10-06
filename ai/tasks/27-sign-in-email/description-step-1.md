# Step 1 — Make the sign-in code email read as mail from a real service

User request (2026-10-06), verbatim. This whole task comes from it:

1. "Create a task to update the email content according to your recommendations"

The recommendations were made in chat during task 26 and are the design below. The copy is a
proposal: the user may edit this file before the step runs, and the step uses whatever it then
says, verbatim.

## Why

- **The evidence.** It was found on 2026-10-06; see
  [task 26's step-2 log](../26-apple-sign-in/implementation-log-step-2.md), "The iPhone 13 sign-ins".
  - On cloud, a sign-in code sent to a Hide My Email address reached the owner's Gmail through Apple's relay, but
    in spam.
  - Gmail's reason: "This message is similar to messages that were identified as spam in the past".
  - "Show original" gives SPF, DKIM and DMARC all `PASS`.
- **So the setup is fine.** What is left is the content, and `mail.shopping-loop.com` having no sending history.
- **The template today**, [otp-code.html](../../../supabase/templates/otp-code.html), is a heading, one line, the
  code, and "ignore this if you didn't ask". Its subject, "Your sign-in code", names no one. Nothing says who sent
  it, or how to reach them. That is also the shape of a phishing mail.
- **Every email-code sign-in on cloud gets this email**, not only relay addresses.
- **What this step can't do.** Reputation builds only with sending history, so this step cannot promise the inbox. It
  removes what makes the mail look anonymous.

## What changes

- **[otp-code.html](../../../supabase/templates/otp-code.html)**, which both template slots share.
  [otp-email-templates-carry-the-code](../../kb/entries/otp-email-templates-carry-the-code.md) still holds:
  - exactly two `content_path` lines, `confirmation` and `magic_link`;
  - nothing restated under `[remotes.production]`.
- **The two `subject` lines** under `[auth.email.template.confirmation]` and `[auth.email.template.magic_link]` in
  [config.toml](../../../supabase/config.toml). They live at the root, and production inherits them.
- **Nothing in the app.**

## The copy

| part | text |
|---|---|
| subject (both slots) | `Your ShoppingLoop sign-in code` |
| heading | `Your ShoppingLoop sign-in code` |
| intro | `We got a request to sign in to ShoppingLoop with {{ .Email }}. Enter this code in the app:` |
| code | `{{ .Token }}`, styled as today: 32 px, bold, `letter-spacing: 6px` |
| expiry | `The code expires in one hour.` |
| safety | `If you didn't ask for it, you can ignore this email. No one can sign in without the code.` |
| footer | `This email was sent by ShoppingLoop. Questions? Write to support@shopping-loop.com.` |

- **`{{ .Email }}`** names the address the code was sent to. A Hide My Email user sees their relay address, which is
  the one Account's hidden-email sentence tells them to use on other devices. Confirm that GoTrue fills it in both
  slots.
- **"One hour"** is `otp_expiry = 3600` under `[auth.email]`, and production inherits it. If either changes, the
  sentence changes with it.
- **The footer's address** is a `mailto:` link.
  [support-address-and-mail-domains](../../kb/entries/support-address-and-mail-domains.md): `support@` is the one
  public contact. Never `no-reply@` or `inbox.`.

## The form

- **A whole HTML document:**
  - `<!doctype html>` and `<html lang="en">`;
  - a `<head>` with `<meta charset="utf-8">`, a viewport meta, and a `<title>` equal to the subject;
  - a `<body>`.
- **Inline styles only:**
  - one column, about 480 px wide at most;
  - the system font stack;
  - dark text on white;
  - the footer smaller and grey, under a thin rule.
- **No images, no tracking, and no link but the `mailto:`.**
  - Do not link to shopping-loop.com. On 2026-10-06 the domain has no website: there is no `A` record for the root or
    `www`.
  - A link goes in once the pages in [app-store-release.md](../../suggestions/app-store-release.md) are live. That is
    out of this task.
- **The comment at the top goes out in every email today**, because GoTrue sends the file as written.
  - Make it a Go template comment, `{{/* … */}}`, which renders to nothing.
  - Keep its content: why the template sends `{{ .Token }}` and not `{{ .ConfirmationURL }}`, and that both slots
    use it.
  - Confirm in Mailpit's source view that no trace of it is sent.
- **A plain-text part.** Expect none, because GoTrue's templates are HTML only. Check which parts Mailpit shows,
  record it, and do not work around it.

## Out of this task

- Registering the sending domain with Apple's Private Email Relay. That is task 26's, and it comes before the
  release.
- The root domain's DMARC policy (`p=none`, which is shared with support mail), Google Postmaster Tools, and the
  Resend key's scope.
- A link to the website: there is no site yet.
- Any other auth template (invite, recovery, email change). The app sends none of them.

## Verification

1. **The local stack.** Restart it with `npx supabase stop && npx supabase start`. Never `db reset`.
2. **Both slots, in Mailpit** (http://127.0.0.1:54324):
   - Send a code to a fresh address, which gets `confirmation`, and to `maya3@example.com`, which gets
     `magic_link`. Use `npm run web` in Playwright, or `POST /auth/v1/otp`.
   - For each, check:
     - the subject;
     - the rendered body, with `{{ .Email }}` filled in and the code present;
     - the `mailto:`;
     - the source: no comment, and which MIME parts there are.
3. **The code still signs in.** On web, through Playwright, finish a sign-in with the code read from the new email.
4. **A screenshot for the user's sign-off:** the rendered email in Mailpit, saved as
   `ai/tasks/27-sign-in-email/screenshots/step-1/code-email-mailpit.png`. The user signs off the look before the
   push.
5. **Commands:** `npm run kb:audit`. The template entry's check counts the `content_path` lines.
6. **Production. The user runs this; the agent never does.**
   - **Why the user:** `config push` asks `[Y/n]` with Y as the default, and under automation it once fired on
     production. See [supabase-config-push-sends-the-whole-root](../../kb/entries/supabase-config-push-sends-the-whole-root.md).
   - **The commands**, at a real terminal, without `--yes`:

     ```bash
     set -a; . ./.env; set +a
     test -n "$RESEND_API_KEY" && echo "key set"
     npx supabase config push
     ```

   - **The push sends the whole root config,** not only this step's change.
     - Expect the two subjects and the template.
     - Anything else in the diff goes to production too: for example task 26's `[auth.external.apple]` block,
       if it is not on cloud yet.
     - The user confirms each such line is intended, or stops the push.
   - Paste the printed diff into the log.
7. **After the push:**
   - **The test:** the user signs in with a code to a Gmail address on cloud, and reports inbox or spam, with
     Gmail's reason if it is spam.
   - **The bias:** the owner's Gmail was trained by marking the old email "Not spam". Prefer an address that never
     received it, and record which address type was used, never the address itself.
   - **One result is weak evidence either way.** Record it as it is.

## After this step

- Write `implementation-log-step-1.md` beside this file, as usual.
- Then run `/librarian deposit 27`. This task has no separate deposit step.

## KB impact

| entry | change |
|---|---|
| otp-email-templates-carry-the-code | the template is a whole document: the brand in the subject, the address the code went to, and the support footer. Its rationale is a Go template comment that is never sent (if confirmed). Whether there is a plain-text part |
| cloud-auth-mail-goes-through-resend | the first spam evidence: Gmail's reason, and SPF/DKIM/DMARC all `PASS`. What this step changed, and where the next code landed. Task 26's step-2 log carries the evidence too, as a candidate for task 26's step 4, so whichever deposit runs second finds it already there |
| support-address-and-mail-domains | the sign-in code email is another place `support@` appears |
