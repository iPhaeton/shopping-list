# Step 5 — implementation log (2026-10-09): the task's one deposit

`/librarian deposit 28`, run once over the whole task, as `description-step-5.md` says. No code,
mockup or config changed. Nothing committed.

## Inputs handed to the planner

- **Logs, in landing order:** `implementation-log-step-1.md` (47965d5), `-2.md` (d82484d),
  `-3.md` (5ab9b85), `-4.md` (0508f98), `-4-unblock.md` (2916e6e).
  - Step 1 landed before step 2.
  - The planner was told the later log wins, and that `-4-unblock.md` overrides steps 1 and 4 on
    what an unblock restores.
- **Base:** `80e58d0` ("Invitations preparation"), the parent of `28-invitations-1`.
- Nothing else: no description files, no suggestion.

## Planner

- **Mode: groups.** The plan was saved verbatim to the session scratchpad as
  `librarian-plan-step-28.md` before any worker was spawned.
- **Planned:** 1 new entry (`blocking-is-per-invitation-and-unblock-restores`, `indexed: false`,
  linked from scope-boundaries), 19 entries updated across R1–R4 plus R1's INDEX work, and 15
  review-on-touch.
  - 0 superseded, because every contradiction was a dropped `share_list` or an incomplete list.
  - No decision was reversed.
- **Grouping departure:**
  - R3 holds three `share_list` contradictions whose INDEX hooks stay true.
  - R1 rewrote deletion-is-a-tombstone's INDEX line, while R3 edited that entry's body.
- **Budget:** nine entries were at 117–120 lines, and the workers trimmed before adding.
- **Dropped candidates (14 lines in the plan):**
  - the RPC HTTP-status mapping;
  - client grants;
  - jest cold-cache timeouts;
  - LM001/LM002 wording;
  - `set_name` length;
  - mockup design calls and harness gotchas;
  - MAX_ROWS guards;
  - the missing partial index;
  - single-screen paging limits;
  - "Notifications underneath Blocked people marks restored rows read";
  - `jest.spyOn(Date,'now')`;
  - session-only tooling quirks.

## Groups run

The risky groups ran in parallel; the review-on-touch groups ran after every risky worker had
returned.

| group | entries | result |
|---|---|---|
| R1 (owns INDEX) | scope-boundaries, blocking-is-per-invitation-and-unblock-restores (new), session-still-valid-guards-writes, phone-is-the-product, writes-retry-from-an-outbox, session-revoked-write-redirects | 5 edited, 1 new. The INDEX hooks are rewritten for scope-boundaries, session-still-valid (eighteen RPCs), session-revoked (callers), writes-retry, phone-is-the-product and deletion-is-a-tombstone. The `session-still-valid` awk now honours a later `drop function`. |
| R2 | realtime-is-a-nudge-to-a-per-user-inbox, realtime-channel-shared-per-topic, queries-go-through-a11y-labels, screens-take-navigation-props, keyset-paging-in-the-order-shown | All 5 edited. Three failing checks were fixed (`onNudge, onNudge` became the four-callback form, and Share became Invite). The keyset title now names the notifications and blocks orders. |
| R3 | list-data-scoped-by-rls, ownership-changes-lock-the-list-row-first, limit-checks-pass-an-applied-resend, select-policy-gates-update-and-delete, deletion-is-a-tombstone, trigram-index-needs-three-characters | All 6 edited. `share_list` was removed from the lock, limit and select-policy entries. The ownership lock's `verify:` now covers 9 functions, plus `accept_invitation`'s lock-before-insert. |
| R4 | supabase-local-stack, native-build-toolchain, maestro-drives-the-native-ui | All 3 edited: auto_explain and the 1M-user lookup and delete rules; the 8 GB simulator-beside-Docker thrash; the tour hardcoding `Sam`, with no device run. |
| T1 | insert-returning-races-membership-trigger, list-cache-holds-acknowledged-rows, max-rows-is-a-silent-ceiling, postgrest-reads-retry-on-network-errors, read-rooted-at-list-members, refused-writes-return-zero-rows | All 6 re-dated. |
| T2 | server-stamps-done-at, writes-can-land-on-a-tombstone, supabase-client-module-boundary, component-suite-earned-by-owned-logic | 3 re-dated. supabase-client-module-boundary was edited: `inviteToList` and `notificationsApi`'s `resultFor`. |
| T3 | first-fetch-replaces-list-state, list-headers-are-pinned-and-opaque, sync-banner-mount-is-unconditional, restored-session-state-waits-for-evidence, theme-provider-suites-fake-the-clock | 2 edited: "shared with you" became invitation wording, and the round header buttons. 3 re-dated. |

**Mutation tests.** R1, R2 and R3 each broke scratch copies (R1 five, R2 and R3 twelve each). Every
broken copy made the changed `verify:` exit 1. R4 broke three copies for the Maestro check.

**T1's caveat:** list-cache-holds-acknowledged-rows was re-dated without the
`src/state/ListsContext.tsx` and `useHydration.ts` diffs. They were checked afterwards: they only
add `lastNotificationsNudge` and its subscription, and reword one doc comment. Neither touches the
cache, and T3 had read both.

## Audit

- `npm run kb:audit`: **74 entries, 67 mechanically checked, 0 errors, 0 warnings.**
- Before the deposit it was 73, 66, 4 errors and 26 warnings.
- `session-still-valid-guards-writes` passes, as this step requires.
- The two `judge` rows (scope-boundaries reviewed 0d ago, support-address-and-mail-domains 2d ago)
  are informational.
- `last_verified`: all 35 work-list entries read `2026-10-09`, and no worker flagged any.
- Every work-list entry is at or under 120 lines; the largest are at 120. INDEX.md is 50 lines.

## Still owed

1. **The INDEX hook for keyset-paging-in-the-order-shown** still reads "live oldest first, the bin
   newest deletion first".
   - The entry now also covers notifications and blocks, newest first, inside RPCs.
   - R2 flagged it after R1 (the INDEX owner) had finished.
   - The hook is incomplete, not wrong.
2. **Cloud status of task 28's four migrations.**
   - scope-boundaries says "Cloud has every migration but task 26's `20261007000000_apple_tokens.sql`
     (`migration list --linked`, 2026-10-06)". deletion-is-a-tombstone says nothing about cloud for
     `purge_notifications`.
   - Every task 28 log says local only, not pushed. Whether the user pushed them since is unknown.
   - Neither worker had a quoted fact, so both left it, and R1 and R3 flagged it.
   - It needs the user's word, or a `migration list --linked` run the user approves.
