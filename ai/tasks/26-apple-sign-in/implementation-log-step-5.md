# Step 5 — implementation log: the task-26 KB deposit

Date: 2026-10-07. No code, mockup or config changed. Only `ai/kb/` changed, written by the librarian agents:
26 files, +276 / −217, three of them new.

## How it ran

- **The command:** `/librarian deposit 26`, with step 1 changed as `description-step-5.md` asks.
  - The planner got the four logs (`implementation-log-step-{1,2,3,4}.md`), told they are one task's deposit, where the later log wins.
  - It got the base, `5fd4a8b`: the parent of `b4cafe0 26-apple-1`. HEAD was `78f86a4`.
  - It got nothing else.
- **The planner's interleaving note.** `git diff 5fd4a8b` also carries two commits that are not task 26. The workers were told to ignore both:
  - `012e3a4`, task 27's description;
  - `0d027d1`, the support-address KB deposit.
- **Planner: `Mode: groups`.** Its report was saved verbatim to the session scratchpad (`librarian-plan-step-26.md`) before any worker ran.
- **The planner's counts:**
  - 3 new;
  - 15 updated (2 contradictions, 1 fix-check);
  - 1 demoted;
  - 10 review-on-touch;
  - 0 superseded;
  - 10 dropped.
- **Groups:** R1, R2 and R3 in parallel, then T1 and T2 in parallel. None died, and none was re-spawned.

## Planner summary (condensed)

- **The three new entries:**
  - `apple-refresh-token-revoked-before-account-deletion` (decision, indexed under Auth);
  - `apple-revoke-leaves-an-email-less-returning-sheet` (gotcha, `indexed: false`);
  - `edge-functions-local-dev-loop` (environment, `indexed: false`). It is separate because `supabase-local-stack` was already at the 120-line budget.
- **One index slot was freed** by demoting `refused-writes-return-zero-rows`. Most writes now go through RPCs, and its inbound `related:` links remain.
- **Contradictions fixed:**
  - `scope-boundaries`: task 25's "no Edge Function, no Apple token revocation" no longer holds, and "cloud is ten migrations behind" was wrong. As of 2026-10-06, only `20261007000000_apple_tokens.sql` is missing from cloud.
  - `delete-account-locks-then-removes-sole-owned-lists`: its "not pushed to cloud" was stale.
- **Fix-check:** `ios-device-build-skips-provisioning-flags`' `verify:` only matched the team written unquoted.
- **The watch item, which no log tested:**
  - The app calls `delete-account` for every Apple-linked account on every platform.
  - Cloud has Apple enabled but none of the three functions, the `apple_tokens` migration or the secrets.
  - So a cloud build cannot delete an Apple-linked account until those are deployed. R1 recorded this as current cloud state.
- **Dropped, each failing admission:**
  - the relay-address line-break note;
  - GoTrue's `identity_data` email: steps 2 and 3 observed opposite results;
  - extending the `jest.mock('../lib/appleSignIn')` verify;
  - nonce, client secret and button re-export: readable from the code;
  - the native button's label;
  - a crash seen once;
  - session-only quirks (awk `strftime`, snapshots holding the relay address, keyboard prompt, keystore);
  - `apple_tokens` as a separate `list-data-scoped-by-rls` update: folded into the decision entry;
  - mockup geometry tables;
  - the `apple_not_configured` failure table.

## Groups (worker reports summarized)

**R1**
- **Created the three new entries.** Each `verify:` was negative-tested on broken copies: 6, 3 and 4 respectively.
- **`delete-account-locks-then-removes-sole-owned-lists`:**
  - the cloud state is now correct;
  - `delete-account` wraps the RPC;
  - the 403 `42501` mapping is recorded;
  - it removed two broken leftover lines after `verify:` in the frontmatter. The audit had been ignoring them.
- **`scope-boundaries`:** rewritten with a task-26 row and a "did not land" bullet. It is at 119 lines.
- **Demoted `refused-writes-return-zero-rows`.**
- **`INDEX.md`:**
  - added the Apple hook under Auth;
  - removed refused-writes' line;
  - extended the scope hook and native-build-toolchain's hook (the sandbox cannot reach apple.com);
  - kept it at 25 entry lines.

