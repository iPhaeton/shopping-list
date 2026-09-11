# Implementation log — step 1: rename an item

**Date:** 2026-09-11. Description: [description-step-1.md](description-step-1.md). Plan: the
approved plan-mode file (not checked in); no `ai/suggestions/` proposal preceded this step.

An item can be renamed now, by an **owner or writer** — the same people who may add one. It is the
list rename one rung down and the same shape end to end: the seventh `WriteAction`, an absolute
value so retries and coalescing are safe, a `security definer` RPC because `authenticated` holds no
UPDATE on `items`, and a `write_outcome` return so a rename that lands on something in the bin goes
through the existing "restore and keep my change" prompt rather than a red banner.

## What was built

| File | |
|---|---|
| `supabase/migrations/20260911000000_rename_item.sql` | new — `rename_item(uuid, text) returns write_outcome`, grants, schema reload |
| `src/state/types.ts` | `item/renamed { listId, itemId, title }`; `Action` has eight members, `WriteAction` seven |
| `src/state/listsReducer.ts` | one arm: trim, blank → no-op, unchanged title → same object, `doneAt`/`deletedAt` untouched |
| `src/lib/outbox.ts` | `supersedes` coalesces per `itemId`; `dropDependents` strands it behind a refused `item/added`, strands nothing when it is itself refused |
| `src/state/restorePlan.ts` | `listIdOf` → `listId`, `itemIdOf` → `itemId` |
| `src/lib/listsApi.ts` | `renameItem(itemId, title)` → `rpc('rename_item')` through `writeResult` |
| `src/state/ListsContext.tsx` | `renameItem(listId, itemId, title)` mutator, `canEditItems` guard, `send()` arm |
| `src/components/ItemRow.tsx` | `onRename` prop, a `Rename` action, and an inline editor in place of the row |
| `src/screens/ListDetailScreen.tsx` | passes `onRename` when `editable` |
| 7 suites | 28 new tests (224 → 252) |

