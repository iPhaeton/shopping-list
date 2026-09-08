---
id: supabase-local-stack
title: A local Supabase stack in Docker plus a linked cloud project — the local code lands in Mailpit, the cloud one in a real inbox
type: environment
status: current
tags: [supabase, auth, environment, verification, docker, cloud]
sources: [ai/tasks/2/implementation-log-step-2.md, ai/tasks/3/implementation-log-step-1.md, ai/tasks/5-supabase-cloud/implementation-log-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-1.md, README.md, .env.example]
last_verified: 2026-09-07
verify: grep -q '^EXPO_PUBLIC_SUPABASE_URL_LOCAL=http://127.0.0.1:54321$' .env.example && grep -q '^EXPO_PUBLIC_SUPABASE_URL_CLOUD=https://gvosanjceygakbubjfkv.supabase.co$' .env.example && grep -q '^EXPO_PUBLIC_SUPABASE_ANON_KEY_CLOUD=$' .env.example && grep -qE '^\[local_smtp\]' supabase/config.toml && grep -qE '^port = 54324' supabase/config.toml
related: [otp-email-templates-carry-the-code, supabase-target-picked-at-runtime, supabase-config-push-sends-the-whole-root, supabase-client-module-boundary, native-build-toolchain, list-data-scoped-by-rls, select-policy-gates-update-and-delete, supabase-default-grants-defeat-revokes]
---

**There are two Supabase environments since step 5**, and this entry used to open "There is no cloud
Supabase project" — any advice you remember to that effect is out of date.

| | where | what reaches it |
|---|---|---|
| **local** | Docker on this machine, `npx supabase start` | the browser (`npm run web`) and the iOS simulator (`npm run ios`) |
| **cloud** | project ref `gvosanjceygakbubjfkv`, eu-west-1 | a physical device in Expo Go (`npm start`) |

The branch is made at runtime and is not a build flag — see
[supabase-target-picked-at-runtime](supabase-target-picked-at-runtime.md) for the rule and the
`EXPO_PUBLIC_SUPABASE_TARGET` override that lets you point either runtime at either environment.

Local addresses:

| service | address |
|---|---|
| API / GoTrue | http://127.0.0.1:54321 |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Mailpit (all outbound mail) | http://127.0.0.1:54324 |

Start Docker Desktop, then `npx supabase start`. The CLI is a devDependency, so always `npx
supabase` — a globally installed one may be a different version.

**Why local is still the verification path:** the six-digit sign-in code is machine-readable in
Mailpit, so the whole OTP flow can be driven end to end by Playwright. On cloud the code lands in a
real inbox and a human has to relay it. Adding cloud did not change that — it added a target for the
phone, which cannot reach this machine's loopback at all. **Confirming anything else about cloud
config isn't scriptable against an API either:** the access token `npx supabase login` stores in the
macOS keychain is not scoped for the Management API — `GET /v1/projects/{ref}/config/auth` and even a
plain project list both come back `403`. The dashboard — read by eye, or driven with Playwright after
a human signs in — is the only read-back path that works without minting a separate personal access
token.

**Reading the code during development:** open Mailpit at http://127.0.0.1:54324. Nothing local is
ever sent to a real address. **Cloud mail is real mail, and since step 6 it goes out through Resend,
not Supabase's built-in mailer** — `[remotes.production.auth.email.smtp]` at the end of
`supabase/config.toml` carries the block, confirmed against the live dashboard on 2026-09-03 (host,
port, sender, rate limit all matched). The restriction that will look like a bug survives step 6, but
its *owner* changed: Resend's sandbox sender (`onboarding@resend.dev`) delivers only to the address
that owns the Resend account, not to "the project's own Supabase team" as it used to. Anything else
is accepted by the API and silently never arrives — same symptom, different cause — and it lifts only
once a verified sending domain lands (phase 2 of task 6, not yet done). Until then, README's "your
real inbox" line means specifically the Resend account owner's inbox.

**The cloud schema is kept current with `npx supabase db push`, and right now it is behind.** The
first two migrations were applied there on 2026-09-03; **step 7's
`20260907000000_list_sharing.sql` is committed but not pushed** — the local stack has sharing and the
cloud project still has step 3's owner-only schema. Pushing it is the user's call, and one thing has
to be checked first: `create unique index on public.users (lower(email))` fails if the production
project holds two addresses differing only in case. The remote runs Postgres 17.6.1 against
`major_version = 17` in `supabase/config.toml`. Ask `npx supabase migration list --linked` rather
than assuming any of this still holds. Config is a separate push with different rules —
[supabase-config-push-sends-the-whole-root](supabase-config-push-sends-the-whole-root.md).

