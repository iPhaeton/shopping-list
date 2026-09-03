---
id: otp-email-templates-carry-the-code
title: OTP needs both the confirmation and magic_link templates overridden to render the token
type: gotcha
status: current
tags: [supabase, auth, email, otp]
sources: [ai/tasks/2/implementation-log-step-2.md, ai/tasks/5-supabase-cloud/implementation-log-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-1.md, supabase/config.toml]
last_verified: 2026-09-03
verify: test "$(grep -c '^content_path = "./supabase/templates/otp-code.html"' supabase/config.toml)" = 2 && grep -q '{{ .Token }}' supabase/templates/otp-code.html
related: [supabase-local-stack, supabase-config-push-sends-the-whole-root, scope-boundaries]
---

Supabase's stock auth emails send `{{ .ConfirmationURL }}` — a magic link. `verifyOtp` has nothing
to do with a link; it needs the six-digit `{{ .Token }}`. So
[supabase/templates/otp-code.html](../../../supabase/templates/otp-code.html) renders the token, and
`supabase/config.toml` points **two** template slots at it:

```toml
[auth.email.template.confirmation]
[auth.email.template.magic_link]
```

**Why both:** GoTrue sends `confirmation` to a brand-new address and `magic_link` to one it already
knows, and `signInWithOtp({ shouldCreateUser: true })` — the app's only sign-in call — reaches both
paths. Override only `magic_link` and the bug hides: every returning-user test passes while the
first sign-in of a fresh address ships an unusable link. That asymmetry is the reason this is worth
writing down; it is invisible unless you deliberately test with an address that has never signed in.

`verifyOtp({ type: 'email' })` accepts the code from either path, so the client needs no new-user
branch.

**Both slots stay at the root of `config.toml`, and that is how they reach production.** Since step 5
the file also has a `[remotes.production]` block, but the templates are deliberately *not* restated
in it: unset keys inherit from the root, so a `config push` carries both overrides to the cloud
project, and a second copy would be a second thing to keep in sync — as well as a third
`content_path` line, which this entry's own check (it counts exactly two) would fail on. See
[supabase-config-push-sends-the-whole-root](supabase-config-push-sends-the-whole-root.md).

**As of 2026-09-03 the push has happened and the dashboard confirms it landed.** Task 6 pushed
`[remotes.production.auth.email.smtp]` (custom SMTP via Resend —
[supabase-local-stack](supabase-local-stack.md) has the detail) in the same `config push` that
carries these two templates to production by inheritance. Auth → Emails in the live dashboard was
read directly from the source editor for both slots — labeled "Confirm sign up" and "Magic link or
OTP" in the current dashboard UI, not "Confirm signup" / "Magic Link" as in older docs — and both
render `{{ .Token }}` from `otp-code.html`.

**That is config-level and dashboard-level proof, not delivery proof.** No physical device has
completed a sign-in against production yet. That still needs two runs — a brand-new address
(exercises `confirmation`), then the same address again (exercises `magic_link`) — and until both
happen, treat "the templates are correctly wired" and "device sign-in works end to end" as separate
claims, not the same one.

**What to do:** any further auth email (email change, recovery) needs the same treatment before it
is used with `verifyOtp`. After editing a template or `config.toml`, restart the stack — see
[supabase-local-stack](supabase-local-stack.md). Retire this entry if the app ever stops using
email OTP.
