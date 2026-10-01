# Step 3 — Search and sort the live rows, on the device

The user's requests are quoted in [description-step-1.md](description-step-1.md). Rationale:
[ai/suggestions/search-and-sort.md](../../suggestions/search-and-sort.md) §1, §2 and §4. Where the two
differ, this description wins. **One deliberate difference:** each list keeps its own item sort,
stored only when it is not the default (the user's answer to the suggestion's decision 3).

**Steps 1 and 2 must land first.** Step 1's mockups (`*-search*`) and its log settle placement,
labels and copy. Step 2 made "Show deleted" a separate view, so everything here is live rows only:
search and sort are hidden in bin mode.

**Scope change:** search and sort are in, for the Lists screen and List detail, over live rows, on
the device. **Out:** searching for an item across lists (user's decision), searching or sorting the
bin, sorting on the server, and a "recently changed" sort.

## The rule

**Search and sort are correct only over a complete stream, but results never wait for the
network.** The screen arranges what state holds at once, completes the live stream in the
background, and says how complete the results are.

- **The stream needs completing** when the query is non-empty or the sort is not the default, *and*
  the live cursor is non-null (`listCursors.live`, `list.nextLive`).
- **"Complete" is derived from the cursor, never remembered.** A re-read can leave a complete stream
  with a cursor again: someone adds the 401st item, and the re-read's page 1 comes back full. The
  screen then completes it again.
- **Default sort with an empty query keeps today's paging on scroll.** Nothing is completed, and no
  line shows. While the stream needs completing, `onEndReached` is not attached: the completion
  loop and `Try again` own paging.
- **No spinner gates the results.** No request timeout is set in
  [supabase.ts](../../../src/lib/supabase.ts), so one stuck request on a weak signal would hold a
  results spinner open indefinitely.

## Arranging: `src/state/arrange.ts`, pure

- `arrangeLists(lists, { sort, query })` takes `liveLists(...)` output. `arrangeItems(items, { sort,
  query })` takes `liveItems(...)` output. Each returns a new array. Screens memoise it in place of
  today's `inJoinOrder`/`inCreationOrder` call. **No debounce:** filtering 2,000 strings is not worth
  one.
- **Matching:** substring of `name` / `title`, case- and accent-insensitive, so `creme` finds `Crème
  fraîche`. Fold both sides with `s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()`,
  and trim the query. An empty query matches everything.
  - Use the explicit range, not `\p{M}`: one fewer engine feature to confirm.
  - The fold is deliberately crude, and that is accepted. It strips every combining mark, so `й`
    matches `и` and `ё` matches `е`. It leaves letters that don't decompose (`ł`, `ø`, `ß`) as they
    are.
- **Sorts.** Stored values first, labels from step 1:

  | screen | value | order |
  |---|---|---|
  | Lists | `oldest` (default) | `inJoinOrder`, today's order |
  | Lists | `newest` | `(joinedAt, id)` descending. **Unstamped lists first**, the latest created first |
  | Lists | `az` | name by the collator, ties by `byStamp` |
  | List detail | `added` (default) | `inCreationOrder`, today's order |
  | List detail | `az` | title by the collator, ties by `byStamp` |
  | List detail | `todo` | undone first, then done, each group by `byStamp` |

  - `byStamp` lives in [listsReducer.ts](../../../src/state/listsReducer.ts). Export it, or move it
    here. Never copy it.
  - Unstamped rows (optimistic, `joinedAt`/`createdAt` `null`) stay last within their group in every
    order **except `newest`**. There they are the newest, so they go first. Putting them last would
    make a list created under `newest` appear at the bottom, then jump to the top once the database
    acknowledges it. This refines the suggestion's tie rule.
- **Collator:** `new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })`, built once, so
  `Item 2` sorts before `Item 10`.
- **Confirm on device, not in jest** (jest runs on Node's full ICU and proves nothing about Hermes).
  This code base already avoids leaning on `Intl` (`grouped` in
  [limits.ts](../../../src/lib/limits.ts)). On the iOS simulator, and on the Android emulator if its
  dev client still runs JS ([native-build-toolchain](../../kb/entries/native-build-toolchain.md) says
  it predates `expo-blur`), check:
  - `'Crème'.normalize('NFD')` decomposes;
  - `Intl.Collator` exists, honours `numeric: true` (`Item 2` < `Item 10`) and `sensitivity: 'base'`
    (`a` equals `Á`).

  Record each result in the log, and Android as unverified if it could not run.
  - **Fallbacks, used only if a check fails:** for `normalize`, a small fold table for Latin-1 and
    Latin Extended-A; for the collator, compare folded strings by code unit, with digit runs compared
    as numbers. Pick at runtime by feature test. Unit-test both paths by stubbing the feature away.

## Completing the stream: [usePaging.ts](../../../src/state/usePaging.ts)

- **`loadAllLists()` and `loadAllItems(listId)`** loop the live page fetch at the normal page size
  (100 lists, 400 items) until the cursor is `null`. Each returns `'complete' | 'failed' | 'capped'`.
- **The page functions report their outcome.** Today `loadMore`/`loadMoreLists` swallow a failed
  page ("a page that fails is silent"). A loop that waits for the cursor to become `null` would then
  re-ask at once. Offline, every attempt fails almost instantly, so that is an endless request loop.
  **The loop stops at the first failed page** and returns `'failed'`. One failed page means one
  request, never a retry burst.
- **Hard stop at 2,000 live rows held:** 20 pages of lists, 5 of items. Check before each request, so
  an account already past the cap returns `'capped'` with no request. The cap is not "bounded by the
  limits": overshoot is accepted, and accounts already past a limit keep everything.
- **A page lands only if it continues where state ends.** This is the trap the suggestion missed:
  - `hydrate` replaces state with a re-read as deep as state was when it *started*. A loop that
    carries its own cursor folds page 4 after a replace dropped page 3. That leaves a gap, a cursor
    past it, and a search that says it is complete.
  - So **each iteration reads the stream's cursor from state**, and a page is folded only if that
    cursor still equals the `after` it was fetched with. Otherwise discard it and continue from
    state's cursor.
  - Read state through `listsRef`/`listCursorsRef`, set synchronously after each fold, as `loadList`
    does and [first-fetch-replaces-list-state](../../kb/entries/first-fetch-replaces-list-state.md)
    requires. The mirroring effect lags a commit.
  - The check may live in the reducer instead: the page action carries `after`, and a mismatched
    page is ignored. Either is fine. Say which in the log.
- **Guards:** the loop holds the same per-list / per-screen in-flight guard as `loadMore`. A
  `loadAll*` that finds a page already in flight waits for it, and never reports `'failed'` because
  of it.
- **Cancellation:** the loop stops between pages when the screen that started it unmounts or stops
  needing it (query cleared and sort back to default). Pages already fetched are still folded.

## Retrying: the read counter

There is no connectivity library ([scope-boundaries](../../kb/entries/scope-boundaries.md), step 4), so
the app learns it is back online only from a read that succeeds:

- `hydrate` on foreground (`AppState` `active`; `visibilitychange` and `online` on web,
  [ListsContext.tsx](../../../src/state/ListsContext.tsx));
- `hydrate` on a realtime resubscribe, which nudges `'all'`;
- `hydrateLists` on any later nudge, including the echo of the user's own queued write once the
  outbox delivers it.

A successful outbox retry is **not** a signal on its own: `flush` re-reads only after a `permanent`
refusal or a `target_deleted` ([useOutbox.ts](../../../src/state/useOutbox.ts)).

**Expose `readEpoch: number` from `useLists()`**, bumped by every `hydrate` that dispatches and every
`hydrateLists` in which at least one read succeeded. The screen restarts a `'failed'` completion when
`readEpoch` moves, and when `Try again` is pressed. Nothing else restarts it.

## Sort preference: `src/lib/sortPreference.ts`

Modelled on [themePreference.ts](../../../src/lib/themePreference.ts):

- **One per-device key**, versioned: `{ v: 1, lists?: 'newest' | 'az', items?: { [listId]: 'az' | 'todo' } }`.
- **Only non-default values are stored** (the user's words). Choosing the default deletes that entry.
  When nothing non-default remains, the key is removed.
- The read never rejects. An absent or unreadable key, or a wrong `v`, reads as all defaults. An
  unrecognised value drops that one entry, not the whole store.
- Writes go through `inOrder`.
- **Per device, not per account, and not cleared on sign-out**, as the theme is. List ids are
  globally unique, so accounts don't collide. A list shared by two accounts on one device shares its
  sort, which is accepted.
- **Never pruned.** The client cannot tell a gone list from one past the loaded pages. An entry is
  ~50 bytes, and only lists someone re-sorted have one. Do not add pruning.
- **No reorder on arrival.** Read it before any screen renders rows: for example, a provider that
  renders nothing until the read resolves, as ThemeContext's gate does with `readThemePreference`.
  Then hold it in memory: a change re-sorts at once, and the write follows.

## The query

- Screen-local `useState`, never stored, cleared on leaving the screen.
- Kept across a trip into the bin and back, like `showDeleted` today. The panel's open state too.
- `Cancel` clears the query and closes the panel. The sort stays.

## Screens

[ListsScreen](../../../src/screens/ListsScreen.tsx) and [ListDetailScreen](../../../src/screens/ListDetailScreen.tsx),
built to step 1's `*-search*` mockups:

- **The magnifier** (`Search and sort`, a new `SearchIcon` in `icons.tsx`) renders in live mode only:
  - on Lists once `status === 'ready'`;
  - on List detail once `list.itemsLoaded`, the same gate the Add bar has. A list never opened has no
    items offline, which is today's behaviour.
  - It is hidden while the live stream is empty and complete, unless the panel is open.
- **The panel** replaces whatever holds the bar's slot (Create / Add bar, limit sentence, or List
  detail's notices) while open. The sort picker goes where step 1 put it. `Show deleted` stays
  reachable.
- **The coverage line** goes where step 1 put it, and shows whenever the stream needs completing and
  is not complete, panel open or not. `n` is the count of live rows held, written with `limits.ts`'s
  `grouped` (export it), never `Intl.NumberFormat`. On Lists, name the total from
  `listCounts.total` only when it exceeds `n`. That count is approximate.

  Proposed copy; step 1's table wins. "Searching" becomes "Sorting" when the query is empty:

  | completion | List detail | Lists |
  |---|---|---|
  | running | `Searching 400 loaded items · loading the rest…` | `Searching 300 of 1,000 lists · loading the rest…` |
  | failed | `Searched the 400 loaded items. The rest need a connection.` + `Try again` | `Searched 300 of 1,000 lists. The rest need a connection.` + `Try again` |
  | capped | `Searched the first 2,000 items.` | `Searched the first 2,000 lists.` |
  | complete | none | none |

- **Empty results, never "No matches" over partial data:**
  - complete: `No matches for "<query>"`;
  - incomplete: `No matches in the 400 loaded items` / `No matches in the 300 loaded lists`, with the
    coverage line above.
  - Hints from step 1's table.
- **A non-default sort over partial data is accepted.** Offline nothing arrives, so the order holds
  still. When the rest arrives, rows slot into place, and the line has already said the results were
  partial.
- The `FlatList`'s `data` is the memoised arrangement. Band colours follow the visible index, as
  today.

## Accepted, do not fix

- **Offline search is usually complete anyway.** Most accounts hold everything in page 1, and the
  cache keeps every loaded page ([list-cache-holds-acknowledged-rows](../../kb/entries/list-cache-holds-acknowledged-rows.md)).
  **Exception:** the acknowledged-rows effect writes the cache only while nothing is queued
  (`status === 'ready' && pending === 0`, `ListsContext.tsx`). Pages completed while writes were
  queued, with the app killed before the queue drained or the next `hydrate`, come back partial at
  the next offline start. The coverage line reports that honestly.
- **`hydrate` re-reads as deep as state holds.** After one search, an account near 1,000 lists makes
  up to 10 sequential list requests on every foreground. If that ever matters, `reloadListPages` can
  re-read with `limit = MAX_ROWS`, one request. **Do not build that speculatively.**

## Tests (jest)

- `arrange.ts`:
  - matching with accents and case, an empty query, and trimming;
  - each sort, ties, unstamped rows last, and first under `newest`;
  - both fallback paths.
- `sortPreference`:
  - read fallbacks: absent, unparseable, wrong `v`, one bad entry among good ones;
  - choosing a default deletes its entry, and removes the key when it was the last one.
- `usePaging`:
  - `loadAllItems`/`loadAllLists` reach `'complete'`;
  - with the fetch mocked to fail, they stop after **one** request and return `'failed'`;
  - `'capped'` at 2,000 rows, with no request when already past it;
  - a page whose `after` no longer matches state's cursor is dropped, and the loop resumes from
    state's cursor.
- `readEpoch` moves on a successful `hydrate`/`hydrateLists`, and not on a failed one.
- Screens, through a11y labels, copy asserted verbatim
  ([queries-go-through-a11y-labels](../../kb/entries/queries-go-through-a11y-labels.md)):
  - results show at once over a partial stream, with the `running` line;
  - a failed completion shows the `failed` line and `Try again`; `Try again` restarts it, and so does
    a `readEpoch` bump;
  - the `capped` line at the stop;
  - empty results in the complete and incomplete forms;
  - the magnifier is absent until loaded, and absent in bin mode;
  - search, sort and line are hidden in bin mode, and the query survives the trip;
  - an item sort set on one list does not apply to another;
  - `Cancel` clears the query and keeps the sort.

## Verification

1. **Local stack only.** Read `.env`'s `EXPO_PUBLIC_SUPABASE_TARGET`, and check for any Metro already
   on 8081, first.
2. **Seed:**
   - one account with ~250 live lists ([seed-lists-for-user.sql](../../../supabase/scripts/seed-lists-for-user.sql));
   - one list with ~1,000 items, including `Crème fraîche`, `Item 2` and `Item 10`;
   - one list with ~2,100 live items, inserted by SQL past `add_item`'s limit, for the cap.
   - The lists cap is jest-only: past 1,000 memberships, the `list_members` trigger refuses inserts.
3. **Browser:**
   - Search finds a list on page 3, and an item on page 3. The `running` line flickers, then clears.
   - `creme` finds `Crème fraîche`. `A–Z` puts `Item 2` before `Item 10`.
   - Offline (browser offline), a search over a partial stream shows results at once, the `failed`
     line and `Try again`, and the network tab shows **one** failed request, not a stream of them.
     Back online, the `online` event's `hydrate` restarts completion with no tap.
   - The 2,100-item list shows the `capped` line.
   - A sort survives a reload. List A at `To do first` and list B at `Added` stay that way. Choosing
     the default removes the entry: inspect the stored key.
4. **Hermes checks** on device, recorded as above.
5. **Phone:** a Maestro flow on the iPhone 18 Pro simulator
   ([maestro-drives-the-native-ui](../../kb/entries/maestro-drives-the-native-ui.md): reset keyboards
   before `inputText`). Screenshots of Lists and List detail with the panel open, both themes, only
   these two screens, compared by measure against step 1's mockups. Save them in
   `screenshots/step-3/`.
6. **Commands:** `npm test`, `npm run typecheck`, `npm run kb:audit`.

## KB impact (for the librarian)

| entry | change |
|---|---|
| scope-boundaries | search and sort are in: live rows, on the device, both screens; the sort per device, per list for items, non-default only; cross-list search, bin search and server sorting out |
| first-fetch-replaces-list-state | a completed stream makes every `hydrate` re-read it whole; `readEpoch`; a page lands only if it continues state's cursor |
| list-cache-holds-acknowledged-rows | pages completed while writes were queued can come back partial offline. Accepted |
| likely new | a page loop must report failure and stop, and must not carry its own cursor across a `hydrate` (the gap this step designs out) |
| likely new | what Hermes provides on each platform (`normalize`, `Intl.Collator` options), and which fallback, if any, shipped |
| likely new | the sort-preference store: per device, per list for items, non-default only, never pruned |
