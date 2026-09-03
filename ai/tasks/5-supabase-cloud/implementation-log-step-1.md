# Implementation log — step 1: local truth, production overrides, and a device on cloud

**Date:** 2026-09-03. Description: [description-step-1.md](description-step-1.md). Reference:
[ai/suggestions/production-supabase.md](../../suggestions/production-supabase.md).

`supabase/config.toml` now carries the local stack at the root and a `[remotes.production]` block
holding only what differs, so a `config push` cannot leak a loopback `site_url` or a one-second
resend cooldown into production. The client picks its Supabase at runtime: browser and simulator get
the Docker stack, a physical phone gets the cloud project.

## Starting position, which was not what the plan assumed

The suggestion doc reads as if steps 1–2 were still ahead. They were not:
`supabase/.temp/linked-project.json` showed the repo already linked to `gvosanjceygakbubjfkv`
(eu-west-1), `npx supabase migration list --linked` showed **both migrations already applied
remotely**, and the remote reported Postgres 17.6.1 against `major_version = 17`. So this step was
only the suggestion's step 3, plus a client change that document had explicitly argued *against*.

That argument is worth recording because it was overturned on purpose.
[production-supabase.md](../../suggestions/production-supabase.md) rejected runtime target-switching
on the grounds that "the phone is not a verification path at all", and concluded production values
should come from the build environment. The task's second sentence makes the phone a target, which
removes the premise. Web has to stay on local (Mailpit is what makes the OTP loop scriptable), so
both environments must exist in one bundle and be chosen at runtime — there is no build-time split
that works, because one `expo start` serves the browser and Expo Go from the same server on the same
env.

## What was built

| File | |
|---|---|
| `src/lib/supabaseTarget.ts` | new — `targets` (both env pairs) and `pickTarget()` |
| `src/lib/supabaseTarget.test.ts` | new — 8 tests over the branch table and the literal names |
| `src/lib/supabase.ts` | reads the selected target instead of one hard-coded pair |
| `supabase/config.toml` | `[remotes.production]` overrides appended |
| `.env.example`, `.env` | `_LOCAL` / `_CLOUD` pairs; cloud key blank in the committed example |
| `README.md` | the two-target table replaces "Expo Go will not get past sign-in" |
| `package.json` | `expo-device@~8.0.10` |

No migration, no schema change. Nothing in `src/state/` or `src/screens/` was touched — the target
switch sits entirely behind the module seam that
[supabase-client-module-boundary](../../kb/entries/supabase-client-module-boundary.md) already drew.

## Decisions

**The simulator stays on local, which cost a dependency.** `Platform.OS` cannot separate a phone
from a simulator — both are `'ios'`. Taking the one-line rule (`web ? local : cloud`) would have put
`npm run ios` on the cloud project too. `expo-device`'s `Device.isDevice` is what distinguishes
them, and it is bundled in Expo Go, so this does not cost a native dev build and
[native-build-toolchain](../../kb/entries/native-build-toolchain.md) still holds. The trade was one
dependency against keeping the simulator on a disposable database.

