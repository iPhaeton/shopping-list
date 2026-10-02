---
id: scope-boundaries
title: Scope — named lists, OTP sign-in, offline writes, sharing, realtime, deletion, paged items and paged lists, required unique names, leaving a list, Day/Night/Auto themes, and list and item limits in; invites out
type: constraint
status: current
tags: [scope, product]
sources: [ai/tasks/1/description-step-1.md, ai/tasks/2/description-step-2.md, ai/tasks/3/description-step-1.md, ai/tasks/4-offline-support/description-step-1.md, ai/tasks/4-offline-support/implementation-log-step-1.md, ai/tasks/5-supabase-cloud/description-step-1.md, ai/tasks/6-custom-smtp/description-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-2.md, ai/tasks/7-list-sharing/description-step-1.md, ai/tasks/7-list-sharing/description-step-2.md, ai/tasks/8-realtime/description-step-1.md, ai/tasks/8-realtime/implementation-log-step-1.md, ai/tasks/9-deletion/description-step-1.md, ai/tasks/9-deletion/implementation-log-step-1.md, ai/tasks/10-rename-item/description-step-1.md, ai/tasks/10-rename-item/implementation-log-step-1.md, ai/tasks/11-pagination/description-step-1.md, ai/tasks/11-pagination/implementation-log-step-1.md, ai/tasks/11-pagination/description-step-2.md, ai/tasks/11-pagination/implementation-log-step-2.md, ai/tasks/12-rename-shoppingloop/description-step-1.md, ai/tasks/12-rename-shoppingloop/implementation-log-step-1.md, ai/tasks/13-google-sign-in/plan-step-1.md, ai/tasks/13-google-sign-in/implementation-log-step-1.md, ai/tasks/13-google-sign-in/description-step-2.md, ai/tasks/13-google-sign-in/implementation-log-step-2.md, ai/tasks/14-account-screen/description-step-1.md, ai/tasks/14-account-screen/implementation-log-step-1.md, ai/tasks/17-user-names/description-step-1.md, ai/tasks/17-user-names/implementation-log-step-1.md, ai/tasks/18-share-by-name/description-step-1.md, ai/tasks/18-share-by-name/implementation-log-step-1.md, ai/tasks/18-share-by-name/implementation-log-step-2.md, ai/tasks/19-remove-oneself/description-step-1.md, ai/tasks/19-remove-oneself/implementation-log-step-1.md, ai/tasks/19-remove-oneself/description-step-3.md, ai/tasks/19-remove-oneself/implementation-log-step-3.md, ai/tasks/20-ux/description-step-1.md, ai/tasks/20-ux/implementation-log-step-1.md, ai/tasks/20-ux/description-step-2.md, ai/tasks/20-ux/implementation-log-step-2.md, ai/tasks/20-ux/description-step-5.md, ai/tasks/20-ux/implementation-log-step-5.md, ai/tasks/23-list-limits/description-step-1.md, ai/tasks/23-list-limits/implementation-log-step-1.md, ai/tasks/23-list-limits/description-step-2.md, ai/tasks/23-list-limits/implementation-log-step-2.md, ai/tasks/24-search-and-sort/description-step-1.md, ai/tasks/24-search-and-sort/description-step-2.md, ai/tasks/24-search-and-sort/implementation-log-step-2.md, b78d16f]
last_verified: 2026-10-02
related: [suggestions-are-proposals, keyset-paging-in-the-order-shown, writes-retry-from-an-outbox, list-cache-holds-acknowledged-rows, list-data-scoped-by-rls, select-policy-gates-update-and-delete, refused-writes-return-zero-rows, server-stamps-done-at, realtime-is-a-nudge-to-a-per-user-inbox, deletion-is-a-tombstone, writes-can-land-on-a-tombstone, read-rooted-at-list-members, max-rows-is-a-silent-ceiling, supabase-local-stack, supabase-target-picked-at-runtime, otp-email-templates-carry-the-code, supabase-config-push-sends-the-whole-root, cloud-auth-mail-goes-through-resend, shoppingloop-is-the-visible-name-only, native-build-toolchain, google-native-signin-library-gaps, session-still-valid-guards-writes, signed-in-event-fires-on-restore-too, trigram-index-needs-three-characters, phone-is-the-product, theme-reaches-native-surfaces, theme-tokens-only, auto-theme-follows-the-time-zone, limit-checks-pass-an-applied-resend]
---

