# Suggestion — share a list by name, with autocomplete

**Status:** proposal, not an approved step. Adopting it needs a new
`ai/tasks/<n>/description-step-<n>.md` first, and
[scope-boundaries](../kb/entries/scope-boundaries.md) updated afterwards by the librarian.

**Date:** 2026-09-22

**Not in `backlog/backlog.txt`** — proposed directly by the user, 2026-09-22, not sourced from the
backlog like [user-names.md](user-names.md) was.

**Depends on [user-names.md](user-names.md) / step 17**, already landed: every account has a
required, unique, case-insensitive `name` (`public.users.name`, unique index on `lower(name)`,
`supabase/migrations/20260921000000_user_names.sql`). This proposal would not be possible before
that — there was nothing stable to search by.

## Current state

Inviting someone to a list is exact-email only. `SharingScreen.tsx` has a plain `TextInput` for an
address; `shareList` in [membersApi.ts](../../src/lib/membersApi.ts) calls `share_list(p_list_id,
p_email, p_role)`, which resolves the address to a user id server-side
(`supabase/migrations/20260907000000_list_sharing.sql#L305`). That function's own comment states the
reason there is no other way to find someone:

> `public.users` is readable only as your own row and stays that way: a general email-to-id lookup
> is an account-enumeration endpoint. Sharing resolves the address server-side instead and never
> hands the caller a directory.

The user wants to invite by **name** instead of email, with a live autocomplete suggesting at most 5
matches while typing. That is a directory lookup by construction — you can't autocomplete a name you
don't already know without searching across other people's rows.

## The tradeoff, resolved with the user, 2026-09-22

Reversing the "never a directory" stance was flagged explicitly rather than assumed. Two shapes were
on the table:

1. **Open search** — any authenticated user can search all other named accounts by name prefix,
   capped at 5 results per query, names only (no email).
2. **Scoped search** — only among people who already share a list with you, falling back to
   something else (still exact email?) for a genuinely new contact.

**Decided: open search (1).** Scoped search doesn't actually satisfy "find someone by name" for the
common case — inviting someone you've never shared a list with — and would need a fallback path
anyway, which reintroduces the email flow the user explicitly wants to drop. The bound that makes
open search acceptable is the same one already used for the sharing roster itself: authenticated
only, capped rows, minimal fields (id + name, no email, no other column).

## Schema — new migration

```sql
-- Case-insensitive contains match — a leading wildcard, so the btree index `create unique index on
-- public.users (lower(name))` (20260921000000_user_names.sql) cannot serve it; that index stays,
-- doing only what it always did (enforce uniqueness). A trigram GIN index on the same expression is
-- what makes this query index-backed instead of a sequential scan.
create extension if not exists pg_trgm;

create index on public.users using gin (lower(name) gin_trgm_ops);

create function public.search_users_by_name(p_query text)
returns table (user_id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.name
    from public.users u
   where u.name is not null
     and u.id <> (select auth.uid())
     and lower(u.name) like '%' || lower(trim(p_query)) || '%' escape '\'
   order by u.name
   limit 5
$$;

revoke execute on function public.search_users_by_name(text) from public, anon;
grant execute on function public.search_users_by_name(text) to authenticated;
```

`p_query` should have `%`/`_` escaped before the `like` (e.g. via a small `replace` chain) so a typed
wildcard character searches literally instead of matching more broadly than intended — a correctness
detail, not a security one, since results are capped either way.

**Indexed, not scanned.** `gin_trgm_ops` decomposes `lower(name)` into trigrams and can serve `like
'%x%'` — unlike a btree, a leading wildcard is not a problem for it — so this scales the same way
`lower(email)`'s uniqueness lookup does, independent of how many accounts exist. The cost sits on the
write side instead: every `set_name` call updates one GIN entry, but names change rarely (once at
onboarding, occasionally after), so that cost is negligible against a search that runs on every
keystroke. `pg_trgm` is one of Supabase's trusted extensions, so `create extension if not exists
pg_trgm` runs directly in the migration with no dashboard step first.

No new policy on `public.users` — this RPC is the only access path, same as `list_members_of`.

### `share_list` changes shape: email → id

Selecting a suggestion already resolves a concrete `user_id`; re-resolving by email would be a step
backward. `share_list` drops `p_email text` for `p_user_id uuid` — a `drop function` + recreate, the
same move `list_members_of` made in the user-names migration when its return shape changed:

```sql
drop function public.share_list(uuid, text, public.list_role);

