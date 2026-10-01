# Implementation log — task 23, step 2: limit owned lists, lists joined, and items per list

**Date:** 2026-10-01. Description: [description-step-2.md](description-step-2.md). The user approved the
plan before work began. The work follows the description, with six decisions the description left
open (below, 1–6), one deviation from it (decision 2), and one addition to it (decision 3).

## Decisions

1. **SQLSTATEs `LM001` (owned lists), `LM002` (lists in total), `LM003` (items per list).**
   - PostgreSQL uses no `LM` class, and PostgREST v14.5 maps an unmapped class to **400**
     (measured; see Verification).
   - `verdictFor` still names all three codes (`isLimitCode` → `permanent`), next to the `P0002`
     rule, so the code decides and the status does not. The test asserts each code at 400 and
     at 500.
   - `PTxxx` codes were not used: three limits would need three distinct HTTP statuses.
2. **Deviation: the constants and sentences live in a new `src/lib/limits.ts`, not beside
   `MAX_ROWS` in `listsApi.ts`.**
   - `ListsScreen`, `ListsContext`, `ListDetailScreen` and `SharingScreen` tests all mock
     `../lib/listsApi` with a factory. `src/lib/supabase.ts` throws at import time without env, so
     `jest.requireActual` is not an option either.
   - A screen reading a constant from `listsApi` would therefore read the mock's copy, and a
     word-for-word sentence asserted against its own copy proves nothing.
   - `limits.ts` holds `MAX_OWNED_LISTS`, `MAX_LISTS`, `MAX_ITEMS`, `LIMIT_CODES`, the three
     sentences (built from the constants with a regex thousands-grouper, so the code does not
     depend on `Intl` being available), and `listLimitSentence(counts)`.
   - The comments in `limits.ts` and the migration point at each other.
3. **Addition: `list/setDeleted` moves the counts in the reducer.** A move from live to the bin
   gives total −1, and owned −1 when `role === 'owner'`. A move back gives +1 each.
   - Without this, the owned sentence ("Delete one…") would stay on screen after the user deleted
     one, until the next full `hydrate`. Binning nudges the user's own inbox, but the nudge goes to
     `hydrateLists`, which reads no counts.
   - It is idempotent, like the create count. A count moves only when liveness flips, so the
     database's `deleted_at` differing from the client-minted one moves nothing, and neither does a
     queued bin folded again by `foldPage` or `replay` over a row that already has it.
4. **When both list limits are hit, the total sentence wins.** `check_list_limits` checks total
   first, and `listLimitSentence` follows the same order.
5. **Looks:** in place of the `AddBar`, a `View` with the bar's surface, `surfaceOutline`,
   `barShadow` and 20 pt inset. It uses `minHeight: 52` and `radius.lg` (the theme's token for
   content more than a line tall), with `colors.text` in `fonts.sans` at 15/20. It wraps to two
   lines on the iPhone 18 Pro and at web 390. No mockup covers it.
6. **The counts read is part of `hydrate`, and a failure there fails the whole `hydrate`:** nothing
   is dispatched and state is untouched, the same as a failed list page. Pending writes are counted
   on top of the server's numbers, so falling back to the counts already in state would count them
   twice.

### How the counts flow (client)

- **Type and state:** `State.listCounts: ListCounts` (`{ owned, total }`), starting at
  `NO_LIST_COUNTS` (0/0, below every limit, which fails safe).
- **`lists/loaded`:** gains an optional `counts`. When it is omitted, the reducer keeps
  `state.listCounts`.
  - `hydrateLists` (a nudge naming lists) dispatches without counts, so it neither reads them nor
    resets them.
  - That is why no `listCountsRef` was needed. A ref would also have lagged by one commit, so a
    create dispatched during `hydrateLists`' awaits would have been lost.
- **`list/created`:** adds +1 to both counts only on the append branch. A queued create folded over
  a fetch that already holds the list (a resend whose response was lost) lands on the update branch
  and is not counted again.
- **`replayState(state, ops): State`** (in `replay.ts`): `replay(lists, ops)` now delegates to it
  and keeps its `List[]` signature for `hydrateLists`, `loadList` and `replay.test`. Callers:
  - `hydrate`: `replayState({ lists, listCursors, listCounts: read.counts }, queue)`.
  - The cold-start cache dispatch: `replayState` over `cached.counts`.
- **`hydrate`:** reads `Promise.all([reloadListPages(...), fetchListCounts()])` and caches the
  counts it read, before the replay.
