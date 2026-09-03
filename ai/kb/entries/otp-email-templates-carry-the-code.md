---
id: otp-email-templates-carry-the-code
title: OTP needs both the confirmation and magic_link templates overridden to render the token
type: gotcha
status: current
tags: [supabase, auth, email, otp]
sources: [ai/tasks/2/implementation-log-step-2.md, ai/tasks/5-supabase-cloud/implementation-log-step-1.md, supabase/config.toml]
last_verified: 2026-09-03
verify: test "$(grep -c '^content_path = "./supabase/templates/otp-code.html"' supabase/config.toml)" = 2 && grep -q '{{ .Token }}' supabase/templates/otp-code.html
related: [supabase-local-stack, supabase-config-push-sends-the-whole-root]
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

**As of 2026-09-03 no `config push` has been run, so the cloud project still has stock templates.**
A physical device reaches cloud and can request a code, but the mail it gets is a
`{{ .ConfirmationURL }}` link that `verifyOtp` cannot accept — this exact bug, in production. Device
sign-in starts working only after the push, and the confirmation is in the dashboard under
Auth → Emails: check that **both** "Confirm signup" and "Magic Link" render `{{ .Token }}`. Both,
because testing with an address that has already signed in exercises only `magic_link` and passes
while every first-time signup is broken. Delete this paragraph once it is done.

**What to do:** any further auth email (email change, recovery) needs the same treatment before it
is used with `verifyOtp`. After editing a template or `config.toml`, restart the stack — see
[supabase-local-stack](supabase-local-stack.md). Retire this entry if the app ever stops using
email OTP.
