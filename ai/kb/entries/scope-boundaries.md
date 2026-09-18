---
id: scope-boundaries
title: Scope — named lists, OTP sign-in, offline writes, sharing, realtime, deletion and paged items in; invites and leaving a list out
type: constraint
status: current
tags: [scope, product]
sources: [ai/tasks/1/description-step-1.md, ai/tasks/2/description-step-2.md, ai/tasks/3/description-step-1.md, ai/tasks/4-offline-support/description-step-1.md, ai/tasks/4-offline-support/implementation-log-step-1.md, ai/tasks/5-supabase-cloud/description-step-1.md, ai/tasks/6-custom-smtp/description-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-2.md, ai/tasks/7-list-sharing/description-step-1.md, ai/tasks/7-list-sharing/description-step-2.md, ai/tasks/8-realtime/description-step-1.md, ai/tasks/8-realtime/implementation-log-step-1.md, ai/tasks/9-deletion/description-step-1.md, ai/tasks/9-deletion/implementation-log-step-1.md, ai/tasks/10-rename-item/description-step-1.md, ai/tasks/10-rename-item/implementation-log-step-1.md, ai/tasks/11-pagination/description-step-1.md, ai/tasks/11-pagination/implementation-log-step-1.md, ai/tasks/11-pagination/description-step-2.md, ai/tasks/11-pagination/implementation-log-step-2.md, ai/tasks/12-rename-shoppingloop/description-step-1.md, ai/tasks/12-rename-shoppingloop/implementation-log-step-1.md, ai/tasks/13-google-sign-in/plan-step-1.md, ai/tasks/13-google-sign-in/implementation-log-step-1.md, ai/tasks/13-google-sign-in/description-step-2.md, ai/tasks/13-google-sign-in/implementation-log-step-2.md, b78d16f]
last_verified: 2026-09-18
related: [suggestions-are-proposals, writes-retry-from-an-outbox, list-cache-holds-acknowledged-rows, list-data-scoped-by-rls, select-policy-gates-update-and-delete, refused-writes-return-zero-rows, server-stamps-done-at, realtime-is-a-nudge-to-a-per-user-inbox, deletion-is-a-tombstone, writes-can-land-on-a-tombstone, read-rooted-at-list-members, max-rows-is-a-silent-ceiling, supabase-local-stack, supabase-target-picked-at-runtime, otp-email-templates-carry-the-code, supabase-config-push-sends-the-whole-root, cloud-auth-mail-goes-through-resend, shoppingloop-is-the-visible-name-only, native-build-toolchain, google-native-signin-library-gaps]
---

Scope is set one task step at a time, by the `ai/tasks/<n>/description-step-<n>.md` that opens the
step — never by a document in `ai/suggestions/`, which is a proposal until a description promotes it
([suggestions-are-proposals](suggestions-are-proposals.md)). What is in, as of step 13 phase 2:

| | |
|---|---|
| step 1 | create named lists, add items, mark/unmark items done |
| step 2 | email OTP sign-in and sign-out, a session that survives a reload, a `users` table |
| step 3 | lists and items in Postgres, one owner each, surviving a reload |
| step 4 | writes queued on disk and retried until they land; the lists readable with no signal |
| step 5 | a cloud Supabase project as a second environment, which a physical device talks to |
| step 6 | custom SMTP, both phases — production sign-in mail leaves through Resend from a verified domain to any address |
| step 7 step 1 | sharing at reader/writer/owner, enforced entirely in the database — no UI |
| step 7 step 2 | the UI for it: role-gated screens, list rename, a sharing screen (invite / change role / remove), a re-fetch when the app comes to the front |
| step 8 | realtime: a change by one member reaches every other member in about a second, both apps in the foreground |
| step 9 | deleting lists and items — as tombstones behind a "Show deleted" checkbox, restorable by whoever may delete, purged after 30 days |
| step 10 | renaming an item, by an owner or writer — an inline editor on the row, sent through a `rename_item` RPC like every other item write |
| step 11 | a list's items paged, fetched only once the list is opened — a first page of live rows and of the bin together, the rest read on scroll by keyset; lists themselves capped, not paged |
| step 12 | the app is called **ShoppingLoop** wherever a person sees it — visible name only; `slug`, `scheme`, `package.json` and `project_id` stay `shopping-list` ([shoppingloop-is-the-visible-name-only](shoppingloop-is-the-visible-name-only.md)) |
| step 13 phases 1-2 | Google added as a second sign-in method: `[auth.external.google]` enabled and proven server-side (phase 1), then a native "Continue with Google" button and `SessionContext.signInWithGoogle` added client-side, delegating to `src/lib/googleSignIn.ts` (phase 2); still no production push and no completed real-account sign-in on either device |

**Still deliberately out: inviting an address that has no account (`list_invites`), leaving a list
you do not own, showing an owner how widely a list is shared without opening it, passwords, and
conflict resolution beyond last-write-wins.**

**Three of those are database limits, not backlog laziness** — none is an afternoon of UI work:

- `share_list` raises `P0002` for an address with no account, so a stranger cannot be invited until a
  `list_invites` table claimed at sign-up exists.
- A non-owner cannot remove their own membership: the delete is filtered to zero rows and answers
  `204`, so a "Leave this list" button would look like it worked and change nothing
  ([select-policy-gates-update-and-delete](select-policy-gates-update-and-delete.md),
  [refused-writes-return-zero-rows](refused-writes-return-zero-rows.md)). That is item 10 in
  `backlog/backlog.txt`.
