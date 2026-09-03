# Plan — step 1: real email delivery through a custom SMTP provider

**Requirement** ([production-supabase.md](../../suggestions/production-supabase.md) §4): *"nothing works
for real users until custom SMTP is set."* Supabase's built-in hosted mailer allows 2 messages per
hour **and delivers only to addresses on the project's own Supabase team** — every other recipient
gets "Email address not authorized", which from the user's side is indistinguishable from mail that
never arrived. There is no uptime guarantee on it either.

**Date:** 2026-09-03. **Provider: Resend, not SendGrid**, and delivered in **two phases** — the
plumbing now, the sending domain whenever you have picked one.

## Why Resend and not the SendGrid this started as

SendGrid retired its permanent free plan on 2025-07-26. A new account now gets a 60-day trial at
100 emails/day, after which Email API Essentials is $19.95/month. Resend's free plan is 3,000
emails/month, 100/day, one verified domain, and both providers are on
[Supabase's supported list](https://supabase.com/docs/guides/auth/auth-smtp).

The free plan having **no trial clock** is what makes the phasing below free: nothing decays while
the domain question sits open. Under SendGrid the 60 days would start on signup whether or not you
had a domain to point at it.

The decision stays cheap to reverse. Only four lines differ:

| | Resend | SendGrid |
|---|---|---|
| `host` | `smtp.resend.com` | `smtp.sendgrid.net` |
| `port` | `465` (implicit TLS) | `587` (STARTTLS) |
| `user` | `resend` | the literal string `apikey` |
| `pass` | `env(RESEND_API_KEY)` | `env(SENDGRID_API_KEY)` |

`config.toml` already carries a commented SendGrid example at
[line 236](../../../supabase/config.toml#L236); it gets replaced, not deleted, so the shape stays
discoverable.

## What this actually unblocks

Two things are broken in production today and one push fixes both.

1. **The email templates have never reached the cloud project.** Per
   [otp-email-templates-carry-the-code](../../kb/entries/otp-email-templates-carry-the-code.md), no
   `config push` has been run, so the cloud project still sends stock `{{ .ConfirmationURL }}` magic
   links that `verifyOtp` cannot accept. A physical device can request a code and can never enter
   one.
2. **Even fixed, mail only reaches the owner** until custom SMTP replaces the built-in mailer.

So phase 1's push carries the SMTP block *and* the two template overrides it inherits from the root.
Sequenced the other way round it would be two live production changes for no reason.

## Two phases, because the domain can wait

Resend lets you send **before any domain is verified**, from its sandbox address
`onboarding@resend.dev`. The catch is precise and worth stating exactly, because everything below
follows from it: **that address delivers only to the email address that owns the Resend account.**
Any other recipient gets a `403` — *"You can only send testing emails to your own email address"* —
which GoTrue surfaces as a failed sign-in request rather than a silent drop.

| | **Phase 1 — now** | **Phase 2 — when a domain is picked** |
|---|---|---|
| From | `onboarding@resend.dev` | `no-reply@mail.<domain>` |
| Delivers to | the Resend account's own address | anyone |
| DNS work | none | MX + SPF + DKIM, then DMARC |
| Rate ceiling | 30/hour, under Resend's 100/day | same |
| The change itself | the whole config block | **one line**, then push |

**What phase 1 buys, stated honestly.** It does *not* make the app multi-user — the restriction
moves from Supabase to Resend rather than lifting. What it does is retire every moving part except
the identity: the API key, the config block, `env()` substitution at push time, GoTrue authenticating
against `smtp.resend.com`, the rate-limit raise, and the template inheritance all get proven against
production while the only thing that can still be wrong is a string. It also gets the templates
pushed, which is what makes your own phone able to sign in at all. When the domain lands, a broken
sign-in has exactly one candidate cause instead of six.

**What phase 1 must not do:** invite anyone else to sign in. Between the phases the app is
single-user by construction, and the failure a stranger hits is a hard error at the "send me a code"
button.

---

# Phase 1 — the plumbing

### 1. Create the Resend account

Sign up at resend.com. **The address you sign up with is the only address that can receive mail
until phase 2**, so use the one you will test sign-in with. No domain, no DNS, nothing else here.

### 2. Create an API key

Resend → API Keys → **Sending access** (not full access). It cannot be scoped to a domain yet;
phase 2 re-scopes it. Shown once.

Store it as `RESEND_API_KEY` in the repo-root **`.env`**, which is gitignored
([.gitignore](../../../.gitignore#L33-L35)) and which the Supabase CLI reads for `env()`
substitution. It is safe beside the Expo variables: Metro only inlines names prefixed
`EXPO_PUBLIC_`, so it cannot reach a bundle. A shell export beats `.env` under the CLI's dotenv
resolution, which is the more explicit option for a one-off push:

```bash
RESEND_API_KEY=re_… npx supabase config push
```

**Do not add `RESEND_API_KEY=` to [.env.example](../../../.env.example).** A fresh checkout copying
it would resolve `env(RESEND_API_KEY)` to an *empty string* and push a broken password over a
working one. A comment naming the variable, with no `=`, is the safe way to document it.

### 3. Prove the credentials before touching production config

The step that saves a live-push debugging cycle — it exercises the key without going near the
Supabase project:

```bash
curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from":"Shopping List <onboarding@resend.dev>","to":["<the Resend account address>"],"subject":"smtp check","text":"ok"}'
```

Then send the same thing to **any other address** and confirm you get the `403`. Two minutes, and it
turns the sandbox rule from something you read in this document into something you have seen — which
matters, because it is the one constraint standing between phase 1 and real users.

A `401` means the key is wrong. Neither check proves SMTP *auth* specifically —
`swaks --server smtp.resend.com:587 --auth-user resend --auth-password $RESEND_API_KEY` does, if it
is worth installing.

### 4. Add the config block

Append to [supabase/config.toml](../../../supabase/config.toml), **at the end of the file**. TOML
cannot reopen `[remotes.production.auth.email]`, so these are new tables rather than edits to the
existing block:

```toml
[remotes.production.auth.email.smtp]
# The built-in hosted mailer is 2/hour and delivers only to addresses on the project's own Supabase
# team; everyone else gets "Email address not authorized", which reads as mail that never arrived.
enabled = true
host = "smtp.resend.com"
port = 465
user = "resend"                      # literal — the API key is the password, not the username
pass = "env(RESEND_API_KEY)"         # resolved at push time from the gitignored .env, or the shell
# PHASE 1 PLACEHOLDER. Resend's sandbox sender delivers only to the address that owns the Resend
# account; every other recipient gets a 403. Replace with no-reply@<the verified domain> and push
# again — that swap is the whole of phase 2, and until it happens this app is single-user.
admin_email = "onboarding@resend.dev"
sender_name = "Shopping List"

[remotes.production.auth.rate_limit]
# Only means anything now that smtp above is enabled — the root's 2/hour is exactly what the
# built-in mailer allowed. 30 is Supabase's own floor for custom SMTP. Resend's free plan is
# 100/day, so this is a burst cap, not an allowance.
email_sent = 30
```

Two edits go with it, or the file contradicts itself:

- **Replace** the commented SendGrid example at
  [config.toml:235-243](../../../supabase/config.toml#L235-L243) with a pointer to this block, so
  there is one description of how mail is sent.
- **Delete** the trailing "Not overridden, deliberately: `[auth.rate_limit] email_sent` stays at the
  root's 2/hour" comment at [config.toml:455-458](../../../supabase/config.toml#L455-L458). It
  states the exact thing this step reverses.

**The root stays untouched.** `email_sent = 2` and `max_frequency = "1s"` at the root are local
truths — local mail goes to Mailpit and a Playwright run must never wait
([supabase-local-stack](../../kb/entries/supabase-local-stack.md)).

**Do not restate the template overrides in the remotes block.** They are correct at the root and
inheritance is what carries them to production; a third `content_path` line also fails
[otp-email-templates-carry-the-code](../../kb/entries/otp-email-templates-carry-the-code.md)'s
`verify:`, which counts exactly two
([supabase-config-push-sends-the-whole-root](../../kb/entries/supabase-config-push-sends-the-whole-root.md)).

### 5. Push

```bash
npx supabase config push        # no --yes: the printed diff is the entire review
```

There is no `--dry-run`. Read the diff before confirming, and check four things:

- the SMTP keys appear, with `pass` **resolved** rather than the literal `env(RESEND_API_KEY)` or an
  empty string;
- `email_sent` is 30, not 2;
- `site_url` is `shopping-list://`, and `127.0.0.1` appears **nowhere**;
- `max_frequency` is `60s`.

### 6. Confirm in the dashboard

- **Project Settings → Authentication → SMTP**: host `smtp.resend.com`, sender
  `onboarding@resend.dev`.
- **Authentication → Emails**: *both* "Confirm signup" **and** "Magic Link" render `{{ .Token }}`.
  This is the inheritance working, and it is the one thing here that no command can assert.
- **Authentication → Rate Limits**: 30 emails/hour.

### 7. Verify end to end on a physical device

`npm start`, Expo Go on a phone; a device picks cloud
([supabaseTarget.ts](../../../src/lib/supabaseTarget.ts)). Two runs, because one is a trap:

1. **An address that has never signed in** → exercises the `confirmation` template.
2. **The same address again** → exercises `magic_link`.

Both must deliver a **six-digit code, not a link**, and both must complete sign-in.

Phase 1 has only one usable address, so run 1 needs that address to be *new to GoTrue*. If it has
already requested a code on cloud, `signInWithOtp({ shouldCreateUser: true })` has already created
the user and every later send takes the `magic_link` path. Reset it in **Authentication → Users →
delete** — but know what that deletes: `public.users.id` cascades from `auth.users`, and
`lists.owner_id` cascades too ([20260831000000_lists.sql:11](../../../supabase/migrations/20260831000000_lists.sql#L11)),
so that account's cloud lists and items go with it. On cloud today that is nothing; do not do it
casually later.

Then:

- Resend → **Emails**: two deliveries, status `delivered` — not `bounced`, not `complained`.
- Check the **spam folder** explicitly. `resend.dev` is properly authenticated, so this should be
  clean; it is the phase-2 domain where it stops being free.
- SQL editor: `public.users` gained exactly one row for that address (the trigger fired), and the
  signed-in session reads only its own row.

### 8. Confirm nothing local moved

`npm test` and `npm run typecheck` are unaffected — they mock the client at the module seam
([supabase-client-module-boundary](../../kb/entries/supabase-client-module-boundary.md)) and reach
no environment. `npm run kb:audit` must stay green: this step edits `config.toml` and both live
`verify:` commands over it (the two `content_path` lines, and the `[remotes.production]` shape) are
written to survive exactly this addition. `npm run web` still lands mail in Mailpit; the local stack
never had SMTP and still does not.

---

# Phase 2 — the sending identity

Nothing here is urgent, and nothing in phase 1 expires while it waits. The trigger is wanting a
second user.

### 9. Pick the identity

Resend recommends a **subdomain** so the app's sending reputation is isolated from the domain's
normal mail. The From address must be on the exact domain verified in Resend — subdomains do not
inherit their parent's verification — so this choice *is* the From address:

| Verify in Resend | `admin_email` becomes |
|---|---|
| `mail.<domain>` (recommended) | `no-reply@mail.<domain>` |
| `<domain>` | `no-reply@<domain>` |

The free plan allows exactly **one** verified domain, so this is not a decision to make twice.

### 10. Add the domain

Resend → Domains → add it, and **choose the region closest to the Supabase project — `eu-west-1`.**
The cloud project is in eu-west-1 ([supabase-local-stack](../../kb/entries/supabase-local-stack.md));
matching it keeps the hop short, and the region is baked into the MX value, so changing it later
means redoing DNS.

### 11. Add the DNS records and verify

Resend generates the exact values per domain — read them from the **Records** tab, don't retype
these. The shape, for `mail.<domain>`:

| Type | Name | Value | Purpose |
|---|---|---|---|
| `MX` | `send.mail.<domain>` | `feedback-smtp.eu-west-1.amazonses.com` (priority 10) | bounce/complaint return path |
| `TXT` | `send.mail.<domain>` | `v=spf1 include:amazonses.com ~all` | SPF |
| `TXT` | `resend._domainkey.mail.<domain>` | `p=MIGfMA0…` (long, one line) | DKIM |

Then click **Verify**. Usually 15 minutes; DNS can take up to 72 hours. Two things that reliably
waste an afternoon: a DNS host that silently appends the zone to the record name (giving
`send.mail.<domain>.mail.<domain>`), and one that wraps the DKIM value across lines.

### 12. Add DMARC

Not required for verification, and it is the difference between arriving and landing in spam:

| Type | Name | Value |
|---|---|---|
| `TXT` | `_dmarc.<domain>` | `v=DMARC1; p=none; rua=mailto:you@<domain>` |

`p=none` is the right starting policy — it asks receivers to report, not to reject, so a
misconfiguration shows up in reports instead of silently eating sign-in codes. Tighten later, once
the reports are clean.

### 13. Swap one line and push

Change `admin_email` to `no-reply@mail.<domain>`, delete the PHASE 1 PLACEHOLDER comment above it,
and push. Re-scope the API key to the new domain in the same pass if you want the tighter grant —
that means a new key in the same env var, and the push carries it either way.

Re-run step 3's `curl` with the new From first. A `403` here means the domain is not verified yet,
and it is far easier to read at a shell than through GoTrue.

### 14. Verify with an address that is not yours

The only proof that matters, and the thing phase 1 structurally cannot test: sign in on a device
with an address that has no connection to either the Supabase team or the Resend account. Both
template runs again, since the sender changed. Check spam — a fresh sending domain with no
reputation is exactly where mail quietly goes missing, and delivered-to-spam is indistinguishable
from never-sent at the app.

---

## Risks

- **A push is a live production change with no dry run.** Sign-in for every user is downstream of
  this one command. The remotes block is the only thing standing between a push and
  `site_url = 127.0.0.1`.
- **An unset `RESEND_API_KEY` at push time is the sharpest edge here.** `env()` substitutes strings
  silently, so an empty password pushes cleanly and then every auth email fails `535` at send time —
  visible only in Logs → Auth, and presenting as "the code never arrives".
- **Phase 1 looks finished and is not.** The dashboard says custom SMTP, the rate limit says 30/hour,
  and a stranger still cannot sign in. The placeholder comment in `config.toml` is the only thing
  carrying that fact; it is deliberately shouty for that reason.
- **Enabling SMTP moves every auth email onto Resend.** A dead key, a revoked domain or a Resend
  outage now breaks sign-in completely, and there is no fallback path. Rotating the key means
  another `config push`, not a dashboard edit.
- **The template asymmetry stays invisible until a stranger signs up.** Testing with an
  already-registered address exercises only `magic_link` and passes while every first-time signup is
  broken. That is why steps 7 and 14 each have two runs.
- **Deliverability is not a code problem and is not reproducible locally.** Mailpit accepts anything;
  SPF/DKIM/DMARC alignment is the only thing that decides whether a real inbox does. This risk is
  entirely phase 2's — `resend.dev` arrives because Resend owns its reputation.
- **Free-plan ceilings:** 100 emails/day and one domain. `token_verifications` and
  `sign_in_sign_ups` also cap at 30 per 5 minutes *per IP* — invisible in development, and several
  users behind one NAT collide.
- **Manual work only you can do:** the Resend account now, the domain and DNS records later, and
  reading a real inbox throughout.

**Rollback:** set `enabled = false` in the SMTP block and push again — production falls back to the
built-in mailer, which still delivers to the owner's address. Sign-in for everyone else stops, so
this is a way out of a broken *send*, not a way out of a broken *domain*.

## Afterwards

- `ai/tasks/6-custom-smtp/implementation-log-step-1.md` — decisions, what bit, how it was verified.
- `/librarian deposit 6-custom-smtp`. Three entries go stale, and none of their `verify:` commands
  can catch it, because all three are false *prose*. **The deposit splits across the two phases**,
  and the middle entry is the one to be careful with — after phase 1 it is half-true, which is worth
  saying explicitly rather than leaving a reader to guess:
  - [otp-email-templates-carry-the-code](../../kb/entries/otp-email-templates-carry-the-code.md) —
    the "As of 2026-09-03 no `config push` has been run" paragraph, which says to delete it once
    done. **Phase 1.**
  - [supabase-local-stack](../../kb/entries/supabase-local-stack.md) — "the built-in hosted mailer
    delivers only to addresses belonging to the project's own Supabase team" stops being the
    operative restriction at phase 1, but the *shape* of it survives until phase 2, pointing at a
    different owner. The note that a device cannot finish signing in dies at phase 1.
  - [supabase-config-push-sends-the-whole-root](../../kb/entries/supabase-config-push-sends-the-whole-root.md)
    — "Deliberately left inheriting: `[auth.rate_limit] email_sent`" is wrong from phase 1 onwards,
    and the suggestion it defers to is no longer a proposal.
- [README.md](../../../README.md) line 35 says a device's code lands in "your real inbox" — true for
  the owner from phase 1, true unqualified only from phase 2.

## Out of scope

A web deployment, which is why `site_url` stays `shopping-list://`. Bounce and complaint webhooks.
Branded links or BIMI. Tightening DMARC past `p=none`. Any second auth email — password recovery,
email change — which would each need the same `{{ .Token }}` treatment before `verifyOtp` could
accept them.
