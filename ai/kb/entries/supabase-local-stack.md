---
id: supabase-local-stack
title: Auth runs against a local Supabase stack in Docker; the sign-in code lands in Mailpit
type: environment
status: current
tags: [supabase, auth, environment, verification, docker]
sources: [ai/tasks/2/implementation-log-step-2.md, ai/tasks/3/implementation-log-step-1.md, README.md, .env.example]
last_verified: 2026-08-31
verify: grep -q 'EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321' .env.example && grep -qE '^\[local_smtp\]' supabase/config.toml && grep -qE '^port = 54324' supabase/config.toml
related: [otp-email-templates-carry-the-code, supabase-client-module-boundary, native-build-toolchain, list-data-scoped-by-rls]
---

**There is no cloud Supabase project.** Everything runs locally, in Docker:

| service | address |
|---|---|
| API / GoTrue | http://127.0.0.1:54321 |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Mailpit (all outbound mail) | http://127.0.0.1:54324 |

Start Docker Desktop, then `npx supabase start`. The CLI is a devDependency, so always `npx
supabase` — a globally installed one may be a different version.

**Why local was chosen:** the six-digit sign-in code is machine-readable in Mailpit, so the whole
OTP flow can be driven end to end by Playwright. Against a cloud project the code lands in a real
inbox and a human has to relay it, and the email templates become dashboard click-paths instead of
files under version control.

**Reading the code during development:** open Mailpit at http://127.0.0.1:54324. Nothing is ever
sent to a real address.

**Env vars.** Copy [.env.example](../../../.env.example) to `.env` (gitignored). The values are the
local stack's defaults — the anon key derives from the JWT secret in `supabase/config.toml`, which
is why it is safe to commit. Two things bite here:

- Metro substitutes `process.env.EXPO_PUBLIC_*` by **literal text match**. `process.env[name]` with
  a computed key is never replaced, so each variable must be spelled out in full.
- The dev server must be **restarted** after editing `.env`; the values are inlined at build time.

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

**Verify anything that touches this stack in the browser** — auth since step 2, list data since
step 3. A phone running Expo Go cannot reach this machine's `127.0.0.1:54321`, so sign-in cannot
complete there at all; `npm run web` is the path that has been driven end to end, with `psql` against
port 54322 as the check on what actually landed in the tables. The iOS simulator shares the host's loopback and would probably reach the stack,
but that has not been tried — see [native-build-toolchain](native-build-toolchain.md) for what each
target is good for otherwise.
