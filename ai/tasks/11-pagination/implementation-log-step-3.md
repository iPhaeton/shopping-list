# Implementation log — step 3: realtime nudges scoped to the list(s) they name

**Date:** 2026-09-12. Description: [description-step-3.md](description-step-3.md). Plan: the
approved plan-mode file (not checked in).

Step 2's own log flagged this as unsolved: "a realtime nudge re-expands every list visited this
session, not only the one on screen." This step is that fix. The broadcast payload already carried
`listId` (`supabase/migrations/20260909000000_realtime.sql`); the client decoded and discarded it.
Now it is threaded through `subscribeToChanges` → `refreshSoon` → a per-nudge accumulator (`dirty`)
→ a new single-list fetch, so a nudge naming one list re-reads only that list's metadata and, if it
was previously opened, only that list's item pages. A nudge with no usable list id (a malformed
payload, or a resubscribe, which can never know what it missed) still falls back to a full
`hydrate()`, unchanged from before.

## What was built

| File | |
|---|---|
| `src/lib/listsChannel.ts` | `onChange`'s type widens to `(listId?: string) => void`; the broadcast handler reads `message.payload?.listId`, passing it through only when it is a string, `undefined` otherwise. `onResubscribe` unchanged — at-most-once delivery means a resubscribe can never know what it missed. |
| `src/lib/listsApi.ts` | new `fetchList(listId)` — same `list_members`-rooted read as `fetchLists`, filtered by `.eq('list_id', listId)`, `maybeSingle()`. `{list: null, error: null}` means not visible (unshared or purged); a soft-deleted-but-still-a-member list comes back non-null with `deletedAt` set, since the `lists` select policy carries no `deleted_at` condition. |
| `src/state/ListsContext.tsx` | the `owed: boolean` ref is replaced by `dirty: Set<string> \| 'all'`, tracking exactly which lists a nudge has named since the last drain; new `hydrateLists(listIds)`, `hydrate`'s sibling, scoped to a set of ids; new `runDirty`/`drainDirty` replacing `drainOwed`; `refreshSoon(listId?)` mutates `dirty` before its debounce early-return, then defers to `drainDirty`; `refresh()` unchanged in behaviour, `owed.current = false` becomes `dirty.current = new Set()`. |
| 3 suites | `listsChannel.test.ts` — the payload-discarding assertion becomes a decoding one, plus four malformed-payload cases; `listsApi.test.ts` — new `describe('fetchList', ...)`; `ListsContext.test.tsx` — `fetchList` added to the mock, `nudge` retyped, five new realtime tests (named-list-only fetch, a shared-in list appearing, an unshared/purged list disappearing, a merely-binned list staying, and the scoping proof — two loaded lists, a nudge naming one leaves the other's `fetchItems` count untouched). Net test count 322 (was 309). |

Untouched: every migration (the payload already carried `listId`; nothing server-side changed),
`reloadPages.ts`, `replay.ts`, `flush`'s own body (only its `finally`'s call target renamed), the
foreground/online-resume effect, and every existing realtime test that calls `nudge()` with no id —
they exercise the `'all'` path and needed no changes.

## Decisions

**`dirty: Set<string> | 'all'`, not a second boolean beside `owed`.** The old `owed` only recorded
*that* a nudge was turned away; a scoped nudge needs to record *which* lists, and `dirty` already
has to hold that between the debounce timer firing and the fetch actually running, so it does double
duty as both "what to fetch" and "is anything owed" — `drainDirty` asks the same ref both questions
(`dirty.current === 'all' || dirty.current.size > 0`) rather than keeping two facts that could drift
apart.

