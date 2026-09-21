# Suggestion — users have a required, unique, editable display name

**Status:** proposal, not an approved step. Adopting it needs a new
`ai/tasks/<n>/description-step-<n>.md` first, and
[scope-boundaries](../kb/entries/scope-boundaries.md) updated afterwards by the librarian.

**Date:** 2026-09-21

**Backlog item:** `backlog/backlog.txt` #14, "Refactor authentication. Users should have names."

**Resolved with the user, 2026-09-21:** a name is **required** (every account must eventually have
one) and **unique** (case-insensitive across all accounts), but not collected up front — it can be
set once, after sign-in, and changed later.

**Relationship to [social-sign-in.md](social-sign-in.md):** that document's "Deliberately out"
section floats a `display_name` column "filled by `handle_new_user` from
`raw_user_meta_data->>'full_name'`" as the obvious follow-up. This document supersedes that specific
idea — see "Why the trigger must not seed the name" below — and proposes one gate shared by both
sign-in methods instead of a Google-only shortcut.

## Current state

`public.users` ([users.sql](../../supabase/migrations/20260830000000_users.sql)) has only `id`,
`email`, `created_at`, minted by the `handle_new_user` trigger off `auth.users`. Identity is shown to
other people exactly once — a raw email in
[SharingScreen.tsx](../../src/screens/SharingScreen.tsx#L136), sourced from `list_members_of` via
[membersApi.ts](../../src/lib/membersApi.ts). [AccountScreen.tsx](../../src/screens/AccountScreen.tsx)
shows no identity at all today, not even the caller's own email. Two sign-in paths — OTP
(`SessionContext.requestCode`/`verifyCode`) and Google (`src/lib/googleSignIn.ts`) — both land in the
same `AuthState` union in [SessionContext.tsx](../../src/state/SessionContext.tsx). No client code
reads or writes `public.users` today.

## Schema

```sql
alter table public.users add column name text;
create unique index on public.users (lower(name));
```

Left **nullable** at the DB level on purpose. `handle_new_user` inserts a row at account creation
before any name exists; a `not null` column would break every sign-up. "Required" is enforced by the
app's navigation state (below), not a column constraint — an account can transiently have
`name is null` between creation and the gate screen being completed.

`create unique index` on a nullable column is fine as-is: SQL unique constraints treat every `NULL`
as distinct from every other `NULL`, so many pre-gate accounts can coexist with `name = null` without
colliding.

**No change to `handle_new_user`.** It keeps minting rows with `email` only; `name` starts null for
every account regardless of sign-in method.

### Why the trigger must not seed the name

The obvious shortcut — pull `raw_user_meta_data->>'full_name'` into the insert for Google sign-ins —
is unsafe once `name` is unique. Real names collide constantly ("John Smith"), and if the seeded value
violates the new unique index, **the whole `auth.users` insert transaction aborts**: sign-up itself
fails, opaquely, for anyone whose Google-reported name happens to match an existing user's chosen
name. Both sign-in methods should go through the same one-time gate instead; the gate screen can
still *prefill* its input from `session.user.user_metadata.full_name` as a suggestion (client-side
only, never DB-seeded), so a Google user with no collision never has to type anything, and one with a
collision just gets told to pick something else — the same experience an OTP user gets.

### `set_name` RPC

```sql
create function public.set_name(p_name text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  trimmed text := trim(p_name);
begin
  if trimmed = '' then
    raise exception using errcode = '22023', message = 'please enter a name';
  end if;

  update public.users set name = trimmed where id = (select auth.uid());
exception
  when unique_violation then
    raise exception using errcode = 'P0001', message = 'that name is taken';
end;
$$;

revoke execute on function public.set_name(text) from public, anon;
grant execute on function public.set_name(text) to authenticated;
```

`security invoker` is enough — the existing "update own row" policy on `public.users`
(`auth.uid() = id`) already permits this write; no definer bypass is needed since the caller only
ever touches their own row.

**The 23505 trap.** [`listsApi.ts`](../../src/lib/listsApi.ts#L374)'s `verdictFor` hard-codes
`23505 → 'applied'`, calibrated for a client-minted insert retried after a dropped response catching
up with itself. A raw `23505` from a genuine name collision must never reach that shared classifier
looking like an ordinary safe-to-ignore duplicate — which is exactly what the `unique_violation`
catch above prevents, by re-raising under a code (`P0001`) that classifier has no special-case for and
that carries a message meant to be shown, not swallowed. Do not route this call through the outbox
either, for the same reason `SharingScreen`'s membership writes don't: the "taken" answer has to reach
the person while they're still looking at the field they typed into, not as a banner an hour later.

**Also recommended:** lock down `public.users` the way
[list_sharing.sql](../../supabase/migrations/20260907000000_list_sharing.sql#L230) already locks
`lists`:

```sql
revoke update on public.users from anon, authenticated;
grant update (name) on public.users to authenticated;
```

Nothing writes to this table from the client today, so the default broad grant Supabase hands every
table has been latent and harmless. This migration is the first one that gives it a live entry point
(`set_name`'s `update` runs as the caller under `security invoker`), so it's also the first one where
leaving `email`/`created_at` open through a future stray `.from('users').update(...)` becomes a real,
reachable mistake rather than a hypothetical one.

### `list_members_of`

Needs `name` added to its returned columns — this changes the function's shape, so it's a
`drop function` + recreate, not `create or replace`, and the `grant execute` has to be repeated
afterward (a drop clears it):

```sql
drop function public.list_members_of(uuid);

create function public.list_members_of(p_list_id uuid)
returns table (user_id uuid, email text, name text, role public.list_role)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, u.email, u.name, m.role
    from public.list_members m
    join public.users u on u.id = m.user_id
   where m.list_id = p_list_id
     and exists (
       select 1 from public.list_members me
        where me.list_id = p_list_id and me.user_id = (select auth.uid())
     )
   order by m.created_at
$$;

revoke execute on function public.list_members_of(uuid) from public, anon;
grant execute on function public.list_members_of(uuid) to authenticated;
```

## Auth state machine

This is the actual "refactor" half of the backlog item. `SessionContext`'s `signedIn` case currently
carries only a `Session`. Extend it to also carry `name: string | null`, resolved right after a
session appears:

```ts
export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; reason?: 'revoked' }
  | { status: 'signedIn'; session: Session; name: string | null };
```

[RootNavigator.tsx](../../src/navigation/RootNavigator.tsx#L48)'s `screensFor` already comments that a
state like a biometric `locked` would slot in as one new arm on this switch — a `name === null` gate
fits the same shape: render a single blocking `SetNameScreen` (no `Lists`/`Sharing`/`Account`
reachable) instead of the normal stack; once `setName` succeeds, the state flips and `RootNavigator`
swaps stacks exactly like every other transition here. `App.tsx`'s `ListsForSignedInUser` needs no
change — it can keep mounting `ListsProvider` for the whole `signedIn` case; the gate screen simply
being the only thing rendered on top of it is enough.

**The offline fallback direction depends on how the `signedIn` state arose — corrected 2026-09-21.**
The first draft of this section said a cache miss or a failed fetch should always fall through to
"assume set, don't block." That's right for a *returning* user, wrong for a *brand-new* one, and the
two look identical from the fetch's point of view: both have no cached name on this device. Losing
connection in the instant between account creation and the first profile fetch would, under the
original rule, let a genuinely nameless fresh account slip straight past the gate.

`SessionContext` already has two distinct code paths for how a `signedIn` state is produced, and
that's the signal to use instead of one blanket rule:

- **`onAuthStateChange`'s listener firing for a sign-in that just happened live in this app run.**
  Connectivity was just proven by the sign-in itself (OTP verification and Google's token exchange
  both need a round trip to succeed), so if the follow-up profile fetch then fails, default toward
  showing the gate rather than assuming it's satisfied. The user lands on `SetNameScreen`; if they're
  still offline when they submit, `set_name` fails with the same "you need a connection" message
  `SharingScreen`'s writes already give ([SharingScreen.tsx](../../src/screens/SharingScreen.tsx#L97)),
  and they stay parked at the gate until they retry — no different from any other blocked write in
  this app.
- **`getSession()` restoring a persisted session at cold start.** Here a cache miss or failed fetch
  keeps the original "assume set, don't block" fallback: cache the last-known name on-device the same
  way [listCache.ts](../../src/lib/listCache.ts) caches lists (keyed by `userId`), and only ever
  conclude "name is missing" from a fresh, successful fetch. This is the same "reading offline"
  guarantee step 4 already established for lists, applied to one more piece of per-user state — but it
  only applies to a session the device has seen before, not to one that's never resolved a name at
  all.

The remaining edge case — force-quitting during that narrow window, then relaunching while still
offline — falls into the second bullet (a persisted session being restored) and lets the user in
nameless until the next successful fetch. That's an accepted, self-healing gap: the moment they're
online again the fetch confirms `name` is still null and shows the gate, and in the meantime anyone
who sees them in a shared list's roster just sees their email instead of a name, via the same
fallback `SharingScreen` already needs for pre-migration rows (see Display, below).

`setName(name: string): Promise<Result>` goes on `SessionContextValue`, calling `set_name` and, on
success, updating local state (and the on-device cache) so the gate clears immediately without a
round trip.

## Display

- [membersApi.ts](../../src/lib/membersApi.ts): add `name: string | null` to `MemberRow`, `Member`,
  and `toMember`.
- [SharingScreen.tsx](../../src/screens/SharingScreen.tsx#L136): render `member.name`, falling back to
  `member.email` only for pre-migration rows that haven't hit the gate yet. Update the a11y labels
  (`Set ${member.email} to ${role}`, `Remove ${member.email}`) the same way.
- [AccountScreen.tsx](../../src/screens/AccountScreen.tsx): currently shows nothing about the account
  at all. Add the current name (and email, also currently absent) plus an edit control reusing
  `setName` and the same "that name is taken" error surface as the onboarding screen.

## New file

- `src/screens/SetNameScreen.tsx` — a text input + submit, prefilled from
  `session.user.user_metadata.full_name`/`name` when present (a suggestion only — see above),
  submitting through `useSession().setName`. Same visual language as `SignInScreen`/`AccountScreen`
  (the existing `PrimaryButton` pattern, `ErrorBanner`).

## Existing accounts

No backfill migration. Every row created before this ships already has `name = null`; those users
simply hit the same one-time gate on their next sign-in, exactly like a brand-new account — nothing
distinguishes "old account, never named" from "new account, not yet named" and nothing needs to.

## Testing

- `SetNameScreen.test.tsx` (new).
- `SharingScreen.test.tsx` / `membersApi.test.ts`: fixtures gain `name`; assert the email fallback for
  a `name: null` row.
- `SessionContext.test.tsx`: the gate transition (`name: null` → blocked → `setName` → cleared), and
  the offline-cache fallback (fetch fails, cached name present → not re-gated).
- No Playwright/browser coverage needed beyond what already exists — this is ordinary React Native UI,
  not a native-module round trip like Google sign-in.

## Deliberately out

- **Seeding `name` from OAuth metadata in the trigger.** See "Why the trigger must not seed the name"
  above — unsafe under the uniqueness constraint. The gate screen's client-side prefill is the closest
  equivalent kept.
- **A length or character-set constraint on `name`.** `items.title` has none either
  ([max-rows-is-a-silent-ceiling](../kb/entries/scope-boundaries.md) notes this precedent); revisit
  only if real input breaks the layout.
- **Forcing existing accounts through the gate before their next sign-in** (e.g. an invalidate-all
  refresh token approach). Unnecessary complexity for a rule that already resolves itself the next
  time each account is seen.
- **Showing "shared with N people" or any roster count.** Unrelated to this item;
  [scope-boundaries](../kb/entries/scope-boundaries.md) already tracks that as a separate, deliberate
  gap.
