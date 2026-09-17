---
id: cloud-auth-mail-goes-through-resend
title: Production auth mail leaves through Resend from no-reply@mail.shopping-loop.com — the From must sit on the verified domain, and DNS resolving is not verification
type: environment
status: current
tags: [supabase, auth, email, resend, deployment, cloud]
sources: [ai/tasks/6-custom-smtp/plan-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-2.md, supabase/config.toml, .env.example]
last_verified: 2026-09-17
verify: grep -q '^admin_email = "no-reply@mail.shopping-loop.com"$' supabase/config.toml && awk '/^\[remotes\.production\.auth\.email\.smtp\]/{f=1;next} /^\[/{f=0} f' supabase/config.toml | grep -q '^enabled = true$' && grep -q '^host = "smtp.resend.com"$' supabase/config.toml && grep -q '^pass = "env(RESEND_API_KEY)"' supabase/config.toml && ! grep -q 'resend\.dev' supabase/config.toml && ! grep -q '^RESEND_API_KEY=' .env.example && grep -qx '.env' .gitignore
related: [supabase-local-stack, supabase-config-push-sends-the-whole-root, otp-email-templates-carry-the-code, shoppingloop-is-the-visible-name-only, scope-boundaries]
---

Since task 6 every auth email the cloud project sends — both OTP templates — leaves through Resend's
SMTP, not Supabase's built-in mailer: `[remotes.production.auth.email.smtp]` at the end of
[supabase/config.toml](../../../supabase/config.toml), `host = "smtp.resend.com"`, `user = "resend"`
(a literal — the API key is the password), `pass = "env(RESEND_API_KEY)"`, From
`no-reply@mail.shopping-loop.com`. **Since 2026-09-17 that From is on a domain Resend has verified,
so cloud mail reaches any address.** The single-recipient restriction that looked like a bug for two
months — first Supabase's built-in mailer (project team only), then Resend's sandbox sender
`onboarding@resend.dev` (account owner only) — is gone, and README's "your real inbox" is true
unqualified. What remains is ordinary deliverability, at the end.

**The From must be on the exact domain verified in Resend.** `mail.shopping-loop.com` is a
subdomain on purpose — Resend recommends one so the app's sending reputation stays apart from the
domain's own mail — and a subdomain does not inherit its parent's verification, so the choice *is*
the address. The free plan allows one verified domain. Any From outside it gets `403` from Resend,
which GoTrue turns into a sign-in code that never arrives, for every user including the owner.

**DNS resolving is not "verified", and nothing on this machine can read the verified state.** Phase 2
hit `403 The mail.shopping-loop.com domain is not verified` while every record already resolved from
the authoritative servers. Resend flips the flag only when its own check runs — the dashboard's
Verify button or its periodic recheck. The `RESEND_API_KEY` in `.env` is a *sending-access* key:
`GET /domains` answers `401 restricted_api_key`, so the status cannot be read programmatically, and
`dig` proves the records, not Resend's opinion of them. **The only local signal is a send:**

```bash
set -a; . ./.env; set +a
curl -s -X POST https://api.resend.com/emails -H "Authorization: Bearer $RESEND_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"from":"ShoppingLoop <no-reply@mail.shopping-loop.com>","to":["<owner>"],"subject":"probe","text":"probe"}'
```

`200 {"id":…}` means verified; `403` means not yet. **Run it before any push that changes
`admin_email`** — a pushed unverified From breaks sign-in for everyone until the next push. Do not
restate Resend's DNS record values in this repo: the plan's table (MX and SPF on
`send.mail.<domain>` at `amazonses.com`) was what Resend issued on 2026-09-03; by 2026-09-17 it issued
one CNAME to `send.forge.rmta.net` carrying both, plus a DKIM TXT. The domain's Records tab in Resend
is the source, and the CNAME must be DNS-only (a proxied one answers as `A` records and fails the check).

**Two ways a push silently breaks mail.**

- `env(RESEND_API_KEY)` substitutes strings without complaint, so an unset or empty variable pushes an
  empty SMTP password cleanly and every auth email then fails `535` at send time — visible only in
  the dashboard's Auth logs, presenting as "the code never arrived". That is why
  [.env.example](../../../.env.example) names the variable in a comment and deliberately carries no
  `RESEND_API_KEY=` line (the `verify:` keeps it that way), and why a push starts by sourcing `.env`
  and testing the variable non-empty. Rotating the key is another `config push`, not a dashboard edit.
- Any From change that has not passed the `curl` above. The rollback for a broken *send* is
  `enabled = false` in the block and a push: production falls back to the built-in mailer, which
  delivers to the owner's address only. It is not a way out of a broken *domain*.

**Proving the Supabase side.** GoTrue returns 5xx when the SMTP handoff fails, so
`POST https://gvosanjceygakbubjfkv.supabase.co/auth/v1/otp` with the cloud anon key and
`{"email": "<owner>", "create_user": true}` answering `200 {}` is proof the auth server sent through
Resend with the current From. It sends a real code to that address, and an existing user exercises
only the `magic_link` template ([otp-email-templates-carry-the-code](otp-email-templates-carry-the-code.md)).

**What is not proven, and only a human can:** the `confirmation` template with a **fresh** address
(a plus-alias of the owner's Gmail is the cheap way; it creates a throwaway production user);
delivery to another provider (Outlook, iCloud) and whether it lands in spam — a fresh domain with no
reputation is exactly where mail goes quietly missing, and delivered-to-spam is indistinguishable
from never-sent at the app; a DMARC record (`TXT _dmarc.shopping-loop.com`,
`v=DMARC1; p=none; rua=mailto:<owner>`), still absent as of 2026-09-17; re-scoping the key to the
domain (optional — the current key sends from any domain in the team). `email_sent = 30`/hour is
Supabase's floor for custom SMTP and Resend's free plan is 100/day — a burst cap, not an allowance
([supabase-config-push-sends-the-whole-root](supabase-config-push-sends-the-whole-root.md)).
