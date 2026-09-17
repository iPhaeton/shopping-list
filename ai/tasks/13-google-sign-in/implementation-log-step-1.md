# Task 13, step 1 — implementation log (agent track)

Human track (Google Cloud Console) was already done and handed back before this session started:
`supabase/config.toml`'s `[auth.external.google]` block and `.env`'s
`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` were already staged/populated. This log covers only the
remaining agent-track work: `.env.example`, stack restart, verification, `kb:audit`.

## Client IDs used

All three came from one GCP project (prefix `857897394234-`), already in `supabase/config.toml`
before this session:

- Web application client (audience / `client_id`): `857897394234-sgkdm3k7p7qd5feo1vmetchp3hjkavsu.apps.googleusercontent.com`
- `additional_client_ids` (iOS, Android — repo has no record of which is which; that mapping lives
  only in the Google Cloud Console):
  `857897394234-7k91redv8k4nfiqbm40m2ln2333btlli.apps.googleusercontent.com`,
  `857897394234-srril4mc96j97hn4jfmuktdvdg96i66e.apps.googleusercontent.com`

Secret not recorded here (per plan) — lives only in `.env`, gitignored.

## What this step actually changed

- `.env.example` — added a doc block for `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`, matching the
  `RESEND_API_KEY` block's shape (rationale paragraph, indented var/description line, closing
  paragraph explaining why there's no `VARNAME=` line). No code, no other file.
- `supabase/config.toml` — untouched by this session; already staged exactly as the plan specifies.

`email_optional` and `skip_nonce_check` did **not** need to differ from the plan's defaults — both
are `false` in the staged block, matching what was planned.

## Verification

`npx supabase stop && npx supabase start` — clean restart, no errors, new `[auth.external.google]`
block picked up (config is read at container start, not hot-reloaded).

Check 1 — provider reports enabled:
```
$ curl -s http://127.0.0.1:54321/auth/v1/settings | jq .external.google
true
```

Check 2 — GoTrue is doing real token validation, not just reporting "enabled":
```
$ curl -s -i -X POST 'http://127.0.0.1:54321/auth/v1/token?grant_type=id_token' \
    -H "apikey: <EXPO_PUBLIC_SUPABASE_ANON_KEY_LOCAL>" \
    -H "Content-Type: application/json" \
    -d '{"provider":"google","id_token":"not-a-real-token"}'

HTTP/1.1 400 Bad Request
Content-Type: application/json

{"error":"invalid request","error_description":"Bad ID token"}
```
Pass: `"Bad ID token"` names a token-validation failure, not "provider not enabled" or
"unsupported provider" — confirms the block took effect and GoTrue is actually parsing/validating
the token rather than short-circuiting on a disabled provider.

`npm run kb:audit` — 0 errors, 12 warnings, all "ground moved" notices tied to files this task (or
the already-staged config.toml) touched, e.g. `cloud-auth-mail-goes-through-resend`,
`max-rows-is-a-silent-ceiling`, and `supabase-local-stack` flagging `.env.example`/`config.toml` as
changed since their `last_verified` date — same shape as the precedent in
[ai/tasks/6-custom-smtp/implementation-log-step-2.md](../6-custom-smtp/implementation-log-step-2.md)
("0 errors, N warnings, all pre-existing"). No `src/` file changed, so `npm test` /
`npm run typecheck` were not re-run.

## Not done here (by design)

Phases 2 (client library, `googleSignIn.ts`, button, `prebuild --clean`) and 3 (push this block to
production, verify on a device) are out of scope for this step — see plan-step-1.md's own scope
statement and the "Risk to flag now" section about the debug keystore not surviving
`prebuild --clean`, which phase 2's own plan needs to account for.
