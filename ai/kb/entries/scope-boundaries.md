---
id: scope-boundaries
title: Scope — named lists, OTP sign-in, offline writes, sharing, realtime, deletion, paged items and paged lists, required unique names, leaving a list, Day/Night/Auto themes, list and item limits, search and sort of live rows, account deletion, Sign in with Apple (native, iOS only), invitations between existing accounts and invitation-only blocking in; inviting someone with no account out
type: constraint
status: current
tags: [scope, product]
sources: [ai/tasks/1/description-step-1.md, ai/tasks/2/description-step-2.md, ai/tasks/3/description-step-1.md, ai/tasks/4-offline-support/description-step-1.md, ai/tasks/4-offline-support/implementation-log-step-1.md, ai/tasks/5-supabase-cloud/description-step-1.md, ai/tasks/6-custom-smtp/description-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-2.md, ai/tasks/7-list-sharing/description-step-1.md, ai/tasks/7-list-sharing/description-step-2.md, ai/tasks/8-realtime/description-step-1.md, ai/tasks/8-realtime/implementation-log-step-1.md, ai/tasks/9-deletion/description-step-1.md, ai/tasks/9-deletion/implementation-log-step-1.md, ai/tasks/10-rename-item/description-step-1.md, ai/tasks/10-rename-item/implementation-log-step-1.md, ai/tasks/11-pagination/description-step-1.md, ai/tasks/11-pagination/implementation-log-step-1.md, ai/tasks/11-pagination/description-step-2.md, ai/tasks/11-pagination/implementation-log-step-2.md, ai/tasks/12-rename-shoppingloop/description-step-1.md, ai/tasks/12-rename-shoppingloop/implementation-log-step-1.md, ai/tasks/13-google-sign-in/plan-step-1.md, ai/tasks/13-google-sign-in/implementation-log-step-1.md, ai/tasks/13-google-sign-in/description-step-2.md, ai/tasks/13-google-sign-in/implementation-log-step-2.md, ai/tasks/14-account-screen/description-step-1.md, ai/tasks/14-account-screen/implementation-log-step-1.md, ai/tasks/17-user-names/description-step-1.md, ai/tasks/17-user-names/implementation-log-step-1.md, ai/tasks/18-share-by-name/description-step-1.md, ai/tasks/18-share-by-name/implementation-log-step-1.md, ai/tasks/18-share-by-name/implementation-log-step-2.md, ai/tasks/19-remove-oneself/description-step-1.md, ai/tasks/19-remove-oneself/implementation-log-step-1.md, ai/tasks/19-remove-oneself/description-step-3.md, ai/tasks/19-remove-oneself/implementation-log-step-3.md, ai/tasks/20-ux/description-step-1.md, ai/tasks/20-ux/implementation-log-step-1.md, ai/tasks/20-ux/description-step-2.md, ai/tasks/20-ux/implementation-log-step-2.md, ai/tasks/20-ux/description-step-5.md, ai/tasks/20-ux/implementation-log-step-5.md, ai/tasks/23-list-limits/description-step-1.md, ai/tasks/23-list-limits/implementation-log-step-1.md, ai/tasks/23-list-limits/description-step-2.md, ai/tasks/23-list-limits/implementation-log-step-2.md, ai/tasks/24-search-and-sort/description-step-1.md, ai/tasks/24-search-and-sort/description-step-2.md, ai/tasks/24-search-and-sort/implementation-log-step-2.md, ai/tasks/24-search-and-sort/implementation-log-step-3.md, ai/tasks/25-account-deletion/implementation-log-step-2-locks.md, ai/tasks/25-account-deletion/implementation-log-step-3.md, b78d16f, ai/tasks/26-apple-sign-in/implementation-log-step-2.md, ai/tasks/26-apple-sign-in/implementation-log-step-4.md, b15d384, 42cd547, ai/tasks/28-invitations/implementation-log-step-3.md, ai/tasks/28-invitations/implementation-log-step-4.md, ai/tasks/28-invitations/implementation-log-step-4-unblock.md, 5ab9b85, 0508f98, 2916e6e]
last_verified: 2026-10-09
related: [suggestions-are-proposals, keyset-paging-in-the-order-shown, writes-retry-from-an-outbox, list-cache-holds-acknowledged-rows, list-data-scoped-by-rls, select-policy-gates-update-and-delete, refused-writes-return-zero-rows, server-stamps-done-at, realtime-is-a-nudge-to-a-per-user-inbox, deletion-is-a-tombstone, writes-can-land-on-a-tombstone, read-rooted-at-list-members, max-rows-is-a-silent-ceiling, supabase-local-stack, supabase-target-picked-at-runtime, otp-email-templates-carry-the-code, supabase-config-push-sends-the-whole-root, cloud-auth-mail-goes-through-resend, shoppingloop-is-the-visible-name-only, native-build-toolchain, google-native-signin-library-gaps, session-still-valid-guards-writes, signed-in-event-fires-on-restore-too, trigram-index-needs-three-characters, phone-is-the-product, theme-reaches-native-surfaces, theme-tokens-only, auto-theme-follows-the-time-zone, limit-checks-pass-an-applied-resend, ownership-changes-lock-the-list-row-first, delete-account-locks-then-removes-sole-owned-lists, apple-refresh-token-revoked-before-account-deletion, apple-revoke-leaves-an-email-less-returning-sheet, blocking-is-per-invitation-and-unblock-restores]
---

