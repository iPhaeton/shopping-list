---
id: supabase-local-stack
title: A local Supabase stack in Docker plus a linked cloud project — the local code lands in Mailpit, the cloud one in a real inbox
type: environment
status: current
tags: [supabase, auth, environment, verification, docker, cloud]
sources: [ai/tasks/2/implementation-log-step-2.md, ai/tasks/3/implementation-log-step-1.md, ai/tasks/5-supabase-cloud/implementation-log-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-1.md, ai/tasks/8-realtime/implementation-log-step-1.md, README.md, .env.example]
last_verified: 2026-09-10
verify: grep -q '^EXPO_PUBLIC_SUPABASE_URL_LOCAL=http://127.0.0.1:54321$' .env.example && grep -q '^EXPO_PUBLIC_SUPABASE_URL_CLOUD=https://gvosanjceygakbubjfkv.supabase.co$' .env.example && grep -q '^EXPO_PUBLIC_SUPABASE_ANON_KEY_CLOUD=$' .env.example && grep -qE '^\[local_smtp\]' supabase/config.toml && grep -qE '^port = 54324' supabase/config.toml && test -n "$(grep -rl "'.env', '.env.development', '.env.local', '.env.development.local'" node_modules/expo node_modules/@expo 2>/dev/null | head -1)"
related: [otp-email-templates-carry-the-code, supabase-target-picked-at-runtime, supabase-config-push-sends-the-whole-root, supabase-client-module-boundary, native-build-toolchain, list-data-scoped-by-rls, select-policy-gates-update-and-delete, supabase-default-grants-defeat-revokes, realtime-is-a-nudge-to-a-per-user-inbox]
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
phone, which cannot reach this machine's loopback at all.

**Cloud *schema* reads back from the CLI; cloud *auth config* does not.** The split matters, because
the second half used to be stated as if it covered both. `npx supabase migration list --linked` and
`npx supabase db dump --linked [-s <schema>]` both work with nothing but the stored login — they open
a database connection (the CLI prints `Initialising login role...`), and `db dump` reports objects
the connecting role does not own, so a policy on `realtime.messages` shows up in `-s realtime`. That
makes any schema question about cloud — did a migration land, does this policy exist there —
answerable in one scriptable command. **Auth config is the part that is not:** the access token
`npx supabase login` stores in the macOS keychain is not scoped for the Management API, so
`GET /v1/projects/{ref}/config/auth` and even a plain project list both come back `403`. For those,
the dashboard — read by eye, or driven with Playwright after a human signs in — is still the only
read-back path without minting a separate personal access token.

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

**The cloud schema is kept current with `npx supabase db push`, and as of 2026-09-10 it is level —
this entry used to say it was two migrations behind.** All four migrations report both a `local` and
a `remote` timestamp: the first two landed 2026-09-03, and step 7's `20260907000000_list_sharing.sql`
and step 8's `20260909000000_realtime.sql` both landed since. **Both worries this entry raised about
that push turned out to be nothing, and each is worth knowing for the next one.** `create unique
index on public.users (lower(email))` was expected to fail if production held two addresses differing
only in case — it exists there now (`users_lower_idx`), so it did not. And the realtime migration
creates a policy **on `realtime.messages`**, a table `supabase_realtime_admin` owns rather than
`postgres`; that was expected to bite on ownership and did not. The policy row is on cloud, read back
directly rather than inferred from the push succeeding
([realtime-is-a-nudge-to-a-per-user-inbox](realtime-is-a-nudge-to-a-per-user-inbox.md)). **This is
schema-level proof, not delivery proof** — nothing has connected a client to the cloud project's
realtime socket. The remote runs Postgres 17.6.1 against `major_version = 17` in
`supabase/config.toml`. Ask `npx supabase migration list --linked` rather than assuming any of this
still holds; nothing in `verify:` asserts it, deliberately, because the state of a remote database is
a dated observation rather than an invariant this repo can hold true, and a check that needs the
network fails for reasons that have nothing to do with the fact. Config is a separate push with
different rules —
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
- **In the dev server a `.env` *file* beats the shell, and this entry used to say the opposite.**
  Measured on 2026-09-09 by reading the served bundle: `EXPO_PUBLIC_SUPABASE_TARGET=local npx expo
  start` with `.env` saying `cloud` produced an app that talked to **cloud**. Two mechanisms compose.
  `@expo/env` refuses to overwrite a key already in `process.env`, so the shell value survives into
  the CLI's environment — and then the dev-only virtual module `expo/virtual/env` computes
  `{ ...process.env, ...['.env', '.env.development', '.env.local', '.env.development.local'] }`, so
  the **file wins** and later files win over earlier ones. (Only a production export inlines from
  `process.env` directly, where the shell does win — this project never runs one.) Consequences worth
  keeping: a shell variable **not** named in any `.env` file does reach the bundle; the way to
  override a key that *is* in `.env` is a gitignored **`.env.local`** plus `--clear`; and to prove
  which value a runtime actually read, grep the served bundle
  (`curl -s 'http://localhost:8081/index.bundle?platform=web&dev=true'`) rather than trusting the
  shell. The `verify:` command pins that merge order in the installed Expo packages, so an upgrade
  that changes it goes red.

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
