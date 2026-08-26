---
id: scope-boundaries
title: Scope — many named lists in; persistence, auth, sharing, and deletion deliberately out
type: constraint
status: current
tags: [scope, product]
sources: [ai/tasks/1/description-step-1.md, ai/tasks/1/implementation-log-step-1.md]
last_verified: 2026-08-26
related: [persistence-isolated-to-provider]
---

[ai/tasks/1/description-step-1.md](../../tasks/1/description-step-1.md) lists exactly three
capabilities — create a list, add items, mark/unmark items done — and puts **authentication /
authorization, persistence, and sharing out of scope**.

**"The user can create a list" means *many* named lists, not one standing list.** The description is
singular and genuinely ambiguous; step 1 put the question to the user and the answer was many. That
reading is why there are two screens (`Lists` → `ListDetail`) and why the app depends on React
Navigation at all — a single-list app needs neither. Treat it as settled: do not "simplify" the
product back to one list, and do not re-litigate the ambiguity from the description alone.

**Deleting lists and items was deliberately not built.** It is absent from the description, so it
was left out on purpose; it is not an oversight waiting to be fixed.

State lives in memory and **resets on reload**. That is intended, not a bug to report.

**What to do:** do not add any of these speculatively, and do not treat their absence as a gap worth
flagging in a review. If a task step genuinely needs one, it arrives through a new
`ai/tasks/<n>/description-step-<n>.md`, and this entry gets updated at that point.

No `verify:` command — scope is a judgment fact. Re-read it whenever a new task description lands.
