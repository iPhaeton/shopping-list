---
id: support-address-and-mail-domains
title: support@shopping-loop.com is the one public contact address — Cloudflare routes it to the owner's Gmail, which replies through Resend; the root, `mail.` and `inbox.` domains each have one mail role
type: environment
status: current
tags: [email, support, contact, dns, cloudflare, resend, gmail, release]
last_verified: 2026-10-07
related: [cloud-auth-mail-goes-through-resend, otp-email-templates-carry-the-code]
---

**`support@shopping-loop.com` is the project's one public contact address.** Anything a user,
Apple or a regulator sees as "how to reach us" uses it: the App Store support contact; the address
Apple publishes as the EU Digital Services Act trader contact on EU product pages; the contact on
shopping-loop.com's Support page, Privacy Policy (the GDPR controller contact) and Terms; the
footer of the sign-in code email (a `mailto:` in `supabase/templates/otp-code.html`); and, when
they land, in-app contact links (AccountScreen, the paywall). Not all of those exist yet — the
address does. Never use `no-reply@mail.shopping-loop.com` (send-only), any `@inbox.shopping-loop.com`
address (no human reads it), or the owner's personal address.

The owner set this up on 2026-10-04..06 entirely in dashboards — Cloudflare, Resend, Gmail — so
nothing in this repo shows it. The DNS below was checked with `dig` on 2026-10-06. The Gmail
settings and the Resend key's scope were set by the owner and **have not been independently
checked**. No `verify:`: the check would need DNS from the network, and the audit has to run
without it. Re-check by hand with `dig +short MX shopping-loop.com` and the like.

## Each mail domain has one role

The domain was registered at Cloudflare on 2026-09-17, and Cloudflare hosts its DNS.

| domain | role | records |
|---|---|---|
| `shopping-loop.com` (root) | support, in and out | MX `route1/2/3.mx.cloudflare.net` (Cloudflare Email Routing); TXT SPF `v=spf1 include:_spf.mx.cloudflare.net ~all`; DKIM `cf2024-1._domainkey` (Cloudflare) and `resend._domainkey` (Resend); `send.shopping-loop.com` MX + SPF (Resend's return path); `_dmarc` `v=DMARC1; p=none;` |
| `mail.shopping-loop.com` | send-only: Supabase auth codes from `no-reply@` | see [cloud-auth-mail-goes-through-resend](cloud-auth-mail-goes-through-resend.md) |
| `inbox.shopping-loop.com` | Resend receiving; **nothing uses it** | MX `inbound-smtp.eu-west-1.amazonaws.com` |

`inbox.` was considered for support and rejected. Mail sent there shows up only in Resend's
dashboard (Emails → Receiving) and nobody is notified. Per Resend's docs, forwarding it or replying
to it both need code: an `email.received` webhook handler plus the API.

## How support mail moves

- **In:** Cloudflare Email Routing (dashboard: Compute → Email Service → Email Routing) has one
  rule: `support` → the owner's personal Gmail, which is a verified destination. Catch-all is off,
  so every other `@shopping-loop.com` address bounces, and a new public address needs its own rule.
  A Gmail filter labels `to:support@shopping-loop.com` "ShoppingLoop support" and never sends it
  to spam.
- **Out:** Gmail "Send mail as" `support@shopping-loop.com` goes through Resend SMTP:
  `smtp.resend.com`, port 465 SSL, username `resend`, and as the password a Resend API key whose
  sending access is restricted to `shopping-loop.com`. Gmail is set to reply from the address a
  message was sent to, so a reply never shows the owner's personal address. The root domain was
  added to Resend only for this, with receiving off.

## Gotchas

- **Never turn on Resend receiving for the root domain.** It needs the root MX, and taking that
  moves support mail away from Cloudflare. Resend itself recommends a subdomain for receiving, and
  that is what `inbox.` is.
- **The root SPF belongs to Cloudflare, so don't add Resend to it.** Resend's SPF sits on
  `send.shopping-loop.com`, its return-path domain, and DMARC passes through DKIM
  `d=shopping-loop.com`.
- **Testing `support@` from the Gmail it forwards to looks like a failure.** Gmail drops a message
  you sent yourself when it comes back through forwarding. Test from another account.
- **Support replies use the same Resend quota as production sign-in codes**: 100 a day on the
  free plan. A burst on one side can use up the other's share.
- **Rotating or deleting the Gmail key breaks replies** until the new key is entered in Gmail's
  Send mail as settings. It is a separate key from `RESEND_API_KEY` in `.env`, which Supabase
  sends with from `mail.` and which a key limited to the root domain could not replace.
