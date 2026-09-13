# Implementation log — step 4: a write enqueued mid-fetch was stranded until an unrelated trigger

**Date:** 2026-09-13. Description: [description-step-4.md](description-step-4.md). Plan: the
approved plan-mode file (not checked in).

The report: checking an item while its list is being re-read after a realtime notification never
sends the write, the "N changes will sync" banner never clears, and other users never see the check.
Root cause traced to `useOutbox.ts`'s `flush()` guard — `if (flushing.current || fetching.current ||
stuck.current) return;`. `flushing`/`stuck` are self-healing (something already running picks a
turned-away write back up); `fetching` was not — `hydrate`/`hydrateLists`'s `finally` only reset
`fetching.current`, and nothing then called `flush()` again. `enqueueOp`'s own call to `flush()`
during a nudge-triggered `hydrateLists` bailed silently, and the write sat in the outbox until a
foreground/online event or another enqueue happened to fire `flush()` while no fetch was running —
which, in one sustained session, may never happen.

## What was built

| File | |
|---|---|
| `src/state/useHydration.ts` | new `flushRef: MutableRefObject<(() => Promise<void>) \| null>` param; `hydrate`'s and `hydrateLists`'s `finally` blocks each gained `if (!retry.current) void flushRef.current?.();` after resetting `fetching.current`, replicating `enqueueOp`'s own backoff guard. |
| `src/state/ListsContext.tsx` | new `flushRef` alongside `listsRef`, threaded into `useHydration`; a `useEffect(() => { flushRef.current = flush; }, [flush])` right after `useOutbox` produces `flush`. |
| `ListsContext.test.tsx` | two new tests after the existing "remembers a nudge that arrived while a write was in flight" — the mirror case, fetch-first-then-write, once via a named nudge (`hydrateLists`) and once via a resubscribe (`hydrate`). Net test count 326 (was 324). |

Untouched: `useOutbox.ts`, `useBlockedWrites.ts`, `useListWrites.ts`, every migration — this was a
client-only race with no server-visible symptom beyond "the write never arrived."

## Decisions

**A ref bridge, not a restructure.** `useHydration()` runs before `useOutbox()`, and `flush` is
built *from* `hydrate` — so `hydrate` cannot close over `flush` directly without a dependency cycle.
`flushRef` uses exactly the pattern `listsRef` already establishes in this same file: a ref the
parent owns, kept current with a mirroring `useEffect`, read by the other hook through
`.current`. No hook got reordered or merged.

**This calls `flush`, not `drainDirty`, from `hydrate`'s/`hydrateLists`'s `finally` — a different
call than step 3's log explicitly ruled out, and safe for a different reason.** Step 3's log
rejected having `hydrate`/`hydrateLists` drain `dirty` themselves, for two reasons: a `useCallback`
cycle (`drainDirty` → `runDirty` → `hydrateLists` → `drainDirty`), and a race with
`discardBlocked`/`restoreBlocked`'s `hydrate().then(() => flush())` chains — `drainDirty` re-enters
`hydrate`/`hydrateLists`, which sets `fetching.current` back to `true` *before* that `.then` resumes,
so the chain's own `flush()` call would wrongly bail with the write still stranded. Calling `flush`
itself has neither property: `flush` is read through a ref (no closure, no cycle), and `flush` never
touches `fetching.current` — only `flushing.current`. When a `.then(() => flush())` chain's own call
sees `flushing.current === true`, that is because the finally-triggered call is *already sending the
same write*, not because it is blocked from ever being sent — no strand results.

**Guarded on `retry.current`, not called unconditionally.** `flush()`'s own top-level guard does not
check `retry.current` — only `enqueueOp`'s call site does, deliberately, per its existing comment
("another write is not evidence the network came back"). An unconditional
`finally { fetching.current = false; void flushRef.current(); }` would bypass that: a nudge-triggered
fetch completing while a backoff timer is pending would fire an out-of-schedule retry. Replicated
`enqueueOp`'s exact guard instead.

**`useBlockedWrites.ts` left unchanged.** `discardBlocked`'s `await hydrate(); return flush();` is
the one place that already hand-solved this exact hazard for its own call site. It becomes a
redundant no-op once `hydrate`'s own `finally` does the real send, but redundant is not wrong — this
is a bug fix, not a dedup pass, and the existing comment there stays accurate (it never claimed to be
the only thing preventing the strand).

**No guard needed against the two internal `hydrate()` calls inside `flush()` itself** (the
tombstone and permanent-failure rollback paths). Both run while the *outer* `flushing.current` is
already `true` (set at the top of `run()`, held until its own `finally`), so the inner call's
finally-triggered `flushRef.current()` hits that guard immediately and no-ops. Traced against the
actual guard ordering in `useOutbox.ts`, not assumed.

## Problems hit

None — the fix landed and all tests passed on the first attempt after typecheck was clean.

## Verified

- `npm run typecheck` — clean.
- New tests confirmed to fail on the pre-fix code (reverted the two implementation files via
  `git stash`, re-ran with `-t "sends a write enqueued while"`): both fail with
  `api.setItemDone` never called, reproducing the reported symptom exactly. Passed once the fix was
  restored.
- Full suite: 324 → 326 tests, all passing.
- `npm run kb:audit`: 0 errors. The two entries this change touches
  (`first-fetch-replaces-list-state`, `realtime-is-a-nudge-to-a-per-user-inbox`) still pass their
  mechanical `verify:` checks; both are flagged "ground moved" (expected — their `sources` list the
  files this step edited) for the librarian to re-verify and re-date.

## Not re-verified this session

No two-device or two-browser run confirming another account actually sees the check — as with step
3, every assertion goes through the mocked `../lib/listsApi` seam
([supabase-client-module-boundary](../../kb/entries/supabase-client-module-boundary.md)). This step
touches no server code and no wire format, so the risk profile is the same as step 3's: lower than a
schema change, but the end-to-end propagation itself is unverified beyond the mocked proof.

## KB impact — handed to the librarian, not edited here

- [first-fetch-replaces-list-state](../../kb/entries/first-fetch-replaces-list-state.md) — its
  "three guarded doors onto `hydrate`/`hydrateLists`" paragraph is now incomplete: `hydrate` and
  `hydrateLists` themselves call `flush` (via `flushRef`) from their own `finally`, guarded on
  `retry.current` alone. Also worth stating alongside the existing "self-draining deliberately does
  not live inside `hydrate`'s or `hydrateLists`'s own `finally`" paragraph, since this change adds a
  *different* call (`flush`, not `drainDirty`) to those same `finally` blocks — a future reader
  should not conflate the two or assume this change contradicts that one.
- [writes-retry-from-an-outbox](../../kb/entries/writes-retry-from-an-outbox.md) — its description of
  `flush`'s guard and of `enqueueOp`'s `retry.current` check is still accurate, but a fourth caller of
  `flush` now exists (`hydrate`/`hydrateLists`'s `finally`, via `flushRef`) worth naming alongside
  `enqueueOp`, the backoff timer, and the blocked-write resolution.

## What this does not solve

- **Still no attempt cap and no change to backoff semantics** — this only closes the gap where
  nothing retried at all; a write already in backoff still waits out its scheduled delay.
- **The pre-existing, documented `fetching`/`flushing` race between `refresh()`/blocked-write calls
  and a nudge-driven fetch already in flight** (both call `hydrate`/`hydrateLists` without checking
  the other's guard) is unchanged — this step does not touch that trade-off, only the one-directional
  gap where a completed fetch never told a stranded write to try again.
