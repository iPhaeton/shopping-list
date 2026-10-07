---
id: otp-email-templates-carry-the-code
title: OTP's code email is one template wired to both the confirmation and magic_link slots — under autoconfirm a new address gets magic_link too; its rationale is a Go template comment, and its body must keep the code the first six-digit run
type: gotcha
status: current
tags: [supabase, auth, email, otp, maestro]
sources: [ai/tasks/2/implementation-log-step-2.md, ai/tasks/5-supabase-cloud/implementation-log-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-2.md, ai/tasks/27-sign-in-email/implementation-log-step-1.md, supabase/config.toml]
last_verified: 2026-10-07
verify: test "$(grep -c '^content_path = "./supabase/templates/otp-code.html"' supabase/config.toml)" = 2 && awk '/\*\/ -}}/{f=1;next} f' supabase/templates/otp-code.html | grep -q '{{ .Token }}' && ! grep -q '<!--' supabase/templates/otp-code.html
related: [cloud-auth-mail-goes-through-resend, supabase-local-stack, supabase-config-push-sends-the-whole-root, scope-boundaries, maestro-drives-the-native-ui, shoppingloop-is-the-visible-name-only]
indexed: false
---

Supabase's stock auth emails send `{{ .ConfirmationURL }}` — a magic link. `verifyOtp` has nothing
to do with a link; it needs the six-digit `{{ .Token }}`. So
[supabase/templates/otp-code.html](../../../supabase/templates/otp-code.html) renders the token, and
`supabase/config.toml` points **two** template slots at it, both with the subject
`Your ShoppingLoop sign-in code`:

```toml
[auth.email.template.confirmation]
[auth.email.template.magic_link]
```

**Which slot GoTrue picks — measured, and it has flipped.** The root config has had
`enable_confirmations = false` since `e2623c2`, so GoTrue runs with `GOTRUE_MAILER_AUTOCONFIRM=true`.
Under that, GoTrue v2.196.0 (task 27, 2026-10-07) sends **`magic_link` to a brand-new address
too**: `/otp` signs the user up already confirmed, logs them in, then sends a recovery-type token
through `magic_link`. `confirmation` is reached only by a user who exists *unconfirmed* — an admin
create with `email_confirm: false`, then `POST /auth/v1/resend {"type":"signup"}`; an unconfirmed
user who calls `/otp` is confirmed on the spot instead. Task 2's log recorded the opposite under an
older GoTrue, and the comments in `config.toml` and the template still say "a brand-new user gets
`confirmation`" — they are stale, not evidence. Production inherits `enable_confirmations = false`
(no override in `[remotes.production]`), so it very likely behaves the same; **not observed on cloud.**

**Both slots stay wired anyway.** It costs nothing, and a config change (turning confirmations on)
or a GoTrue change would route new users back through `confirmation` — where a stock template would
ship an unusable link while every returning-user test passes. To exercise `confirmation` locally,
use the `/resend type=signup` route above; a fresh address no longer does it. `verifyOtp({ type:
'email' })` accepts the code from either slot, so the client needs no new-user branch. GoTrue fills
`{{ .Email }}` in both.

**The template's rationale is a Go template comment, `{{/* … */ -}}`, never `<!-- -->`.** An HTML
comment went out in every email; the Go comment renders to nothing, and `-}}` trims the newline so
the sent HTML starts at `<!doctype html>`. The comment names fields **without braces**
(`.ConfirmationURL`, `.Token`): a braced copy inside it would let a grep for `{{ .Token }}` pass with
the code gone from the body — which is why `verify:` looks for the token only after the comment
closes, and fails on any `<!--`.

**The code must stay the first standalone six-digit run in the email's text.**
`.maestro/scripts/mailpit-code.js` and `.maestro/seed.mjs` take the first `\b(\d{6})\b` in Mailpit's
`Text` field, which Mailpit derives from the HTML ([maestro-drives-the-native-ui](maestro-drives-the-native-ui.md)).
The recipient's address now sits *above* the code, so a test address with a bounded six-digit run
(`a.123456@…`, `x+123456@…`) would yield the wrong code — no current address does. For the same
reason the template uses no all-digit hex colours (`#1c1c1e`, not `#111111`): styles do not reach
`Text` today, and this keeps it so if that changes.

**The email is HTML only** — one `text/html` quoted-printable part, no `text/plain`, no multipart.
That is what GoTrue sends for a single template; it was not worked around.

**Both slots stay at the root of `config.toml`, and that is how they reach production.** Unset keys
under `[remotes.production]` inherit from the root, so a `config push` carries both overrides and
both subjects to the cloud project; a restated copy would be a second thing to keep in sync, and a
third `content_path` line fails this entry's check (it counts exactly two). See
[supabase-config-push-sends-the-whole-root](supabase-config-push-sends-the-whole-root.md). The
current template and subjects were pushed by the owner on 2026-10-07; the push's printed diff was
not recorded. Auth → Emails in the dashboard labels the slots "Confirm sign up" and "Magic link or
OTP".

**What is proven on cloud:** sends to existing addresses through Resend
([cloud-auth-mail-goes-through-resend](cloud-auth-mail-goes-through-resend.md)), which exercise
`magic_link` only. Whether a fresh cloud address also gets `magic_link` is inferred from the config,
not observed. Treat "the templates are correctly wired" and "device sign-in works end to end" as
separate claims.

**What to do:** any further auth email (email change, recovery) needs the same treatment before it
is used with `verifyOtp`. After editing a template or a subject, `stop && start` the local stack and
check what kong actually serves — [supabase-local-stack](supabase-local-stack.md). Retire this
entry if the app ever stops using email OTP.

**Demoted out of `INDEX.md` at step 11** (`indexed: false`), not retired: still checked every audit,
found by `/librarian ask`, and linked from [supabase-local-stack](supabase-local-stack.md), where
anyone touching sign-in mail starts.
