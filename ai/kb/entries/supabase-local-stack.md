---
id: supabase-local-stack
title: A local Supabase stack in Docker plus a linked cloud project — the local code lands in Mailpit, the cloud one in a real inbox
type: environment
status: current
tags: [supabase, auth, environment, verification, docker, cloud]
sources: [ai/tasks/2/implementation-log-step-2.md, ai/tasks/3/implementation-log-step-1.md, ai/tasks/5-supabase-cloud/implementation-log-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-2.md, ai/tasks/7-list-sharing/implementation-log-step-1.md, ai/tasks/8-realtime/implementation-log-step-1.md, ai/tasks/9-deletion/implementation-log-step-1.md, README.md, .env.example, ai/tasks/13-google-sign-in/implementation-log-step-1.md, ai/tasks/13-google-sign-in/implementation-log-step-2.md, ai/tasks/20-ux/implementation-log-step-1.md, ai/tasks/22-sticky-headers/implementation-log-step-1.md, ai/tasks/20-ux/implementation-log-step-5.md, ai/tasks/24-search-and-sort/implementation-log-step-2.md, ai/tasks/24-search-and-sort/implementation-log-step-3.md, a572bd3, ai/tasks/27-sign-in-email/implementation-log-step-1.md, ai/tasks/28-invitations/implementation-log-step-1.md, 47965d5, ai/tasks/28-invitations/implementation-log-step-3.md, 5ab9b85]
last_verified: 2026-10-09
verify: grep -q '^EXPO_PUBLIC_SUPABASE_URL_LOCAL=http://127.0.0.1:54321$' .env.example && grep -q '^EXPO_PUBLIC_SUPABASE_URL_CLOUD=https://gvosanjceygakbubjfkv.supabase.co$' .env.example && grep -q '^EXPO_PUBLIC_SUPABASE_ANON_KEY_CLOUD=$' .env.example && grep -qE '^\[local_smtp\]' supabase/config.toml && grep -qE '^port = 54324' supabase/config.toml && grep -q 'is already defined and IS NOT overwritten' node_modules/@expo/env/build/index.js && grep -qF "mode !== 'test' && \`.env.local\`, \`.env.\${mode}\`, \`.env\`" node_modules/@expo/env/build/index.js
related: [edge-functions-local-dev-loop, trigram-index-needs-three-characters, cloud-auth-mail-goes-through-resend, phone-is-the-product, maestro-drives-the-native-ui, otp-email-templates-carry-the-code, supabase-target-picked-at-runtime, supabase-config-push-sends-the-whole-root, supabase-client-module-boundary, native-build-toolchain, list-data-scoped-by-rls, select-policy-gates-update-and-delete, supabase-default-grants-defeat-revokes, realtime-is-a-nudge-to-a-per-user-inbox, deletion-is-a-tombstone]
---

| | where | what reaches it |
|---|---|---|
| **local** | Docker on this machine, `npx supabase start` | the browser (`npm run web`), the iOS simulator, and the Android emulator (`npm run ios`/`npm run android`) |
| **cloud** | project ref `gvosanjceygakbubjfkv`, eu-west-1 | a physical device on the dev build (`npm start`) — Expo Go cannot run the app |

The branch is made at runtime, not at build — [supabase-target-picked-at-runtime](supabase-target-picked-at-runtime.md) has the rule and the `EXPO_PUBLIC_SUPABASE_TARGET` override that points either runtime at either environment.

| local service | address |
|---|---|
| API / GoTrue | http://127.0.0.1:54321 |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Mailpit (all outbound mail) | http://127.0.0.1:54324 |

Start Docker Desktop, then `npx supabase start` — always `npx`: the CLI is a devDependency.

**Why local is still the verification path:** the sign-in code is machine-readable in Mailpit, so
Playwright (web) and Maestro (simulator) drive OTP end to end; on cloud a human relays it from a real
inbox. **Cloud mail is real mail, through Resend to any address** —
[cloud-auth-mail-goes-through-resend](cloud-auth-mail-goes-through-resend.md).

**The cloud schema is kept current with `npx supabase db push`, lags whenever a step adds a
migration, and reads back from the CLI.** `npx supabase migration list --linked` and `npx supabase
db dump --linked [-s <schema>]` need only the stored login (`db dump` shows objects the role does
not own, so a `realtime.messages` policy shows in `-s realtime`). Ask them rather than assuming —
`verify:` asserts none of it. `pg_cron` is confirmed only on this Docker stack, so the purge
schedule is its own migration ([deletion-is-a-tombstone](deletion-is-a-tombstone.md)); **an
unapplied migration wedges every later `db push`** (it retries from the earliest unapplied file) —
`npx supabase migration repair --status applied <timestamp>` is the way out.
Cloud *auth config* has no read-back at all, and config is a separate push with different rules —
[supabase-config-push-sends-the-whole-root](supabase-config-push-sends-the-whole-root.md).

