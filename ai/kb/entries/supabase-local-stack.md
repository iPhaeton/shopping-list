---
id: supabase-local-stack
title: A local Supabase stack in Docker plus a linked cloud project — the local code lands in Mailpit, the cloud one in a real inbox
type: environment
status: current
tags: [supabase, auth, environment, verification, docker, cloud]
sources: [ai/tasks/2/implementation-log-step-2.md, ai/tasks/3/implementation-log-step-1.md, ai/tasks/5-supabase-cloud/implementation-log-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-2.md, ai/tasks/7-list-sharing/implementation-log-step-1.md, ai/tasks/8-realtime/implementation-log-step-1.md, ai/tasks/9-deletion/implementation-log-step-1.md, README.md, .env.example, ai/tasks/13-google-sign-in/implementation-log-step-1.md, ai/tasks/13-google-sign-in/implementation-log-step-2.md, ai/tasks/20-ux/implementation-log-step-1.md, ai/tasks/22-sticky-headers/implementation-log-step-1.md, ai/tasks/20-ux/implementation-log-step-5.md, ai/tasks/24-search-and-sort/implementation-log-step-2.md, ai/tasks/24-search-and-sort/implementation-log-step-3.md, a572bd3]
last_verified: 2026-10-07
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

**Why local is still the verification path:** the six-digit sign-in code is machine-readable in
Mailpit, so the whole OTP flow can be driven end to end — by Playwright on web, by Maestro on a
simulator. On cloud the code lands in a real inbox and a human has to relay it. Nothing local is
ever sent to a real address; **cloud mail is real mail, sent through Resend from a verified domain
to any address** — [cloud-auth-mail-goes-through-resend](cloud-auth-mail-goes-through-resend.md)
has the block, the From constraint and what is still unproven about delivery.

**The cloud schema is kept current with `npx supabase db push`, lags whenever a step adds a
migration, and reads back from the CLI.** `npx supabase migration list --linked` and `npx supabase
db dump --linked [-s <schema>]` need only the stored login (`db dump` shows objects the role does
not own, so a `realtime.messages` policy shows in `-s realtime`). Ask them rather than assuming —
`verify:` deliberately asserts none of it. `pg_cron` is confirmed only on this Docker stack, so the
purge schedule is its own migration ([deletion-is-a-tombstone](deletion-is-a-tombstone.md)); **an unapplied migration
wedges every later `db push`** — the CLI retries from the earliest unapplied file — and `npx supabase
migration repair --status applied <timestamp>` is the way out. No client has used the cloud
realtime socket yet ([realtime-is-a-nudge-to-a-per-user-inbox](realtime-is-a-nudge-to-a-per-user-inbox.md)).
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
- **Which value wins is measured, not read off the code, and it has flipped once** (under SDK 54
  the file beat the shell). Today (SDK 57, ios and web bundles, 2026-09-28) it is **shell >
  `.env.local` > `.env`**: `@expo/env` never overwrites a key already set. The dev-only
  `expo/virtual/env` that once reversed it is still there, inert for an unidentified reason, and no
  static check can see that. Read the bundle first.

**A new migration: `npx supabase migration up --local`** applies only what is pending and keeps
every row, the load-test users below included. **An edited migration or `supabase/config.toml`**
needs more: `start` on running containers applies nothing, and auth does not reread the config while
up. "My table isn't there" and "my template override did nothing" clear only with this, which
**wipes every row**:

```bash
npx supabase stop && npx supabase start && npx supabase db reset
```

**The local stack may hold 1,000,000 load-test users** — `supabase/scripts/seed-1m-users.sql`
(commit `a572bd3`), emails `%@loadtest.invalid`, present on 2026-10-02. With them,
`search_users_by_name` takes ~3.5 s cold (245 ms warm), and under build load it hit the
authenticated role's 8 s `statement_timeout` (HTTP 500, `57014`). Their names also sort ahead of
seeded ones: "Jor" answers `Aaliyah Jordan 107351`… before `seed.mjs`'s Jordan. Count them before a
sharing test; the script's own cleanup line or a `db reset` removes them.

**Other local data, as of 2026-10-03 — check before relying on it.** Every real list of
`maya@example.com` (Groceries, Hardware store, …) is binned at one identical stamp, and her live
lists are load-test `Seed list 43xx`, so **screenshots use `maya3@example.com`, which holds the
mockups' set**. For paging and the 2,000-row completion cap: `t23lists` has 403 live lists, `Seed
list 5` 1,000 extra items, and `Seed list 6` 2,100 (`Bulk 1…2100`), past the cap.

**`db reset` wipes the `auth` schema too**: a tab holding an older session fails its next refresh
with a 400 on `/auth/v1/token`. Nothing is broken — clear the site's storage, or sign in again.

**To simulate being offline, abort requests to port 54321 — not `setOffline`**, which also blocks
the Metro bundle, so the app never boots. Routing `**/127.0.0.1:54321/**` to `route.abort()` leaves
the app running with the database unreachable — the scenario
[writes-retry-from-an-outbox](writes-retry-from-an-outbox.md) exists for.

**To test row-level security without a browser, switch role inside a psql transaction.**
`set local role authenticated; set local request.jwt.claims = '{"sub":"<user-uuid>","role":"authenticated"}';`
makes `auth.uid()` return that person, so a whole role matrix — reader, writer, owner, non-member,
`anon` — can be scripted against real policies. Mint the accounts through the local admin API
(`/auth/v1/admin/users` with the service-role key). Two traps: assert the **row count**, since RLS
refuses an UPDATE or DELETE by matching zero rows rather than erroring
([select-policy-gates-update-and-delete](select-policy-gates-update-and-delete.md)), and read
`pg_proc.proacl` and `information_schema.column_privileges` directly rather than trusting a `revoke`
([supabase-default-grants-defeat-revokes](supabase-default-grants-defeat-revokes.md)).

**Verify flows that touch Supabase in the browser**, with `psql` against port 54322 as the check on
what actually landed; looks are signed off on the simulator ([phone-is-the-product](phone-is-the-product.md)).
Both native builds have signed in against local too — Android with Google (task 13), iOS by OTP with
Maestro reading Mailpit (task 20; [maestro-drives-the-native-ui](maestro-drives-the-native-ui.md)).
No device has completed a sign-in against production
([otp-email-templates-carry-the-code](otp-email-templates-carry-the-code.md)).
