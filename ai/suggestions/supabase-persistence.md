# Suggestion — introduce Supabase for persistence, accounts, sharing, and live updates

**Status:** proposal, not an approved step. Persistence, auth, and sharing are currently out of
scope per [scope-boundaries](../kb/entries/scope-boundaries.md); adopting this needs a new
`ai/tasks/<n>/description-step-<n>.md` first, and that entry updated afterwards by the librarian.

**Date:** 2026-08-27

## Why Supabase

- **Pure-JS client.** `@supabase/supabase-js` needs no native module, so it runs in both of the
  verification paths available here — `npm run web` and Expo Go. Anything requiring a dev build is
  blocked by [no-native-build-toolchain](../kb/entries/no-native-build-toolchain.md).
- **One box for all four requirements.** Postgres, auth, row-level security, and realtime.
- **No dead end.** It is ordinary Postgres, so a local-first sync engine (PowerSync) can be layered
  on the same database later without a migration.

## Schema

```sql
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text
);

create table lists (
  id uuid primary key,
  name text not null check (length(trim(name)) > 0),
  owner_id uuid not null references auth.users,
  created_at timestamptz not null default now()
);

create table list_members (
  list_id uuid references lists on delete cascade,
  user_id uuid references auth.users on delete cascade,
  role text not null default 'editor',
  primary key (list_id, user_id)
);

create table items (
  id uuid primary key,
  list_id uuid not null references lists on delete cascade,
  title text not null check (length(trim(title)) > 0),
  done_at timestamptz,                -- null = not done
  created_at timestamptz not null default now()
);
create index on items (list_id);
```

Two deliberate departures from the in-memory shape:

- **`items` is its own table**, not a nested array. The provider reassembles rows into the nested
  `List.items[]` the reducer and screens already expect, so neither changes shape.
- **`done_at timestamptz` replaces `done: boolean`.** See "Converging toggles" below.

## Row-level security

Every table gets `enable row level security`. The visibility rule is the same everywhere: *you can
see a list if you are a member of it.*

**The footgun:** if the `lists` policy queries `list_members` and the `list_members` policy queries
`lists`, Postgres recurses infinitely and every query 500s. Break the cycle with a
`security definer` helper, which bypasses RLS inside its own body:

```sql
create function is_list_member(p_list_id uuid, p_user_id uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from list_members
    where list_id = p_list_id and user_id = p_user_id
  );
$$;
```

Both policies then call `is_list_member(...)` rather than each other. Sharing a list is one insert
into `list_members`; no policy changes.

## Client wiring

```bash
npx expo install @supabase/supabase-js @react-native-async-storage/async-storage expo-crypto
```

New file `src/lib/supabase.ts`:

- `createClient(url, anonKey, { auth: { storage: AsyncStorage, persistSession: true,
  autoRefreshToken: true, detectSessionInUrl: Platform.OS === 'web' } })`. `detectSessionInUrl` must
  be **on** for the browser, where email-confirmation and OAuth callbacks arrive in the URL, and
  **off** on native, where deep-link handling differs.
- Drive `supabase.auth.startAutoRefresh()` / `stopAutoRefresh()` from React Native's `AppState`, so
  tokens do not silently expire while backgrounded.

Config goes in a gitignored `.env`; the `EXPO_PUBLIC_` prefix is what makes Expo CLI inline the
values. Expo's docs warn against putting secrets behind that prefix, and that warning does not apply
here: the anon key is designed to ship in clients. **RLS is the security boundary, not the key.** No
service-role key ever reaches the app.

## Where Supabase runs

Three ways to run it; this plan uses the first two.

| | What it is | Used for |
|---|---|---|
| **Cloud** (supabase.com) | hosted service — create a project, copy its URL and anon key | the phone, and any two-client test |
| **Local** (`supabase start`) | the CLI boots the stack in Docker: API `:54321`, Postgres `:54322`, Studio `:54323` | fast schema and RLS iteration in the browser |
| **Self-hosted** (`docker compose`) | ~11 services on a server you own; you own TLS, secrets, backups, upgrades | not used |

**Start with cloud.** Docker is installed on this machine but its daemon is off, and 8 GB of RAM is
already shared with Metro, a browser, and an editor. The deciding reason is narrower though: a phone
cannot reach the Mac's `localhost`, so Expo Go needs a reachable URL no matter what. Adopting the CLI
later costs nothing — `supabase db pull` writes a migration from the schema already built in the
dashboard, so none of the work is redone.

Free-tier projects **pause after ~7 days without API requests**. The data survives; the database
refuses connections until restored, which presents as a total outage on the next open.

### Targeting local from the browser and cloud from the phone

Worth having once the local stack exists, and it must be decided **at runtime**. Expo's
`.env.development` / `.env.production` split on build mode, not platform, and a single `expo start`
serves the browser and Expo Go from the same server on the same env — press `w` in a `npm start`
session and the setting is silently wrong. `Platform.OS` cannot mismatch.