**Env vars.** Copy [.env.example](../../../.env.example) to `.env` (gitignored). There are two
symmetric pairs, `_LOCAL` and `_CLOUD`, and neither is a default. The local values are the stack's
own defaults — that anon key derives from the JWT secret in `supabase/config.toml`, which is why it
is safe to commit. **The cloud key is deliberately blank in the committed example** and the
`verify:` command asserts it stays that way; fill it in from
`npx supabase projects api-keys --project-ref gvosanjceygakbubjfkv`, taking the publishable
`sb_publishable_…` key, not the legacy anon JWT. It is built to ship in a client bundle — RLS is
the boundary ([list-data-scoped-by-rls](list-data-scoped-by-rls.md)) — but `sb_secret_…` must never
enter `src/` or `.env.example`. `.env` also holds the un-prefixed Sign in with Apple key, which no
bundle sees: `npx supabase start` hands it to the Edge Functions
([edge-functions-local-dev-loop](edge-functions-local-dev-loop.md)).

Three things bite here:

- Metro substitutes `process.env.EXPO_PUBLIC_*` by **literal text match**, so a computed
  `process.env[name]` arrives `undefined` and every variable is spelled out in full. To prove what a
  bundle received, fetch it and grep rather than trusting the shell —
  `curl -s 'http://localhost:8081/index.bundle?platform=ios&dev=true' | grep -o '"EXPO_PUBLIC_SUPABASE_TARGET": { enumerable: true, value: "[a-z]*"'`
  (`platform=web` for the browser).
- The dev server must be **restarted** after editing `.env` — sometimes with `--clear` — because the
  values are inlined at build time.
- **Which value wins is measured, not read off the code, and it has flipped once.** On SDK 57 it is
  **shell > `.env.local` > `.env`** (`@expo/env` never overwrites a set key); the dev-only
  `expo/virtual/env` that once reversed it is still there, inert for no known reason. Read the bundle.

**A new migration: `npx supabase migration up --local`** applies only what is pending and keeps
every row, the load-test users below included. **An edited `supabase/config.toml` or email
template: `npx supabase stop && npx supabase start`** — auth rereads neither while up, and this
keeps every row too. `otp-code.html` is bind-mounted into
kong as a single file, which GoTrue fetches over HTTP; an editor that saves by replacing the file
leaves the mount on the old copy until another `stop && start`, so check what is served:
`docker exec supabase_kong_shopping-list cat /home/kong/templates/email/magic_link.html`.
**Only an edited migration needs `db reset`**, since `start` applies nothing to running containers,
and it **wipes every row** — `auth` included, so a tab holding an older session then fails its next
refresh with a 400 on `/auth/v1/token`; clear the site's storage or sign in again:

```bash
npx supabase stop && npx supabase start && npx supabase db reset
```

**The local stack may hold 1,000,000 load-test users** — `supabase/scripts/seed-1m-users.sql`
(commit `a572bd3`), emails `%@loadtest.invalid`, present on 2026-10-02. With them,
`search_users_by_name` takes ~3.5 s cold (245 ms warm), and under build load it hit the
authenticated role's 8 s `statement_timeout` (HTTP 500, `57014`). Their names also sort ahead of
seeded ones: "Jor" answers `Aaliyah Jordan 107351`… before `seed.mjs`'s Jordan. Count them before a
sharing test; the script's own cleanup line or a `db reset` removes them. With them, **look an
account up by `public.users`' `lower(email)`, never `auth.users.email`** (a seq scan), and never
delete with `or … in (select … from auth.users where email like …)` — it runs for minutes; join
with `delete … using auth.users` instead.

**Other local data, as of 2026-10-03 — check first.** `maya@example.com`'s real lists are all
binned and her live ones are load-test `Seed list 43xx`, so **screenshots use `maya3@example.com`**,
which holds the mockups' set. Paging: `t23lists` has 403 live lists, `Seed list 5` 1,000 extra
items, `Seed list 6` 2,100 (`Bulk 1…2100`), past the 2,000-row completion cap.

**To simulate being offline, route `**/127.0.0.1:54321/**` to `route.abort()` — not `setOffline`**,
which blocks the Metro bundle too ([writes-retry-from-an-outbox](writes-retry-from-an-outbox.md)).

**To test row-level security without a browser, switch role inside a psql transaction.**
`set local role authenticated; set local request.jwt.claims = '{"sub":"<user-uuid>","role":"authenticated"}';`
makes `auth.uid()` return that person, so a whole role matrix — reader, writer, owner, non-member,
`anon` — can be scripted against real policies. Mint the accounts through the local admin API
(`/auth/v1/admin/users` with the service-role key). Two traps: assert the **row count**, since RLS
refuses an UPDATE or DELETE by matching zero rows rather than erroring
([select-policy-gates-update-and-delete](select-policy-gates-update-and-delete.md)), and read
`pg_proc.proacl` and `information_schema.column_privileges` directly rather than trusting a `revoke`
([supabase-default-grants-defeat-revokes](supabase-default-grants-defeat-revokes.md)).

**To see the plan inside a definer function, use `auto_explain` — it is preloaded locally.**
In the psql session, `set auto_explain.log_nested_statements = on; set auto_explain.log_level =
notice; set auto_explain.log_analyze = on; set auto_explain.log_buffers = on`, then call the
function: its inner plans print as notices. `load 'auto_explain'` is refused, and unnecessary.

**Verify flows that touch Supabase in the browser**, with `psql` against port 54322 as the check on
what actually landed; looks are signed off on the simulator ([phone-is-the-product](phone-is-the-product.md)).
Both native builds have signed in against local ([maestro-drives-the-native-ui](maestro-drives-the-native-ui.md));
no device has against production ([otp-email-templates-carry-the-code](otp-email-templates-carry-the-code.md)).
