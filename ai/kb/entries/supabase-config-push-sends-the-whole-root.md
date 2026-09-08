---
id: supabase-config-push-sends-the-whole-root
title: config push sends the whole root config — [remotes.production] holds only what differs, and there is no dry run
type: gotcha
status: current
tags: [supabase, config, auth, deployment, cloud]
sources: [ai/tasks/5-supabase-cloud/implementation-log-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-1.md, supabase/config.toml]
last_verified: 2026-09-07
verify: grep -q '^\[remotes.production\]' supabase/config.toml && grep -q '^project_id = "gvosanjceygakbubjfkv"' supabase/config.toml && grep -q '^site_url = "shopping-list://"' supabase/config.toml && grep -q '^max_frequency = "60s"' supabase/config.toml && grep -q '^site_url = "http://127.0.0.1:3000"' supabase/config.toml && grep -q '^\[remotes.production.auth.rate_limit\]' supabase/config.toml && grep -q '^email_sent = 30' supabase/config.toml
related: [otp-email-templates-carry-the-code, supabase-local-stack, supabase-target-picked-at-runtime, scope-boundaries]
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
- **`npx supabase status` is not a schema check on the block, whatever it looks like.** It only errors
  on genuinely malformed TOML (`CliConfigParseError`); an unrecognized key — a typo like `emailz_sent`
  for `email_sent` — is silently dropped and parses clean. That typo would then push as "no change,"
  with no warning from the CLI, `status`, or the push diff, because the key was never recognized in
  the first place. There is also no CLI command that reads a schema back for comparison; the one place
  that answered "is this field name even legal here" during step 6 was `strings -a` on the compiled CLI
  binary (`node_modules/@supabase/cli-darwin-arm64/bin/supabase` ships its schema as inline
  `effect-schema` definitions). That is schema-level confidence only — the push diff and a dashboard
  read-back are still what prove the values themselves are right.

**The inheritance is load-bearing, not laziness.** It is what carries the two `otp-code.html`
template overrides to real inboxes. Restating their `content_path` under `[remotes.production]` would
duplicate a value that is already correct *and* break
[otp-email-templates-carry-the-code](otp-email-templates-carry-the-code.md), whose check counts
exactly two occurrences of that line in the file. When something must be true in both places, leave
it at the root and let it inherit.

**What is overridden, and why:** `site_url` / `additional_redirect_urls` become `shopping-list://`
(the app's own scheme from `app.json` — there is no web deployment, and the code-based OTP flow
renders neither into an email; they are overridden so a push cannot leak a loopback address),
`[remotes.production.auth.email] max_frequency` becomes `"60s"`, which is what makes
`SignInScreen`'s 60-second resend cooldown a true statement about the server rather than a
client-side hope, and — since step 6 — `[auth.rate_limit] email_sent` becomes `30`.

**That third override used to be left inheriting, and this entry used to say so.**
`[auth.rate_limit] email_sent` stayed at the root's 2/hour — exactly what the built-in hosted mailer
allows — until [ai/tasks/6-custom-smtp/implementation-log-step-1.md](../../tasks/6-custom-smtp/implementation-log-step-1.md)
enabled `[remotes.production.auth.email.smtp]` (Resend) and raised it to 30 in the same push, per
[ai/suggestions/production-supabase.md](../../suggestions/production-supabase.md) §4 — no longer just
a proposal for this piece, though that document's phase 2 (a verified sending domain) still is. 30 is
Supabase's own floor for custom SMTP, not Resend's ceiling (its free plan allows 100/day); treat it as
a burst cap, not an allowance.

**What to do:** adding a key to the root means asking whether it is a *local* truth. If it is,
override it in the block in the same edit; a push is the moment the omission becomes production's
problem. The `verify:` command asserts the block still exists, still names the right project, and
still shadows both of the local-only values it was built for — including that the root really does
still carry the loopback `site_url` the override exists to hide.
