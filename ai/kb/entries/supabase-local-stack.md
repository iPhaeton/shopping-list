---
id: supabase-local-stack
title: A local Supabase stack in Docker plus a linked cloud project — the local code lands in Mailpit, the cloud one in a real inbox
type: environment
status: current
tags: [supabase, auth, environment, verification, docker, cloud]
sources: [ai/tasks/2/implementation-log-step-2.md, ai/tasks/3/implementation-log-step-1.md, ai/tasks/5-supabase-cloud/implementation-log-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-2.md, ai/tasks/7-list-sharing/implementation-log-step-1.md, ai/tasks/8-realtime/implementation-log-step-1.md, ai/tasks/9-deletion/implementation-log-step-1.md, README.md, .env.example, ai/tasks/13-google-sign-in/implementation-log-step-1.md]
last_verified: 2026-09-18
verify: grep -q '^EXPO_PUBLIC_SUPABASE_URL_LOCAL=http://127.0.0.1:54321$' .env.example && grep -q '^EXPO_PUBLIC_SUPABASE_URL_CLOUD=https://gvosanjceygakbubjfkv.supabase.co$' .env.example && grep -q '^EXPO_PUBLIC_SUPABASE_ANON_KEY_CLOUD=$' .env.example && grep -qE '^\[local_smtp\]' supabase/config.toml && grep -qE '^port = 54324' supabase/config.toml && test -n "$(grep -rl "'.env', '.env.development', '.env.local', '.env.development.local'" node_modules/expo node_modules/@expo 2>/dev/null | head -1)"
related: [cloud-auth-mail-goes-through-resend, otp-email-templates-carry-the-code, supabase-target-picked-at-runtime, supabase-config-push-sends-the-whole-root, supabase-client-module-boundary, native-build-toolchain, list-data-scoped-by-rls, select-policy-gates-update-and-delete, supabase-default-grants-defeat-revokes, realtime-is-a-nudge-to-a-per-user-inbox, deletion-is-a-tombstone]
---

**There are two Supabase environments since step 5.**

| | where | what reaches it |
|---|---|---|
| **local** | Docker on this machine, `npx supabase start` | the browser (`npm run web`) and the iOS simulator (`npm run ios`) |
| **cloud** | project ref `gvosanjceygakbubjfkv`, eu-west-1 | a physical device in Expo Go (`npm start`) |

The branch is made at runtime, not at build — [supabase-target-picked-at-runtime](supabase-target-picked-at-runtime.md)
has the rule and the `EXPO_PUBLIC_SUPABASE_TARGET` override that points either runtime at either environment.

| local service | address |
|---|---|
| API / GoTrue | http://127.0.0.1:54321 |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Mailpit (all outbound mail) | http://127.0.0.1:54324 |

Start Docker Desktop, then `npx supabase start`. The CLI is a devDependency, so always `npx
supabase` — a globally installed one may be a different version.

**Why local is still the verification path:** the six-digit sign-in code is machine-readable in
Mailpit, so the whole OTP flow can be driven end to end by Playwright. On cloud the code lands in a
real inbox and a human has to relay it. Nothing local is ever sent to a real address; **cloud mail is
real mail, sent through Resend from a verified domain to any address** —
[cloud-auth-mail-goes-through-resend](cloud-auth-mail-goes-through-resend.md) has the block, the
From constraint and what is still unproven about delivery.

**The cloud schema is kept current with `npx supabase db push`, lags whenever a step adds a
migration, and reads back from the CLI.** `npx supabase migration list --linked` and `npx supabase
db dump --linked [-s <schema>]` need only the stored login (they open a database connection, and
`db dump` reports objects the role does not own, so a `realtime.messages` policy shows in
`-s realtime`). Ask them rather than assuming — remote state is a dated observation, not an
invariant, so `verify:` deliberately asserts none of it (last seen 2026-09-10: step 9's
`20260910000000_deletion.sql` and `20260910000001_purge_schedule.sql` were local only). The schedule
is its own file because `create extension pg_cron` is confirmed only on this Docker stack and may be
refused on cloud ([deletion-is-a-tombstone](deletion-is-a-tombstone.md)); **an unapplied migration
wedges every later `db push`** — the CLI retries from the earliest unapplied file — and `npx supabase
migration repair --status applied <timestamp>` is the way out. Two earlier worries proved groundless:
the unique index on `lower(email)` did not collide on cloud, and a policy on `realtime.messages`
(owned by `supabase_realtime_admin`) did not bite on ownership — schema-level proof only; no client
has used the cloud realtime socket
([realtime-is-a-nudge-to-a-per-user-inbox](realtime-is-a-nudge-to-a-per-user-inbox.md)). Cloud
*auth config* has no read-back at all, and config is a separate push with different rules —
[supabase-config-push-sends-the-whole-root](supabase-config-push-sends-the-whole-root.md).

