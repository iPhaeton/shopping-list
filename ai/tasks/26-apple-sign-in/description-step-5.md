# Step 5 — Deposit the whole task into the KB

The user's requests and the decisions they settled are in
[description-step-1.md](description-step-1.md). This step is request 5.

**Run it after the last step of this task that lands**, normally step 4. It changes no code, no
mockup and no config. It is the only step of task 26 that runs the librarian.

**It was step 4** until requests 6 and 7 inserted a step before it. Step 1's and step 2's logs call
it step 4. They mean this step.

## Why one deposit

Request 5. Steps 1–4 skip the per-step `/librarian deposit` that CLAUDE.md's working rules ask for,
so that one pass sees the task's end state.

- Several entries are touched by more than one step. `scope-boundaries` is touched by steps 1–4.
- One pass writes each entry once, instead of step 2 writing it and steps 3 and 4 rewriting it.

## Inputs

- **The logs:** `implementation-log-step-1.md`, `-2.md`, `-3.md` and `-4.md`, each ending in its
  **KB candidates** section. Where they disagree, the later log wins, because it records the later
  state.
- **The base:** the parent of step 1's first commit. Find it with `git log --oneline`. Task commits
  are named like `25-account-deletion-1`.
- **Not the description files.** The command hands the planner logs only, because a log records what
  was actually built.

## How

- Run `/librarian deposit 26`.
- **Change one thing in the command's step 1.** The command is written for a single step's log.
  Hand the planner all four log paths and the base, and tell it they are one task's deposit. Hand
  it nothing else.
- Everything else is as the command says:
  1. save the plan on `Mode: groups`;
  2. run the risky groups, then the review-on-touch groups;
  3. close with `npm run kb:audit` and the `last_verified` check;
  4. relay the reports verbatim.
- `Mode: done` for the whole task is a valid outcome.

## Expected candidates

These are the union of the four steps' KB impact tables. They are a starting point, not a mandate:
the planner decides each one under the admission test in
[CHARTER.md](../../kb/CHARTER.md).

| entry | from |
|---|---|
| scope-boundaries | steps 1–4, as one rewrite: Sign in with Apple, native and iOS only; Hide My Email accepted as a separate account; Account's hidden-email sentence; registering the relay domain must come before cloud; the revoke on delete, on every platform from step 4's stored refresh token, and the sign-in recovery as its backstop; the first Edge Functions; nothing on cloud |
| phone-is-the-product | steps 1 and 2: the new Sign in and Account mockups, and the screenshots that match them |
| native-build-toolchain | step 2: the entitlement, prebuild with `--platform ios`, the simulator's Apple Account |
| google-native-signin-library-gaps, or a new entry | step 2: the nonce, the name sent once, the mocks in `SessionProvider` suites |
| delete-account-removes-sole-owned-lists | steps 3 and 4: the function revokes every stored token, then calls it |
| supabase-client-module-boundary | step 3: the function imports supabase-js outside `src/` |
| a new revocation entry | steps 3 and 4: step 4's stored token replaces step 3's second sheet |
| list-data-scoped-by-rls, or the revocation entry | step 4: `apple_tokens` is service-only |

## Done when

- The deposit has closed. Every entry on the work list carries today's `last_verified`, or is named as
  flagged.
- `npm run kb:audit` passes, or each failure is named with whether the fact or the check is wrong.
- `implementation-log-step-5.md` records the planner's mode and summary, the groups run, the audit
  result and any entry still owed. The workers' reports go to the user verbatim and are summarized
  in the log, not copied.

There is no deposit after this step, because this step is the deposit.
