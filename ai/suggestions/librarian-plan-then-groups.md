# Suggestion — deposit the KB as one plan and small worker groups, not two full passes

**Status:** adopted 2026-10-02, the same day, by editing the files under
[Files adoption would change](#files-adoption-would-change) and adding
[`.claude/agents/librarian-worker.md`](../../.claude/agents/librarian-worker.md). The open
decisions were settled as: no Sonnet anywhere, groups of ~6, reports relayed verbatim. This is about
the KB tooling, not the app, so [scope-boundaries](../kb/entries/scope-boundaries.md) is unaffected,
and no entry under `ai/kb/entries/` changed.

**Date:** 2026-10-02

**Sourced from the user**, 2026-10-02, after task 24 step 2's two-pass deposit. Pass 2 alone used
~11% of the session's usage; by the user's estimate, both passes together take at least ~20%.

## Current state

- **Flow.** [`.claude/commands/librarian.md`](../../.claude/commands/librarian.md) spawns the
  `librarian` agent ([`.claude/agents/librarian.md`](../../.claude/agents/librarian.md)).
  - The agent runs with `model: inherit` and the tools Read/Write/Edit/Bash/Grep/Glob.
  - It has **no Agent tool**, so it cannot fan out. Only the calling session can.
- **Two passes.** [CHARTER.md](../kb/CHARTER.md) rule 5 splits a step that flags more than a third
  of entries "ground moved" into two invocations:
  - pass 1: failing `verify:` checks, contradictions, new entries;
  - pass 2: review-on-touch of flagged entries whose checks pass.

  Each invocation is one agent that loads everything it needs, then makes every edit with that load
  in context.

### Measured on task 24 step 2

Source: the two subagent transcripts of session `c5120e6e-…`. "Context tokens" means
`input_tokens + cache_read_input_tokens + cache_creation_input_tokens`, summed over distinct
assistant `message.id`s.

Both passes ran Opus 5.5 at effort `xhigh`. Neither the agent file nor the spawn sets effort, so
it came from `effortLevel` in the user's `~/.claude/settings.json`.

| | model calls | context peak | context tokens | spent after loading finished |
|---|---|---|---|---|
| pass 1 | 53 | ~201K | ~7.6M | calls 10–52: ~7.0M (92%) |
| pass 2 | 44 | ~168K | ~4.7M | calls 20–43: ~3.2M (68%) |
| both | 97 | | ~12.3M | |

**Context is almost all cache reads:** ~11.8M of the ~12.3M (pass 1 7.41M, pass 2 4.40M). Cache
writes, at the 5-minute TTL, are ~0.52M. Uncached input is ~200 tokens.

**Output was not measured.** The transcripts log `output_tokens` at the start of each streamed
response, not its end: a 9,076-character edit is recorded as 8 tokens.
- Visible output (tool inputs plus text) is ~65K characters in pass 1 and ~34K in pass 2, roughly
  25K tokens together.
- Thinking cannot be measured from the transcripts: its blocks are stored with empty text.

Pass 1 edited 8 entries and wrote 1 (`keyset-paging-in-the-order-shown`). Pass 2 reviewed 18
entries, edited 5 and only re-dated 13.

**Cost ≈ calls × context.** Every call re-sends everything loaded so far.
- Loading is cheap: pass 1 reached 110K tokens by call 9 for ~0.6M.
- The bill is the many small calls that come after, each carrying the whole load.

**What the post-load calls were:**
- Pass 1, 43 calls:
  - ~15 separate edit scripts, 2–3 per entry for `deletion-is-a-tombstone`, `scope-boundaries` and
    `supabase-local-stack`;
  - ~7 re-reads of a passage just edited;
  - ~10 code greps;
  - 4 negative tests of new `verify:` commands;
  - 2 audits.

  The negative tests run against scratchpad copies of the source, never the repo. That is correct,
  and keep it.
- Pass 2, 24 calls: 5 entries edited, several Edit calls each, with a python line count after each
  entry. Then 13 date bumps and the audit.

**Loaded twice.** Both passes loaded the implementation log, the charter, ~56K characters of
whole-file diffs, and `first-fetch-replaces-list-state` plus
`realtime-is-a-nudge-to-a-per-user-inbox`. The two-pass split pays the load once per pass.

**New facts deferred.** Pass 1 deferred two new facts to pass 2:
- the `loadedRows`/`stampedLists` extra bin page;
- `withinLoadedRange`'s bin comparison.

So the cheap pass did new-fact work. The `first-fetch-replaces-list-state` edit took ~8 calls,
including a trim back under 120 lines.

**Flags concentrate on hot files.** Of pass 2's 18 flagged entries:
- [listsApi.ts](../../src/lib/listsApi.ts) flagged 9;
- `ListsScreen.tsx` and `ListsContext.tsx` flagged 3 each.

Many entries link `listsApi.ts` for reference rather than as the thing they describe.

## 1. Planner — one librarian, Opus

One invocation that decides everything and edits nothing, unless the work is small (below). Effort
`high`, set in its agent file ([§5](#5-model-and-effort)).

**Reads:**
- `npm run kb:audit`, non-`ok` lines only;
- `ai/kb/INDEX.md`;
- every entry's `title:` (one grep, not full frontmatter);
- the step's implementation log;
- `git diff --stat` for the step;
- in full, only:
  - entries with a failing `verify:`;
  - entries the log's Decisions / Problems hit / Follow-ups contradict;
  - the entries a new fact would update.

**Does not read:**
- `description-step-<n>.md` — the log records what was actually built;
- whole-file diffs;
- review-on-touch entries.

**Writes a work list, then stops.** One line per entry:
- slug, or the new slug;
- action: `fix-check` | `contradiction` | `new` | `update-with-fact` | `review-on-touch`;
- for anything but review-on-touch, the log fact to use, quoted with its log heading;
- the diff files that bear on it.

**Groups the work list:**
- At most ~6 entries per group; each entry in exactly one group.
- `INDEX.md` is owned by exactly one group, the one holding `new` or `contradiction` work. Two
  workers never edit the same file.
- **Risky groups** hold every `fix-check`, `contradiction`, `new` and `update-with-fact`. All
  new-fact work lives here, never in a review-on-touch group, so the deferral above cannot recur.
- **Review-on-touch groups** are formed around a shared ground file, so a group's diff is one
  `git diff -- <files>` that serves every entry in it.

**Small step.** If the whole work list fits one group, the planner does the work itself in the same
invocation, which is today's single pass. This replaces the charter's "do not split a narrow step"
and its ">⅓ flagged" threshold.

## 2. Workers — one fresh librarian per group

**Input from the session:**
- the group's slice of the work list, quoted facts included;
- the entry paths;
- the diff command limited to the group's files;
- the instruction to read the charter.

Not the log, the description, or entries outside the group.

**Habits** (cheap on their own, adoptable without the rest):
- Read all of the group's entries in one call.
- Make every change to one entry in one call: one write, or all its Edits in one message.
- Never re-read a passage after editing it. Edit fails loudly if the match is wrong.
- Negative-test each new or changed `verify:` on scratchpad copies, as pass 1 does now.
- Check the 120-line budget and run `npm run kb:audit` **once**, at the end, not after each entry.
- Report per entry: edited (what and why), re-dated only, or flagged back to the session.

**Model and effort:** Opus at effort `medium`, from a separate agent file
([§5](#5-model-and-effort)). Whether any group runs on Sonnet is decision 1 below.

## 3. Orchestration — the calling session, via the skill

1. Spawn the planner. Save its work list to the session scratchpad, so a resume does not depend on
   anyone's memory.
2. Spawn all risky groups in **one** message.
3. When they finish, spawn all review-on-touch groups in one message. The risky half still lands
   first, which is the part of rule 5 worth keeping.
4. Close:
   - run `npm run kb:audit`;
   - confirm every entry on the work list was edited or had `last_verified` bumped;
   - relay the planner's summary and each worker's report verbatim.

**Resume.** A worker that dies is re-run from the saved work list for its group only. The audit's
`last_verified` dates show which of its entries are still owed.

**Session cost.** Every completion costs the calling session one call at the session's own context
size. Fewer, larger groups keep that down, which is one reason the group size is ~6 and not 1.

## 4. Charter changes

- **Rule 5.** Plan-then-groups replaces the two-pass table.
  - The rationale stays and gets stronger: a pass that dies now loses one group rather than half
    the step, and the riskiest work still lands first.
  - The worked example (step 9, killed mid-way) still applies.
- **Budgets.** The paragraph opens "every deposit pass reads every current entry before it may
  dedup against them".
  - That is already out of date: the agent file reads only the frontmatter of untouched entries.
  - Under this proposal the planner reads only titles.
  - Reword it so the budget argument rests on `/librarian ask` and on workers reading whole
    entries.

## 5. Model and effort

**Effort is the larger lever, the model the smaller one.** Both passes ran at `xhigh`, two levels
above Opus 5.5's own default of `medium`. Lower effort means less thinking, and also fewer, more
consolidated tool calls with less re-checking between them. The post-load calls under Current state
are that pattern, and cost ≈ calls × context.
- **Planner: `high`.** Triage and contradiction-finding are the judgment the work list rests on.
- **Workers: `medium`.** The planner decided their edits. The checks that matter, `npm run
  kb:audit` and the negative tests of new `verify:` commands, are steps they are told to run, not
  thoroughness left to effort.

**Effort is set only in frontmatter.** The Agent tool overrides `model` per spawn, but not
`effort`. An agent file's `effort:` overrides the session's level; without it the agent inherits
the session's. So a `high` planner and `medium` workers need two agent files:
- `librarian`: planner, plus `ask` and `audit`, `effort: high`;
- `librarian-worker`: worker, `effort: medium`.

**Adoptable now, on its own:** `effort: high` in today's
[`.claude/agents/librarian.md`](../../.claude/agents/librarian.md). Measure the next deposit
against the table in Current state.

**Sonnet saves less than its list price suggests.** List prices as of 2026-09-25: Opus 5.5 $4 in /
$20 out per MTok, Sonnet 5.5 $2 / $10, cache reads $0.20 on both. Cache writes at the 5-minute TTL
cost 1.25× input. On task 24 step 2's measured tokens:

| | cache reads 11.8M | cache writes 0.52M | visible output ~25K | total |
|---|---|---|---|---|
| Opus 5.5 | ~$2.36 | ~$2.60 | ~$0.50 | ~$5.46 |
| Sonnet 5.5 | ~$2.36 | ~$1.30 | ~$0.25 | ~$3.91 |

- That is ~28% less, before thinking, and only if Sonnet makes as many calls.
- The biggest line, cache reads, costs the same on both models.
- API prices stand in for subscription usage. How the plan weighs cache reads per model is not
  known here.

## Estimate

This is an estimate, not a measurement. For a step the size of task 24 step 2 (27 entries touched
or flagged):

| | calls × average context | context tokens |
|---|---|---|
| planner | ~12 × ~35K | ~0.4M |
| 5 groups | 5 × ~12 × ~30K | ~1.8M |
| session orchestration | ~7 × ~60K | ~0.4M |
| total | | **~2.6M**, against ~12.3M measured |

Treat it as ±2×; even at the high end it is under half. It counts context tokens only, so lowering
effort ([§5](#5-model-and-effort)) saves thinking and calls on top of it.

Measure the first adopted run the same way as the table in Current state:
- the transcripts are `~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl`;
- sum per distinct assistant `message.id`;
- `output_tokens` there is the stream-start count, so measure output as visible characters, and
  thinking not at all;
- for the end-to-end figure, read the session's usage meter before and after, as the ~11% for pass
  2 was.

## Trade-offs

- **Workers see only their group.** Noticing that entry A's change makes entry B wrong is the
  planner's job, and it reads less than a full pass did.
- **The work list is the single point of judgment.** A missed contradiction there is missed
  everywhere. The final audit catches failing checks and un-bumped dates, not wrong prose.
- **More spawns mean more calls in the calling session.** Batching each set into one message bounds
  it at one call per completion.

## Open decisions

1. **Sonnet for any group?** Never the planner: its work list is the single point of judgment
   (Trade-offs). Among workers, the best fit is not review-on-touch, although the charter calls it
   the low-risk half. Task 24 step 2's subtle fix, `writes-can-land-on-a-tombstone`, was
   review-on-touch: a consequence of the bin's new sort order that named no changed identifier. The
   best fit is a group whose edits the planner fully specified: only `fix-check` and
   `update-with-fact`, each with its quoted fact. The saving is ~28% of that group's bill
   ([§5](#5-model-and-effort)). Recommendation: lower effort first. Only if that is not enough,
   try Sonnet on one step's specified groups and compare its edits with an Opus group's.
2. **Group size.** ~6 is a guess balancing worker context against session calls.
3. **Relay.** Verbatim per report, as the skill requires today, or one merged report the session
   writes? Verbatim is longer, but nothing gets lost.

## Deliberately out

- **A script that re-dates entries whose code names do not appear in the diff.** Tested against
  pass 2's 18 entries:
  - for each entry, the backticked identifiers of its pre-step text against the `+`/`-` lines of
    its ground files' diff;
  - it would have cleared 2 of the 5 entries that needed edits, `first-fetch-replaces-list-state`
    and `writes-can-land-on-a-tombstone`, because their drift was in meaning, not in names.

  Review-on-touch is a judgment and stays one.
- **A `ground:` frontmatter field naming only the files whose change could falsify an entry.** It
  would cut flags at the source (`listsApi.ts` alone flagged 9 of 18). But it needs a per-entry
  judgment, and a field set too narrow silences exactly the drift the audit exists to catch.
  Revisit only if groups do not bring the cost down enough.
- **Sonnet throughout.** The planner's triage and contradiction work need the judgment. The saving
  is also small: ~28% at list prices ([§5](#5-model-and-effort)), below what lowering effort or the
  plan-then-groups split itself should give.

## Files adoption would change

- [`.claude/commands/librarian.md`](../../.claude/commands/librarian.md):
  - `deposit <n>` becomes planner → risky groups → review-on-touch groups → audit → relay;
  - `deposit <n> pass 2` is removed.
- [`.claude/agents/librarian.md`](../../.claude/agents/librarian.md):
  - becomes the planner, keeping `ask` and `audit`, with `effort: high`;
  - deposit step 0 (decide one pass or two) is replaced by the planner's small-step rule;
  - step 2 drops `description-step-<n>.md`.
- `.claude/agents/librarian-worker.md`, new: the worker, the habits in §2, `effort: medium`, the
  same tools.
- The "only writer" rule must name both agents. It is worded for one librarian in
  [`CLAUDE.md`](../../CLAUDE.md), in [CHARTER.md](../kb/CHARTER.md) curation rule 1, in the
  agent file's `description:` and body, and in the command file.
- [`ai/kb/CHARTER.md`](../kb/CHARTER.md): rule 5, and the Budgets paragraph in §4. The charter is
  not an entry or the index, so the librarian-only rule does not bind it. Whoever adopts this edits
  it directly.
