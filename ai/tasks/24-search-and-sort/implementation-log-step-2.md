# Step 2 — implementation log: "Show deleted" becomes a separate bin view, newest deletion first

2026-10-02. Scope: `description-step-2.md`. Step 1 signed off the same day.

## Outcome

- "Show deleted" switches the whole screen to the bin, on both screens:
  - bin rows only, `(deletedAt, id)` descending, next page on scroll;
  - no Create/Add bar: a `BarSentence` holds the slot;
  - `The bin is empty` with its hint;
  - the switch stays while it is checked;
  - the label is always `Show deleted`;
  - no `Deleted` tag on rows.
- Both bin reads are keyset on `(deleted_at, id)` desc. The live reads are byte-identical.
- New partial index `items_bin_order_idx`, applied to local only. **Not pushed to cloud.**
- `listCache` `VERSION` 8. `outbox` stays at 1.

## Server half (done first)

### PostgREST v14.5 accepts the embed order

- Image: `public.ecr.aws/supabase/postgrest:v14.5`. Account `t23lists` (`18d02d22-…`), token from OTP via
  Mailpit.
- **Page 1:**
  `GET /rest/v1/list_members?select=role,created_at,lists!inner(id,name,deleted_at)&lists.deleted_at=not.is.null&order=lists(deleted_at).desc,list_id.desc&limit=100`
  - 200, 100 rows, all binned, `deleted_at` strictly desc.
  - First row `Seed list 202` (`2026-10-02T07:58:02.905508+00:00`); last `Seed list 228` (`2026-09-23T04:31:02.905508+00:00`,
    `11b4f8ca-…`).
- **Continuation:** adds `&lists.deleted_at=lte.<c>&lists.or=(deleted_at.lt."<c>",and(deleted_at.eq."<c>",id.lt."<id>"))`.
  - 200, 50 rows, desc, all `< c`, no null embeds.
  - 150 distinct across both pages: the `!inner` embed filter drops parent rows.
- **Tie-break,** with the cursor stamp equal to row 3's: id `ffff…` starts at row 3 (`Seed list 276`), id `0000…` starts
  after it (`Seed list 64`).
- **No fallback function needed.**

### Measurement

Method: `read-rooted-at-list-members`. Role-switched psql as `authenticated` with a JWT claim, hand SQL in PostgREST's
shape (`inner join lateral`), warm, `explain (analyze, buffers)`.

Seed, removed afterwards (replica mode; items and memberships deleted before lists):
- 200,000 background lists over 10,000 load-test accounts (modulo, 20 each), a third binned, 2 items each with 1/10 of
  them binned;
- a 2,000-list account (`…7a120`), 666 binned;
- a big-bin list (`…7a121`): 1,000 live + 40,000 binned, distinct stamps.

Totals: 1,087,640 items, 204,864 lists.

**Item bin, big bin (40k)**, before → after the index:

| read | before | after |
|---|---|---|
| page 1 | Index Scan Backward on `items_deleted_at_idx` (the purge index), filter `list_id`, 1,769 rows removed: 2,183 buf, 7.1 ms | Index Scan Backward on `items_bin_order_idx`: 413 buf, 3.8 ms |
| cursor @400 | bitmap + top-N sort: 992 buf, 22.7 ms | bitmap + sort: 754 buf, 27.0 ms |
| cursor @10,000 | 936 buf, 11.9 ms | 685 buf, 13.0 ms |
| cursor @30,000 | BitmapAnd + sort of 10,000: 855 buf, 5.3 ms | BitmapOr + sort: 542 buf, 5.1 ms |

**Typical bin (`Seed list 398`, 500 binned)**, before → after:

| read | before | after |
|---|---|---|
| page 1 | bitmap, 26 buf, 0.51 ms | Index Scan Backward, 421 buf, 0.42 ms |
| page 2 | bitmap, 143 buf, 2.25 ms | Index Scan Backward, 117 buf, 0.64 ms |