create function public.share_list(p_list_id uuid, p_user_id uuid, p_role public.list_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.list_members m
     where m.list_id = p_list_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'only an owner can share this list';
  end if;

  if p_user_id = (select auth.uid()) then
    raise exception using errcode = '22023', message = 'you already have this list';
  end if;

  if not exists (select 1 from public.users u where u.id = p_user_id) then
    raise exception using errcode = 'P0002', message = 'that account no longer exists';
  end if;

  insert into public.list_members (list_id, user_id, role)
  values (p_list_id, p_user_id, p_role)
  on conflict (list_id, user_id) do update set role = excluded.role;
end;
$$;

revoke execute on function public.share_list(uuid, uuid, public.list_role) from public, anon;
grant execute on function public.share_list(uuid, uuid, public.list_role) to authenticated;
```

The existence check is defence in depth for a race (target deleted between search and share) rather
than a normal path — the UI only ever calls this with an id a search result just returned. It still
raises `P0002`, already classified `'permanent'` by `verdictFor`
([listsApi.ts:371](../../src/lib/listsApi.ts#L371)), so no client-side error-classification change is
needed.

`notify pgrst, 'reload schema';` at the end, matching every migration that changes a function's
shape.

## Client

- [membersApi.ts](../../src/lib/membersApi.ts): add `UserSuggestion = { userId: string; name:
  string }` and `searchUsers(query: string)`, calling `search_users_by_name` the way `fetchMembers`
  calls `list_members_of`. Change `shareList(listId, userId: string, role: Role)` to send
  `p_user_id`.
- New `src/components/UserAutocomplete.tsx` — controlled like
  [RolePicker](../../src/components/RolePicker.tsx): `{ value, onChangeText, onSelect, disabled }`.
  Owns its own debounce (300ms) and fetch; queries fire only at 2+ trimmed characters; a `cancelled`
  flag in the effect cleanup discards stale responses arriving out of order. Suggestions render
  **inline below the input**, not an absolute overlay — `SharingScreen` is already inside a
  `ScrollView`, and an overlay risks z-index/overflow issues a pushed-down inline list avoids
  entirely. Each suggestion is a `Pressable` with `accessibilityRole="button"` and
  `accessibilityLabel={`Share with ${user.name}`}`, per
  [queries-go-through-a11y-labels](../kb/entries/queries-go-through-a11y-labels.md).
- [SharingScreen.tsx](../../src/screens/SharingScreen.tsx#L58): replace the `email` state and its
  `TextInput` (`#L176`–`#L188`) with `query`/`selected: UserSuggestion | null`. Typing clears
  `selected`; selecting a suggestion sets it and mirrors the name into `query`. `canInvite` becomes
  `selected !== null && !pending` — text alone is no longer enough to share, since a name is not a
  unique target the way an email was. The Share button calls `shareList(listId, selected.userId,
  inviteRole)` and resets both on success. Everything else on the screen (roster, role picker,
  remove, `run()`'s error handling) is unchanged.

## Testing

- `membersApi.test.ts`: update `shareList`'s assertion to the new `p_user_id` param; add a
  `searchUsers` case.
- `UserAutocomplete.test.tsx` (new): debounced fetch fires once per pause, no fetch under 2
  characters, renders at most 5 results, selecting calls `onSelect`, editing after a selection clears
  it.
- `SharingScreen.test.tsx`: rewrite the invite-flow tests around the new component — mock
  `membersApi.searchUsers`, type a name, wait for the debounced suggestion, tap it, tap Share, assert
  `shareList('list-1', 'u2', 'writer')`. Update the `"Email address"` label assertion to whatever
  label `UserAutocomplete` exposes.

## Deliberately out

- **Scoping suggestions to existing list co-members.** Considered and rejected above — it doesn't
  cover the "invite someone new" case, which is the point of the feature.
- **Showing email anywhere in the new flow.** The roster already prefers name over email for
  display; this proposal keeps email out of the search results entirely, unlike the roster's
  pre-migration fallback.
- **A minimum-length gate on the server.** The 5-row cap already bounds what any single query can
  leak; a 2-character client-side gate is a UX nicety (don't search on an empty box), not a security
  boundary, so the RPC itself stays simple and doesn't need to special-case a short `p_query`.
