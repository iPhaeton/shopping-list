# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md
@ai/kb/INDEX.md

## Commands

```bash
npm run web                       # Expo dev server in a browser at http://localhost:8081
npm start                         # dev server + QR code for Expo Go on a physical device
npm test                          # jest (jest-expo preset)
npm run typecheck                 # tsc --noEmit
npm run kb:audit                  # check every ai/kb entry still holds
npx jest src/state/listsReducer.test.ts        # one suite
npx jest -t 'trims the name'                   # one test by name
```

## Working rules

- **`ai/kb/` holds what reading the code carefully would *not* tell you** — rationale, environment
  constraints, scope boundaries, gotchas that already cost a debugging cycle. It's a small set of
  exceptions, not a description of the system: most questions have no entry, and the code is the
  answer. The index above is loaded every session — open the two or three entries bearing on your
  task; if none cover it, run `/librarian ask <topic>`, which searches every entry rather than the
  shortlist. A miss there means nothing in the KB constrains you — read the code and proceed.
  Don't grep the KB yourself, and don't restate its facts here: a fact in two places is a fact
  that will drift.
- **`ai/tasks/*/implementation-log-step-*.md` are historical records, not current truth.** Each is
  accurate as of the day it was written and is never edited. Read them for provenance — *why* was
  this done — never to learn the current stack or conventions. The step-1 log's version table is
  already four versions out of date, which is exactly why this rule exists.
- **After finishing a task step:** write `ai/tasks/<n>/implementation-log-step-<n>.md` beside the
  description, covering decisions, problems hit, and how the result was verified. Then run
  `/librarian deposit <n>` to curate what the step taught into the KB.
- **Only the librarian writes to `ai/kb/entries/` and `ai/kb/INDEX.md`.** Hand it candidate facts;
  don't append to the KB yourself. The rules it curates by are in
  [ai/kb/CHARTER.md](ai/kb/CHARTER.md).
- **Write for whoever is reading.** In chat, explain things in simple words — assume a technical
  person who doesn't know this code and hasn't read the documentation. When you refer to
  something in the code, always say where it lives — the component, class, or function it
  comes from. Files under `ai/tasks/` have a different reader: other agents. Write those for
  precision and density, not for a human's comfort.