- **`listCache`:** `VERSION` 6 → 7. The blob is `{ v, lists, cursors, counts, fetchedAt }`, and
  `readCachedLists` drops a blob whose `counts` is missing or lacks either number, because
  `undefined >= 100` is `false`. `outbox.ts` stays at 1.

### Database: `supabase/migrations/20261001000000_list_limits.sql`

- **The two helpers:**
  - `check_list_limits(p_user_id, p_owner)` counts live lists only, both counts in one query, and
    raises `LM002` at total ≥ 1000, then `LM001` at owned ≥ 100 when `p_owner` is true.
  - `check_item_limit(p_list_id)` raises `LM003` at 1,000 or more live items.
  - Both are `security definer`, with execute revoked from `public, anon, authenticated`. An
    `authenticated` call gets 403 `42501`, so a client cannot probe another account's counts.
- **One trigger, `limit_list_memberships`**, `before insert or update` on `list_members`:
  - **INSERT:** passes if `(list_id, user_id)` already exists. `share_list`'s upsert fires BEFORE
    INSERT ahead of the conflict check, and its update path then fires BEFORE UPDATE. Otherwise it
    calls `check_list_limits(new.user_id, new.role = 'owner')`.
  - **UPDATE:** calls `check_list_limits(new.user_id, true)` only on `old.role <> 'owner' and
    new.role = 'owner'`.
  - It sorts after `keep_last_owner` by name, which does not matter, because that trigger returns
    early on a promotion.
- **`create or replace` of `add_item`, `set_item_deleted` and `set_list_deleted`:** each keeps its
  previous body and its `session_still_valid()` guard first, and adds one check.
  - `add_item` skips the count when `p_id` already exists.
  - Both restores count only when the row is in the bin **and** the caller may restore it. Their
    permission predicate sits inside that condition, so a caller without access falls through to
    the unchanged update and its `42501`.
- **`my_list_counts()`:** returns `table (owned int, total int)`, `security invoker`, and is rooted
  at `list_members` with an explicit `m.user_id = (select auth.uid())`. PostgREST returns a one-row
  array, and `fetchListCounts` takes the first row with a 0/0 fallback for a null body.
- **No lock, no counter, no backfill.** That follows the description, and request 3.

## Problems hit

1. **A mutation survived the first test set.** Making `hydrate` dispatch `read.counts` instead of
   the replayed counts broke no test. The existing tests covered the cache cold start and
   creates made after `hydrate`, but not "a pending create on top of a fresh read".
   - Added `count a pending create on top of the counts a re-read brings`. The same mutation now
     fails it.
   - The other mutations were caught by the first test set: dropping `isLimitCode` from
     `verdictFor` failed 3 tests, removing the owned +1 failed 7, and counting a change of
     timestamp only failed 2.
2. **A KB `verify:` failed on naming only.** `first-fetch-replaces-list-state` counts
   `listsRef.current = loaded;` (it expects 2 in `useHydration.ts`). Naming the replayed state
   `loaded` turned that line into `loaded.lists`. The replayed state is now `replayed`, and
   `const loaded = replayed.lists` keeps the original line. The fact held either way.
3. **A test's offline create held back its own nudge.** `drainDirty` stands down while a backoff
   `retry` timer is pending. "Counts are kept by a nudge" therefore uses an acknowledged create, not
   an offline one.
4. **Plans measured on today's small local tables were sequential scans** (about 2,800 lists),
   which said nothing about scale.
   - Re-measured with 200,000 background lists (one owner membership each, a third binned, spread
     over 10,000 load-test accounts by `row_number() % 10000`, seeded under replica mode), then
     deleted. The numbers are below.
5. **On web, the optimistic 1,001st item sorts after the loaded pages**, at the bottom of a
   1,000-row list.
   - Seeing it appear took scrolling until every page was loaded, then delaying the `add_item`
     response by 2 s with `page.route`.
   - The banner text matches twice because List detail and the Lists screen underneath both
     render `ErrorBanner` from the same `error`. That predates this step. It is one banner per
     screen, not a burst.
6. **Each mount reads the counts twice on web**, matching step 1's double read of the lists (Problems
   5 there; still unexplained, and present at HEAD).

## Verification

**Local stack only.** `.env` says `cloud`, so Metro ran with `EXPO_PUBLIC_SUPABASE_TARGET=local`.
Every request went to `127.0.0.1:54321`, as Playwright's network log shows. The migration was
applied with `npx supabase migration up --local`.

### Fixture accounts

All three were signed in through OTP and Mailpit with `/auth/v1/verify`, so their tokens and
`session_id`s are real. They were seeded under `session_replication_role = replica`. Every seeded
list is named `t23s2-…`.

