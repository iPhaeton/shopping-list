# Step 4 — Deposit the whole task into the KB

The user's requests and the decisions they settled are in
[description-step-1.md](description-step-1.md). This step is request 5.

**Run it after the last step of this task that lands**, normally step 3. It changes no code, no
mockup and no config. It is the only step of task 26 that runs the librarian.

## Why one deposit

Request 5. Steps 1–3 skip the per-step `/librarian deposit` that CLAUDE.md's working rules ask for,
so that one pass sees the task's end state.

- Several entries are touched by more than one step. `scope-boundaries` is touched by all three.
- One pass writes each entry once, instead of step 2 writing it and step 3 rewriting it.

## Inputs

- **The logs:** `implementation-log-step-1.md`, `-2.md` and `-3.md`, each ending in its
  **KB candidates** section. Where they disagree, the later log wins, because it records the later
  state.
- **The base:** the parent of step 1's first commit. Find it with `git log --oneline`. Task commits
  are named like `25-account-deletion-1`.
- **Not the description files.** The command hands the planner logs only, because a log records what
  was actually built.

## How

- Run `/librarian deposit 26`.
- **Change one thing in the command's step 1.** The command is written for a single step's log.
  Hand the planner all three log paths and the base, and tell it they are one task's deposit. Hand
  it nothing else.
- Everything else is as the command says:
  1. save the plan on `Mode: groups`;
  2. run the risky groups, then the review-on-touch groups;
  3. close with `npm run kb:audit` and the `last_verified` check;
  4. relay the reports verbatim.
- `Mode: done` for the whole task is a valid outcome.

## Expected candidates

These are the union of the three steps' KB impact tables. They are a starting point, not a mandate:
the planner decides each one under the admission test in
[CHARTER.md](../../kb/CHARTER.md).

| entry | from |
|---|---|
| scope-boundaries | steps 1–3, as one rewrite: Sign in with Apple, native and iOS only; Hide My Email accepted as a separate account; Account's hidden-email sentence; registering the relay domain must come before cloud; the revoke on delete, and its web and Android exception; the first Edge Function; nothing on cloud |
| phone-is-the-product | steps 1 and 2: the new Sign in and Account mockups, and the screenshots that match them |
| native-build-toolchain | step 2: the entitlement, prebuild with `--platform ios`, the simulator's Apple Account |
| google-native-signin-library-gaps, or a new entry | step 2: the nonce, the name sent once, the mocks in `SessionProvider` suites |
| delete-account-removes-sole-owned-lists | step 3: the function calls it after the revoke |
| supabase-client-module-boundary | step 3: the function imports supabase-js outside `src/` |
| a new revocation entry | step 3 |

## Done when

- The deposit has closed. Every entry on the work list carries today's `last_verified`, or is named as
  flagged.
- `npm run kb:audit` passes, or each failure is named with whether the fact or the check is wrong.
- `implementation-log-step-4.md` records the planner's mode and summary, the groups run, the audit
  result and any entry still owed. The workers' reports go to the user verbatim and are summarized
  in the log, not copied.

There is no deposit after this step, because this step is the deposit.
