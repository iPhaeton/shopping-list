# Suggestion — a cloud Supabase project for production, alongside the local stack

**Status:** proposal, not an approved step. Adopting this needs a new
`ai/tasks/<n>/description-step-<n>.md` first, and
[supabase-local-stack](../kb/entries/supabase-local-stack.md) updated afterwards by the librarian —
that entry opens with "There is no cloud Supabase project" and becomes false the moment step 1 below
lands.

**Date:** 2026-08-31

**Covers backlog items 1, 2 and 4:** real database, real email service, and Supabase limits.

**Relationship to [supabase-persistence.md](supabase-persistence.md):** that document's "Where
Supabase runs" section recommended *starting* with cloud and treated local as a later convenience.
That call was reversed when step 2 actually landed — local won because the six-digit code is
machine-readable in Mailpit, which is what makes the OTP flow drivable end to end by Playwright. This
plan keeps that reversal and adds cloud as a **second target**, not a replacement. Its
`pickTarget()` / `EXPO_PUBLIC_SUPABASE_TARGET` runtime-switching sketch is **not** adopted here — see
"Environment selection" below for why, and what replaces it.

## The shape of it

Don't switch environments; add one.

| | Runs | Purpose |
|---|---|---|
| **local** (`npx supabase start`) | Docker on this machine | all development and verification; Mailpit keeps the OTP loop automatable |
| **production** (supabase.com) | hosted | real users, real inboxes |

`supabase/config.toml` keeps its current local values at the root and grows a `[remotes.production]`
block for the values that differ. The client picks an environment from `EXPO_PUBLIC_*` alone and
never learns which one it is talking to.

## 1. Create and link the project

```bash
npx supabase login
npx supabase projects create shopping-list --org-id <org> --region <region>
npx supabase link --project-ref <ref>          # prompts for the db password
```

Confirm the remote Postgres major version matches `major_version = 17` in
[config.toml](../../supabase/config.toml) — `SHOW server_version;` in the SQL editor. A mismatch lets
local and remote diverge silently, which is exactly the failure the local stack exists to prevent.

Link artifacts need no `.gitignore` work: [supabase/.gitignore](../../supabase/.gitignore) already
covers `.temp` and `.branches`.

## 2. Push the schema

```bash
npx supabase db push --dry-run     # confirm it only wants 20260830000000_users.sql
npx supabase db push
npx supabase db advisors --linked --type security
```

The advisors run is the real check, not ceremony: it confirms RLS is enabled on `public.users` and
inspects the `security definer` trigger in
[20260830000000_users.sql](../../supabase/migrations/20260830000000_users.sql). `set search_path = ''`
is already there, which is the hardening it looks for.

## 3. Split config into local truth and production overrides

**This is the step with the most ways to go wrong.** `config push` sends the *whole* root config, so
as things stand today it would push `site_url = "http://127.0.0.1:3000"`, `email_sent = 2` and
`max_frequency = "1s"` into production. Override exactly the keys that are local-only:

```toml
[remotes.production]
project_id = "<ref>"

[remotes.production.auth]
site_url = "https://<production-url>"
additional_redirect_urls = ["https://<production-url>"]

[remotes.production.auth.email]
max_frequency = "60s"          # matches RESEND_COOLDOWN_SECONDS in SignInScreen.tsx

[remotes.production.auth.rate_limit]
email_sent = 30                # root's 2/hour is the local default and unusable in production

[remotes.production.auth.email.smtp]
enabled = true
host = "smtp.<provider>.com"
port = 587
user = "<user>"
pass = "env(SHOPPING_LIST_SMTP_PASS)"
admin_email = "no-reply@<domain>"
sender_name = "Shopping List"
```

Remotes are matched to the target by `project_id`, and every key available at the root is available
inside the block; unset keys inherit.