```ts
const targets = {
  local: {
    url: process.env.EXPO_PUBLIC_SUPABASE_URL_LOCAL,
    anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY_LOCAL,
  },
  cloud: {
    url: process.env.EXPO_PUBLIC_SUPABASE_URL_CLOUD,
    anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY_CLOUD,
  },
} as const;

function pickTarget(): keyof typeof targets {
  const override = process.env.EXPO_PUBLIC_SUPABASE_TARGET;
  if (override === 'local' || override === 'cloud') return override;
  return __DEV__ && Platform.OS === 'web' ? 'local' : 'cloud';
}
```

Metro substitutes `process.env.EXPO_PUBLIC_*` by **literal text match**, so each variable must be
spelled out in full — a computed key is never replaced. The `__DEV__` guard keeps a production web
export from pointing at `localhost`. Env changes need a dev-server restart, sometimes `--clear`.

The local anon key derives from `jwt_secret` in `supabase/config.toml`, so it is stable for this
project and identical for anyone who checks the repo out — it can sit in a committed `.env.example`.

**The catch:** local and cloud are two different databases with two different user tables. An account
made on web and one made on the phone are unrelated and cannot see each other's lists. That is fine
for steps 1–2, but it breaks the natural way to verify steps 3 and 4 — sharing and realtime both need
two clients on the *same* database. Hence the override:

```bash
npm run web                                     # local (default)
EXPO_PUBLIC_SUPABASE_TARGET=cloud npm run web   # both clients on cloud, for two-client tests
```

Or point Expo Go at the local stack over the LAN (`http://<mac-lan-ip>:54321`) — `supabase start`
binds on all interfaces. Keeps everything on one database and off the cloud, but breaks whenever the
LAN IP changes, so it is the fallback rather than the default.

## Code changes

Confined to the state layer, as
[persistence-isolated-to-provider](../kb/entries/persistence-isolated-to-provider.md) planned. The
screens and components are untouched.

| File | Change |
|---|---|
| `src/lib/supabase.ts` | new — the configured client |
| `src/state/SessionContext.tsx` | new — session, `signIn`/`signUp`/`signOut`, wraps `ListsProvider` in `App.tsx` |
| `src/screens/SignInScreen.tsx` | new — email/password, added to `RootStackParamList` |
| `src/state/ListsContext.tsx` | the only file that talks to the database for list data: hydrate on mount, write on change, subscribe |
| `src/state/types.ts` | `Item.done: boolean` → `doneAt: string \| null`; `item/toggled` → `item/setDone`; add `remote/synced` |
| `src/state/listsReducer.ts` | handle the two changed actions; stays pure |

Three specifics:

**Ids become UUIDs.** [ListsContext.tsx:17-21](../../src/state/ListsContext.tsx#L17-L21) mints
`list-1`, `item-1` from a module counter; two devices on a shared list both produce `item-3`. Swap
`makeId` for `randomUUID()` from `expo-crypto`. The
[ids-minted-outside-reducer](../kb/entries/ids-minted-outside-reducer.md) convention holds unchanged
and is exactly what makes optimistic writes work — the client knows the row's id before the server
replies, so the UI updates immediately and the insert is idempotent on retry.

**Converging toggles.** `item/toggled` flips a boolean. Two live clients toggling the same item
apply two flips and land back where they started, and a retried request double-applies. Send an
absolute value instead — `{ type: 'item/setDone', done: boolean }` writing `done_at = now()` or
`null` — so last-write-wins actually converges. This is why the column is a timestamp, and it buys
"who checked it off, and when" for free.

**Realtime.** Subscribe in the provider, unsubscribe on unmount, fold incoming rows in through
`remote/synced`. `ListDetail` subscribes to `items` filtered `list_id=eq.<id>`; `Lists` subscribes
to the user's `list_members` rows. Postgres Changes is the right tool at this volume — note it runs
one RLS check *per subscriber per event*, so Broadcast-from-database is the upgrade path if a list
ever has many simultaneous viewers.

## Staging

Three steps, each independently verifiable:

1. **Auth + persistence, single user.** Schema, RLS, sign-in screen, provider reads and writes.
   No sharing, no realtime. This is where the provider seam gets its real test.
2. **Sharing.** `list_members` writes, an "invite by email" path, members visible in `ListDetail`.
3. **Realtime.** Subscriptions and `remote/synced`.

## Verification

`npm test` and `npm run typecheck` throughout, then `npm run web` — Playwright MCP is allowlisted
for driving it. Sharing and realtime need two sessions: two browser profiles, or web plus Expo Go
on a device.

Test strategy holds up unchanged. The reducer tests stay pure and offline — the actions still carry
their ids, so they need no client. Provider tests mock `src/lib/supabase.ts` at the module boundary.
Screen tests keep their navigation stubs per
[screens-take-navigation-props](../kb/entries/screens-take-navigation-props.md), and the new
sign-in screen follows the same a11y-label query conventions.

## Risks

- **Offline is not solved.** Supabase has no built-in write queue; the reducer serves as an
  optimistic cache, and a write lost to bad signal is lost. For a shopping list used in a store this
  will eventually matter — the answer then is PowerSync over the same database, not a rewrite.
- **New async failure surface.** Every mutation can now fail. The UI currently has no error
  affordance at all; step 1 above should add one rather than leaving writes to fail silently.
- **Free-tier projects pause after inactivity**, which looks like a total outage on next open.
- **Requires an account.** Creating the Supabase project and pasting its URL and anon key is a
  manual step only you can do.
