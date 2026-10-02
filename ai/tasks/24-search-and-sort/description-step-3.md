# Step 3 — Search and sort the live rows, on the device

The user's requests are quoted in [description-step-1.md](description-step-1.md). Rationale:
[ai/suggestions/search-and-sort.md](../../suggestions/search-and-sort.md) §1, §2 and §4. Where the two
differ, this description wins. **One deliberate difference:** each list keeps its own item sort,
stored only when it is not the default (the user's answer to the suggestion's decision 3).

**Steps 1 and 2 must land first.** Step 1's mockups (`*-search*`) and its log settle placement,
labels and copy. Step 2 made "Show deleted" a separate view, so everything here is live rows only:
search and sort are hidden in bin mode.

**Step 1's review reshaped this step** (user, 2026-10-02; the rounds are in
[implementation-log-step-1.md](implementation-log-step-1.md)):
- **Search is the resting state** of both screens. A header button swaps it for the Create / Add bar
  and back.
- The sort is **several keys at once**, on toggle buttons, in a fixed priority. It is not one choice
  from a picker.

This description was rewritten to match. Where the log and this text differ, this text wins.

**Scope change:** search and sort are in, for the Lists screen and List detail, over live rows, on
the device. **Out:** searching for an item across lists (user's decision), searching or sorting the
bin, sorting on the server, and a "recently changed" sort.

## The rule

**Search and sort are correct only over a complete stream, but results never wait for the
network.** The screen arranges what state holds at once, completes the live stream in the
background, and says how complete the results are.

- **The stream needs completing** when the query is non-empty or the sort is not the default, in
  either mode, *and* the live cursor is non-null (`listCursors.live`, `list.nextLive`).
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
  query })` takes `liveItems(...)` output. The query applies in both modes. Each returns a new array. Screens memoise it in place of
  today's `inJoinOrder`/`inCreationOrder` call. **No debounce:** filtering 2,000 strings is not worth
  one.
- **Matching:** substring of `name` / `title`, case- and accent-insensitive, so `creme` finds `Crème
  fraîche`. Fold both sides with `s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()`,
  and trim the query. An empty query matches everything.
  - Use the explicit range, not `\p{M}`: one fewer engine feature to confirm.
  - The fold is deliberately crude, and that is accepted. It strips every combining mark, so `й`
    matches `и` and `ё` matches `е`. It leaves letters that don't decompose (`ł`, `ø`, `ß`) as they
    are.
- **Sorts: several keys, fixed priority.** Each key is a toggle button. The buttons sit left to right
  in priority order: List detail `To Do` · `A–Z` · `Date`, Lists `A–Z` · `Date`.

  | key | screens | states, in tap order | default | compares |
  |---|---|---|---|---|
  | `todo` | List detail | off → `first` → `last` → off | off | undone before done (`first`) or after (`last`) |
  | `az` | both | off → `asc` → `desc` → off | off | `name` / `title` by the collator; `desc` negates |
  | `date` | both | `asc` ↔ `desc`, **never off** | `asc` | `joinedAt` on Lists, `createdAt` on List detail |

  - **Compare by `todo` (if on), then `az` (if on), then `date`.** `date` is always the last key, so it
    breaks `az` ties. No database rule makes list names or item titles unique. No key after `date`
    could change anything, since no two rows share a stamp.
  - **`date` `asc` is `byStamp`**: `(stamp, id)` ascending, unstamped rows last, in their original
    order. The default sort with no query must therefore equal today's `inJoinOrder` /
    `inCreationOrder`. Test that equality.
  - **`date` `desc` is `asc` reversed exactly**: `(stamp, id)` descending, and **unstamped rows
    first**, the latest created first. Unstamped rows are optimistic (`joinedAt`/`createdAt` `null`),
    so they are the newest. Putting them last would make a list created under `desc` appear at the
    bottom, then jump to the top once the database acknowledges it. A comparator alone cannot reverse
    the stable order among unstamped rows, so carry each row's input index.
  - `byStamp` lives in [listsReducer.ts](../../../src/state/listsReducer.ts). Export it, or move it
    here. Never copy it.
  - Suggested types: `ListSort = { az: 'asc' | 'desc' | null; date: 'asc' | 'desc' }` and
    `ItemSort = ListSort & { todo: 'first' | 'last' | null }`.
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
  needing it (the query empty, and the sort back to the default). Pages already fetched are still
  folded.

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

- **One per-device key**, versioned:
  `{ v: 1, lists?: Partial<ListSort>, items?: { [listId]: Partial<ItemSort> } }`.
- **Only non-default values are stored** (the user's words). That means `az` and `todo` only when on,
  and `date` only as `'desc'`.
  - Setting a key back to its default deletes that key.
  - A list entry left empty is deleted.
  - When nothing non-default remains, the storage key is removed.
- The read never rejects. An absent or unreadable key, or a wrong `v`, reads as all defaults. An
  unrecognised value drops that one key, not its entry and not the whole store.
- Writes go through `inOrder`.
- **Per device, not per account, and not cleared on sign-out**, as the theme is. List ids are
  globally unique, so accounts don't collide. A list shared by two accounts on one device shares its
  sort, which is accepted.
- **Never pruned.** The client cannot tell a gone list from one past the loaded pages. An entry is
  ~50 bytes, and only lists someone re-sorted have one. Do not add pruning.
- **No reorder on arrival.** Read it before any screen renders rows: for example, a provider that
  renders nothing until the read resolves, as ThemeContext's gate does with `readThemePreference`.
  Then hold it in memory: a change re-sorts at once, and the write follows.

## The query and the mode

- **Two screen-local `useState`s, never stored:** the query, and the mode (`'search' | 'create'`).
  Both reset on leaving the screen. Both are kept across a trip into the bin and back.
- **The screen opens in search mode.** The exception is an empty, complete live stream: then there
  is nothing to search, so it opens in create mode, as a new account's first screen looks today.
  A reader has no create mode and stays in search. The mode never switches by itself after that.
- **The header button toggles the mode. Switching keeps the query and the sort** (user).
- **The query filters in both modes** (user). In create mode, an item added that doesn't match the
  query drops out of view the moment it lands. That is accepted (user, step 1's review); do not
  special-case it.
- **The field's × clears the query.** It shows only while the query is non-empty. There is no
  `Cancel`: there is no panel to close.

## Screens

[ListsScreen](../../../src/screens/ListsScreen.tsx) and [ListDetailScreen](../../../src/screens/ListDetailScreen.tsx),
built to step 1's `*-search*` mockups:

- **New glyphs** in [icons.tsx](../../../src/components/icons.tsx), in `PencilIcon`'s style:
  `SearchIcon`, `PlusIcon`, `CloseIcon`, `ArrowUpIcon`, `ArrowDownIcon`. The paths are in step 1's log.
- **The header button** is a round `IconButton` with an `outline` ring. It sits left of `Account` on
  Lists, and left of `Rename` / `Share` on List detail, with a 12 pt gap.
  - Its glyph names the other mode.
    - Search mode: `PlusIcon`, labelled `New list` / `New item`. Tapping it switches to create mode
      and focuses the Create / Add input.
    - Create mode: `SearchIcon`, labelled `Search and sort`, with the dot while the query is
      non-empty or the sort is not the default. Both change which rows create mode shows, and
      neither is visible there. Its `accessibilityValue.text` spells out the query, then the active
      sort in priority order.
  - It renders in live mode only:
    - on Lists once `status === 'ready'`;
    - on List detail once `list.itemsLoaded`, the same gate the Add bar has. A list never opened has
      no items offline, which is today's behaviour.
  - It is hidden while the live stream is empty and complete and the mode is create. The first row
    brings it back.
- **Search mode's slot** follows the mockups:
  - the field on the `AddBar` surface, labelled `Search lists` / `Search items`;
  - the × (`Clear search`);
  - under it, the row of sort buttons, labelled `Sort by to do` / `Sort by name` / `Sort by date
    added`, with each state as `accessibilityValue.text`. Copy and values are in step 1's log.
- **Create mode's slot** is today's: the Create / Add bar, or the limit sentence on Lists at a list
  limit. Plus still shows at the limit.
- **Every case where List detail's slot held a notice:**
  - **A reader** has no create mode, so no header button. Search mode holds the slot. The read-only
    sentence moves under the search slot, in the coverage line's style. When both show, the coverage
    line comes first.
  - **A binned list** keeps its notice, with `Restore <name>`, in the slot. It gets no search, no sort
    buttons and no header button: it is a tombstone, like bin mode. Its rows keep the list's stored
    sort, with no query.
- **Bin mode:** no header button. Step 2's bin sentence takes the field's or bar's place. When bin
  mode is entered from search mode, the sort row's 44 pt stays as sky under the sentence, so `Show
  deleted` does not move under the finger.
- **List detail's status-bar strip** uses the constant `DRAWN_SKY_H` (224), the old resting header's
  height. Search mode makes the header 268–318 pt, so measure it by `onLayout`, as Sharing does.
- **The coverage line** goes where step 1 put it, and shows whenever the stream needs completing and
  is not complete, in either mode. `n` is the count of live rows held, written with `limits.ts`'s
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
  - each key in both directions, and combinations in priority order (`todo`, then `az`, then `date`);
  - the default sort with no query equals `inJoinOrder` / `inCreationOrder`;
  - `az` ties broken by `date`;
  - unstamped rows last under `date` `asc`, and first, latest first, under `desc`;
  - both fallback paths.
- `sortPreference`:
  - read fallbacks: absent, unparseable, wrong `v`, one bad entry among good ones;
  - setting a key back to its default deletes that key, an emptied list entry, and the storage key
    when it was the last.
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
  - the header button: absent until loaded, absent in bin mode, for a reader, and on a binned list.
    Its label flips between `New list` / `New item` and `Search and sort`;
  - a screen with an empty, complete live stream opens in create mode;
  - the date button never turns off; `A–Z` and `To Do` cycle off → on → reversed → off;
  - search, sort and line are hidden in bin mode, and the query and mode survive the trip;
  - an item sort set on one list does not apply to another;
  - the × clears the query;
  - switching to create mode keeps the query and the sort, and the rows stay filtered;
  - in create mode the magnifier's dot shows for a non-empty query or a non-default sort, and not when
    both are at rest.

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
   - A sort survives a reload. List A at `To Do First` + `Z–A` and list B at the default stay that
     way. Setting list A back to the default removes its entry: inspect the stored key.
4. **Hermes checks** on device, recorded as above.
5. **Phone:** a Maestro flow on the iPhone 18 Pro simulator
   ([maestro-drives-the-native-ui](../../kb/entries/maestro-drives-the-native-ui.md): reset keyboards
   before `inputText`). Screenshots, both themes:
   - Lists and List detail at rest (search mode, empty query, default sort), against step 1's
     `lists-screen-search-resting` and `list-detail-screen-search-resting`;
   - Lists and List detail searching, against `lists-screen-search` and `list-detail-screen-search`;
   - List detail in create mode with a non-default sort, against `list-detail-screen-search-sorted`.

   Compare by measure. Save them in `screenshots/step-3/`.
6. **Commands:** `npm test`, `npm run typecheck`, `npm run kb:audit`.

## KB impact (for the librarian)

| entry | change |
|---|---|
| scope-boundaries | search and sort are in: live rows, on the device, both screens, search the resting state; several sort keys at once in a fixed priority; the sort per device, per list for items, non-default keys only; cross-list search, bin search and server sorting out |
| first-fetch-replaces-list-state | a completed stream makes every `hydrate` re-read it whole; `readEpoch`; a page lands only if it continues state's cursor |
| list-cache-holds-acknowledged-rows | pages completed while writes were queued can come back partial offline. Accepted |
| likely new | a page loop must report failure and stop, and must not carry its own cursor across a `hydrate` (the gap this step designs out) |
| likely new | what Hermes provides on each platform (`normalize`, `Intl.Collator` options), and which fallback, if any, shipped |
| likely new | the sort-preference store: per device, per list for items, non-default keys only, never pruned |
| likely new | the sort model: `todo` → `az` → `date`, `date` never off, and why (no key after `date` can matter; names aren't unique) |
