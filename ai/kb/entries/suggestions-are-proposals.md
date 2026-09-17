---
id: suggestions-are-proposals
title: ai/suggestions/*.md are proposals, not scope — and eight of their designs have turned out wrong
type: constraint
status: current
tags: [scope, process, suggestions]
sources: [ai/tasks/2/implementation-log-step-2.md, ai/tasks/3/implementation-log-step-1.md, ai/tasks/5-supabase-cloud/implementation-log-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-1.md, ai/tasks/7-list-sharing/implementation-log-step-2.md, ai/tasks/8-realtime/implementation-log-step-1.md, ai/tasks/9-deletion/implementation-log-step-1.md, ai/suggestions/social-sign-in.md, ai/suggestions/otp-biometric-auth.md]
last_verified: 2026-09-17
verify: grep -q 'deleted_at < cutoff' ai/suggestions/deletion.md && grep -q 'deleted_at <= cutoff' supabase/migrations/20260910000000_deletion.sql && grep -q 'coalesce(new.list_id, old.list_id)' ai/suggestions/realtime-sync.md && grep -q 'tg_op' supabase/migrations/20260909000000_realtime.sql && grep -q 'pickTarget()' src/lib/supabase.ts
related: [scope-boundaries, supabase-target-picked-at-runtime, read-rooted-at-list-members, select-policy-gates-update-and-delete, list-data-scoped-by-rls, realtime-is-a-nudge-to-a-per-user-inbox, deletion-is-a-tombstone, writes-retry-from-an-outbox, native-build-toolchain]
indexed: false
---

The documents in `ai/suggestions/` read like plans because they are — full schema, design and staging
for list persistence, biometric unlock, a cloud project, sharing, realtime and deletion. **None of it
is approved.** A suggestion becomes scope only when it arrives as an
`ai/tasks/<n>/description-step-<n>.md`, and **a document being *partly* implemented does not promote
the rest of it** ([scope-boundaries](scope-boundaries.md)). What has been promoted, and by which step:

| document | promoted | still only a proposal |
|---|---|---|
| `otp-biometric-auth.md` | step 2 — the auth half | biometric unlock; it also needs a native dev build, allowed but not set up |
| `supabase-persistence.md` | step 3 — staging step 1 | everything else; its `is_list_member` helper was rejected outright when sharing arrived |
| `production-supabase.md` | step 5 — project/schema/config; step 6 — §4 phase 1, custom SMTP | §4 phase 2, a verified sending domain |
| `list-sharing.md` | step 7 step 1 — the SQL | — |
| `list-sharing-ui.md` | step 7 step 2 — all of it, covering that document's staging steps 2 and 3 | — |
| `realtime-sync.md` | step 8 — staging steps 1 and 2, plus idempotent replay from its optional step 3 | echo suppression and the `SyncBanner`, offered to the user and declined |
| `deletion.md` | step 9 — all six staging steps at once, the only time a suggestion has landed complete in one step | — |

**A suggestion can also be plain wrong, and eight catalogued errors across four documents say how
often.** None is a typo: each reads correctly and fails only when run.

- `list-sharing.md`, three — its "owners remove members" policy cannot remove anyone
  ([select-policy-gates-update-and-delete](select-policy-gates-update-and-delete.md)); its last-owner
  trigger would have aborted account deletion
  ([list-data-scoped-by-rls](list-data-scoped-by-rls.md)); and its claim that `set search_path = ''`
  defeats the design was measured and does not hold
  ([read-rooted-at-list-members](read-rooted-at-list-members.md)).
- `list-sharing-ui.md`, one — it contradicted *itself*: both header buttons owner-only, and the
  sharing screen reachable by every member, which cannot both be true when the button is the only way
  in. Caught while scripting the browser run; `Share list` renders for every member and only
  `Rename list` is gated.
- `realtime-sync.md`, one, and the instructive one because it is a **warning** rather than a design —
  it asserts that `coalesce(new.list_id, old.list_id)` raises `record "new" is not assigned yet` on a
  DELETE and breaks every un-share. Measured on PostgreSQL 17, a row-level DELETE trigger reads `NEW`
  as null and does not raise, so the warning was false; the shipped migration branches on `tg_op`
  anyway, for the different and real reason that no column is shared by all three tables. A
  suggestion's *cautions* deserve the same measurement its designs do, and a false one that survives
  into a code comment as fact is the expensive version of this mistake.
- `deletion.md`, three, the first worth learning from — its `set_item_done` tested "is the target in
  the bin" *before* the permission check, which would tell a stranger holding an item id that a row
  they cannot see exists and is deleted (the shipped function raises `42501` first); its
  `purge_deleted` used `deleted_at < cutoff`, which collects nothing at a zero-second interval because
  `now()` is frozen per transaction, making the one call that proves the function works a silent
  no-op (shipped: `<=`); and its conflict prompt would have been announced before the fetch that tells
  it what to offer.

`deletion.md` also got something right that nothing else would have caught: it predicted this KB's own
audit would go green over a claim that had stopped being true, and it had —
[writes-retry-from-an-outbox](writes-retry-from-an-outbox.md) held a case-sensitive grep that let
`'item/setDeleted'` through.

**And a suggestion can be *overruled* by the very step that implements the rest of it.**
`production-supabase.md`'s "Environment selection" section argued against runtime target-switching;
step 5 did it anyway, because the task made the phone a target and removed the section's premise
([supabase-target-picked-at-runtime](supabase-target-picked-at-runtime.md)). So a document is not
merely un-promoted until a task lands — parts of it can be wrong afterwards.

**What to do:** read a suggestion for its reasoning, never for its authority. By default the
documents are not edited — not to record that they landed, not to record that they were wrong — so
the KB and the migrations are the only current account of either, and the eight errors above still
stand uncorrected in their files.

**The one exception, since 2026-09-17: the user may direct a revision.** Do not revise on your own
judgement. When the user does direct one, reuse the shape the first revisions used: a dated
`**Revised <date> — <one line on what changed>**` paragraph directly under the document's
`**Date:**` line, plus an inline *(revised <date>: …)* marker on each corrected passage, with the
original wording left readable so the document still shows what it said on the day it was written.
Two documents have been revised so far, both on 2026-09-17 and both only on the toolchain premise
that [native-build-toolchain](native-build-toolchain.md) lifted —
[social-sign-in.md](../../suggestions/social-sign-in.md) and
[otp-biometric-auth.md](../../suggestions/otp-biometric-auth.md). No design content changed in either.

Before building from one, check that a task description promoted it, then check its design against
the entries linked above, and against itself.

The `verify:` command asserts three of the divergences above still stand in both directions: the
purge comparison (`<` in the document, `<=` in the migration), the false DELETE-trigger warning
against the shipped `tg_op` branch, and runtime target selection against the section that argued
against it. It fails if a document is quietly corrected or if the shipped code drifts back.