**Deviation from the description.** On a very large bin, continuations are *not* the predicted one-page backward walk.

- **Cause:** the planner estimates 27–197 rows after the cursor where there are 10,000–39,600. It multiplies the
  list's selectivity by the global binned fraction and by the global `deleted_at` histogram, so it picks bitmap + sort.
- **Evidence the index can serve it:** with `enable_bitmapscan = off`, cursor @30,000 is a backward walk of
  `items_bin_order_idx`, 412 buf, 1.4 ms.
- **Tried and rejected:** `create statistics (mcv) on list_id, (deleted_at is null)`. It still estimated 197, chose
  bitmap, 867 buf, 15.7 ms.
- **Decision:** kept as is.
  - The index fixes page 1 — the hot path, on every list open and every re-read. Without it, page 1 walked every list's
    recent deletions.
  - It turns typical bins into the ordered walk.
  - A 40k-row bin is ~1,300 deletions a day in one list. Even then a continuation costs ≤ ~27 ms, tracking the bin after
    the cursor.

**Lists bin** (no index change):

| memberships | page 1 | cursor mid-stream | live page 1, for reference |
|---|---|---|---|
| 402 (`t23lists`, 150 binned) | 1,638 buf, 1.08 ms | @100 (50 rows): 1,632 buf, 0.86 ms | 1,632 buf |
| 2,000 (666 binned) | 8,086 buf, 4.86 ms | @333: 8,080 buf, 6.12 ms | 8,080 buf, 4.2 ms |

- Plan: Bitmap Index Scan on `list_members_user_id_created_at_idx` (all memberships) → nested loop `lists_pkey` → sort.
- A continuation costs page 1: nothing bounds it. The `lte` is kept as the description asks, but it buys nothing here.
- Not escalated. The denormalised-stamp escalation stays unbuilt.

### Migration

- `supabase/migrations/20261002000000_items_bin_order.sql`:
  `create index items_bin_order_idx on public.items (list_id, deleted_at, id) where deleted_at is not null;`
- Applied with `npx supabase migration up --local`, not `db reset`, which would wipe the 1M users and test accounts.

## Client

- **`types.ts`:**
  - `BinCursor = { deletedAt; id }`, `CursorOf<S>`, and `StreamPage`, a discriminated union, for both `pageLoaded`
    payloads;
  - `List.nextBin`, `ListCursors.bin` and `items/firstPageLoaded.bin.next` are `BinCursor`.
- **`listsApi.ts`:** `fetchLists`/`fetchItems` are generic `<S extends Stream>(…, after: CursorOf<S> | null)`, so jest
  mocks still type loosely. Each delegates to `live…Page`/`bin…Page`.
  - **The live branches keep every literal the `read-rooted-at-list-members` verify greps.** It still passes.
  - The bin branches are exactly as the description writes them, with `cursorAfter(rows, stream, limit)`.
- **`listsReducer.ts`:**
  - `binItems`, `binLists`;
  - `inDeletionOrder<T extends {id; deletedAt}>`: one generic for items and lists, `byStamp` with its arguments swapped;
  - `sameCursor` compares either cursor kind;
  - `withCursor` sets list cursors per stream.
- **`reloadPages.ts`:**
  - `FetchPage`/`FetchListPage` are generic;
  - both re-reads are stream-generic closures;
  - a single cast lives in `streamPage()`;
  - `cursorOf` is gone.
- **`useHydration.ts`:** `withinLoadedRange` is exported. The bin is in range when its cursor is `null`, or
  `deletedAt > cursor`, or the stamps are equal and `id >= cursor.id`. Live is unchanged.
- **`usePaging.ts` / `ListsContext.tsx`:**
  - `loadMore(listId, stream)` and `loadMoreLists(stream)` fetch only that stream;
  - each branch pairs its name with its cursor through `.then(… { name: 'live', next } as const)`;
  - the `loadListItems` literals are kept for the `deletion-is-a-tombstone` verify.