Untouched on purpose: **every policy**, the realtime migration, `BlockedBanner`, `replay`,
`listCache` (`Item`'s shape did not change, so `VERSION` stays 3), `outbox.ts`'s `VERSION` (a v1 blob
can only hold actions that are still valid).

## Decisions

**The editor opens in place of the row, not in a bar at the top.** The list-rename bar hangs under a
*header* button, so top-of-screen is where the user is already looking; an item's Rename is on the
row, and on a long list a bar at the top would open off-screen. `ItemRow` swaps its checkbox for a
`TextInput` seeded with the title, with `Save` (disabled while blank) and `Cancel`. The draft is
row-local state, seeded on open and not after — like `AddBar`'s `initialValue`, so a rename arriving
from another device does not clobber what this one is typing — and a `FlatList` may discard it if the
row scrolls far enough to unmount, which is accepted as an open `AddBar` draft already is.

**Saving an unchanged title queues nothing.** The row compares the trimmed draft to `item.title`
before calling `onRename`. The reducer would return the same state object anyway, but the op would
still be enqueued and sent; the check is in the row so a no-op tap is genuinely nothing.

**A binned row gets no Rename, only Restore**, for the reason its checkbox is disabled: the write
would come straight back `target_deleted`. `ListDetailScreen` already folds `binned` into `editable`,
so a list opened from the bin loses the control with everything else that writes.

**`rename_item` is `set_item_done` with `title` for `done_at`, three-way split and all, in the same
order.** Row missing → `target_deleted`; **caller not a writer → raise `42501`**; otherwise →
`target_deleted`. Copied rather than factored into a helper: migrations are append-only and each
function has to be readable on its own. The permission check before the last tombstone branch is the
part that matters — a stranger holding an item id is refused and never learns the row is in the bin,
and case 5 of the matrix below asserts exactly that. No server-side `trim`, matching `add_item`; the
table's own `check (length(trim(title)) > 0)` refuses a blank with `23514`, which `humanize` already
rewords.

**Realtime needed nothing.** `notify_on_item_change` is `after insert or update on public.items`, so
the rename's UPDATE fans out like a tick does. Two renames in the matrix wrote exactly four
`realtime.messages` rows — two members each — and the browser check below measured the other tab
following in 262 ms.

**The two `outbox.ts` arms the KB warns about were edited by hand, and the tests are aimed at
them.** `supersedes` ends in `default: return false`, so a seventh action silently stops coalescing
unless spelled out; `dropDependents`'s `item/added` arm is a filter predicate, so it silently keeps a
new item action that a refused insert should have stranded. Both have a test whose comment says which
trap it is for. Everything else was a compile error until handled — `listIdOf`, `itemIdOf`,
`send()`, the `dropDependents` "strands nothing" group — which is the union working as intended.

## Problems hit

### 1. A code comment tripped a KB `verify:` that greps for a word

`first-fetch-replaces-list-state` asserts `! grep -q 'replay' src/state/listsReducer.ts` — the fold
lives one level up, and the reducer must not know about it. The first draft of the new reducer arm
said "a *replayed* rename must not undo a tick", and the audit went red on prose. Reworded to "a
rename folded back over fetched rows". Same class of trap as step 9's "revoke execute" note: a
`verify:` grep does not distinguish a comment from code, so a word choice can fail an entry whose
fact is intact.

### 2. Playwright's `getByRole` was ambiguous for an owner

`getByRole('button', { name: /bob list/ })` matched two elements on the owner's list screen — the row
and its `Delete bob list` action — where a writer's screen has only the row. Anchored the regex
(`/^bob list, /`). Worth knowing before the next browser probe: the label set differs by role, so a
selector that works signed in as a writer can be ambiguous as an owner.

### 3. The wrong `outbox:` key was read first

`localStorage` on this browser holds six `outbox:<uid>` keys from accounts that signed in during
earlier steps, and `Object.keys(...).find(k => k.startsWith('outbox:'))` returned an empty one. Read
all of them instead; bob's held the queued `item/renamed`. Not a bug — the outbox is per account by
design — but a probe that reads "the" outbox has to name the account.

## How it was verified

**Automated:** 252 tests across 13 suites, `tsc --noEmit` clean, `npm run kb:audit` at **1 error** —
the predicted one (see below).

**Migration:** `npx supabase migration up`, not `db reset`, so both accounts and `bob list`
survived. `pg_proc.proacl` read back as
`{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}` — no `anon`, no PUBLIC —
and `prosecdef` true with `search_path=""`.

**The RPC, in one rolled-back transaction, 11 cases**, switching role with `set local role
authenticated` + `request.jwt.claims`, asserting return values *and* the row afterwards: owner →
`applied`, title changed; writer → `applied`; reader → `42501`, title unchanged; stranger on a live
item → `42501`; **stranger on a binned item → `42501`, not `target_deleted`**; owner on a binned item
→ `target_deleted`, title unchanged; owner on an item inside a binned list → `target_deleted`;
unknown id → `target_deleted`; blank title → `23514`; `anon` → "permission denied for function";
and four `realtime.messages` rows for the two accepted renames.

**End to end in the browser** against the local stack, driven with Playwright, signed in as **bob,
a writer** on the owner's list:

| | |
|---|---|
| open the list | `Rename` on every live row, next to `Delete`; screenshot checked by eye |
| Rename → field seeded "Item 2" → "Oat milk" → Save | row reads "Oat milk" in place, editor gone, **one** `rename_item` request, `psql` shows the new title |
| abort port 54321, rename twice ("Soy milk", "Almond milk") | *"1 change will sync when you're back online"* — two renames, one pending; bob's `outbox:` key holds one `item/renamed` op with the newest title; four aborted retries at 1 s / 2 s / 4 s backoff |
| lift the route, fire `online` | **one** request, carrying "Almond milk"; banner gone |
| second context signed in as **alise, the owner**, same list open | owner sees `Rename` on the item *and* `Rename list` in the header |
| bob renames to "Bananas" | alise's tab shows "Bananas" after **one** re-fetch, 262 ms, no reload |

**The stack was left exactly as found:** the item renamed back to "Item 2" through the UI, then
`psql` confirmed the three titles, 2 lists, 3 memberships and 2 accounts match the start. The stray
`before-rename.png` Playwright wrote to the repo root was deleted; `.playwright-mcp/` is gitignored.

## KB impact — handed to the librarian, not edited here

One `verify:` now fails and it is the entry whose fact moved: `writes-retry-from-an-outbox` pins
`Action` at seven members and `WriteAction` at six; both are one higher. Its prose about `supersedes`
and `dropDependents` not defending themselves is still true and now has a second worked example.

Prose that has gone stale without tripping a check: `list-data-scoped-by-rls` and
`scope-boundaries` ("writer also adds items and checks them off" — and renames them now);
`server-stamps-done-at` and `writes-can-land-on-a-tombstone` (`rename_item` is the fourth RPC
returning `write_outcome`, and the third built on `set_item_done`'s three-way split);
`supabase-local-stack` (the cloud project is now **three** migrations behind, and `db push` is the
user's to run); `queries-go-through-a11y-labels` may want the new labels — `Rename <title>`,
`Item name`, `Save`, `Cancel`.

Two facts worth an entry or a line somewhere: a `verify:` grep cannot tell prose from code (problem
1, and step 9's "revoke execute" was the same thing); and a browser probe reading "the" outbox has to
name the account, because one device's `localStorage` holds one outbox per account that ever signed
in.

## What this does not solve

**Not verified: the cloud project.** `npx supabase db push` is the user's to run and now carries
three files — step 9's pair plus this one.

**Two "Save" buttons can coexist** if the list-rename bar and an item editor are both open. Both
work; only a screen reader reading labels alone could confuse them. Not worth a longer label until
somebody hits it.

**No happens-before**, as before: a rename and a delete of the same item from two devices resolve by
who you are, not by which came first. Last-write-wins for the title itself.
