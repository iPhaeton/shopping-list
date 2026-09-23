# Implementation log — step 2: live-update `SharingScreen`'s roster on a realtime nudge

**Date:** 2026-09-23. Description: [description-step-2.md](description-step-2.md).

## What changed

No database change — the server side already existed and already covered this. `notify_list_members()`
(`supabase/migrations/20260909000000_realtime.sql:56-104`) fires on every `list_members` insert/
update/delete and, on a `DELETE`, broadcasts to every *remaining* member's `user:<uid>` topic
(confirmed by reading the trigger body directly: `target_list := old.list_id` at `:74`, the notify
loop at `:89-100` reads `list_members` after the row is already gone). This already fired for both
`leave_list` and `remove_member`, unchanged since either existed. The gap was entirely that nothing
client-side told `SharingScreen` a nudge had arrived — its roster is local `useState`, deliberately
outside `ListsContext`'s reducer, so it never got the "live for free" treatment `state.lists` readers
(`ListDetailScreen`, etc.) already have.

**`src/state/ListsContext.tsx`** — added `lastNudge: { listId: string | undefined } | null` to
`ListsContextValue` and its `useMemo`. The one realtime subscription effect
(`useEffect(() => { if (status !== 'ready') return; return subscribeToChanges(userId, refreshSoon,
refreshSoon); }, [userId, status, refreshSoon]);`) now wraps both slots in a local `onNudge` that
calls the existing `refreshSoon(listId)` unchanged, then also `setLastNudge({ listId })` — a plain
`useState`, not routed through `useHydration`'s debounced `dirty`/`drainDirty` machinery, since
nothing about `lastNudge` triggers a fetch of its own; a consuming screen decides what to do with it.

**`src/screens/SharingScreen.tsx`** — destructures `lastNudge` from `useLists()` and adds one more
effect beside the existing mount effect:
```ts
useEffect(() => {
  if (!lastNudge) return;
  if (lastNudge.listId !== undefined && lastNudge.listId !== listId) return;
  void load();
}, [lastNudge, listId, load]);
```
Reuses the screen's existing `load()` — no new fetch path. Deliberately calls `load()` directly, not
`run()`: `run()`'s "am I still in this roster → `navigation.popToTop()`" check is for a write *this*
device made; a nudge-triggered reload is about someone else's change, and a viewer discovering they
themselves were removed while looking at someone else's Sharing screen is a different, pre-existing
gap this step wasn't asked to close.

**Tests:**
- `src/state/ListsContext.test.tsx` — `Probe` now renders `lastNudge`; two new cases assert it after
  `nudge('l7')` (renders `l7`) and after `resubscribe()` (renders `all`, the same "not sure what
  changed" case an unnamed nudge already gets via `dirty = 'all'`).
- `src/screens/SharingScreen.test.tsx` — the `listsChannel` mock changed from a static no-op
  (`subscribeToChanges: jest.fn(() => () => {})`) to one that captures the passed `onChange` into a
  module-level `nudge` variable, the exact technique `ListsContext.test.tsx` already uses. Three new
  cases: a nudge naming the open list re-fetches and re-renders; a nudge naming a different list is
  ignored; a nudge naming no list (`nudge()`, undefined) also re-fetches.

## Decisions worth flagging

- **Deliberately not a second `subscribeToChanges` call in `SharingScreen`.** Traced directly into
  `@supabase/realtime-js` (`node_modules/@supabase/realtime-js/src/RealtimeClient.ts:462-475`):
  `channel(topic)` returns the *same* instance for a topic already open, keyed by topic string, and
  this app has exactly one topic per user (`user:<uid>`), already held open by `ListsContext`. A
  second subscription for the same user would share that instance — its `onChange` binding would
  fire on every broadcast, but its cleanup (`removeChannel` → `unsubscribe()` + `teardown()`) tears
  down the *shared* channel. `SharingScreen` unmounts on every "back" navigation, so this would have
  silently killed `ListsContext`'s own realtime subscription for the rest of the session the first
  time anyone visited Sharing and navigated away. This is why the fix routes through `ListsContext`'s
  existing subscription via a new exposed field, rather than opening a second one.
- **`source`/`op` still not decoded**, matching the existing payload-stays-thin rule
  ([realtime-is-a-nudge-to-a-per-user-inbox](../../kb/entries/realtime-is-a-nudge-to-a-per-user-inbox.md)).
  `listsChannel.ts`'s `onChange` callback doesn't even carry them today, so `SharingScreen` re-reads
  its roster on *any* nudge for the open list — an item add or list rename, not just a membership
  change — one avoidable extra `fetchMembers` call rather than deeper plumbing to filter client-side.
  Considered and rejected as not worth the complexity for a cheap read.
- **`lastNudge` is a fresh object every time**, deliberately, including two nudges naming the same
  list back to back — so an effect keyed on it by reference always re-fires; no counter or timestamp
  needed for that, object identity alone does it.
- **The roster was not folded into `ListsContext`'s reducer state**, considered and explicitly
  rejected as the alternative design (surfaced by the user mid-review, comparing this to how
  item-checked sync already works "for free" through that shared state). Doing so would undo an
  earlier, still-current, documented decision to keep the roster uncached, unreplayed and
  outbox-bypassing specifically because it has to reflect the database live rather than through this
  app's "eventually consistent from cache" model elsewhere — see
  [writes-retry-from-an-outbox](../../kb/entries/writes-retry-from-an-outbox.md)'s "membership writes
  deliberately do not go through any of this." The thin `lastNudge` signal was chosen as the smaller,
  reversible change that bridges the gap without touching that boundary.

## Verification

- `npm run typecheck` — clean.
- `npm test` — 408/408 passing (22 suites), including the two new `ListsContext.test.tsx` cases and
  the three new `SharingScreen.test.tsx` cases.
- `npm run web`, driven end to end with Playwright, reading OTP codes from local Mailpit's HTTP API —
  and specifically designed to prove the *live* path rather than a coincidental refetch:
  - Two accounts signed up (`owner-realtime-test@example.com` owning a list, `reader-realtime-test@example.com`
    shared onto it as reader by name search). The owner opened the list's Sharing screen and **left the
    tab untouched** from that point on — no reload, no navigation, no further browser interaction.
  - The "leave" itself was triggered from a **separate `psql` connection**, not the browser: looked up
    the reader's `auth.users.id` and an already-live `auth.sessions` row from their earlier sign-in,
    then, inside one explicit transaction (`set local role authenticated` + `set_config('request.jwt.claims',
    ..., true)` — both transaction-scoped, so they must be in the same transaction as the call, a
    mistake hit and corrected on the first attempt: without `begin`/`commit` wrapping, psql's
    autocommit ran the claims-setting statement and the RPC call as two separate transactions, so the
    guard saw no claims and `leave_list` raised `'this device has been signed out'`), called
    `public.leave_list(<list_id>)` directly.
  - `psql` confirmed the `list_members` row was gone immediately after.
  - Without touching the browser at all since before the SQL call, a fresh accessibility snapshot of
    the still-open Sharing screen showed the roster with only the owner — the reader's row had
    disappeared with no reload, confirming the update arrived over the live realtime socket and not
    from any browser-side action.
  - Browser console: 0 errors (the same two pre-existing, unrelated warnings seen in every prior run).
  - Cleanup: both test accounts and the test list deleted directly via `psql` afterward.