- **Components:**
  - `ShowDeletedToggle` lost `count`/`more`; its label is the constant `Show deleted`.
  - `ListRow`/`ItemRow` lost the tag and `styles.tag`.
  - **New `BarSentence`:** Lists' former `full`/`fullText` styles, moved. It renders the limit sentence and both bin
    sentences, and step 3 can reuse it.
- **Screens:**
  - `visible` is `inDeletionOrder(bin…)` with the switch on.
  - `more` and `loadNextPage` use the shown stream only.
  - The switch renders while `binned > 0 || showDeleted`.
  - Lists' bin sentence replaces the limit sentence too.
  - List detail shows its bin sentence only for an editor. A reader keeps the read-only notice, and a binned list keeps
    its notice.
- **`.maestro/flows/tour-signed-in.yaml`:** `tapOn: Show deleted`. The seed comment is updated too.

## The `loadedRows` / `stampedLists` question: yes

A row binned on this device carries a stamped `createdAt`/`joinedAt` and a device `deletedAt`, so it counts toward
`wanted` for the bin. When every loaded bin page is full (cursor non-null), the re-read asks for **one page more** than
was loaded:
- **The database already has the deletion:** it is page 1's first row, so page 1 grew by one. The extra page is what
  keeps the last row shown before, which a remote deletion of the same kind would drop until the next scroll. Needed.