Scope is set one task step at a time, by the `ai/tasks/<n>/description-step-<n>.md` that opens the
step — never by a document in `ai/suggestions/`, which is a proposal until a description promotes it
([suggestions-are-proposals](suggestions-are-proposals.md)). What is in, as of task 24 step 2:

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
| step 9 | deleting lists and items — as tombstones behind a "Show deleted" switch, restorable by whoever may delete, purged after 30 days |
| step 10 | renaming an item, by an owner or writer — an inline editor on the row, sent through a `rename_item` RPC like every other item write |
| step 11 | a list's items paged, fetched only once the list is opened — a first page of live rows and of the bin together, the rest read on scroll by keyset |
| step 12 | the app is called **ShoppingLoop** wherever a person sees it — visible name only; `slug`, `scheme`, `package.json` and `project_id` stay `shopping-list` ([shoppingloop-is-the-visible-name-only](shoppingloop-is-the-visible-name-only.md)) |
| step 13 phases 1-2 | Google added as a second sign-in method: `[auth.external.google]` enabled and proven server-side (phase 1), then a native-only "Continue with Google" button (`Platform.OS !== 'web'`) and `SessionContext.signInWithGoogle` added client-side, delegating to `src/lib/googleSignIn.ts` (phase 2); still no production push and no completed real-account sign-in on either device ([google-native-signin-library-gaps](google-native-signin-library-gaps.md)) |
| step 14 | an Account screen: plain "Sign out" moved off the `Lists` header behind it, alongside a separately confirmed "Sign out of all devices" (`supabase.auth.signOut({ scope: 'global' })`) |
| step 17 | every account gets a required, unique (case-insensitive), editable display name — a blocking `SetNameScreen` gate between sign-in and the rest of the app, an `Account` screen edit, and the sharing roster showing names instead of emails |
| step 18 | inviting is by name, not email: a live, debounced autocomplete (`search_users_by_name`, trigram-indexed, self-excluded, capped at 5) replaces the free-typed address field, and `share_list` now takes an id the search already resolved instead of resolving an email server-side |
| step 19 | a reader or writer can remove themselves from a list they don't own ("Leave list"), through a fourth membership RPC, `leave_list`; an owner still removes anyone — including themselves — through the existing `remove_member` behind "Remove", now behind the same two-step Cancel/confirm every row gets (step 3) |
| step 20 steps 1–5 | the **Quiet Horizon** restyle, and with it **the phone becomes the product** ([phone-is-the-product](phone-is-the-product.md)): two role-keyed palettes, Day and Night ("Moonlit"), Nunito Sans + Source Serif 4, and a Day / Night / **Auto** choice under "Appearance" on Account, stored per device — Auto, the default, is night from sunset to sunrise at the time zone's city ([auto-theme-follows-the-time-zone](auto-theme-follows-the-time-zone.md)); applied flat at first; steps 3–5 then rebuilt every screen, and the native launch screen, to the mockups in `ai/ux/primary/` |
| task 23 step 1 | the lists themselves paged the way items are — 100 a page, live and bin streams, page 1 of both on every fetch, the rest on scroll |
| task 23 step 2 | three limits the database enforces: 100 lists you **own**, 1,000 lists you are on, 1,000 items in a list, none counting the bin; at either list limit the Lists screen swaps its Create bar for a sentence saying so |
| task 24 step 2 | "Show deleted" switches either screen to its bin alone — newest deletion first and paged that way, no Create / Add bar, `The bin is empty` once emptied; the switch reads `Show deleted` with no count, and no row carries a `Deleted` tag. **The bin is never searched, sorted another way, or loaded in full** |