**Env vars.** Copy [.env.example](../../../.env.example) to `.env` (gitignored). There are two
symmetric pairs, `_LOCAL` and `_CLOUD`, and neither is a default. The local values are the stack's
own defaults — that anon key derives from the JWT secret in `supabase/config.toml`, which is why it
is safe to commit. **The cloud key is deliberately blank in the committed example** and the
`verify:` command asserts it stays that way; fill it in your own `.env` from
`npx supabase projects api-keys --project-ref gvosanjceygakbubjfkv`, taking the publishable
`sb_publishable_…` key rather than the legacy anon JWT. That key is designed to ship inside a client
bundle — RLS is the boundary, not the key ([list-data-scoped-by-rls](list-data-scoped-by-rls.md)) —
but `sb_secret_…` must never enter `src/` or `.env.example`. Leaving the cloud key blank costs
nothing on web or in the simulator; only a physical device refuses to boot without it.

Three things bite here:

- Metro substitutes `process.env.EXPO_PUBLIC_*` by **literal text match**. `process.env[name]` with
  a computed key is never replaced and arrives as `undefined`, so every variable is spelled out in
  full. To check that a *native* bundle really received them, fetch it and grep:
  `curl -s 'http://localhost:8081/index.bundle?platform=ios' | grep -c EXPO_PUBLIC_SUPABASE_URL_CLOUD`.
  A unit test covers the same property from the other side.
- The dev server must be **restarted** after editing `.env` — sometimes with `--clear` — because the
  values are inlined at build time.
- **A shell variable beats `.env`.** That is what makes `EXPO_PUBLIC_SUPABASE_URL_CLOUD= npx expo
  start` a way to prove which pair a runtime actually read.

**After editing a migration or `supabase/config.toml`:** `npx supabase start` on already-running
containers prints status and does *not* apply migrations, and the auth container does not reread
`config.toml` while it is up. Both symptoms — "my table isn't there", "my template override did
nothing" — clear with:

```bash
npx supabase stop && npx supabase start && npx supabase db reset
```

**`db reset` wipes the `auth` schema too, and the browser does not know that.** A tab still holding
a session from before the reset will fail its next token refresh with a 400 on `/auth/v1/token`.
Nothing is broken — clear the site's local storage, or just sign in again. It looks alarming in the
console during a Playwright run and has already been mistaken for a real auth failure once.

**To simulate being offline, abort requests to port 54321 — not `setOffline`.**
`page.context().setOffline(true)` also blocks the Metro bundle, so the app never boots and a restart
cannot be tested at all. Routing only `**/127.0.0.1:54321/**` to `route.abort()` is the faithful
version: the app starts normally and the database is unreachable, which is the scenario
[writes-retry-from-an-outbox](writes-retry-from-an-outbox.md) exists for. Stopping the containers
works too, but it is slower and takes Mailpit with it.

**To test row-level security without a browser, switch role inside a psql transaction.**
`set local role authenticated; set local request.jwt.claims = '{"sub":"<user-uuid>","role":"authenticated"}';`
is what makes `auth.uid()` return that person, so a whole role matrix can be scripted against real
policies — step 7 checked reader, writer, owner, non-member and `anon` against every operation this
way. Mint the accounts through the local admin API (`/auth/v1/admin/users` with the service-role
key). Two traps: assert the **row count**, since RLS refuses an UPDATE or DELETE by matching zero
rows rather than by erroring
([select-policy-gates-update-and-delete](select-policy-gates-update-and-delete.md)), and read
`pg_proc.proacl` and `information_schema.column_privileges` directly rather than trusting that a
`revoke` did what it said
([supabase-default-grants-defeat-revokes](supabase-default-grants-defeat-revokes.md)). This
complements the browser; it does not replace it.

**Verify anything that touches Supabase in the browser** — auth since step 2, list data since step 3
— with `psql` against port 54322 as the check on what actually landed in the tables. `npm run web`
is the only path that has been driven end to end. The simulator picks the same local stack and boots
against it, but no sign-in has been completed there. A physical device reaches cloud, and as of step
6 the SMTP credentials and both templates are confirmed live by direct dashboard read-back — but no
physical device has actually completed a sign-in against production yet, which is the only thing left
that would prove it end to end. See
[otp-email-templates-carry-the-code](otp-email-templates-carry-the-code.md) for exactly what is and
isn't proven, and [native-build-toolchain](native-build-toolchain.md) for what each target is good
for otherwise.
