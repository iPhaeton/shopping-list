---
description: Curate or query the project knowledgebase in ai/kb/
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

**`ask <topic>`** — answer inline, no subagent. Read `ai/kb/INDEX.md`, open the two or three
entries that bear on `<topic>`, and answer from them. Quote the relevant lines and name the entry
files you used so the user can check you. Flag any entry whose `last_verified` is over 90 days old
and that carries no `verify:` command. If nothing in the KB covers the topic, say so plainly rather
than answering from the code — an uncovered topic is a gap worth knowing about, and may be worth an
entry after the next task step.

**No arguments** — read `ai/kb/INDEX.md` and list what the KB currently covers, grouped as the index
groups it, then show the three usages above.