`max_frequency` earns its line. [SignInScreen.tsx:9](../../src/screens/SignInScreen.tsx#L9) hard-codes
a 60-second resend cooldown and its comment asserts "Supabase allows one code request per minute" —
locally that is 1s, so the comment is aspirational until this override exists. Setting it makes the
UI and the server agree.

**The templates stay at the root and are inherited, and that inheritance is the thing to verify by
hand.** Both slots in [config.toml](../../supabase/config.toml) point at
[otp-code.html](../../supabase/templates/otp-code.html) for the reason recorded in
[otp-email-templates-carry-the-code](../kb/entries/otp-email-templates-carry-the-code.md): GoTrue
sends `confirmation` to a brand-new address and `magic_link` to a returning one, and losing either
one in production reproduces exactly the bug that entry describes — every returning user works while
the first sign-in of a fresh address ships an unusable link.

```bash
npx supabase config push
```

Then open Auth → Emails in the dashboard and confirm **both** "Confirm signup" and "Magic Link"
render `{{ .Token }}`.

## 4. A real email service

The built-in hosted mailer is 2 messages per hour **and delivers only to addresses on your own
Supabase team**; every other recipient gets "Email address not authorized". It is not a soft limit
to grow into — nothing works for real users until custom SMTP is set. There is no uptime guarantee
on it either.

- Any of Resend, Postmark, AWS SES, SendGrid, ZeptoMail or Brevo will do.
- **Verify the sending domain with SPF, DKIM and DMARC.** This is the difference between the code
  arriving and the code landing in spam, and it has the longest lead time of anything in this plan
  (DNS propagation) — start it early even though it sits at step 4.
- The password lives in the shell / CI environment as `SHOPPING_LIST_SMTP_PASS` and never in the
  repo; `env()` substitution reads it at push time.
- Custom SMTP starts at a floor of 30 messages/hour. The `email_sent` override in step 3 is what
  raises it.

## 5. Client keys

```bash
npx supabase projects api-keys --project-ref <ref>
```

Use the **publishable** key (`sb_publishable_…`), not the legacy `anon` JWT — legacy keys still work
but are deprecated by end of 2026. It is designed to ship in a client bundle, so it being in the web
build is fine; RLS is the security boundary, not the key. The `sb_secret_…` key must never enter
`src/`.

**Keep the variable name `EXPO_PUBLIC_SUPABASE_ANON_KEY` and add a comment**, rather than renaming to
match the new terminology. The name appears as a literal in
[src/lib/supabase.ts:11](../../src/lib/supabase.ts#L11), [.env.example](../../.env.example), the
README and a KB entry, and Metro substitutes `process.env.EXPO_PUBLIC_*` by literal text match — a
rename is four coordinated edits and a `kb:audit` risk in exchange for a slightly better name.

## Environment selection

**Production values are injected at build time by the environment, not by a file in the repo.**

[supabase-persistence.md](supabase-persistence.md) proposed a runtime `pickTarget()` switching on
`__DEV__ && Platform.OS === 'web'`, with `_LOCAL` and `_CLOUD` variable pairs. Don't. It was written
for a world where the phone needed cloud because it cannot reach `127.0.0.1` — but per
[supabase-local-stack](../kb/entries/supabase-local-stack.md) the phone is not a verification path
at all, so the problem it solved no longer exists. It also doubles the env surface and puts a
branch between the app and its own configuration.

Nor is a `.env.production` file the answer: Expo's docs explicitly recommend *against* using
`NODE_ENV` to switch between env files, since `expo export` forces `NODE_ENV=production` itself and
the behaviour is not what you would expect.

So:

- `.env` stays exactly as it is — the local stack. It remains the file a fresh checkout copies from
  [.env.example](../../.env.example).
- Production values come from the real process environment at export/build time (EAS secrets, or CI
  env vars). Shell variables take precedence over `.env` under standard dotenv resolution, so the two
  compose without any code change.

Smoke-testing cloud from this machine, without touching `.env`:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_… \
npx expo start --web --clear
```

## Verification

`npm test` and `npm run typecheck` are unaffected — they mock
[src/lib/supabase.ts](../../src/lib/supabase.ts) at the module seam per
[supabase-client-module-boundary](../kb/entries/supabase-client-module-boundary.md) and never reach
either environment.

**The Playwright/Mailpit loop does not apply to the cloud project, by design.** Verifying it is
manual, and needs two runs rather than one:

1. An address that has **never** signed in → exercises the `confirmation` template.
2. The same address again → exercises `magic_link`.

Both must deliver a six-digit code, not a link. Then in the SQL editor: `public.users` gained exactly
one row (the trigger fired), and a signed-in session reads only its own row.

## Limits worth knowing before launch (backlog item 4)

| Limit | Where it bites |
|---|---|
| Built-in mailer: 2/hour, team addresses only | total blocker; fixed by step 4 |
| Custom SMTP floor: 30/hour | raise via `[auth.rate_limit] email_sent` |
| `token_verifications`: 30 per 5 min per IP | several users behind one NAT could collide |
| `sign_in_sign_ups`: 30 per 5 min per IP | same |
| Free-tier projects pause after ~7 days idle | data survives; presents as a total outage on next open |
| Free-tier backups are daily and coarse | PITR is a Pro feature |

The per-IP auth limits are the ones most likely to surprise, because they are invisible in
development — one machine, one user, one IP.

## Guard rails

- `npx supabase db reset` is local-only, but `db push --linked` is not. `--dry-run` first, always.
- `enable_signup = true` means any address on the internet can create an account. That is a product
  decision that has never actually been made — there is no invite gate today.
- `otp_expiry = 3600` and `otp_length = 6` at the root are fine for production unchanged.

## Documentation this invalidates

Not tidy-up — [supabase-local-stack](../kb/entries/supabase-local-stack.md) states as fact that no
cloud project exists, and `npm run kb:audit` cannot catch a false prose claim (its `verify:` command
only greps `.env.example` for the local URL, which stays true). Needs a librarian pass covering:

- `supabase-local-stack` — two environments now, local still the verification path and why.
- `otp-email-templates-carry-the-code` — the same override applies in production, via `config push`,
  and inheritance from the root block is what carries it there.
- [README.md](../../README.md) and [.env.example](../../.env.example) — say *local stack*
  specifically, rather than implying it is the only one.

## Risks

- **A pushed root config is a live production change.** `config push` has no dry-run. The remotes
  block is the entire defence against `site_url = 127.0.0.1` and a 2-emails-per-hour limit reaching
  real users; get it wrong and sign-in breaks for everyone at once.
- **The template asymmetry is invisible until a stranger signs up.** Testing with your own,
  already-registered address exercises only `magic_link` and passes while the new-user path is
  broken.
- **Deliverability is not a code problem.** Unverified sending domains land OTP codes in spam, which
  looks identical to "the email never sent" from the user's side and is not reproducible locally.
- **The automated OTP verification loop does not extend to production.** Every cloud auth change is
  checked by hand, in a real inbox, forever. That is the accepted cost of keeping local as the dev
  environment.
- **Manual setup only you can do:** create the Supabase project and organisation, choose and pay for
  an email provider, and add the DNS records.

## Sequencing

Steps 1–2 are safe and reversible. Step 4's DNS verification has the longest lead time, so start it
first even though it lands later. Step 3 is the one to slow down on.

Ordering against [ai/tasks/3](../tasks/3/description-step-1.md) (list persistence) does not matter
much: doing that first means one additional migration to push here, not any rework.
