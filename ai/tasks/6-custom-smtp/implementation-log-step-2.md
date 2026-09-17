# Implementation log — step 2 (phase 2, items 13–14): the sending domain

**Date:** 2026-09-17. Plan: [plan-step-1.md](plan-step-1.md) §"Phase 2". Items 9–12 (pick the
identity, add it in Resend, DNS records) were done by the user before this step; item 12 (DMARC)
was not. Phase 1 is [implementation-log-step-1.md](implementation-log-step-1.md).

Production auth mail now goes out from `no-reply@mail.shopping-loop.com`. The sandbox-sender
restriction is gone: Resend delivers from a verified domain to any recipient, so the app is no
longer single-user. The push was run from this side, with the diff captured below.

## What was built (item 13)

| File | |
|---|---|
| `supabase/config.toml:459-462` | the `PHASE 1 PLACEHOLDER` comment replaced with one stating the domain constraint; `admin_email` `onboarding@resend.dev` → `no-reply@mail.shopping-loop.com` |

Nothing else changed. `sender_name`, the rate limit, the templates and the rest of the remotes
block were already correct and already on the remote.

## The domain, as DNS actually has it

Zone `shopping-loop.com` is on Cloudflare (`leif`/`blakely.ns.cloudflare.com`). The plan's record
table (MX + SPF TXT on `send.mail.<domain>` pointing at `amazonses.com`) is what Resend generated
in 2026-09-03 docs and is **not** what Resend issues now. What is live:

| Name | Type | Value |
|---|---|---|
| `send.mail.shopping-loop.com` | `CNAME` | `send.forge.rmta.net` |
| ↳ resolves through to | `MX` | `10 feedback.forge.rmta.net` |
| ↳ and | `TXT` | `v=spf1 ip4:52.3.252.119 ip4:44.222.39.36 ip4:199.249.231.0/24 ~all` |
| `resend._domainkey.mail.shopping-loop.com` | `TXT` | `p=MIGfMA0…` — one 216-char string, not split |
| `_dmarc.shopping-loop.com` | — | absent (item 12 not done) |

One CNAME carries the return-path MX and SPF from Resend's side; the DKIM TXT is the only record
whose value lives in this zone. The plan's two named traps (zone appended twice, DKIM wrapped)
did not occur. The CNAME is DNS-only — a proxied one would have answered as `A` records, and
Resend's check would fail.

## What bit: DNS resolving is not "verified"

The first `curl` with the new From returned `403 The mail.shopping-loop.com domain is not
verified` **while every record above already resolved from the authoritative servers.** Resend
marks a domain verified only after its own check runs — the dashboard's Verify button or its
periodic recheck — and nothing on this machine can see that state:

- the `RESEND_API_KEY` in `.env` is a *sending-access* key; `GET /domains` answers
  `401 restricted_api_key`, so the status cannot be read programmatically;
- `dig` proves the records, not Resend's opinion of them.

So the 403 from `POST /emails` is the only local signal of verification, and it is the gate for
the push: pushing an unverified From would make Resend reject *every* auth email, owner included.
The user cleared it in the dashboard (cause not observed from this side); the same `curl` then
returned `200 {"id":"01a0ae9a-…"}`.

## The push

Run here, not handed off, with `--yes` explicit — the CLI's `[Y/n]` prompt defaults to Y under
automation, so an interactive "review the diff" is not available to an agent and an ambiguous
prompt is worse than a stated intent. `.env` was sourced into the shell first (`set -a; . ./.env`)
and `RESEND_API_KEY` tested non-empty, so `env()` could not resolve to `""`. The auth diff the CLI
printed, verbatim except the hash:

```
-admin_email = "onboarding@resend.dev"
+admin_email = "no-reply@mail.shopping-loop.com"
```

One line. `pass = "hash:…"` unchanged (same key), `sender_name = "ShoppingLoop"` already remote
(the rename's follow-up push had happened). API, DB and Storage reported `up_to_date`; auth
`updated`.

## Verification (item 14, partial)

- **Resend API path:** `POST https://api.resend.com/emails` from
  `ShoppingLoop <no-reply@mail.shopping-loop.com>` to the owner's address — `200` with an id.
- **Supabase SMTP path:** `POST https://gvosanjceygakbubjfkv.supabase.co/auth/v1/otp` with the
  cloud anon key, `{"email": <owner>, "create_user": true}` — `200 {}`. GoTrue returns 5xx when the
  SMTP handoff fails, so this is proof that the auth server sent through `smtp.resend.com` with the
  new From. The address is an existing user, so this exercised the `magic_link` template.
- `npm run kb:audit` — 0 errors, 9 warnings, all pre-existing. No file under `src/` changed, so
  `npm test` / `npm run typecheck` were not re-run.

**Not done, and only a human can:**

- The `confirmation` (signup) template with a **fresh** address. A plus-alias of the owner's Gmail
  (`…+anything@gmail.com`) is new to Supabase and lands in the same inbox — the cheap way to run
  it. Not done here because it creates a throwaway user in production `auth.users`.
- Delivery to an address at another provider (Outlook, iCloud), and whether it lands in spam.
  With the sandbox gone, recipient *restriction* is solved; *reputation* is not, and a fresh
  domain with no DMARC is where mail goes quietly missing.
- DMARC (item 12): `TXT _dmarc.shopping-loop.com` `v=DMARC1; p=none; rua=mailto:<owner>`.
- Re-scoping the API key to the domain (optional; the current key sends from any domain in the
  team).

## Knowledgebase

Prose now false, none of it caught by a `verify:` line:

- [supabase-local-stack](../../kb/entries/supabase-local-stack.md) lines 54–62 — the
  owner-only restriction ("Resend's sandbox sender delivers only to the address that owns the
  Resend account … until phase 2 … not yet done") is gone. Cloud mail now reaches any address;
  what remains is ordinary deliverability.
- [supabase-config-push-sends-the-whole-root](../../kb/entries/supabase-config-push-sends-the-whole-root.md)
  line 59 — "that document's phase 2 (a verified sending domain) still is [a proposal]" — no
  longer.
- [README.md:35](../../../README.md#L35) "your real inbox" is now true unqualified.
- [plan-step-1.md](plan-step-1.md) §11's record table is historical (amazonses vs `forge.rmta.net`),
  which is fine for a plan; the point is that the KB should not restate record values — Resend's
  Records tab is the source, and the shape changed once already.

Candidate facts for the librarian:

- The From in `admin_email` must be on the domain verified in Resend, and DNS resolving is not
  verification: a sending-access key cannot read `/domains`, so `POST /emails` returning `403`
  vs `200` is the only local check, and it gates the push. (gotcha)
- `config push --yes` prints the diff *and* applies it; when the intent is to apply it is the
  right call for an agent, and the printed diff is the record. (extends the existing entry's
  "run without `--yes`" rule, which is about a human reviewing.)

Nothing under `ai/kb/` was edited in this step.