**`reloadPages` is reused completely unmodified.** `hydrateLists` builds its "fetched" array by
replacing only the named lists with fresh, items-empty copies and passing every other list through
as the *same object reference* it already had. `reloadPages`'s reload condition (`wanted <=
loadedRows(list, stream)`) compares that object against itself for every untouched list, which is
trivially true — so untouched lists provoke zero `fetchItems` calls with no special-casing needed
beyond building the input array correctly.

**`hydrateLists` does not call `writeCachedLists`.** The untouched lists in its output are
`listsRef.current`'s own objects — the *replayed* view, which may hold a write the database has not
acknowledged yet. `hydrate` may cache because everything it hands over came from a fetch; `hydrateLists`
does not have that property for anything outside the named set, so it caches nothing at all and
relies entirely on the existing `pending === 0` effect to persist the dispatch once the outbox
actually empties. Caught in plan review before it was written, not found by a failing test.

**Self-draining stays out of `hydrate`'s and `hydrateLists`'s own `finally` blocks.** The
alternative — each fetch function draining `dirty` itself when it finishes, the way `flush` already
does — would make `drainDirty → runDirty → hydrateLists → drainDirty` a circular `useCallback`
dependency, and would race `discardBlocked`/`restoreBlocked`'s `hydrate().then(() => flush())`
chains: a drain fired synchronously inside `hydrate`'s `finally` sets `fetching.current` back to
`true` before that `.then` resumes, so `flush` would see it set and silently skip a queued write.
`runDirty`'s own `while` loop covers "something else was named while I was working" without either
hazard, since a nudge arriving mid-fetch is picked up by the same still-running `runDirty` call the
moment `fetching.current` clears.

**A newly-shared list is appended, not inserted at its `created_at` position.** `List` carries no
such field, and confirmed by search: nothing in `ListsScreen.tsx` or any test sorts or depends on
list array order. Self-corrects on the next full `hydrate` (foreground resume, or a resubscribe).

**`refresh()` keeps its exact old guard, not `fetching.current`.** Adding that guard would make a
user-triggered "refresh" (the sharing screen) sometimes silently do nothing while a nudge-driven
fetch happens to be in flight — worse for an explicit user action than the bounded, self-healing
race it would prevent. Documented in `refresh`'s own comment rather than fixed.

## Problems hit

`listsChannel.test.ts`'s `deliver()` helper originally defaulted its `payload` parameter to `{
listId: 'l1' }`. A parametrized "no usable list id" test tried to cover "no payload at all" by
passing `undefined` explicitly — which triggers a JS default parameter exactly as if the argument
had been omitted, silently substituting the default and making that test case assert against the
wrong delivery. Fixed by dropping the default and handling `payload === undefined` explicitly
inside `deliver`, which also made the case semantically correct (a message with no `payload` key is
indistinguishable from one whose `payload` is `undefined`, from `listsChannel.ts`'s own `message.payload
?? {}` handling — so one test case covers both).

## Not re-verified this session

No two-device or two-browser realtime run against either Supabase stack — every assertion here goes
through the same mocked seams (`../lib/listsApi`, `../lib/listsChannel`) prior steps used, per
[supabase-client-module-boundary](../../kb/entries/supabase-client-module-boundary.md). Nothing
server-side changed (the payload already carried `listId`), so this is lower-risk than step 1's or
2's schema-touching changes, but the actual "list A changes on device 2, device 1 shows it without
device 1's own list B flickering or re-fetching" experience is unverified beyond the mocked proof in
`ListsContext.test.tsx`.

## KB impact — handed to the librarian, not edited here

- [realtime-is-a-nudge-to-a-per-user-inbox](../../kb/entries/realtime-is-a-nudge-to-a-per-user-inbox.md) —
  its `verify:` greps for `.on('broadcast', { event: 'list/changed' }, () => onChange())` verbatim;
  that call now decodes `listId`. The entry's core claim — the payload's contents are never applied
  to reducer state, only used to decide what to re-read — still holds and is worth stating
  explicitly against this change, since a careless reading of "do not apply one to reducer state"
  could be mistaken for forbidding this feature entirely rather than the delta-application it
  actually rules out.
- [first-fetch-replaces-list-state](../../kb/entries/first-fetch-replaces-list-state.md) — its
  `verify:` checks `refreshSoon` calling `void refresh()` and never calling `hydrate(` directly;
  neither is true any more (`refreshSoon` → `drainDirty` → `runDirty` → `hydrate`/`hydrateLists`).
  Needs the heaviest rewrite of the three: two fetch functions becoming three, `owed` becoming
  `dirty`, and the new self-draining/circularity trade-off documented above.
- [list-cache-holds-acknowledged-rows](../../kb/entries/list-cache-holds-acknowledged-rows.md) — its
  prose describes two fetch functions and how each caches; a third now exists (`hydrateLists`) that
  deliberately caches nothing. Worth a short addendum so a future reader does not "fix" that
  omission and reintroduce the bug it avoids.

## What this does not solve

- **The `fetching.current` race between `refresh()`/`discardBlocked`/`restoreBlocked`'s direct
  `hydrate()` calls and a nudge-driven `runDirty` already in flight** — neither checks the other's
  guard, so either can start alongside the other and whichever dispatch lands last wins. Documented
  in `refresh`'s comment as a pre-existing, bounded, self-healing gap (repaired by the next nudge or
  foreground event), not one this step widens or was asked to close.
- **Still a full re-read of the named list, never a delta.** Unchanged from the architecture step 8
  established — this step narrows *which* list a nudge re-reads, not *how*.
- **A list shared with you mid-session lands at the end of the array**, not at its "true"
  `created_at`-ordered position, until the next full refresh reorders it. Accepted trade-off, not a
  gap to fill without `List` gaining a `createdAt` field nothing currently needs.
