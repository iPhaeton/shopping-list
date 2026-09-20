# Step 1 implementation log — session revocation for writes

## What changed

- New `supabase/migrations/20260920000000_session_revocation.sql`:
  - `public.session_still_valid()` — `security definer`, zero arguments, `stable`. Returns whether
    the caller's JWT `session_id` claim still has a row in `auth.sessions`. `security definer`
    because `authenticated` holds no grant at all on `auth.sessions` (checked via
    `information_schema.role_table_grants`: only `postgres` does) — an `invoker` version, the shape
    `my_memberships()` uses, would fail outright on every call regardless of session validity.
  - Nine write RPCs (`set_item_done`, `add_item`, `rename_item`, `rename_list`, `set_list_deleted`,
    `set_item_deleted`, `share_list`, `set_member_role`, `remove_member`) each got one line added as
    the first statement inside `begin`: `if not public.session_still_valid() then raise exception
    using errcode = '42501', message = 'this device has been signed out'; end if;`. Bodies otherwise
    unchanged, same signatures throughout (`create or replace`, no re-grants or `notify pgrst`
    needed — that was only required in prior migrations when a *signature* changed).
  - `list_members_of` (a read, not a write) and the SELECT-side RLS policies (`my_memberships()`,
    `read lists you belong to`, etc.) were deliberately left untouched — this closes the gap for
    writes only, per the chosen scope.

## Why this, and why this scope

Root-caused, not assumed: probed the local stack directly. `GET /rest/v1/lists` with a fresh access
token → `200`. `POST /auth/v1/logout?scope=global` with that token → `204`, and its row in
`auth.sessions` was confirmed deleted. The *same* access token against `GET /rest/v1/lists` again →
still `200`. An access token is a self-contained JWT, checked by signature and expiry only
(`jwt_expiry = 3600`); nothing on a normal request looks it up against `auth.sessions`. This is what
let a second, already-signed-in device (the reported bug: iOS emulator staying live after "sign out
of all devices" was pressed on Android) keep writing for up to an hour after being globally signed
out.

A realtime "kick" broadcast (reusing the existing per-user nudge channel from
`ai/kb/entries/realtime-is-a-nudge-to-a-per-user-inbox.md`) was considered and rejected: delivery is
at-most-once, so a device offline at the moment of sign-out never receives it, and reconnecting
afterward does not force a token refresh — it just resumes on the same stale-but-valid token. That
is exactly the case the user asked about directly ("if the device is offline, will it be able to
write when it comes back online?") — yes, with a kick alone, and that is why the RLS-level check was
chosen instead: it is checked fresh on every request, independent of whether anything was ever
delivered.

Scope is writes only, by explicit user choice, not an oversight: a revoked device may still *read*
briefly-stale data until its token naturally expires, but the instant it tries to change anything,
`session_still_valid()` fails it. Full coverage (folding the check into `my_memberships()` and the
base `list_members` read policy too) was scoped out as a larger, separate piece of work.

## Cost, measured rather than assumed

`explain (analyze, buffers)` on `exists (select 1 from auth.sessions where id = ...)` against the
live local `auth.sessions` table: **0.25ms**, 1 buffer. The check takes no arguments and references
nothing about the row it sits beside — Postgres evaluates it once per statement (an InitPlan), the
same treatment `(select auth.uid())` and `my_memberships()` already get throughout this schema
(`ai/kb/entries/read-rooted-at-list-members.md`), not the per-row `is_list_member(list_id, uid)`
shape that same entry rejected on cost grounds. `auth.sessions` is sized by live sessions across the
whole install, not by list/item row counts, so it does not grow with the data this project's other
RLS work has been careful about.

## Problem hit during verification — unrelated pre-existing behavior, not a regression

While writing a regression probe (verify a *valid* session's writes still succeed, migration
applied), a plain `POST /rest/v1/lists` with `Prefer: return=representation` consistently returned
`42501 "new row violates row-level security policy for table lists"` — even with `auth.uid()`
independently confirmed correct via raw `psql` (`set_config('request.jwt.claims', …)` +
`set_config('request.jwt.claim.sub', …)`), and even with `session_still_valid()` (new in this
migration) independently confirmed to return `true` in that same session. Root-caused by elimination:
the same insert *without* `Prefer: return=representation` returned `201` and the row was confirmed
present via a follow-up `GET`. This is the well-known Postgres RLS/RETURNING timing gotcha — the
`RETURNING` clause's implicit re-check of the row against the table's SELECT policy runs before the
`on_list_created` **AFTER INSERT** trigger has granted the creator's `list_members` row, so `id in
(select m.list_id from my_memberships() m)` isn't true yet at that instant. **Confirmed pre-existing
and unrelated to this migration**: reproduced identically after `npx supabase db reset` with this
migration's file moved out of `supabase/migrations/` entirely. **Does not affect the app**:
`insertList` in `src/lib/listsApi.ts` calls `.insert({ id, name })` with no `.select()`, so it never
requests `return=representation` and never hits this path — confirmed separately via the browser
smoke test below, which creates a list through the real UI without incident. Worth the librarian's
judgment on whether this is a KB-worthy gotcha (a future `.select()` added to `insertList`, or a new
insert-with-representation call elsewhere, would resurface it) or too narrow to record.

## Verification

- `npx supabase migration up` — applied clean.
- Regression probe (valid, non-revoked session) against all nine RPCs plus the plain `lists` insert
  — every one still returns `applied`/`204`/`201` exactly as before.
- Reproduction probe, scripted against the local stack: signed in, created a list and item, confirmed
  `set_item_done` applied; then `POST /auth/v1/logout?scope=global`; then with the **same,
  now-revoked access token**: `GET /rest/v1/lists` still `200`s (writes-only scope preserved),
  `set_item_done` and `add_item` both now refused with `403` / `42501` /
  `"this device has been signed out"` — the exact bug, reproduced and then confirmed fixed.
- `npm run typecheck` — clean (no `src/` changes).
- `npm test` — 18 suites / 344 tests, all passing, unaffected.
- Manual, single-session, end to end in the browser (Playwright MCP) against the local stack: signed
  in via a fresh OTP, created a list through the real UI, added an item, checked it done — all three
  write paths succeeded with zero console errors. A genuine two-device browser reproduction (two
  Playwright tabs) was considered and rejected: two tabs on the same origin share `localStorage`
  (the web backing for `AsyncStorage`), so they would collide into the *same* session rather than
  simulate two independent devices — the curl-based reproduction above is the methodologically sound
  substitute and is what actually isolates two sessions.
- Not pushed to the cloud project. Local verification only, per the plan and the project's standing
  caution around unattended Supabase pushes.
