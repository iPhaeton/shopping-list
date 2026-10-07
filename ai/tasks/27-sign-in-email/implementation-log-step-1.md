# Step 1 — implementation log (2026-10-07)

Local part done and verified. Production push and the Gmail test were the user's (description, verification 6–7);
their results, as reported, are under "Production" below.

## Deviations from the description

- **A fresh address does not get `confirmation`.** Verification 2 assumed it does (as the KB entry
  `otp-email-templates-carry-the-code` and task 2's step-2 log say). Under the current config it gets `magic_link`.
  See "Problems hit" 1. The `confirmation` slot was exercised another way: an admin-created unconfirmed user plus
  `POST /auth/v1/resend {"type":"signup"}`.
- **One style beyond the description:** `white-space: nowrap` on the footer `mailto:` link. At 480 px the address
  wrapped at its hyphen (`support@shopping-` / `loop.com`) in the first screenshot.

## What changed

| file | change |
|---|---|
| `supabase/templates/otp-code.html` | rewritten as a whole document: the description's copy verbatim, inline styles, one `mailto:` |
| `supabase/config.toml` | both `subject` lines → `Your ShoppingLoop sign-in code`. `content_path` lines are untouched, still exactly 2. Nothing under `[remotes.production]` |

Nothing in `src/`, no test, no migration.

## Decisions

- **Comment = `{{/* … */ -}}`.** It is a Go template comment, so it renders to nothing. `-}}` trims the following
  newline, so the sent HTML starts at byte 0 with `<!doctype html>` (confirmed in Mailpit's `HTML` field).
- **The comment names fields without braces** (`.ConfirmationURL`, `.Token`). The `otp-email-templates-carry-the-code`
  verify greps `{{ .Token }}`. A braced copy inside the comment would let the check pass even with the code gone
  from the body.
- **No all-digit hex colors.** Colors are `#1c1c1e` text, `#6e6e73` footer, `#e5e5ea` rule, `#ffffff` background.
  Mailpit derives `Text` from the HTML, and the Maestro reader takes the first `\b\d{6}\b`. Styles do not reach
  `Text` today; this keeps it so if that changes.
- **Font stack:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`. The wrapper
  is `max-width: 480px; margin: 0 auto; padding: 24px 16px`. The heading is 22 px, body 16 px, footer 13 px grey
  under a 1 px `#e5e5ea` `<hr>`.

## Verification (local stack; GoTrue v2.196.0, Mailpit v1.30.2, CLI v2.116.0)

**Restart:** `npx supabase stop && npx supabase start`, twice (see "Problems hit" 2). Never `db reset`.
`auth.users` = 1,000,039 after it, so the load-test users survived. The auth container's env showed
`GOTRUE_MAILER_SUBJECTS_{CONFIRMATION,MAGIC_LINK}=Your ShoppingLoop sign-in code`.

**Messages checked** (Mailpit `GET /api/v1/message/<ID>` and `/raw`):

| recipient | how sent | `one_time_tokens.token_type` → slot | final template |
|---|---|---|---|
| `t27-fresh-1791375421@example.com` (new) | `POST /auth/v1/otp`, `create_user: true` | `recovery_token` → `magic_link` | no (before nowrap) |
| `t27-unconfirmed-1791375465@example.com` | admin create `email_confirm: false`, then `POST /auth/v1/resend type=signup` ×2 | `confirmation_token` → `confirmation` | yes (2nd send) |
| `maya3@example.com` | web sign-in via Playwright ×2 | `recovery_token` → `magic_link` | yes (2nd sign-in) |

Every message:
- Subject `Your ShoppingLoop sign-in code`.
- `{{ .Email }}` filled with the recipient. **GoTrue fills it in both slots.**
- Code present, and equal to what the Maestro regex returns.
- The only `href` is `mailto:support@shopping-loop.com`.
- No `<!--`, `ConfirmationURL`, `verifyOtp` or "stock" anywhere in the raw source.

**MIME:** `Mime-Version: 1.0`, a single `Content-Type: text/html; charset=UTF-8`, `Content-Transfer-Encoding:
quoted-printable`. No `multipart`, no `text/plain` part, as expected. Not worked around. Mailpit's `Text` tab is
Mailpit's own rendering of the HTML: the heading dash-underlined, then the paragraphs, the address before the code.
Local From is the stack default `Admin <admin@email.com>`; production's is `no-reply@mail.shopping-loop.com`.

**The code still signs in (web, Playwright, local bundle):**
- Metro: `EXPO_PUBLIC_SUPABASE_TARGET=local BROWSER=none CI=1 npx expo start --web --port 8081`.
- The bundle grep showed `value: "local"`. `.env` has the target line commented out, and there is no `.env.local`.
- The browser held a session of task 26's relay-test account (list "Relay test"), so it was signed out via
  Account → Sign out first.
- `maya3@example.com` → code from Mailpit → My Lists (Groceries, Hardware store, …), twice. The first sign-in made
  `auth.sessions` row 12:19:04 UTC; the second used the final template (code `836267`).

**Screenshot:** `screenshots/step-1/code-email-mailpit.png`, 1100×820 CSS px. Mailpit's message view of `maya3`'s
final-template email: header block (From/To/Subject) plus the rendered HTML tab. It is for the user's sign-off
before the push.

**Commands:** `npm run kb:audit` → 73 entries, 66 checked, **1 error**, 4 warnings. The 4 warnings are "ground
moved", from the uncommitted `config.toml`/`otp-code.html`. The error:
- `shoppingloop-is-the-visible-name-only`'s verify includes `grep -q "in ShoppingLoop:" supabase/templates/otp-code.html`.
- That matched the old intro ("Enter this code in ShoppingLoop:"). The new copy says "Enter this code in the app:".
- The template is right. The check is stale: a KB candidate, not fixed here (librarian-only).

`otp-email-templates-carry-the-code`'s own check passes. No jest or `tsc` run: no TS changed.

## Problems hit

1. **With `enable_confirmations = false`, GoTrue sends `magic_link` to a brand-new address.**
   - The root config has had `enable_confirmations = false` since `e2623c2` (2026-08-27), so the container runs
     with `GOTRUE_MAILER_AUTOCONFIRM=true`.
   - `/otp` for a new address logs `user_signedup`, then `login` (`immediate_login_after_signup`), then
     `user_recovery_requested`. The user row has `email_confirmed_at` set, `confirmation_sent_at` null and
     `recovery_sent_at` set. The token is `recovery_token`.
   - So under autoconfirm, the magic-link path signs the user up confirmed, then sends `magic_link`.
   - `confirmation` is reached only for a user who exists unconfirmed, e.g. through `/resend type=signup`. An
     unconfirmed user who calls `/otp` is signed up and confirmed on the spot instead.
   - Task 2's log (2026-08-27) recorded the opposite "empirically", under an older GoTrue.
   - Production inherits `enable_confirmations = false` (no override in `[remotes.production]`), so it very likely
     behaves the same. **Not observed on cloud.**
   - Both slots stay wired: it costs nothing and covers a config or GoTrue change.
2. **A template edit can miss the running stack.**
   - `supabase start` bind-mounts `otp-code.html` as a single file into kong, at
     `/home/kong/templates/email/{confirmation,magic_link}.html`, which GoTrue fetches over HTTP.
   - An editor that saves by replacing the file (new inode) leaves the mount on the old content. Kong's copy stayed
     at 1,833 bytes after the nowrap edit. `GOTRUE_MAILER_TEMPLATE_RELOADING_ENABLED=true` cannot help, because the
     served file itself is stale.
   - The fix was a second `stop && start`. A template or subject edit needs only that, not the `db reset` the
     `supabase-local-stack` entry pairs with it, and data is kept.
   - Check what kong serves: `docker exec supabase_kong_shopping-list cat /home/kong/templates/email/magic_link.html`.
3. **The Maestro code reader now sees the address before the code.**
   - `.maestro/scripts/mailpit-code.js` and `.maestro/seed.mjs` take the first `\b(\d{6})\b` in `Text`.
   - Fine for every address used here.
   - An address with a six-digit run bounded by non-word characters (e.g. `a.123456@…`, `x+123456@…`) would now
     yield the wrong code. Not changed: out of scope, and no current address hits it.

## State left

- Local stack running, data kept. New local users: `t27-fresh-1791375421@example.com` (confirmed, no name),
  `t27-unconfirmed-1791375465@example.com` (unconfirmed). Disposable.
- The Playwright browser is signed in as `maya3@example.com`; the earlier relay-test account's web session was
  signed out.
- Metro stopped. `.playwright-mcp/` (gitignored) holds this session's snapshots; they contain only `example.com`
  addresses.
- Uncommitted: `supabase/config.toml`, `supabase/templates/otp-code.html`, `screenshots/step-1/`, this log.
- Cloud: the new subjects and template are live (the user's push, 2026-10-07).

## Production (the user runs it; the agent never does)

Commands, at a real terminal, without `--yes`:

```bash
set -a; . ./.env; set +a
test -n "$RESEND_API_KEY" && echo "key set"
npx supabase config push
```

- **Sign-off:** the user approved the look from the screenshot on 2026-10-07, before the push.
- **Push:** run by the user on 2026-10-07. They reported "all worked as expected". The printed diff was **not
  pasted**, so this log has no record of what else, if anything, the push carried beyond the subjects and the template.
- **Gmail test after the push:** the code email **landed in the inbox**.
  - The address type and whether the address had ever received the old email were not stated.
  - So the result can't be separated from the bias of the owner's Gmail, which was trained with "Not spam" on the
    old email.
  - One result is weak evidence either way: recorded as reported, not as proof the content fixed the spam verdict.

## KB candidates

| entry | candidate |
|---|---|
| otp-email-templates-carry-the-code | template is a whole document: brand subject `Your ShoppingLoop sign-in code`, `{{ .Email }}` (filled in both slots), support `mailto:` footer. Rationale is a `{{/* */ -}}` comment, confirmed never sent. The comment carries field names without braces so the `{{ .Token }}` grep can't be satisfied by it. HTML only: one `text/html` QP part, no plain text. **Contradiction:** under `enable_confirmations = false` (autoconfirm) GoTrue v2.196.0 sends `magic_link` to a new address too; `confirmation` only via `/resend type=signup` for an unconfirmed user. "Why both" and the "`confirmation` never sent from production" framing need rewriting; cloud unobserved |
| cloud-auth-mail-goes-through-resend | the spam paragraph's description of the template (no brand, no footer, no contact) is stale after this step. What changed: brand in subject and heading, recipient address, expiry line, support footer, pushed to cloud 2026-10-07. The next cloud code landed in a Gmail **inbox**; the address type and its history were unstated, so it is one weak data point |
| support-address-and-mail-domains | the sign-in code email's footer is another place `support@` appears, as a `mailto:` |
| shoppingloop-is-the-visible-name-only | **failing verify:** `grep -q "in ShoppingLoop:" supabase/templates/otp-code.html` matches the retired intro. A replacement that still proves the brand is in the email: `grep -q 'Your ShoppingLoop sign-in code' supabase/templates/otp-code.html`, or `grep -c '^subject = "Your ShoppingLoop sign-in code"$' supabase/config.toml` = 2 |
| supabase-local-stack | a template or subject edit needs `stop && start` only, and data survives (1,000,039 users kept). `db reset` is for migrations. The single-file bind mount goes stale when the editor replaces the file; check kong's copy |
| maestro-drives-the-native-ui (low) | `mailpit-code.js` takes the first six-digit run in `Text`, and the address now precedes the code |
