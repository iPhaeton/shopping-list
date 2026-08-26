# KB Charter

Rules for the knowledgebase under `ai/kb/`. The librarian reads this file before curating.
It is **not** auto-loaded into every session — only `ai/kb/INDEX.md` is.

## Why this exists

Three layers hold project knowledge, with three different lifetimes:

| layer | path | lifetime |
|---|---|---|
| Journal | `ai/tasks/<n>/implementation-log-step-<n>.md` | append-only, immutable, provenance |
| KB | `ai/kb/entries/<slug>.md` | mutable, deduped, one fact per file |
| Index | `ai/kb/INDEX.md` | one hook line per entry, auto-loaded |

A journal entry is a correct record of the day it was written, forever. It must therefore never be
the thing an agent reads to learn *current* truth. The step-1 log records Expo SDK 57.0.16; commit
`4d55c18` moved the project to 54 and nothing swept the knowledge behind it. That log was not
wrong — it was true on 2026-08-25. The KB is what is true *now*.

## The admission test

> **Would a competent agent, reading this code carefully, get this wrong without being told?**

If the code answers it, the KB stays silent. No entry for "the reducer is pure" — that is visible in
[src/state/listsReducer.ts](../../src/state/listsReducer.ts). Yes to *why* ids are minted outside
it, because no amount of reading reveals that.

What earns an entry: rationale behind a non-obvious choice, environment constraints, scope
boundaries an agent would otherwise "helpfully" cross, and gotchas that already cost a debugging
cycle. What does not: anything restating structure, and anything true only of one conversation.

**Fact inflation is the failure mode.** When torn between adding a new entry and updating an
existing one, update.

## Entry format

```markdown
---
id: rntl-14-api-changes
title: RNTL 14 broke render/fireEvent and removed toHaveAccessibilityState
type: gotcha
status: current
tags: [testing, rntl]
sources: [ai/tasks/1/implementation-log-step-1.md, 6ef87a2]
last_verified: 2026-08-26
verify: grep -q '"@testing-library/react-native": "\^14' package.json
related: [queries-go-through-a11y-labels]
---

<the fact, then why it matters, then what to do about it>
```

Required: `id` (matches the filename), `title`, `type`, `status`, `last_verified` — plus
`superseded_by` whenever `status: superseded`, so a dead entry always names its replacement.
Optional: `tags`, `sources`, `verify`, `related`, `indexed`.

Every slug in `related:` and `superseded_by:` must name a real entry; the audit fails on a link
that points nowhere.

`type` is one of `convention`, `constraint`, `gotcha`, `decision`, `environment`, `reference`.
`status` is one of `current`, `superseded`, `retired`.

**Frontmatter values are read as the raw rest of the line** — the audit parser strips nothing, so
never put an inline `#` comment after a value. A `verify:` command containing `#`, `|`, or quotes is
fine exactly as you would type it into a shell.

## How each type is revised

| type | revised how |
|---|---|
| `decision` | the **decision itself** is never edited — a new entry supersedes it; the old one becomes `status: superseded` with `superseded_by`. Sharpening its `verify:`, `sources`, or wording is a normal in-place edit, since none of that changes what was decided |
| `environment` | overwritten in place when the machine changes |
| `gotcha` | `status: retired` once the dependency that caused it is gone |
| `convention` / `constraint` | edited in place; `verify:` asserts the invariant still holds |
| `reference` | overwritten; `verify:` pins the version it refers to |

Superseded and retired entries stay in git and stay on disk. They leave `INDEX.md`.

## Staying true

`verify:` is a shell command run from the repo root; **exit 0 means the fact still holds**. Prefer a
command that asserts the invariant rather than one that merely finds the file — `! grep -q
'useNavigation(' src/screens/*.tsx` is a real check; `test -f src/screens/ListsScreen.tsx` is not.

Facts that cannot be checked mechanically (rationale, scope) carry no `verify:`. They rely on
`last_verified` and on **review-on-touch**: when a task edits a file an entry names, re-read that
entry and either bump `last_verified` or fix it.

**Review-on-touch is enforced, not aspirational.** The audit reads the repo files each entry links
to — its *ground* — and warns when one has been committed to on a later day than `last_verified`,
or is dirty in the working tree right now. That makes `last_verified` load-bearing for every entry,
not just judgment facts: it is the date the audit measures drift against.

This warning is independent of `verify:` and fires alongside a passing check, because the two prove
different things. A check proves the invariant still holds; it says nothing about whether the
entry's prose still describes the code. An entry can be green and stale in the same breath —
[queries-go-through-a11y-labels](entries/queries-go-through-a11y-labels.md) would still pass while
`ListRow`'s label format changed underneath its explanation.

Answer a ground-moved warning by re-reading the entry against the file that moved, then correcting
the prose or bumping `last_verified`. Links into `ai/kb/` itself are not treated as ground —
entries cite each other constantly and every curation pass would light them all up.

Run `npm run kb:audit` to execute every check.

## Curation rules

1. **The librarian is the only writer to `ai/kb/entries/` and `ai/kb/INDEX.md`.** Other agents
   deposit candidate facts by handing them to the librarian; they do not write here. If every agent
   may append, the KB becomes the sprawl it was built to replace.
2. **The librarian never edits `ai/tasks/**`.** Journals are immutable, including their outdated
   parts.
3. Curation is **task-scoped**: it runs at the end of an `ai/tasks/<n>` step, after the
   implementation log is written.
4. For each candidate fact, decide exactly one of: **new** / **update** an existing entry /
   **contradicts** an existing entry (write the new truth, mark the loser superseded, link both) /
   **drop** (fails the admission test — say why).

## Budgets

`INDEX.md` holds at most **25** lines. An entry that nothing has retrieved or referenced across
**5** task steps is demoted out of the index; its file stays in git and can be promoted back.
When the index is full, demote before adding.

A demoted entry stays `status: current` — it is still true, just not worth everyone's context — and
gains `indexed: false` so the audit knows its absence from the index is deliberate rather than a
mistake. Promoting it back means deleting that line and adding it to `INDEX.md`.

Demotion costs less than it sounds. A demoted entry stays **searchable** — `/librarian ask`
greps every entry rather than the index, the deposit pass reads them all, and the audit keeps
running its `verify:`. What it loses is **passive** discovery: it no longer rides into every
session on `INDEX.md`, so nothing puts it in front of an agent who did not think to ask.

That is the cost worth weighing, because this KB exists for facts an agent would get wrong
*without being told* — exactly the facts nobody thinks to search for. An inbound `related:` link
buys some of it back: an agent reading a neighbouring entry follows the link and finds the fact it
did not know to want. The audit warns when a demoted entry has no inbound link. Answer that warning
by adding the link from whichever entry genuinely relates — not by reaching for `retired`, which
means the fact stopped being true, not that it stopped being popular.