| account | name | seeded state |
|---|---|---|
| `t23a@example.com` | T23 Alpha | owns 100 lists, plus `t23s2-full` (id `…f011`) holding 1,000 items |
| `t23b@example.com` | T23 Beta | writer on 1,000 ownerless lists |
| `t23c@example.com` | T23 Gamma | owns 100 lists |

### HTTP status per code

Measured with `curl` through `/rest/v1`, using T23 Alpha's token, before the client was wired:

| call | status | body |
|---|---|---|
| `POST lists` at 101 owned | **400** | `LM001` "they already own 100 lists" |
| `rpc/add_item`, the 1,001st item | **400** | `LM003` "this list already has 1,000 items" |
| `rpc/share_list` writer → Beta (1,000) | **400** | `LM002` "they are already on 1,000 lists" |
| `rpc/share_list` owner → Gamma (100 owned) | **400** | `LM001` |
| `POST lists` resending an existing id, at the limit | 409 | `23505` (client: `applied`) |
| `rpc/add_item` resending an existing id, at 1,000 | 200 | `"applied"` |
| `rpc/check_list_limits`, `rpc/check_item_limit` | 403 | `42501` permission denied |
| `rpc/my_list_counts` | 200 | `[{"owned":101,"total":101}]` |

### SQL cases

Each case ran as `authenticated` with `request.jwt.claims` holding the real `sub` and `session_id`,
in its own transaction, which was rolled back. Fixture changes inside a case were made as
`postgres` in replica mode first. Every result matched the description:

| # | case | result |
|---|---|---|
| 1 | owned via create (Alpha, bins take 101 → 99) | at 99 → ok; at 100 → `LM001`; resend of an existing list at 100 → `23505`; `my_list_counts` 100/100 |
| 2 | total via create (Beta, 999 after a bin) | at 999 → ok; at 1,000 → `LM002`; counts 1/1000 |
| 3 | items (`t23s2-full`, 2 binned → 998) | add at 998 → ok; restore a binned item at 999 → ok; add at 1,000 → `LM003`; restore the other at 1,000 → `LM003`; resend of an existing id at 1,000 → `applied`; resent restore of a live item at 1,000 → ok |
| 4 | list restore | Alpha restores at 98 and 99 → ok; at 100 → `LM001`; resent restore of a live list at 100 → ok; Beta restores its own binned list at 1,000 total → `LM002`; Beta (a writer) restoring → `42501`, so a caller without access never gets a count |
| 5 | promotion (Alpha → Gamma at 100 owned) | share as owner, new member → `LM001`; share as writer → ok; share as owner over the writer row (upsert) → `LM001`; `set_member_role` to owner → `LM001`; demote to reader → ok |
| 6 | demoting frees a slot | promote Gamma at 100 → `LM001`; Gamma demoted on a co-owned list → ok; promote at 99 → ok |
| 7 | total via share | writer → Beta at 1,000 → `LM002`; at 999 → ok; re-share as reader at 1,000 → ok, role became reader |
| 8 | the helpers called as `authenticated` | `42501` for both |

### Plans

Measured with 200,000 background lists, then `analyze`. Each query was run once warm, then
measured.

| query | account | plan | buffers | time |
|---|---|---|---|---|
| `my_list_counts` body (invoker, RLS) | `t23lists`, 402 memberships | bitmap scan on `(user_id, created_at)` → nested loop into `lists_pkey`, RLS `hashed SubPlan` | 1,632 | 1.1 ms |
| `my_list_counts()` call | `t23lists` | Function Scan | 1,652 | 0.95 ms |
| `my_list_counts` body | Beta, 1,000 | same shape | 4,044 | 2.2 ms |
| `check_list_limits` count (definer, no RLS) | a load-test account, 20 | index scan on `(user_id, created_at)` → nested loop into `lists_pkey` | n/a | 0.17 ms |
| same | `t23lists`, 402 | same | n/a | 2.7 ms |
| same | Beta, 1,000 | **hash join with Seq Scan on `lists`** (135,917 rows) | 2,196 | **24.8 ms** |
| `check_list_limits(...)` whole call | 20 / 402 memberships | n/a | n/a | 0.4 / 0.9 ms |
| `check_item_limit` count | `t23s2-full`, 1,000 items | bitmap scan on `items (list_id, created_at)` | 21 | 0.24–0.43 ms |

- The invoker counts read costs about what page 1 of the lists costs (step 1: 1,649 buffers at 402
  memberships). It is a second request with that cost on every full `hydrate`.
