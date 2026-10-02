---
description: Query or curate this project's knowledgebase in ai/kb/. Use `ask <topic>` before stating anything about this project's conventions, constraints, gotchas, or scope that the auto-loaded ai/kb/INDEX.md doesn't already cover — the index is a curated shortlist and `ask` searches every entry, including the ones it omits. Also runs the end-of-step deposit pass (`deposit <n>`) and the staleness audit (`audit`).
argument-hint: deposit <n> | audit | ask <topic>
allowed-tools: Read, Write, Grep, Glob, Bash(npm run kb:audit), Task, Agent
---

Route on `$ARGUMENTS`:

**`deposit <n>`** — one planner, then small worker groups, under the charter's curation rule 5. Do
not curate the KB yourself: the `librarian` and `librarian-worker` agents are the only writers to
`ai/kb/entries/`. Their output is not shown to the user otherwise, so you relay it.

1. **Plan.** Spawn the `librarian` subagent with: "Plan the deposit for task step `<n>`. Follow
   your charter and `ai/kb/CHARTER.md`." plus the implementation log path, and nothing else. **Do
   not also point it at the step's suggestion document**: the log records where the shipped code
   diverged from the proposal, so naming both makes it read hundreds of lines twice and reconcile
   two accounts of the same work.

   If its report says `Mode: done`, the step was small and the planner did the work itself: relay
   the report verbatim and stop.
2. **Save the plan.** On `Mode: groups`, write the planner's report verbatim to
   `librarian-plan-step-<n>.md` in your scratchpad directory, before spawning anything. A resume
   reads it from there rather than from anyone's memory.
3. **Risky groups.** Spawn one `librarian-worker` per `R` group, **all in one message**. Hand each
   only:
   - its group's heading and lines from the work list, quoted facts included;
   - the paths of its entries, `ai/kb/entries/<slug>.md`;
   - its `diff:` command;
   - "Read `ai/kb/CHARTER.md` first."

   Not the log, the task description, or any entry outside the group.
4. **Review-on-touch groups.** When every risky worker has returned, spawn one `librarian-worker`
   per `T` group, all in one message, handed the same way. The risky half lands first, so a run
   that dies here has already fixed every entry that actively misleads.
5. **Close.**
   - Run `npm run kb:audit`.
   - Grep `last_verified:` across the work list's entries: each one a worker did not flag must now
     carry today's date. Name any that does not.
   - Relay the planner's summary, then each worker's report, **verbatim**, then the audit result,
     the flagged entries, and any entry still owed.

**Resuming.** If a worker dies, re-spawn a `librarian-worker` for its group alone, from the saved
plan. The entries in that group whose `last_verified` is already today are done; tell the worker to
skip them.

**`audit`** — run `npm run kb:audit` and summarize. For any failure, say whether the *fact* changed
or the *check* was wrong. Offer to spawn the librarian to fix the entries; do not edit them from
here, and never edit project code to make a check pass.

**`ask <topic>`** — answer inline, no subagent.

**Search `ai/kb/entries/` itself, not `INDEX.md`.** The index is a curated shortlist, not the
search space: entries demoted under the charter's budget rules keep `status: current` and stay
true, but carry `indexed: false` and appear in no index line. Searching the index alone would
report "the KB doesn't cover that" about facts the KB holds.

So: grep `ai/kb/entries/` for `<topic>` across titles, `tags`, and body text, then open the two or
three best matches and answer from them. Read `ai/kb/INDEX.md` afterwards, to group your answer the
way the index groups things and to see what the project considers front-of-mind.

Then:

- Quote the relevant lines and name the entry files, so the user can check you.
- Flag any entry whose `last_verified` is over 90 days old and that carries no `verify:` command.
- **If a match carries `indexed: false`, say so.** A demoted entry that answers a real question is
  evidence it was demoted too early — worth telling the user, and worth a promotion at the next
  deposit pass.
- **If nothing matches, that is the expected case, not a finding.** The KB holds only what careful
  reading of the code would not reveal, so most questions miss. What follows depends on who asked.
  Mid-task, on your own behalf: note that the KB doesn't constrain this, then read the code and
  carry on — never stall on a miss. For a user's direct question: say plainly that the KB doesn't
  cover it *before* answering from the code, so the miss stays visible rather than papered over.
- Propose an entry only when the code would actively **mislead** whoever reads it next. That is the
  admission test in [ai/kb/CHARTER.md](../../ai/kb/CHARTER.md); a topic merely being absent does
  not meet it, and treating every miss as a gap is how the KB inflates.

**No arguments** — list what the KB covers, from `ai/kb/entries/` rather than from the index, for
the same reason. Group it as `ai/kb/INDEX.md` groups things, list any `indexed: false` entries
separately under "demoted (still true, not in the index)", then show the three usages above.