**R2**
- **`ios-device-build-skips-provisioning-flags`:**
  - the `verify:` now uses `grep -qE 'DEVELOPMENT_TEAM = "?YZ75T58P4Z"?;'`;
  - added that the agent's sandbox blocks apple.com and that the failure shows as `-1001`;
  - added the "does not support the Sign In with Apple capability" case;
  - the profile now has the entitlement.
- **`native-build-toolchain`:** the Apple entitlement, the simulator's Apple Account, and DeviceHub's path. Trimmed to 120 lines.
- **`maestro-drives-the-native-ui`:**
  - a tap on a button above the keyboard can land on the keyboard, so flows use `pressKey: Enter`;
  - the share sheet is tapped by point;
  - Apple's sheet is drivable.
  - Trimmed to 120 lines.
- **`supabase-target-picked-at-runtime`:** a dev build takes its target from the Metro serving it, and the recipe for pointing a phone at local.
- **`shoppingloop-is-the-visible-name-only`:** the App ID's description is what Settings → Sign in with Apple lists.
- **`phone-is-the-product`:** which Sign in mockup is current per platform, `account-screen-hidden-email*` as a state, and the `APPLE_INSIDE` calibration. It is at 117 lines.

**R3**
- **`cloud-auth-mail-goes-through-resend`:** relay mail lands in spam with SPF, DKIM and DMARC passing, and the template is bare.
- **`supabase-client-module-boundary`:** the boundary covers `src/` only, and `FunctionsHttpError` is detected by `error.name`. It is at 120 lines.
- **`tsconfig-explicit-types-array`:** `exclude` replaces the base's list and adds `supabase/functions`.
- **`restored-session-state-waits-for-evidence`:** `withSameUser` keeps `prev.session`.
- **`session-still-valid-guards-writes`:** after a deletion elsewhere, the device reopens on Choose your name.
- **`theme-reaches-native-surfaces`:** the Apple button's colour comes from the app theme, and its words from the device language.
- **Its run of the audit showed one transient error:** the new decision entry was not yet in `INDEX.md` because R1 was still running. It cleared once R1 finished.

**T1**
- **Edited:**
  - `account-deletion-forces-signed-out-and-clears-twice`: deletion goes through `deleteOnServer`, and the `verify:` was extended;
  - `signed-in-event-fires-on-restore-too`;
  - `queries-go-through-a11y-labels`: "Continue with Apple", the `Share` pill (120 lines);
  - `theme-provider-suites-fake-the-clock`: now three suites;
  - `expo-crypto-undefined-under-jest`: the `digestStringAsync` mock, and why `expo-apple-authentication` is absent from `jest.setup.ts`.
- **Re-dated:** `recycled-text-input-keeps-letter-spacing`.

**T2**
- **Re-dated:** `expo-sdk-version`, `ios-scene-support-is-opt-in`, `max-rows-is-a-silent-ceiling`.
- **Edited `supabase-local-stack`:**
  - `.env` also holds the Apple key, with no `EXPO_PUBLIC_` prefix, which `supabase start` passes to the functions;
  - linked `edge-functions-local-dev-loop`;
  - it is at 120 lines.

## Close

- **`npm run kb:audit`:** 73 entries, 66 checked mechanically, 0 errors, 0 warnings.
  - `judge` lines (no mechanical check): `scope-boundaries`, reviewed today, and `support-address-and-mail-domains`, reviewed 2026-10-06, not in this deposit.
  - The pre-existing `ios-device-build-skips-provisioning-flags` failure that step 4's log mentions is fixed.
- **`last_verified`:** all 28 entries on the work list carry 2026-10-07 except `refused-writes-return-zero-rows` (2026-10-02). It was only demoted (`indexed: false`), not re-verified. Its `verify:` passes.
- **Index:** 25 entry lines.

## Owed

- **`shoppingloop-is-the-visible-name-only`** holds one line R2 inferred and no log measured: an App ID that Xcode creates again would again be named "XC …". Keep or cut at the next touch.
- **`expo-crypto-undefined-under-jest`** lacks `implementation-log-step-2.md` in `sources:`. That log covers the `digestStringAsync` mock (`b15d384` changed `jest.setup.ts`). T1 was not told which log, so it left it out.
- **No other entry is owed.** There is no deposit after this step.