**Symmetric `_LOCAL` / `_CLOUD` names, chosen over the cheaper asymmetric option.** The suggestion
recommended keeping `EXPO_PUBLIC_SUPABASE_ANON_KEY` unchanged to avoid touching four places. Keeping
one pair unsuffixed and adding a `_CLOUD` pair would have implied the unsuffixed one is the default
in a way that is false — neither target is a default. The known cost is that
`supabase-local-stack`'s `verify:` greps `.env.example` for the literal string
`EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, which the rename breaks; that entry needed
rewriting anyway, since it opens with "There is no cloud Supabase project".

**`pickTarget()` lives in its own module, not in `supabase.ts`.** Testing it where it was first
written would mean importing `@supabase/supabase-js` into a test, which the module-boundary
convention forbids. Splitting it makes the only new logic in this step directly testable and leaves
`supabase.ts` as the thin client seam it was.

**The error message names the selected target.** `Missing EXPO_PUBLIC_SUPABASE_URL_CLOUD or …` tells
a phone owner which two lines their `.env` is missing. The previous "missing config" phrasing would
have been actively misleading now that there are two pairs and web works with only one filled in.

**`site_url = "shopping-list://"`.** There is no web deployment, so the app's own scheme from
`app.json` is the only honest value. The code-based OTP flow renders neither `site_url` nor
`additional_redirect_urls` into an email — they are overridden so a push cannot put `127.0.0.1:3000`
into production, not because anything reads them.

**Two keys deliberately left inheriting.** The `[auth.email.template.*]` overrides stay at the root
and reach production through inheritance — that inheritance is the mechanism that carries
`otp-code.html` to real inboxes, and restating the paths inside the remotes block would both
duplicate them and break the `otp-email-templates-carry-the-code` audit, which counts exactly two
occurrences of the `content_path` line. `[auth.rate_limit] email_sent` stays at the root's 2/hour
because that is exactly what the built-in hosted mailer allows; raising it to 30 does nothing until
custom SMTP exists, which is the suggestion's step 4 and out of scope here.

## Not done, by decision

**`npx supabase config push` was not run.** The config split is written; pushing it is the user's
call, and it is a live production change with no `--dry-run`.

The consequence is specific and worth stating plainly: **the cloud project still has stock Supabase
email templates**, which render `{{ .ConfirmationURL }}` and no `{{ .Token }}`. A phone can reach
cloud and request a code today, but the email will contain a link that `verifyOtp` cannot accept —
precisely the failure
[otp-email-templates-carry-the-code](../../kb/entries/otp-email-templates-carry-the-code.md)
describes. Sign-in on a device completes only after the push.

Also outstanding regardless of the push: the built-in hosted mailer sends only to addresses on the
project's own Supabase team, so the first device sign-in must use the account owner's address.
`enable_signup = true` inherits to production, meaning any address on the internet can create an
account once real SMTP exists — flagged, not changed, because it is a product decision nobody has
made.

## Verification

`npm run typecheck` clean. `npm test` — 90 tests, 9 suites, all passing (82 before; the 8 new ones
are the target table). The existing suites were unaffected: all three that touch auth mock
`src/lib/supabase.ts` with a factory, so neither `@supabase/supabase-js` nor `expo-device` is ever
loaded under jest.

**Web, end to end.** `npx expo start --web --clear`, then Playwright: signed in as a brand-new
address (which exercises the `confirmation` template, not `magic_link`), read the code `359105` from
Mailpit, created a list. `psql` on port 54322 confirmed the row landed against the right owner. Zero
console errors. This is the check that mattered most — it proves the target switch did not disturb
the path everything else is verified against.

**The native bundle actually receives both pairs.** Fetching
`/index.bundle?platform=ios` and grepping showed all four variables present under their full literal
names, and no surviving `process.env.EXPO_PUBLIC_SUPABASE_*` reference. This is the failure mode the
literal-text-match rule exists for, and it is now checked rather than assumed.

**Which target the simulator picks, proven by making the wrong answer fail.** Booting Expo Go on the
iOS simulator with the app working proves nothing on its own — both env pairs were filled in, so
either branch would have rendered. Two mirror runs settle it, since shell variables take precedence
over `.env`:

| Run | Expectation if the branch is right |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL_CLOUD= EXPO_PUBLIC_SUPABASE_ANON_KEY_CLOUD= npx expo start` | boots — it chose local |
| `EXPO_PUBLIC_SUPABASE_URL_LOCAL= …_ANON_KEY_LOCAL= EXPO_PUBLIC_SUPABASE_TARGET=cloud npx expo start` | boots — it chose cloud, and the cloud pair resolves |

Both booted to the sign-in screen. So `Device.isDevice` is `false` on this simulator as documented,
and the cloud configuration resolves inside a real native runtime — which is the phone's path minus
the phone.

**The cloud project answers and RLS holds there.** `GET /auth/v1/settings` with the publishable key
returns 200 with `email: true`; `GET /rest/v1/lists` and `/rest/v1/users` with no session both return
`[]` rather than rows, which is
[list-data-scoped-by-rls](../../kb/entries/list-data-scoped-by-rls.md) behaving correctly against
the remote database and not only the local one.

**`npx supabase status` parses the config with the remotes block present** and the local stack is
unaffected by it.

**Not verified, and only the account owner can:** a physical phone over `npm start`. Everything up
to the phone's own radio is covered by the runs above.

## Follow-ups

1. `npx supabase config push` — without `--yes`, so the CLI prints the diff and waits; there is no
   dry run, and that prompt is the entire review. Then in the dashboard, Auth → Emails: confirm
   **both** "Confirm signup" and "Magic Link" render `{{ .Token }}`. Both, because testing with an
   already-registered address exercises only `magic_link` and passes while every first-time signup
   is broken.
2. `npm run kb:audit` fails one entry until the librarian runs — see below.

## Knowledgebase

`supabase-local-stack` is now wrong in two ways: its opening sentence "There is no cloud Supabase
project" is false, and its `verify:` command greps `.env.example` for a variable name that no longer
exists. `otp-email-templates-carry-the-code` gains a production dimension — the same override
applies there, carried by root inheritance through `config push`. Both are the librarian's to
rewrite; nothing under `ai/kb/` was edited here.