Scope is set by each step's `ai/tasks/<n>/description-step-<n>.md` — never by `ai/suggestions/`, a
proposal until a description promotes it ([suggestions-are-proposals](suggestions-are-proposals.md)). In, as of task 28 step 4
(the steps' logs hold the detail):

| | |
|---|---|
| steps 1–6 | named lists and items, email OTP sign-in with a surviving session, Postgres storage, writes queued on disk and retried, lists readable with no signal, a cloud project a physical device talks to, production mail through Resend |
| steps 7–11 | sharing at reader/writer/owner enforced in the database, with role-gated screens, list rename and a sharing screen; realtime between foregrounded members in about a second; tombstone deletion behind "Show deleted", restorable by whoever may delete, purged after 30 days; item rename via `rename_item`; items paged by keyset, fetched once a list opens |
| steps 12–14 | the visible name **ShoppingLoop** only — `slug`, `scheme`, `package.json` and `project_id` stay `shopping-list` ([shoppingloop-is-the-visible-name-only](shoppingloop-is-the-visible-name-only.md)); a native-only Google button, never completed on a real account ([google-native-signin-library-gaps](google-native-signin-library-gaps.md)); an Account screen with plain and global sign-out |
| steps 17–19 | a required, unique (case-insensitive), editable display name behind a blocking `SetNameScreen` gate; finding people by name (`search_users_by_name`, trigram-indexed, self-excluded, 5 rows) — the invite takes the id the search resolved; "Leave list" (`leave_list`) for a reader or writer, while an owner removes anyone, themselves included, via `remove_member`, both behind a Cancel/confirm |
| task 20 | the **Quiet Horizon** restyle, and **the phone becomes the product** ([phone-is-the-product](phone-is-the-product.md)): Day and Night palettes and a per-device Day / Night / **Auto** choice — Auto, the default, is night from sunset to sunrise at the time zone's city ([auto-theme-follows-the-time-zone](auto-theme-follows-the-time-zone.md)); every screen and the launch screen built to `ai/ux/primary/` |
| task 23 | lists paged as items are (100 a page, live and bin streams); three database limits — 100 lists you **own**, 1,000 lists you are on, 1,000 items in a list, none counting the bin — with Create swapped for a sentence at a list limit |
| task 24 | "Show deleted" switches a screen to its bin alone, newest deletion first, labelled with no count, **never searched, sorted another way, or loaded in full**; search and sort of **live** rows — search the resting state, sort toggles in fixed priority `todo` → `az` → `date` (`date` never off), per list or global, per device (`sort-preference` v1, above `SessionProvider`, never pruned); a query or non-default sort completes the stream in the background up to 2,000 rows (`COMPLETION_CAP`) and says so; a binned list shows no query |
| task 25 | deleting your own account: every list you solely own goes, live or binned, shared or not; a general warning, no per-list preview (the user's call). Only an `auth.users` delete bypassing `delete_account` can still leave an ownerless list ([delete-account-locks-then-removes-sole-owned-lists](delete-account-locks-then-removes-sole-owned-lists.md)) |
| task 26 | Sign in with Apple, native and **iOS only**; Android keeps email and Google, web email. The hidden-email sentence and `Share` for any relay address, on every platform. Deleting an Apple-linked account revokes Apple's stored refresh token first, with no sheet ([apple-refresh-token-revoked-before-account-deletion](apple-refresh-token-revoked-before-account-deletion.md)) |
| task 28 | **invitations between existing accounts**: Sharing invites (`invite_to_list`), nobody joins without accepting, the inviter hears accept and decline, an owner may withdraw. Notifications are **in-app only** — a bell and a Notifications screen, no push, no badge (D6). **Blocking, for invitations only** (D5): pressed on an invitation, it removes nobody from lists and hides nobody from search; an unblock restores every still-pending suppressed invitation ([blocking-is-per-invitation-and-unblock-restores](blocking-is-per-invitation-and-unblock-restores.md)) |

**Still deliberately out: inviting someone with no account (`list_invites`), a block wider than
invitations, push notifications or an app badge, showing an owner how widely a list is shared
without opening it, passwords, and conflict resolution beyond last-write-wins.**

**Two of those are database limits, not backlog laziness.** A stranger needs a `list_invites` table
claimed at sign-up, since `invite_to_list` takes only a resolved user id. And the `list_members`
select policy shows you your own row, so a client-computed "shared with N" would read `1` for everybody.

**"The user can create a list" means *many* named lists**, settled against an ambiguous step-1
description — hence two list screens (`Lists` → `ListDetail`). Do not "simplify" back to one list.

## What a landed step did *not* land — each easy to assume and wrong

- **step 4, offline** — no sync engine (PowerSync if this ever needs real convergence), no
  connectivity library, no conflict resolution beyond last-write-wins, no "wait for sync" on signing
  out with writes pending ([writes-retry-from-an-outbox](writes-retry-from-an-outbox.md)). Reading
  offline *did* land ([list-cache-holds-acknowledged-rows](list-cache-holds-acknowledged-rows.md)).
- **step 5, cloud** — no user-facing feature and no schema change ([supabase-local-stack](supabase-local-stack.md)).
- **step 6, SMTP** — deliverability is unproven, and no physical-device sign-in has ever completed
  against production ([cloud-auth-mail-goes-through-resend](cloud-auth-mail-goes-through-resend.md)).
- **step 8, realtime** — no echo suppression (`x-client-id`) and no "just updated" `SyncBanner` (both
  offered and declined), no presence, no per-field conflict UI: last-write-wins is made *visible*
  ([realtime-is-a-nudge-to-a-per-user-inbox](realtime-is-a-nudge-to-a-per-user-inbox.md)).
- **step 9, deletion** — no policy change, no realtime migration, no restore of a list's items when
  the list itself is restored, and no happens-before: the rule is who you are, not whose change came
  first ([deletion-is-a-tombstone](deletion-is-a-tombstone.md), [writes-can-land-on-a-tombstone](writes-can-land-on-a-tombstone.md)).
- **step 10, item rename** — no re-granted `title` column: the write is a `security definer` RPC
  because the client still holds no UPDATE on `items` at all
  ([server-stamps-done-at](server-stamps-done-at.md)). No realtime migration either.
- **step 11, pagination** — no migration. `ListRow` shows no item count at all, and an item added
  past a loaded page surfaces one scroll away, by design
  ([read-rooted-at-list-members](read-rooted-at-list-members.md)).
- **step 17, user names** — no backfill migration and no forced re-gate of an existing account before
  its next sign-in; every pre-step-17 row hits the same one-time gate as a brand-new account. No
  seeding from Google's `full_name` claim.
- **step 18, share by name** — no scoping to co-members: `search_users_by_name` is an open search
  over every named account, deliberately. No client-side cap — 5 rows, server-side. `set_name` has a
  3-character floor ([trigram-index-needs-three-characters](trigram-index-needs-three-characters.md))
  and still no character-set constraint.
- **step 19, leave list (steps 1-3)** — only a reader/writer's own row uses `leave_list`; an owner's
  "Remove" still calls `remove_member` for every row, their own included. No bulk leave, and no
  "leave and delete my account".
- **step 20, themes (steps 1–5)** — no app icon, no cross-fade, and the choice is per device, not
  per account. **Auto reads no location** ([auto-theme-follows-the-time-zone](auto-theme-follows-the-time-zone.md));
  some native surfaces follow the device ([theme-reaches-native-surfaces](theme-reaches-native-surfaces.md)).
  No iPhone 18 Pro Max pass, and step 5 unseen on Android ([phone-is-the-product](phone-is-the-product.md)).
- **task 23 step 1, paged lists** — no migration or index; the sharing roster is unpaged. Past 100
  lists in a stream, an acknowledged new list drops below the loaded range until a scroll reaches it,
  and a newly shared list arrives on the nudge only if it sorts inside that range.
- **task 23 step 2, limits** — **no locks: overshoot is accepted**, the user's call; task 25's
  ownership locks ([ownership-changes-lock-the-list-row-first](ownership-changes-lock-the-list-row-first.md))
  do not lift it. Count-then-write races under READ COMMITTED, so writes at a limit at the same
  instant can both pass; do not add `for update`, advisory locks, counter columns or serializable
  isolation. No backfill: an account already past a limit keeps everything and cannot add more.
  Ownership, not creation, is the cap, so handing a list over frees a slot. No item count or warning
  anywhere, and neither Restore nor the role picker is pre-checked — the refusal speaks
  ([limit-checks-pass-an-applied-resend](limit-checks-pass-an-applied-resend.md)). The counts the
  warning reads are approximate: they move with this device's creates and bins and with each full
  re-read, never with a nudge.
- **task 24 step 2, the bin view** — no index for the lists bin, so every page of it costs the whole
  account; denormalising the stamp onto `list_members` is the escalation, unbuilt until measured slow
  ([keyset-paging-in-the-order-shown](keyset-paging-in-the-order-shown.md)).
- **task 24 step 3, search and sort** — no server change: both run on the client over the rows held,
  and nothing past the 2,000-row cap is searched or sorted. Bin mode gets no search, no sort, no
  coverage line and no header button. A sort is never synced to the account.
- **task 25, account deletion** — nothing handles another device's 409 on a list create
  ([session-still-valid-guards-writes](session-still-valid-guards-writes.md)).
- **task 26, Sign in with Apple** — no Apple button on Android or web, no Apple sheet at deletion, and
  nothing on cloud beyond Apple enabled in its auth: the `apple_tokens` migration, the three Edge
  Functions and their secrets are local only. A revoke briefly leaves an email-less returning sheet
  ([apple-revoke-leaves-an-email-less-returning-sheet](apple-revoke-leaves-an-email-less-returning-sheet.md)).

**Cloud has every migration but task 26's `20261007000000_apple_tokens.sql`** (`migration list
--linked`, 2026-10-06), and no client has ever connected to the cloud realtime socket. A pushed
migration is schema-level proof, never behaviour-level ([supabase-local-stack](supabase-local-stack.md)).

**What to do:** never add an out-of-scope item speculatively or flag its absence in a review. When a
new task description lands, re-read and update this entry. No `verify:` — scope is a judgment fact.