**Env vars.** Copy [.env.example](../../../.env.example) to `.env` (gitignored). There are two
symmetric pairs, `_LOCAL` and `_CLOUD`, and neither is a default. The local values are the stack's
own defaults — that anon key derives from the JWT secret in `supabase/config.toml`, which is why it
is safe to commit. **The cloud key is deliberately blank in the committed example** and the
`verify:` command asserts it stays that way; fill it in your own `.env` from
`npx supabase projects api-keys --project-ref gvosanjceygakbubjfkv`, taking the publishable
`sb_publishable_…` key rather than the legacy anon JWT. That key is designed to ship inside a client
bundle — RLS is the boundary, not the key ([list-data-scoped-by-rls](list-data-scoped-by-rls.md)) —
but `sb_secret_…` must never enter `src/` or `.env.example`.

Three things bite here:

- Metro substitutes `process.env.EXPO_PUBLIC_*` by **literal text match**. `process.env[name]` with
  a computed key is never replaced and arrives as `undefined`, so every variable is spelled out in
  full. To prove what a bundle really received, fetch it and grep —
  `curl -s 'http://localhost:8081/index.bundle?platform=ios' | grep -c EXPO_PUBLIC_SUPABASE_URL_CLOUD`
  (`platform=web&dev=true` for the browser bundle) — rather than trusting the shell.
- The dev server must be **restarted** after editing `.env` — sometimes with `--clear` — because the
  values are inlined at build time.
- **In the dev server a `.env` *file* beats the shell** (measured 2026-09-09 from the served bundle;
  this entry once said the opposite). `@expo/env` will not overwrite a key already in `process.env`,
  then the dev-only `expo/virtual/env` computes `{ ...process.env, ...['.env', '.env.development',
  '.env.local', '.env.development.local'] }` — the file wins, later files over earlier (only a
  production export, which this project never runs, inlines `process.env` directly). So a shell
  variable named in no `.env` file does reach the bundle, and the way to override a key that *is* in
  `.env` is a gitignored **`.env.local`** plus `--clear`. The `verify:` pins that merge order.

**After editing a migration or `supabase/config.toml`:** `npx supabase start` on already-running
containers prints status and does *not* apply migrations, and the auth container does not reread
`config.toml` while it is up. Both symptoms — "my table isn't there", "my template override did
nothing" — clear with:

```bash
npx supabase stop && npx supabase start && npx supabase db reset
```

**`db reset` wipes the `auth` schema too, and the browser does not know that.** A tab still holding
a session from before the reset fails its next token refresh with a 400 on `/auth/v1/token`. Nothing
is broken — clear the site's local storage, or sign in again. It has already been mistaken for a
real auth failure once, mid-Playwright-run.

**To simulate being offline, abort requests to port 54321 — not `setOffline`.**
`page.context().setOffline(true)` also blocks the Metro bundle, so the app never boots and a restart
cannot be tested. Routing only `**/127.0.0.1:54321/**` to `route.abort()` is faithful: the app
starts normally and the database is unreachable, the scenario
[writes-retry-from-an-outbox](writes-retry-from-an-outbox.md) exists for. Stopping the containers
works too, but is slower and takes Mailpit with it.

**To test row-level security without a browser, switch role inside a psql transaction.**
`set local role authenticated; set local request.jwt.claims = '{"sub":"<user-uuid>","role":"authenticated"}';`
makes `auth.uid()` return that person, so a whole role matrix — reader, writer, owner, non-member,
`anon` — can be scripted against real policies. Mint the accounts through the local admin API
(`/auth/v1/admin/users` with the service-role key). Two traps: assert the **row count**, since RLS
refuses an UPDATE or DELETE by matching zero rows rather than erroring
([select-policy-gates-update-and-delete](select-policy-gates-update-and-delete.md)), and read
`pg_proc.proacl` and `information_schema.column_privileges` directly rather than trusting a `revoke`
([supabase-default-grants-defeat-revokes](supabase-default-grants-defeat-revokes.md)).

**Verify anything that touches Supabase in the browser**, with `psql` against port 54322 as the check
on what actually landed. `npm run web` is the only path driven end to end; no sign-in has been
completed in the simulator ([native-build-toolchain](native-build-toolchain.md)). A physical device
reaches cloud, whose SMTP and templates are live and have sent one real code — but no device has
completed a sign-in against production, the only thing left that would prove it end to end
([otp-email-templates-carry-the-code](otp-email-templates-carry-the-code.md)).
