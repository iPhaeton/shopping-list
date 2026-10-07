---
id: apple-revoke-leaves-an-email-less-returning-sheet
title: After an Apple revoke the device keeps showing its returning-user sheet, whose token has no email (~10–15 s on a phone, never ends on the simulator); GoTrue then fails the sign-in with a 500, so the app revokes again and asks the user to wait 5 minutes
type: gotcha
status: current
tags: [auth, apple, ios, gotrue, simulator, deletion]
sources: [ai/tasks/26-apple-sign-in/implementation-log-step-2.md, ai/tasks/26-apple-sign-in/implementation-log-step-3.md, ai/tasks/26-apple-sign-in/implementation-log-step-4.md, b15d384, 9421c3c, 42cd547]
last_verified: 2026-10-07
verify: grep -q '^email_optional = false' supabase/config.toml && grep -q 'status === 500 && !carriesEmail(identityToken)' src/lib/appleSignIn.ts && grep -q "invoke('reset-apple-sign-in'" src/lib/appleSignIn.ts && test "$(grep -c 'signInAsync(' src/lib/appleSignIn.ts)" = 1 && grep -q 'Try again in 5 minutes.' src/lib/appleSignIn.ts && grep -A1 '^\[functions.reset-apple-sign-in\]' supabase/config.toml | grep -q '^verify_jwt = false'
related: [apple-refresh-token-revoked-before-account-deletion, edge-functions-local-dev-loop]
indexed: false
---

**What happens.** A revoke — by `delete-account`, from any device, or by the user's Stop Using (on
iOS 27: `Delete` → `Stop Using`, behind a 2FA code) — ends the app's authorization, but the device
keeps showing Apple's **returning-user** sheet for a while. That sheet's identity token has no
`email`, since the consent that shared it is gone, and the sheet authorizes the app again without
it. With no account for the `sub` — the usual case right after a deletion — GoTrue 2.196 inserts an
`auth.users` row with no email (it ignores `email_optional` on this id-token path), and
`handle_new_user()` fails on `public.users.email not null`: a **500, on every attempt** until the
device catches up.

**How long.** A real phone catches up within roughly 10–15 s: on the iPhone 13 a sheet opened 10 s
after the revoke was still the returning one, and 13 s was enough. The **simulator never caught up**
(3½ minutes after a revoke, still returning) — test the post-revoke sign-in on a device, and wait
≥30 s after a revoke before checking for the consent sheet, as the step-4 device runs did.

**The error message points at the wrong statement.** GoTrue's 500 names the *second* error,
"failed to close prepared statement: … transaction is aborted". The first is only in the Postgres
log: `null value in column "email"`. Read the Postgres log.

**The recovery, and why it does not retry.** On a 500 for an email-less token, `signInWithApple()`
in [src/lib/appleSignIn.ts](../../../src/lib/appleSignIn.ts) sends that sheet's
`authorizationCode` to [reset-apple-sign-in](../../../supabase/functions/reset-apple-sign-in/index.ts)
(`verify_jwt = false` — the caller has no session, since the sign-in just failed), which exchanges
it and revokes the new authorization, and the user sees "Sign in with Apple needs a few minutes to
reset. Try again in 5 minutes." **It opens no second sheet: reopening the sheet at once was tried and
failed.** Do not turn this into an immediate retry, and do not flip `email_optional` — GoTrue ignores
it on this path.

**Testing Apple's sheet on the simulator.** It takes about 20 s to appear under load and asks for the
Apple Account password (no Face ID). The same Apple Account returns to the same local account; only
an Apple Account with no local identity gets a new account, with a relay address.

The `verify:` asserts `email_optional` still off, the 500-and-no-email branch calling
`reset-apple-sign-in`, a single `signInAsync(` (no second sheet), the wait sentence, and
`verify_jwt = false` on the reset function.
