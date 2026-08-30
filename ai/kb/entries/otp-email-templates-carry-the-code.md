---
id: otp-email-templates-carry-the-code
title: OTP needs both the confirmation and magic_link templates overridden to render the token
type: gotcha
status: current
tags: [supabase, auth, email, otp]
sources: [ai/tasks/2/implementation-log-step-2.md, supabase/config.toml]
last_verified: 2026-08-30
verify: test "$(grep -c '^content_path = "./supabase/templates/otp-code.html"' supabase/config.toml)" = 2 && grep -q '{{ .Token }}' supabase/templates/otp-code.html
related: [supabase-local-stack]
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

**What to do:** any further auth email (email change, recovery) needs the same treatment before it
is used with `verifyOtp`. After editing a template or `config.toml`, restart the stack — see
[supabase-local-stack](supabase-local-stack.md). Retire this entry if the app ever stops using
email OTP.
