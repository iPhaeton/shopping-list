# Step 7 — The deposit: the whole task into the KB at once

The user requests, decisions D1–D14 and the step plan are in
[description-step-1.md](description-step-1.md). This step needs steps 1–6, so it runs last.

## What this step delivers

The KB learns what task 29 taught, in one `/librarian deposit 29` over all six logs. Request 9 asked for
this: steps 1–6 end with their logs only, and this step deposits for them. For this task, that overrides
CLAUDE.md's deposit after every step.

Nothing else is built. No code, catalog, migration or log of steps 1–6 changes.

## Before starting

- `ls ai/tasks/29-languages/implementation-log-step-*.md` lists six logs. If one is missing, stop and
  ask the user whether to deposit without that step. Never write a stand-in log.
- Each log should end with a **KB candidates** table (steps 1–6's "After this step" asks for it). The
  planner reads logs, never descriptions, so a KB impact row that no log carries reaches the KB only
  through the closing check below.
- Run `git status --short` and keep the output. The closing check compares against it.

## Running the deposit

Follow the `/librarian deposit 29` skill as written, with these three changes. The skill was written for
one step's log.

1. **The planner's hand-off.** Give it exactly this, and nothing else (not the descriptions, as the skill
   says, and not this file):
   - "Plan the deposit for task 29, steps 1–6. Follow your charter and `ai/kb/CHARTER.md`."
   - The six log paths, `ai/tasks/29-languages/implementation-log-step-1.md` through `-step-6.md`.
   - The diff base, `55432c1` ("i18n tasks"). It is the last commit before step 1's work, so
     `git diff --stat 55432c1` covers the whole task, committed or not.
   - "Where two logs disagree, the later step's log is current, because later steps rework earlier ones.
     For example, step 1's log says every non-English catalog compiles to English, and step 4 fills
     them."
2. **Expect `Mode: groups`.** Six steps' candidates will not fit one group. The skill's rules for saving
   the plan and resuming a worker that died apply unchanged.
3. **One extra closing check**, after the skill's own:
   - For every row of the six descriptions' **KB impact** tables, find its entry or candidate in the
     planner's work list, either as an action or as a recorded `drop`.
   - Name every row that is in neither. The user decides whether it is owed.

## Verification

- `npm run kb:audit` passes, or each failure is named with whether the fact or the check is wrong.
- Every entry in the work list that no worker flagged has today's `last_verified`.
- The planner's summary and each worker's report are relayed verbatim.
- Compared with the `git status --short` kept before starting, nothing outside `ai/kb/` changed, apart
  from this step's log.

## After this step

Write `implementation-log-step-7.md` beside this file. It covers:
- the plan's groups;
- the entries added, updated and superseded;
- the candidates dropped, each with the planner's reason;
- the audit result;
- the KB impact rows the extra check found unhandled.

There is no further deposit, because this step is the deposit.
