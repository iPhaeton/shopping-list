# Step 3 — implementation log: search and sort the live rows, on the device

2026-10-03. Scope: `description-step-3.md`. Steps 1 and 2 landed first (`3ccf224`, `0d11495`).

## Outcome

- Search is the resting state of Lists and List detail. A round header button (Plus ↔ magnifier) swaps it for the
  Create / Add bar. The query and the mode are screen-local, survive a trip into the bin, reset on leaving.
- Sort: toggle buttons in fixed priority, `todo` → `az` → `date`; `date` never off. Lists `A–Z` · `Date`, List detail
  `To Do` · `A–Z` · `Date`. Item sort per list, Lists sort global, both per device, non-default keys only.
- A non-empty query or a non-default sort over a live stream with a non-null cursor completes the stream in the
  background. Results never wait; the coverage line says `running` / `failed` + `Try again` / `capped`.
- Bin mode: no search, sort, line or header button. Entered from search mode, the bin sentence keeps 44 pt of sky under
  it.
- No server change. No cache or outbox version change (`listCache` `VERSION` 8, outbox 1).

## Files

| file | what |
|---|---|
| `src/state/arrange.ts` (new) | `ListSort`/`ItemSort`, defaults, `isDefaultSort`, `nextSort`, `arrangeLists`/`arrangeItems`, `fold`, collator, both fallbacks |
| `src/lib/sortPreference.ts` (new) | key `sort-preference`, `{ v: 1, lists?, items?: { [listId] } }`; `listSortOf`/`itemSortOf`/`withListSort`/`withItemSort`/`readSortPreference`/`writeSortPreference` |
| `src/state/SortContext.tsx` (new) | `SortProvider` (renders `null` until the read resolves) + `useSorts()` (throws outside it). Mounted in `App.tsx` inside `ThemeProvider`, around `SessionProvider` |
| `src/state/useCompletion.ts` (new) | `useCompletion(needed, run, readEpoch)` → `{ status: 'running'│'failed'│'capped'│null, retry }` |
| `src/lib/searchCopy.ts` (new) | `coverageLine`, `noMatchesTitle`, `NO_MATCHES_HINT`, `searchSummary` (magnifier's `accessibilityValue`) |
| `src/components/{ModeButton,SearchField,SortButtons,CoverageLine}.tsx` (new) | presentational; none imports `../lib/` (module-boundary verify) |
| `src/components/icons.tsx` | `SearchIcon`, `PlusIcon`, `CloseIcon`, `ArrowUpIcon`, `ArrowDownIcon` (step 1's paths) |
| `src/components/IconButton.tsx` | optional `value` → `accessibilityValue.text` |
| `src/state/types.ts` | `lists/pageLoaded` and `items/pageLoaded` gain optional `after` |
| `src/state/listsReducer.ts` | `continues()` check; `byStamp` exported (not moved: `keyset-paging` verify greps it there) |
| `src/state/usePaging.ts` | awaitable guards (`single()`), `PageOutcome`, `Completion`, `COMPLETION_CAP` 2000, `fold()` syncing refs, `loadAllItems`/`loadAllLists` |
| `src/state/useHydration.ts` | `readEpoch` (`useState`), bumped after `hydrate`'s dispatch and after `hydrateLists`' when ≥1 `fetchList` succeeded |
| `src/state/ListsContext.tsx` | exposes `readEpoch`, `loadAllItems`, `loadAllLists`; `loadMore`/`loadMoreLists` now resolve to `PageOutcome` |
| `src/lib/limits.ts` | `grouped` exported |
| `src/screens/ListsScreen.tsx`, `ListDetailScreen.tsx` | everything in "Screens" below |
| `.maestro/flows/tour-signed-in.yaml` | waits for `Search items`, not `Add an item` |
| `.maestro/flows/tour-search-and-sort.yaml` (new) | the five step-3 shots; resets every sort it set |

## Decisions

- **The continuation check lives in the reducer** (the description allowed either). A page action carrying `after` is
  ignored whole unless `sameCursor(state's cursor for that stream, after)`. `loadMore`/`loadMoreLists` pass it, so
  **scroll pages are covered too**, not only the loop: previously a scroll page landing after a `hydrate` that dropped
  the page before it left the same gap. `reloadListPages`/`reloadPages` omit `after` (they build from nothing). No new
  action type (`writes-retry` verify counts 11).
  - Mutation-checked: with `continues()` forced to `true`, `drops a page a re-read moved the cursor past, and carries on
    from state` fails; restored, it passes.
- **Every page fold in `usePaging` sets `listsRef`/`listCursorsRef` synchronously** (`fold()`: same reducer over the
  refs, then `replay`), `items/firstPageLoaded` included. Load-bearing: List detail's completion effect runs in the
  commit where `itemsLoaded` flips, before the provider's mirroring effect; reading a stale ref there saw
  `nextLive: null` and would have returned `'complete'` at once. `loadList` now uses `fold()` (the
  `listsRef.current = replay(` literal survives there).
- **Cursors move only through `hydrate`/`hydrateLists`/the cold-start cache load (all ref-synced already) and page
  folds (now synced)**, so the loop's ref view cannot disagree with state about a cursor. Write actions never move one.
- **`loadAll*` return `'complete' | 'failed' | 'capped' | 'stopped'`.** The fourth value (aborted between pages, or the
  provider unmounted, or the list stopped being `itemsLoaded`) is a deviation from the description's three; the screen
  ignores it.
- **Order inside each loop iteration:** aborted → wait for any in-flight page (then re-check) → cursor `null` →
  `'complete'` → held ≥ 2000 → `'capped'` (no request) → one page → `'failed'` on failure. Held = `liveItems(list)` /
  `liveLists(lists)` length, optimistic rows included.
- **In-flight guards are `Map<key, Promise>`** set by `single()`, whose `.finally` cleanup always runs a microtask
  later, so registration precedes cleanup. A scroll call that finds a page in flight still returns at once
  (`'skipped'`, unchanged behaviour); only the loop waits.
- **Completion runs in live mode only.** In bin mode `needsCompleting` is false and the loop aborts, so it never holds
  the per-list / lists guard against the bin's own scroll paging. Coming back restarts it if still needed.
- **`useCompletion`:** effect keyed on `needed`, `run`, an attempt counter; `AbortController` per run. A `readEpoch`
  *move* restarts only a `'failed'` run (the epoch at mount restarts nothing). `Try again` bumps the attempt.
  `'complete'` sets nothing: `needed` already turns false through the cursor.
- **Mode** is `useState<'search'│'create'│null>`, frozen on the first render with rows known (Lists: `status` ready;
  List detail: `itemsLoaded`) by a render-time `setMode`. Create only for an empty, complete live stream and an editor.
  Shown mode is `search` whenever the role cannot create.
- **Plus focuses the Add/Create bar** through `autoFocus` on remount, behind a `focusAdd`/`focusCreate` flag set only
  by Plus.
- **Reader in bin mode (deviation from step 2's log):** step 2 kept the read-only notice in the slot. Step 3 moved that
  sentence under the search slot, so in bin mode the reader's slot holds the bin sentence + 44 pt sky like an editor's,
  and the read-only line stays below it. Test renamed: `keeps a reader’s read-only sentence in the bin, under the bin
  sentence`.
- **Binned list:** `shownQuery` is `''`; its stored item sort applies. If that sort is non-default over a partial list,
  completion runs and the coverage line shows under the notice card. Not covered by the description; uniform with the
  rule.
- **Copy:** `capped` names `grouped(held)`, which is 2,000 at the cap. Lists name `listCounts.total` only when
  `> held`. Empty results use the no-matches copy only when there are live rows held; with none, the existing empty
  states.
- **Fallbacks implemented, not conditional on the device checks** (the tests list requires both paths). Picked at
  module load by feature test (`'é'.normalize('NFD').length === 2`; collator exists and passes `Item 2` < `Item 10`
  and `a` == `Á`). The fold table (161 letters, U+00C0–U+017F) was generated from Node's `normalize`, and a test checks
  the fallback against the primary path over that whole range. The fallback also strips already-decomposed marks.
- **Status-bar strip:** `skyHeight` measured by `onLayout` on the padded header block, initial `SEARCH_SKY_H` 268;
  `DRAWN_SKY_H` and `statusBarSkyFill` are gone.
- **Dot assertion:** screen tests assert the magnifier's `accessibilityValue` (`summary` is defined exactly when
  `dot` is true), not the dot's view.

## Problems hit

- **The two screen suites leaned on leaked mocks.** No `resetMocks`; `serveLists` persisted from test to test, and tests
  passed because the Create bar was always present. Fixes:
  - `ListsScreen.test.tsx`'s `beforeEach` calls `serveLists([])`.
  - `createList`/`addItem` press `New list`/`New item` first when search holds the slot.
  - Call-count assertions need `mockClear()` per test (added in the new describes). A filtered run of three tests
    showed 3 continuations for a test that makes 1.
- `JSON.stringify(screen.toJSON())` throws (circular `Provider`); drawn order is read from `getAllByText` instead.
- Test fixture trap: "Jasmine rice" contains `mi`.
- **postgrest-js 2.112.4 retries every GET on a network error: 3 retries, 1 s/2 s/4 s** (`DEFAULT_MAX_RETRIES`,
  `getRetryDelay`; per-query `.retry(false)` exists). Offline, one page from the loop showed as **4 failed HTTP
  requests** at 0/1/3/7 s, and the `failed` line appeared after ~7 s. The loop itself issued one logical request and
  stopped; this is library behaviour on every read in the app (hydrate, scroll), already noted in `listsApi.ts` ("retries
  nothing but GET/HEAD/OPTIONS"). **Not changed:** turning retries off app-wide or for the loop only is a decision for
  the user. The description's "one failed request" holds at the app level, not on the wire.
- **react-native-web 0.21 drops `accessibilityValue`** (no `aria-valuetext` in the DOM), the same family as the accepted
  "no checked state on web". The sort buttons' and magnifier's values exist on native and in RNTL only.
- Maestro's first run on the freshly booted 18 Pro failed with the known driver-start error; the second worked.
- **Local data:** every real list of `maya@example.com` (Groceries, Hardware store, …) is binned at one identical
  stamp, `2026-10-02 12:54:26.307975+00`, and her live lists are load-test `Seed list 43xx`. This predates this
  session; step 2's log says her lists were re-binned at their saved stamps but Groceries left live. Not touched.
  Shots used `maya3@example.com`, which holds the mockups' set.
- `npm test` prints `An update to VirtualizedList … not wrapped in act(...)` 1–5 times per full run, at HEAD's tracked
  files as well (measured 5/1/1 at HEAD, 2/3/2 with the step). Pre-existing, load-dependent.
- Android: the Pixel_10 emulator booted but the 2026-09-27 dev client did not bring up a JS target. **The user stopped
  the Android check ("No Android").**

## Verification

### Commands

- `npm test`: 31 suites, **786 passing** (687 before). New suites `arrange.test.ts` (28), `sortPreference.test.ts` (13).
  New: provider `completing a stream` (10) and `the read counter` (2); reducer continuation (5); Lists
  `search and sort` (20); List detail `search and sort` (21).
- `npm run typecheck`: clean.
- `npm run kb:audit`: **0 errors**, 15 "ground moved" warnings for the librarian.

### Environment

- `.env`: `EXPO_PUBLIC_SUPABASE_TARGET` commented out; nothing on 8081. Docker Desktop was off and was started.
- Metro: `EXPO_PUBLIC_SUPABASE_TARGET=local npx expo start --port 8081` (no `CI`).

### Seed (local, kept)

- `t23lists`: 403 live lists; `Seed list 251` (position 251 of 403, page 3) renamed `Zanzibar trip`.
- `t23lists`' `Seed list 5` (`95c1e4f2-…`): +1,000 items `Item 1…1000`, #900 titled `Crème fraîche` (row 901 of 1,001,
  page 3).
- `t23lists`' `Seed list 6` (`b6b5137a-…`): +2,100 items `Bulk 1…2100` (2,101 live).
- `maya3@example.com`: Groceries +8 items (Coffee beans, Bananas, Mince, Mint, Oat milk done, Jasmine rice, Miso paste,
  Salami); +2 owned lists `Big grocery run`, `Grove Street party`.
- All by SQL in `session_replication_role = replica` (no realtime triggers; memberships inserted by hand). A temporary
  2,100 items in maya3's Pharmacy, used for the capped shot, were deleted.

### Browser (Playwright, 390×844, `t23lists`, local)

- **Lists, page-3 find:** with the `lists:` cache key removed (page 1 held), typing `zanz` showed `Zanzibar trip`.
  - The line read `Searching 100 of 403 lists · loading the rest…`, then 200, 300 and 400, then cleared.
  - Exactly four continuation requests went out, sequential, each `created_at=gte.<cursor>` from the last.
- **List detail, page-3 find:** on `Seed list 5`, `creme` found `Crème fraîche` after two continuations; the line read
  400, then 800, then cleared.
- **A–Z:** `Crème fraîche, Item 1, Item 2, … Item 9, Item 10`.
- **Offline** (`context.setOffline(true)`) on `Seed list 6`, query `bulk 2`:
  - matching rows showed at once;
  - then `Searched the 400 loaded items. The rest need a connection.` with `Try again`;
  - one logical page request, which postgrest-js retried 3 times (above); nothing more in the 3 s after.
- **Back online:** the `online` event's `hydrate` restarted completion with no tap, and it ended at
  `Searched the first 2,000 items.`
- **Sort survives a reload:**
  - `Seed list 6` was set to To Do First + Z–A; the stored key held both lists' entries.
  - After a reload, list A's first rows were `Milk 1, Bulk 1999, Bulk 1998` (undone first, numeric Z–A over 2,000
    held), and `Seed list 7` was at the default.
  - Resetting list A removed only its entry. Resetting `Seed list 5`'s A–Z then removed the key
    (`localStorage.getItem('sort-preference') === null`).
- Console: no errors beyond the offline fetch failures.

### Hermes (Metro inspector, `Runtime.evaluate`, `Origin` header)

| check | iOS 27 simulator, Hermes `250829098.0.17` |
|---|---|
| `'Crème'.normalize('NFD')` decomposes | yes (length 6; folds to `creme`) |
| `typeof Intl.Collator` | `function` |
| `numeric: true`: `compare('Item 2', 'Item 10')` | −1 |
| `sensitivity: 'base'`: `compare('a', 'Á')` | 0 |
| `resolvedOptions()` | `en-US`, `numeric: true`, `sensitivity: 'base'` |

So iOS takes both primary paths. **Android: unverified** (user's call; dev client predates `expo-blur`).

### Phone (iPhone 18 Pro, iOS 27, existing dev client, `maya3`, status bar 9:41)

- `.maestro/flows/tour-search-and-sort.yaml`, Day then Night (`set-theme`), plus a scratch capped-line flow on Pharmacy.
- Shots in `screenshots/step-3/`:
  - `lists-search-resting`, `lists-search`, `list-detail-search-resting`, `list-detail-search`,
    `list-detail-search-sorted`;
  - `list-detail-capped`;
  - each `-{day,night}-ios.png`.
- The data cannot reproduce the mockups' `running` (Lists) and `failed` + `Try again` (List detail) lines on the
  simulator. The capped shot stands in for the line's position.
- Lists rest shows no `Show deleted`: `maya3` has no binned list.

**By measure** (column scans of the PNGs; pt; mockup 390×844 inset 47 vs 18 Pro 402×874):

| | mockup | 18 Pro | Δ |
|---|---|---|---|
| List detail field (rest, search, sorted) | 172.0–224.0 | 187.0–239.0 | +15.0 |
| List detail sort row (x 60) | 232.0–268.0 | 247.0–283.0 | +15.0 |
| List detail `Show deleted` label, rest | 289.3 | 304.7 | +15.4 |
| List detail first checkbox, rest | 367.0 | 382.0 | +15.0 |
| List detail first checkbox, create mode (sorted) | 323.0 | 338.0 | +15.0 |
| List detail coverage line text (mock `failed`, phone `capped`) | 282.7 | 298.0 | +15.3 |
| Lists field | 129.7–181.7 | 145.0–197.0 | +15.3 |
| Lists sort row | 189.7–225.7 | 205.0–241.0 | +15.3 |
| Night, List detail edges (moonlit) | 232.0 / 268.0 / 197.3 / 303.7 | 247.0 / 283.0 / 212.3 / 318.7 | +15.0 |

- The 18 Pro sits ~15.3 pt lower throughout (step 2's figure), so relative geometry matches to ≤ 0.4 pt.
- Visually: the dot's `skyTop` ring reads as a cut-out in both themes; lit buttons `primary`, unlit `surface`.

Left behind: the simulator on Day, signed in as `maya3`, every sort at its default.

## KB candidates (for the librarian)

The description's KB-impact table stands. Additions and corrections:

- **first-fetch-replaces-list-state:**
  - every page fold in `usePaging` (`fold()`) now sets both refs synchronously, `items/firstPageLoaded` included, and
    why (List detail's completion effect, same commit);
  - `readEpoch` lives in `useHydration`;
  - the continuation check is in the reducer and covers scroll pages too. Its verify literals still hold.
- **likely new, page loops:**
  - stop at the first failed page;
  - read the cursor from state every round;
  - pages carry `after`;
  - `'stopped'` is a fourth outcome;
  - wait for an in-flight page, never double it.
- **likely new, postgrest-js read retries:** 2.112 retries GET/HEAD/OPTIONS on network errors and 520/503, 3 times,
  1 s/2 s/4 s, so offline one app read is 4 HTTP attempts over ~7 s; `.retry(false)` per query. Unchanged here, pending
  the user.
- **likely new, Hermes:** the table above; iOS takes both primary paths; Android unverified; both fallbacks ship,
  picked by feature test at load.
- **likely new, sort preference:** key `sort-preference` v1, per device (above `SessionProvider`, survives sign-out),
  per list for items, non-default keys only, never pruned; `SortProvider` gates rendering like the theme.
- **likely new, sort model:** `todo` → `az` → `date`, `date` never off; `date desc` is the exact reverse via input
  index (unstamped first, latest first).
- **phone-is-the-product:**
  - web-only flaw: RNW 0.21 drops `accessibilityValue`;
  - step-3 shots measure +15.3 pt uniformly against the mockups;
  - `maya@example.com`'s real lists are all binned locally; `maya3` holds the mockups' set.
- **queries-go-through-a11y-labels:**
  - new labels `New list`/`New item`, `Search and sort`, `Search lists`/`Search items`, `Clear search`,
    `Sort by to do`/`name`/`date added`, `Try again`, with values;
  - screen suites wrap `SortProvider` and query values with `toHaveAccessibilityValue`;
  - `createList`/`addItem` helpers press Plus first.
- **maestro-drives-the-native-ui:**
  - `tour-search-and-sort.yaml`;
  - `pressKey: Enter` dismisses the keyboard from the search field and an empty Add bar;
  - `tour-signed-in.yaml` now waits for `Search items`.
- **scope-boundaries / deletion-is-a-tombstone:**
  - the bin is never searched or sorted;
  - a binned list gets no search;
  - a reader's slot in bin mode is the bin sentence.
