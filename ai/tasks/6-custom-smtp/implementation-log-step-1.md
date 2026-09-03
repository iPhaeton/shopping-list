# Implementation log — step 1, items 4–6: custom SMTP pushed to production

**Date:** 2026-09-03. Description: [description-step-1.md](description-step-1.md). Plan:
[plan-step-1.md](plan-step-1.md). Items 1–3 (Resend account, API key, curl proof) were done by the
user before this step started.

Production now sends auth email through Resend's sandbox sender, and both OTP templates reach the
cloud project. A stranger still cannot sign in — the sandbox sender only delivers to the Resend
account's own address — but every other moving part of phase 1 is now proven against production
rather than read off a config file.

## What was built (item 4)

One file, three edits, plus a doc note:

| File | |
|---|---|
| `supabase/config.toml` | appended `[remotes.production.auth.email.smtp]` (Resend, `enabled = true`) and `[remotes.production.auth.rate_limit]` (`email_sent = 30`) at the end of the file |
| `supabase/config.toml:235-236` | the commented SendGrid example replaced with a one-line pointer to the block above — one description of how mail is sent, not two |
| `supabase/config.toml:455-458` | deleted — the "not overridden, deliberately" comment stated the exact thing the new block reverses |
| `.env.example` | appended a comment naming `RESEND_API_KEY`, deliberately with no `=` line |

The root config, the template overrides, and the `[remotes.production.auth]` block from task 5 were
untouched, per [supabase-config-push-sends-the-whole-root](../../kb/entries/supabase-config-push-sends-the-whole-root.md)
and [otp-email-templates-carry-the-code](../../kb/entries/otp-email-templates-carry-the-code.md).

## A plan claim that turned out wrong, and how it was checked instead

The plan expected `npx supabase status` to fail loudly on a bad key in the new block — a cheap parse
check before a live push. It doesn't: appending a bogus `emailz_sent = 30` to a scratchpad copy of
the config parsed without complaint. The CLI only errors on genuinely malformed TOML
(`CliConfigParseError`); unknown keys are silently dropped, which means a typo in the block would
have pushed as "no change" with no warning.

Since there is no CLI command that reads a remote's config back for comparison, the shape was
verified a level down instead: `node_modules/@supabase/cli-darwin-arm64/bin/supabase` is a
Bun-compiled binary carrying its config schema as inline `effect-schema` definitions, readable with
`strings -a` on the binary. That confirmed two things no other check could: a `[remotes.*]` entry
uses the **same** `auth` schema object as the root (so nothing about being under `remotes` narrows
what fields are legal), and the `smtp` struct's fields are exactly `enabled/host/port/user/pass/
admin_email/sender_name` — matching the block written, field for field. This is schema-level
confidence, not a guarantee the values are semantically right; the push diff and the dashboard
read-back are what proved that.

## Item 5 — the push

Run by the user, not by the assistant, per the task's explicit handoff. No push diff was captured in
this log since it wasn't visible on this side of the handoff — the dashboard read-back in item 6
covers the same ground from the other direction.

## Item 6 — verified against the live dashboard, not just read

The plan's original item 6 was "confirm in the dashboard" — a human visually scanning three pages.
What actually happened: a Management API check was attempted first (GET
`/v1/projects/{ref}/config/auth` using the CLI's access token from the macOS keychain), which would
have let the checks assert the two template bodies programmatically instead of by eye. It failed —
`403 Forbidden`, on both the auth-config endpoint and a plain project list, meaning the token stored
by `npx supabase login` isn't scoped for the Management API at all, not that the project or endpoint
was wrong. No token value was printed at any point.

Given that, the check was done through the browser Supabase dashboard, driven by Playwright, after
the user signed in manually (the assistant never touched credentials). Every field in the SMTP
settings page matched `config.toml` exactly: host, port, username, sender email, sender name, and
the "minimum interval per user" field (Supabase's UI name for `max_frequency`) at 60 seconds. Both
email templates — now labeled "Confirm sign up" and "Magic link or OTP" in the current dashboard,
not "Confirm signup" / "Magic Link" as in older docs — were opened individually and their bodies
read directly from the source editor, not just eyeballed: both render `{{ .Token }}` from the same
`otp-code.html` content, which is the inheritance from the root working. Rate Limits showed
`30 emails/h`, not the root's `2`.

Screenshots taken during this check were deleted immediately after use; nothing was persisted beyond
this log.

## Not done, by design

**Items 7–8 — a physical device actually signing in.** Two runs are needed and neither happened in
this session: a brand-new address (exercises the `confirmation` template) and the same address again
(exercises `magic_link`). The dashboard read-back proves the templates are byte-correct and the SMTP
credentials are wired; it does not prove Resend actually delivers, that the mail lands outside spam,
or that `verifyOtp` accepts what arrives. That gap is real and is the reason phase 1 is "pushed" but
not "verified end to end."

**Phase 2 — the sending domain.** Untouched. `admin_email` is still the phase-1 placeholder
`onboarding@resend.dev`, and the placeholder comment above it in `config.toml` was left in place
because it is still true.

## Verification

`npx supabase status` (parses `config.toml`, including the new block — no output means no error).
`npm run kb:audit` — 0 errors, 2 warnings unrelated to this change (one is this step's own
`.env.example` edit flagged as "ground moved," expected; the other is a pre-existing warning on
`writes-retry-from-an-outbox`). `npm test` — 90 tests, 9 suites, all passing, unchanged from before
this step since nothing in `src/` was touched. `npm run typecheck` clean. The binary `strings` check
described above, in place of the CLI schema-validation the plan assumed existed. The full dashboard
read-back described in item 6, covering every field the push was supposed to change.

## Knowledgebase

Three entries carry prose the push makes false, none of it catchable by a `verify:` command:

- [otp-email-templates-carry-the-code](../../kb/entries/otp-email-templates-carry-the-code.md) — the
  "As of 2026-09-03 no `config push` has been run" paragraph is now false; it says to delete itself
  once this happens.
- [supabase-local-stack](../../kb/entries/supabase-local-stack.md) — the built-in mailer's
  team-only restriction is no longer the operative restriction in production; the restriction's
  *shape* survives (Resend's sandbox sender still delivers only to one address) but the owner moved
  from Supabase to Resend. The note that a device cannot finish signing in no longer holds — the
  templates are live — though a *stranger* signing in is still blocked, for the new reason.
- [supabase-config-push-sends-the-whole-root](../../kb/entries/supabase-config-push-sends-the-whole-root.md)
  — "Deliberately left inheriting: `[auth.rate_limit] email_sent`" is wrong from this push onward;
  it is now explicitly overridden to 30 in the remotes block.

[README.md:35](../../../README.md#L35) ("your real inbox") is true for the Resend account owner as
of this push, true unqualified only from phase 2 — worth a qualifying line, flagged for the
librarian rather than edited here.

Nothing under `ai/kb/` was edited in this step.
