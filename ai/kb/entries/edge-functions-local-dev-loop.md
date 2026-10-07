---
id: edge-functions-local-dev-loop
title: Edge Functions on the local stack — a new function needs a full `supabase start`, a code edit an edge-runtime restart; secrets reach them from `.env` through `[edge_runtime.secrets]`; local Kong answers CORS itself, so cloud CORS is unverified; no `deno` on PATH
type: environment
status: current
tags: [supabase, edge-functions, deno, local, cors, secrets]
sources: [ai/tasks/26-apple-sign-in/implementation-log-step-3.md, ai/tasks/26-apple-sign-in/implementation-log-step-4.md, 9421c3c, 42cd547]
last_verified: 2026-10-07
verify: grep -q '^\[edge_runtime.secrets\]' supabase/config.toml && grep -q '^APPLE_SIGN_IN_KEY_ID = "env(APPLE_SIGN_IN_KEY_ID)"' supabase/config.toml && grep -q '^APPLE_SIGN_IN_PRIVATE_KEY = "env(APPLE_SIGN_IN_PRIVATE_KEY)"' supabase/config.toml && ! grep -qE '^APPLE_SIGN_IN_[A-Z_]*=' .env.example && grep -q corsHeaders supabase/functions/delete-account/index.ts && ! grep -q corsHeaders supabase/functions/store-apple-token/index.ts supabase/functions/reset-apple-sign-in/index.ts && test -z "$(find supabase/functions -name 'deno.json*' -o -name package.json)"
related: [apple-refresh-token-revoked-before-account-deletion, supabase-local-stack, supabase-target-picked-at-runtime]
indexed: false
---

The functions live in `supabase/functions/` and run in the local stack's edge-runtime container
(CLI 2.116.0, Deno 2). What costs a cycle:

- **A new function needs a full stack restart.** The router builds its function list from
  `SUPABASE_INTERNAL_FUNCTIONS_CONFIG` at `supabase start`; an unknown name gets **404**. A code
  edit to an existing function needs only `docker restart supabase_edge_runtime_shopping-list`. A
  `supabase start` straight after `stop` once came back with no containers; a second `start` worked.
- **Secrets come from `.env`.** CLI 2.116.0 resolves `[edge_runtime.secrets]` in
  [supabase/config.toml](../../../supabase/config.toml) at `supabase start` from `.env` (or the
  shell, which wins) and puts them in the container's environment — so a changed secret also needs a
  restart. The Apple ones are `APPLE_SIGN_IN_KEY_ID` and `APPLE_SIGN_IN_PRIVATE_KEY` (the `.p8` in
  base64 on one line); [.env.example](../../../.env.example) says where each comes from and has no
  `KEY=` line for them on purpose. Unset, the functions answer `apple_not_configured` once they
  reach Apple.
- **`SUPABASE_SERVICE_ROLE_KEY` is injected** by the local edge runtime, as a legacy JWT. The cloud
  project's variable is not checked.
- **Local CORS proves nothing.** Locally, Kong answers the preflight itself and adds the headers, so
  a web call worked with or without the function's own; through Kong a `POST` with `Origin` returns
  exactly one `Access-Control-Allow-Origin`. To test the function's own headers, bypass Kong: Node
  `fetch` from inside `supabase_studio_shopping-list` to
  `http://supabase_edge_runtime_shopping-list:8081/delete-account`. **Cloud CORS is unverified.**
  Only `delete-account` sets CORS headers — it is the only function a browser calls.
- **`deno` is not on PATH**, so functions are verified by request and on the device, not by
  `deno check` or Jest. `npm:@supabase/supabase-js@2.112.4` imports load with no `package.json` or
  `deno.json`.
- **"wall clock duration warning … early termination"** lines in the runtime log are idle workers
  being reaped, not failures.

Nothing here is deployed to cloud yet
([apple-refresh-token-revoked-before-account-deletion](apple-refresh-token-revoked-before-account-deletion.md)).

The `verify:` asserts the two secrets still resolve through `[edge_runtime.secrets]`, no `KEY=`
line for them in `.env.example`, CORS on `delete-account` only, and no `deno.json`/`package.json`
under `supabase/functions`.
