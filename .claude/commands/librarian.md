---
description: Query or curate this project's knowledgebase in ai/kb/. Use `ask <topic>` before stating anything about this project's conventions, constraints, gotchas, or scope that the auto-loaded ai/kb/INDEX.md doesn't already cover — the index is a curated shortlist and `ask` searches every entry, including the ones it omits. Also runs the end-of-step deposit pass (`deposit <n>`) and the staleness audit (`audit`).
argument-hint: deposit <n> | audit | ask <topic>
allowed-tools: Read, Grep, Glob, Bash(npm run kb:audit), Task
---

Route on `$ARGUMENTS`:

**`deposit <n>`** — spawn the `librarian` subagent with: "Run a deposit pass for task step `<n>`.
Follow your charter and `ai/kb/CHARTER.md`." Then relay its report to the user verbatim — the
subagent's output is not shown to them otherwise. Do not curate the KB yourself; the librarian is
the only writer to `ai/kb/entries/`.

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