- **The definer count switches to a hash join for an account with about 1,000 memberships.** The
  literal `user_id` is a most-common value, so its estimate is exact, and a sequential scan of
  `lists` (2,174 pages) is cheaper by buffers than 1,000 `lists_pkey` probes (4,044).
  - It is paid once per membership insert or promotion, only by accounts at the edge of the total
    limit, and it is bounded by the smaller of a `lists` scan and the per-membership probes.
  - At 1,000,000 lists the scan would cost about 11,000 pages, and the planner would go back to the
    nested loop.
  - No index was added.
- The 200,000 lists were deleted afterwards, with `list_members` before `lists`, because replica mode
  skips foreign-key cascades.

### Commands

- `npm test`: 28 suites, **659 tests**, all passing (620 → 659).
  - New: `listsApi` (`fetchListCounts` ×2, the three limits ×5), `listCache` (v6 dropped, partial
    counts dropped), `listsReducer` (`list counts` ×8), `replay` (`replayState` ×4),
    `ListsContext` (`list counts` ×9, the items limit ×1), `ListsScreen` (`at a list limit` ×6),
    `SharingScreen` (×2).
  - A `fetchListCounts` stub was added to the four `listsApi` mocks.
- `npm run typecheck`: clean.
- `npm run kb:audit`: **2 errors, both expected**:
  - `list-cache-holds-acknowledged-rows`: `VERSION = 7`, and both `writeCachedLists(...)` calls now
    pass the counts.
  - `session-still-valid-guards-writes`: re-defining three guarded RPCs takes
    `if not public.session_still_valid() then` from 13 to 16 lines, and the migration files naming
    it from 5 to 6.

### Browser

Playwright at 390×844:

- **Over the limit before the migration:** `t23lists` (250 owned, from step 1) shows the owned
  sentence in place of the bar.
  [lists-over-owned-limit-web.png](screenshots/step-2/lists-over-owned-limit-web.png)
- **The owned limit:** Alpha at 99 owned has the bar.
  - Creating "Hundredth" (`POST lists` 201) swaps the bar for the owned sentence.
  - Binning one brings the bar back at once (`rpc/set_list_deleted` 204).
  - A reload keeps the bar: `rpc/my_list_counts` says 99.
- **The total limit:** Beta at 999 has the bar. Creating "Thousandth" swaps it for the total
  sentence. [lists-total-limit-web.png](screenshots/step-2/lists-total-limit-web.png)
- **The 1,001st item** in `t23s2-full`, with every page loaded and `add_item` delayed 2 s:
  - "One too many" was on screen before the response.
  - `rpc/add_item` came back 400. The item was gone after the re-read, and the banner said "This
    list is full: 1,000 items at most."
    [list-detail-items-full-web.png](screenshots/step-2/list-detail-items-full-web.png)
  - No UI change on List detail.
- **Offline past the owned limit:**
  - Alpha at 99. Requests to `127.0.0.1:54321` were aborted, then "Offline party" was created and
    given two items. The SyncBanner said "3 changes will sync when you're back online", and the
    sentence showed, because the pending create counted.
  - SQL then restored a seed list, so the server said 100 owned. The route was removed and `online`
    dispatched.
  - Result: `POST lists` 400, then one red banner with the owned sentence. The list and both items
    were gone, nothing was left pending, and `add_item` was never sent (`dropDependents`).
    [lists-offline-create-refused-web.png](screenshots/step-2/lists-offline-create-refused-web.png)
- **Sharing screen:**
  - Gamma was made a writer on `t23s2-full` by SQL. As Alpha, "Set T23 Gamma to owner" →
    `rpc/set_member_role` 400 → "they already own 100 lists", and Gamma stayed a writer.
    [sharing-promote-refused-web.png](screenshots/step-2/sharing-promote-refused-web.png)
  - Sharing with "T23 Beta" (picked from the search) → `rpc/share_list` 400 → "they are already on
    1,000 lists".
    [sharing-total-refused-web.png](screenshots/step-2/sharing-total-refused-web.png)

### Phone

iPhone 18 Pro simulator, iOS 27, the existing Debug dev client (no native change). The status bar
was overridden to 9:41. A one-off Maestro flow, kept in the scratchpad, ran `open-app` → `sign-out`
when signed in → `sign-in` → `set-theme`, then took the shot.

- [lists-owned-limit-day-ios.png](screenshots/step-2/lists-owned-limit-day-ios.png): Alpha, Day.
- [lists-total-limit-night-ios.png](screenshots/step-2/lists-total-limit-night-ios.png): Beta, Night.
- The simulator was left on the Night theme, signed in as Beta.

