---
id: supabase-config-push-sends-the-whole-root
title: config push sends the whole root config — [remotes.production] holds only what differs, and there is no dry run
type: gotcha
status: current
tags: [supabase, config, auth, deployment, cloud]
sources: [ai/tasks/5-supabase-cloud/implementation-log-step-1.md, supabase/config.toml]
last_verified: 2026-09-03
verify: grep -q '^\[remotes.production\]' supabase/config.toml && grep -q '^project_id = "gvosanjceygakbubjfkv"' supabase/config.toml && grep -q '^site_url = "shopping-list://"' supabase/config.toml && grep -q '^max_frequency = "60s"' supabase/config.toml && grep -q '^site_url = "http://127.0.0.1:3000"' supabase/config.toml
related: [otp-email-templates-carry-the-code, supabase-local-stack, supabase-target-picked-at-runtime]
---

`supabase/config.toml` holds the **local** stack at its root. `npx supabase config push` sends that
whole root config to the linked project, so every key that is only true on this machine reaches
production unless the `[remotes.production]` block restates it. Left alone, a push would set
production's `site_url` to `http://127.0.0.1:3000` and let anyone request a fresh sign-in code every
second (`max_frequency = "1s"`, which exists so a Playwright run never waits).

Three rules make the block work:

- **A remote is matched to a project by `project_id`**, not by its name — `[remotes.production]` is a
  label. The value under it is the cloud ref, not the root's `project_id` (which is the local
  stack's `shopping-list`).
- **Any key left unset inherits from the root.** So the block is a diff, not a copy.
- **There is no `--dry-run`.** Run `npx supabase config push` *without* `--yes` so the CLI prints the
  diff and waits — that prompt is the entire review, and it is a live production change.

**The inheritance is load-bearing, not laziness.** It is what carries the two `otp-code.html`
template overrides to real inboxes. Restating their `content_path` under `[remotes.production]` would
duplicate a value that is already correct *and* break
[otp-email-templates-carry-the-code](otp-email-templates-carry-the-code.md), whose check counts
exactly two occurrences of that line in the file. When something must be true in both places, leave
it at the root and let it inherit.

**What is overridden, and why those two:** `site_url` / `additional_redirect_urls` become
`shopping-list://` (the app's own scheme from `app.json` — there is no web deployment, and the
code-based OTP flow renders neither into an email; they are overridden so a push cannot leak a
loopback address), and `[remotes.production.auth.email] max_frequency` becomes `"60s"`, which is what
makes `SignInScreen`'s 60-second resend cooldown a true statement about the server rather than a
client-side hope.

**Deliberately left inheriting:** `[auth.rate_limit] email_sent = 2` per hour. That is exactly what
Supabase's built-in hosted mailer allows, so raising it does nothing until
`[remotes.production.auth.email.smtp]` points at a real provider — see
[ai/suggestions/production-supabase.md](../../suggestions/production-supabase.md) §4, which is still
a proposal.

**What to do:** adding a key to the root means asking whether it is a *local* truth. If it is,
override it in the block in the same edit; a push is the moment the omission becomes production's
problem. The `verify:` command asserts the block still exists, still names the right project, and
still shadows both of the local-only values it was built for — including that the root really does
still carry the loopback `site_url` the override exists to hide.