- A list you own cannot say "shared with 2 people": the `list_members` select policy shows you your
  own row, so any count the client computed would read `1` for everybody.

Equally deliberate, and in the same family: a sole owner deleting their account leaves an **ownerless
list nobody can see or clean up**, because the alternative was cascading and destroying lists other
people are in ([list-data-scoped-by-rls](list-data-scoped-by-rls.md)).

**"The user can create a list" means *many* named lists, not one standing list.** The step-1
description was singular and genuinely ambiguous; the question went to the user and the answer was
many. That reading is why there are two list screens (`Lists` → `ListDetail`) and why the app depends
on React Navigation at all. Treat it as settled: do not "simplify" the product back to one list, and
do not re-litigate the ambiguity from the description alone.

## What a landed step did *not* land

Each of these is easy to assume and wrong:

- **step 4, offline** — no sync engine (PowerSync is the answer if this ever needs real convergence),
  no connectivity library, no conflict resolution beyond last-write-wins, and no "wait for sync"
  confirmation when signing out with writes pending. Reading offline *did* come in with it, decided
  with the user before the work started: without a cached copy a cold start with no signal shows an
  empty app, and the shop-with-no-bars scenario the queue exists for never happens
  ([writes-retry-from-an-outbox](writes-retry-from-an-outbox.md),
  [list-cache-holds-acknowledged-rows](list-cache-holds-acknowledged-rows.md)).
- **step 5, cloud** — no user-facing feature and no schema change. Nothing about the local-first
  workflow changed; web is still where work is verified
  ([supabase-local-stack](supabase-local-stack.md)).
- **step 6, SMTP** — phase 2 (a verified sending domain) landed 2026-09-17: a stranger's
  `signInWithOtp` now reaches a real inbox, not just the Resend account owner's. Deliverability
  itself is still unproven (fresh address, cross-provider, DMARC) and no physical-device sign-in has
  ever completed against production
  ([cloud-auth-mail-goes-through-resend](cloud-auth-mail-goes-through-resend.md),
  [otp-email-templates-carry-the-code](otp-email-templates-carry-the-code.md)).
- **step 8, realtime** — no echo suppression (`x-client-id`) and no "just updated" `SyncBanner`; both
  were offered to the user and declined. No presence and no per-field conflict UI either:
  last-write-wins is made *visible* rather than replaced
  ([realtime-is-a-nudge-to-a-per-user-inbox](realtime-is-a-nudge-to-a-per-user-inbox.md)).
- **step 9, deletion** — no policy change at all (a tombstone is still a row, and a member must see
  it to restore it), no realtime migration (a soft delete is an `UPDATE` the existing triggers
  already cover), and no restore of a list's items when the list itself is restored. It does not
  solve happens-before: the rule is who you are, not whose change came first
  ([deletion-is-a-tombstone](deletion-is-a-tombstone.md),
  [writes-can-land-on-a-tombstone](writes-can-land-on-a-tombstone.md)).
- **step 10, item rename** — no re-granted `title` column and no policy change: the write is a
  `security definer` RPC because the client still holds no UPDATE on `items` at all
  ([server-stamps-done-at](server-stamps-done-at.md)). No realtime migration either, and no
  happens-before between a rename and a delete of the same item from two devices.
- **step 11, pagination** — no migration across either half: no new index (measured unnecessary), no
  policy change, nothing to push. The sharing roster and the lists themselves are **not** paged —
  lists stop at `MAX_ROWS` with a dev-time warning. Step 11-2 moved the bin's first page off
  `fetchLists` entirely — it now ships with the fetch that opens the list instead (still bounded at
  `PAGE_SIZE`, not minimised), so the Lists screen carries no item data and `ListRow` shows no count
  at all. `items.title` has no length check, and an item added to a list longer than a page lands
  beyond the loaded pages after the next hydration — one scroll away, by design
  ([read-rooted-at-list-members](read-rooted-at-list-members.md),
  [max-rows-is-a-silent-ceiling](max-rows-is-a-silent-ceiling.md),
  [deletion-is-a-tombstone](deletion-is-a-tombstone.md)).
- **step 13, Google sign-in (phases 1-2)** — server side (phase 1) and the client (phase 2) both
  landed: `[auth.external.google]` validates a real token, and a native "Continue with Google" button
  (`Platform.OS !== 'web'`, a product choice, not a crash workaround — see
  [google-native-signin-library-gaps](google-native-signin-library-gaps.md)) now calls
  `src/lib/googleSignIn.ts` on Android and iOS. Still not landed: any push to production, and a
  completed real-account sign-in on either device — the auto-link check against that address's OTP
  sign-in has not run.

**Cloud is three migrations behind local.** The four migrations up to realtime are pushed and read
back from the production project; step 9's two (`20260910000000_deletion.sql`,
`20260910000001_purge_schedule.sql`) and step 10's `20260911000000_rename_item.sql` have not been
pushed at all, and no client has ever connected to the cloud realtime socket. A pushed migration is schema-level proof, never behaviour-level ([supabase-local-stack](supabase-local-stack.md)).

**What to do:** do not add any of the out-of-scope items speculatively, and do not treat their
absence as a gap worth flagging in a review. When a new task description lands, re-read this entry
and update it — that is the moment it goes stale.

No `verify:` command — scope is a judgment fact.