### Left on the local stack on purpose

- **T23 Alpha:** 100 owned (seeds plus "Hundredth" and `t23s2-full`), 2 binned.
- **T23 Beta:** on 1,000 (999 writer seeds plus "Thousandth", owned), 1 binned.
- **T23 Gamma:** owns 100, and is a writer on `t23s2-full`.
- `t23s2-full` holds 1,000 live items.
- `scratchpad/limits/cleanup.sql` removed every `t23s2-%` list and is lost with the scratchpad. The
  same deletes, in replica mode with children first, remove them again.

## Accepted edges (not fixed)

- **A restore refused at a limit through `BlockedBanner`** ("Restore and keep my change"):
  - The restore op is refused, banners the sentence, and re-fetches. `dropDependents` keeps the
    blocked write (`list/setDeleted` strands nothing).
  - That write then lands on the same tombstone again: `target_deleted` → `setError(null)` → the
    blocked prompt returns without the sentence.
  - This was reasoned, not reproduced. Restores are deliberately not pre-checked.
- **The counts move only through this device's own creates and bins, and through full re-reads.**
  - A list somebody shares with you, removes you from, or promotes you on is counted at the next
    `hydrate` (foreground, mount, or a refusal's re-fetch), never by a nudge.
  - A bin or restore of a list beyond the loaded pages moves nothing until then.
- **A resent create whose list sorts past the loaded live pages** (more than 100 live lists) is
  folded back as optimistic and counted once more, on top of server counts that already include it.
  The count is one too high until the next `hydrate`.
- **The trigger checks a promotion or share on a binned list too.** The description scopes it by
  role change only, and the list's bin state is not consulted.

## For the librarian

The description's KB-impact table stands. Facts to add or fold in:

- **writes-retry-from-an-outbox:**
  - Three SQLSTATEs, `LM001`/`LM002`/`LM003`, are named in `verdictFor` (`permanent`) and
    `humanize`, measured 400.
  - `humanize`'s sentences come from `src/lib/limits.ts`.
  - The membership RPCs keep the database's words ("they already own 100 lists", "they are already
    on 1,000 lists").
- **list-cache-holds-acknowledged-rows:**
  - `VERSION` 7; the blob gains `counts`; `writeCachedLists(userId, lists, cursors, counts)` takes
    the counts from before the replay.
  - Its `verify:` fails on `VERSION = 6` and the two three-argument calls.
- **session-still-valid-guards-writes:**
  - The migration re-defines `add_item`, `set_item_deleted` and `set_list_deleted`, so its `verify:`
    counts 16 guard lines across 6 files, not 13 across 5.
  - The guarded RPCs are still the same ten.
- **scope-boundaries:**
  - The three limits are in: overshoot accepted, ownership as the per-user cap, warnings only for
    the two list limits, no backfill.
  - Cloud is now eight migrations behind.
- **New entry (the description's "likely new entry"):** a limit check must let an already-applied
  resend through.
  - The list checks live on `list_members`, never in a BEFORE trigger on `lists`, which would fire
    ahead of the primary-key check.
  - `add_item` skips the count for an existing id, and the restores count only a row really in the
    bin.
  - Verified at the limit: `23505` and `applied`.
- **Counts in state:**
  - `State.listCounts` is the server's numbers plus this device's creates and bins, and
    approximate.
  - Both changes are idempotent by id and by liveness, so `replay` and `foldPage` can apply them
    again.
  - `lists/loaded`'s optional `counts` keeps state's when omitted (`hydrateLists`).
  - A failed counts read fails `hydrate`.
  - This could go in `first-fetch-replaces-list-state` or a new entry. The `listsRef.current =
    loaded;` count in that entry's `verify:` is why `hydrate` names the replayed state `replayed`.
- **read-rooted-at-list-members:**
  - `my_list_counts()` is the third read rooted at `list_members`: invoker, about page 1's cost on
    every full `hydrate`.
  - The definer count in `check_list_limits` switches to a hash join with a `lists` seq scan for a
    1,000-membership account (24.8 ms at 200,000 lists), and was accepted.
- **Constants beside the migration (new, or `max-rows-is-a-silent-ceiling`):**
  - `src/lib/limits.ts` exists because every list suite mocks `listsApi` with a factory and
    `supabase.ts` throws without env.
  - A value a screen needs must not live in `listsApi`.
- **phone-is-the-product:** the limit sentence's look (the bar's surface, `radius.lg`, two lines)
  was signed off by these two shots only.