- **Still queued** (blocked outbox head, or `flush`'s rollback `hydrate`): the extra page is never-shown rows. Unneeded.

Either way it is bounded at one page per stream per re-read. The page then counts as loaded, so the next re-read asks for
it again. Accepted, not fixed. A position-based rule (re-read until past the old cursor) over-fetches by up to a page too.

Pinned by `reloadPages.test.ts` (`describe('a row binned on this device')`) and by the `reloadListPages` test "asks one bin
page further for a list binned on this device and not yet sent".

## Tests

- **Tests:** 29 suites, 687 passing; 659 before.
- **New suite:** `src/state/useHydration.test.ts` (`withinLoadedRange`, 5 cases).
- **Rewritten:** every count, tag and interleave test in both screen suites and in the provider suite.
- **`listsApi.test.ts`:** its builder stub gained `lte`.
- **`listCache.test.ts`:** the two shape tests now write `v: 8`, so they still exercise the shape checks.
- **RNTL trap:** in the bin an item's checkbox is disabled, and `fireEvent` fires nothing from a disabled element. The
  List detail tests fire `endReached` from `Restore <title>`.
- **Act warning:** `npm test` sometimes prints one `An update to VirtualizedList … not wrapped in act(...)`. It happened
  1 run in 3 at HEAD and 1 in 3 with these changes. Load-dependent and not from this step.
- `npm run typecheck`: clean.
- **`npm run kb:audit`:** 3 errors, all from this step's intended changes, left for the librarian.
  - `list-cache-holds-acknowledged-rows`: `VERSION = 7`. Expected.
  - `queries-go-through-a11y-labels`: greps `Show 1 deleted` and `Show ${count}+ deleted`, both removed by the user's
    no-count decision.
  - **`max-rows-is-a-silent-ceiling`, not foreseen by the description:** it asserts exactly 2 `.limit(limit)` in
    `listsApi.ts`, and there are now 4, one per stream per read. Its intent holds: every page is limited and guarded,
    and `if (limit > MAX_ROWS)` and `rows.length < limit` are still 2 each. Satisfying it would break the
    `read-rooted-at-list-members` literal `.order('created_at').order('list_id').limit(limit)`.

## Verification

### Environment

- `.env` has `EXPO_PUBLIC_SUPABASE_TARGET` commented out, and nothing was on 8081.
- Metro started with `EXPO_PUBLIC_SUPABASE_TARGET=local npx expo start --port 8081`. The web and iOS bundles both read
  `"local"`.

### Verification seed (kept)

- `t23lists`' 150 binned lists re-stamped by SQL: spread 2026-09-18 → 10-02, ordered by `md5(id)`, unrelated to join
  order.
- `Seed list 398` was given 500 binned items. Their stamps are scrambled by `(j*7919)%500`.
- `Seed list 397`'s 2 items were binned, and later restored in-app.

### Browser (Playwright, 390×844, signed in as `t23lists` by OTP)

**Live mode:**
- Hydrate read page 1 of both streams, with the bin as `order=lists(deleted_at).desc,list_id.desc`.
- Scrolling issued two live continuations (#33, #34) and no bin continuation.

**Lists bin:**
- `Deleted lists, newest first.`; no Create bar and no limit sentence (the account is at 100 owned); no tags.
- Scrolling issued exactly one request (#35, `lte` + `lists.or` at `Seed list 228`, as in the curl) and no live one.
- All 150 rows were collected in on-screen order and diffed against
  `order by deleted_at desc, id desc`: identical, with page 2 appended below.

**Nudge into a paged bin:**
- Setup: the `lists:<uid>` cache key was removed and the page reloaded, so only page 1 of each stream was loaded.
- `t23friend` inserted "Friend's dinner" and `rpc/share_list`'d it (writer). Read by id (#50); past the live cursor, so
  not shown.
- Then `rpc/set_list_deleted`. Read by id (#51); appeared at the **top of the bin**, with no Restore (writer). This
  exercised the new `withinLoadedRange` comparison against a non-null bin cursor.

**List detail on `Seed list 398`:**
- Opening read page 1 of both streams (#54 live, #55 bin `order=deleted_at.desc,id.desc&limit=400`).
- The bin view showed `Deleted items, newest first.` and no Add bar.
- Scrolling issued one continuation (#56, `lte` + `or`).
- All 500 titles in on-screen order hashed (SHA-256) identical to the database's order.

**List detail on `Seed list 397`:**
- Restoring both binned items left `The bin is empty` + `Deleted items wait here for 30 days.`, with the switch still
  rendered.
- Switching off showed Milk 1, Eggs 2 and the Add bar, and no switch.
- The database showed both restored.
- [list-detail-live-after-restore-web.png](screenshots/step-2/list-detail-live-after-restore-web.png).

### Phone (iPhone 18 Pro, iOS 27, existing dev client, `maya@example.com`, status bar 9:41)

The flow:
1. Signed out of `t23b`, which the simulator held.
2. Shot Night: Lists bin, Groceries bin (1 row, `Coffee`), and Pharmacy emptied by restoring a binned `Plasters`.
3. Shot Day: the same, re-binning `Plasters` in-app first.
4. Restored all 24 of Maya's binned lists in-app (a Maestro `repeat`).
5. Shot the empty Lists bin in Day, then Night. Lists stays mounted under Account, so the switch stayed on.

Shots, in `screenshots/step-2/`:
- [lists-bin-day](screenshots/step-2/lists-bin-day-ios.png), [lists-bin-night](screenshots/step-2/lists-bin-night-ios.png)
- [list-detail-bin-day](screenshots/step-2/list-detail-bin-day-ios.png), [list-detail-bin-night](screenshots/step-2/list-detail-bin-night-ios.png)
- [lists-bin-empty-day](screenshots/step-2/lists-bin-empty-day-ios.png), [lists-bin-empty-night](screenshots/step-2/lists-bin-empty-night-ios.png)
- [list-detail-bin-empty-day](screenshots/step-2/list-detail-bin-empty-day-ios.png), [list-detail-bin-empty-night](screenshots/step-2/list-detail-bin-empty-night-ios.png)

**By measure against `ai/ux/primary/*-bin-quiet-horizon.png`** (Day; pt, relative to the header row; the 18 Pro sits
15.3 pt lower):

| | mockup | 18 Pro | Δ |
|---|---|---|---|
| Lists sentence top − Account pill top | 57.4 | 57.3 | 0.1 |
| Lists sentence height | 52.0 | 52.0 | 0 |
| Lists switch centre − pill top | 185.4 | 141.3 | 44.1 |
| List detail sentence top − Back top | 112.0 | 112.0 | 0 |
| List detail switch centre − Back top | 235.7 | 191.7 | 44.0 |

- The 44 pt is the sky that step 3's search mode brings. Step 2 sits on the bar's 52 pt, as the description says.
- A 2–5-level colour step under the sentence (List detail, Day, y ≈ 235 pt) is also present in live mode on the same
  device. It is where `SkyFill` meets `Hillside`, not something the sentence introduced.
- Seen in passing on `t23b`, which is at a limit: switching to the bin swaps a 2-line limit sentence for the 1-line bin
  sentence, so the switch rises ~14 pt there. Inherent to the copy, accepted.

**Local data restored afterwards:**
- Maya's 24 lists re-binned at their saved `deleted_at`.
- `Plasters` hard-deleted.
- Maya's Groceries untouched (its bin holds `Coffee`).

**Left on purpose:** `t23lists`' re-stamped bin, 500 binned items in `Seed list 398`, `Seed list 397`'s 2 restored items,
and `t23friend`'s binned "Friend's dinner", shared with `t23lists` as writer.

## Problems hit

- The first Lists screen-test rewrite rendered twice in one `it` (`screen.unmount()` then render). Every later test in
  the file timed out on `New list name`. Split into two tests.
- Maestro's first run found the simulator signed in as `t23b`. The flow now signs out first when `Account` is visible.
- Playwright `run_code` has no `require`; hashed with `crypto.subtle` in the page instead.

## KB candidates (for the librarian)

The description's KB-impact table stands. Additions and corrections:

- **read-rooted-at-list-members:**
  - PostgREST v14.5 accepts `order=lists(deleted_at).desc` on the `!inner` embed and orders the parent rows by it.
    `lists.or=` drops parent rows. Measured with curl.
  - **The item bin index fixes page 1 but not deep continuations on a very large bin:** planner misestimate, bitmap +
    sort. Typical bins do get the walk. Numbers above. The extended-statistics fix was tried and did not help.
  - The lists bin costs page 1 on every page (table above). The `lte` on the embed buys nothing.
- **max-rows-is-a-silent-ceiling:** its `verify:` counts `.limit(limit)` = 2. It is 4 now, one per stream per read. Update
  the count; the guard and short-page rule are unchanged.
- **queries-go-through-a11y-labels:** the switch's label is the constant `Show deleted`. Drop the two count greps.
  Screen tests query `getByRole('switch', { name: 'Show deleted' })`.
  - RNTL fires nothing from a disabled element, so a bin row's checkbox cannot start `endReached`. Use its `Restore`.
- **first-fetch-replaces-list-state:** the `loadedRows` answer above. It also applies to `stampedLists`.
- **realtime-is-a-nudge-to-a-per-user-inbox:** `withinLoadedRange` (now exported and unit-tested) compares the bin by
  `(deletedAt, id)` desc. A list binned elsewhere lands on page 1 of the bin. `loadList` is needed only once more than a
  page has been binned since.
- **list-cache-holds-acknowledged-rows:** `VERSION` 8 (bin cursors are deletion positions).
- **scope-boundaries / deletion-is-a-tombstone:** the bin is its own view, newest deletion first, never searched or sorted
  another way. No `Deleted` tag; no count on the switch.
- **phone-is-the-product:** step 2's bin screens measure within 0.1 pt of the mockups except the 44 pt step 3 adds.
  `BarSentence` is the bar-surface sentence component.
- **maestro-drives-the-native-ui:**
  - The simulator may be left signed in as another account. Guard flows with a conditional `sign-out.yaml`.
  - `repeat: while: visible: "Restore .*"` empties a bin.
  - Lists stays mounted under Account, so screen-local state survives a theme change made there.