**Still deliberately out: inviting someone with no account (`list_invites`), showing an owner how
widely a list is shared without opening it, passwords, and conflict resolution beyond last-write-wins.**

**Two of those are database limits, not backlog laziness.** A stranger needs a `list_invites` table
claimed at sign-up — since step 18 `share_list` takes only a tapped `search_users_by_name` result. And
a list cannot say "shared with 2 people": the `list_members` select policy shows you your own row, so
any count the client computed would read `1` for everybody.

Equally deliberate, and in the same family: a sole owner deleting their account leaves an **ownerless
list nobody can see or clean up** — the alternative was cascading onto lists other people are in
([list-data-scoped-by-rls](list-data-scoped-by-rls.md)).

**"The user can create a list" means *many* named lists, not one standing list** — settled against a
genuinely ambiguous step-1 description, which is why there are two list screens (`Lists` →
`ListDetail`). Treat it as settled: do not "simplify" the product back to one list.

## What a landed step did *not* land

Each of these is easy to assume and wrong:

- **step 4, offline** — no sync engine (PowerSync if this ever needs real convergence), no
  connectivity library, no conflict resolution beyond last-write-wins, no "wait for sync" on signing
  out with writes pending ([writes-retry-from-an-outbox](writes-retry-from-an-outbox.md)). Reading
  offline *did* land ([list-cache-holds-acknowledged-rows](list-cache-holds-acknowledged-rows.md)).
- **step 5, cloud** — no user-facing feature and no schema change; flows are still verified on web
  against local ([supabase-local-stack](supabase-local-stack.md)), looks on the phone.
- **step 6, SMTP** — deliverability is unproven, and no physical-device sign-in has ever completed
  against production ([cloud-auth-mail-goes-through-resend](cloud-auth-mail-goes-through-resend.md)).
- **step 8, realtime** — no echo suppression (`x-client-id`) and no "just updated" `SyncBanner`; both
  were offered to the user and declined. No presence and no per-field conflict UI either:
  last-write-wins is made *visible* rather than replaced
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
- **task 23 step 1, paged lists** — no migration or index; the sharing roster is still unpaged.
  Accepted by parity with items, and reachable only past 100 lists in a stream: a list created here,
  once acknowledged, drops below the loaded range until a scroll reaches it; a list newly shared
  with you arrives on the nudge only if it sorts inside the loaded range, otherwise with its page.
- **task 23 step 2, limits** — **no locks: overshoot is accepted**, the user's call. Count-then-write
  races under READ COMMITTED, so writes at a limit at the same instant can both pass; do not add
  `for update`, advisory locks, counter columns or serializable isolation. No backfill: an account
  already past a limit keeps everything and cannot add more. Ownership, not creation, is the cap, so
  handing a list over frees a slot. No item count or warning anywhere, and neither Restore nor the
  role picker is pre-checked — the refusal speaks
  ([limit-checks-pass-an-applied-resend](limit-checks-pass-an-applied-resend.md)). The counts the
  warning reads are approximate: they move with this device's creates and bins and with each full
  re-read, never with a nudge.
- **task 24 step 2, the bin view** — no index for the lists bin, so every page of it costs the whole
  account; denormalising the stamp onto `list_members` is the escalation, unbuilt until measured slow
  ([keyset-paging-in-the-order-shown](keyset-paging-in-the-order-shown.md)).

**Cloud is ten migration files behind local, not pushed at all** — every `supabase/migrations/*.sql`
dated after `20260909000000`, from deletion to the item bin's index — and no client has ever
connected to the cloud realtime socket. A pushed migration is schema-level proof, never
behaviour-level ([supabase-local-stack](supabase-local-stack.md)).

**What to do:** do not add any of the out-of-scope items speculatively, and do not treat their
absence as a gap worth flagging in a review. When a new task description lands, re-read this entry
and update it — that is the moment it goes stale. No `verify:` — scope is a judgment fact.
