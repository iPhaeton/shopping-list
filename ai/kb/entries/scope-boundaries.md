---
id: scope-boundaries
title: Scope — named lists, OTP sign-in, offline writes, sharing, realtime, deletion, paged items, required unique names and leaving a list in; invites and paged lists out
type: constraint
status: current
tags: [scope, product]
sources: [ai/tasks/1/description-step-1.md, ai/tasks/2/description-step-2.md, ai/tasks/3/description-step-1.md, ai/tasks/4-offline-support/description-step-1.md, ai/tasks/4-offline-support/implementation-log-step-1.md, ai/tasks/5-supabase-cloud/description-step-1.md, ai/tasks/6-custom-smtp/description-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-2.md, ai/tasks/7-list-sharing/description-step-1.md, ai/tasks/7-list-sharing/description-step-2.md, ai/tasks/8-realtime/description-step-1.md, ai/tasks/8-realtime/implementation-log-step-1.md, ai/tasks/9-deletion/description-step-1.md, ai/tasks/9-deletion/implementation-log-step-1.md, ai/tasks/10-rename-item/description-step-1.md, ai/tasks/10-rename-item/implementation-log-step-1.md, ai/tasks/11-pagination/description-step-1.md, ai/tasks/11-pagination/implementation-log-step-1.md, ai/tasks/11-pagination/description-step-2.md, ai/tasks/11-pagination/implementation-log-step-2.md, ai/tasks/12-rename-shoppingloop/description-step-1.md, ai/tasks/12-rename-shoppingloop/implementation-log-step-1.md, ai/tasks/13-google-sign-in/plan-step-1.md, ai/tasks/13-google-sign-in/implementation-log-step-1.md, ai/tasks/13-google-sign-in/description-step-2.md, ai/tasks/13-google-sign-in/implementation-log-step-2.md, ai/tasks/14-account-screen/description-step-1.md, ai/tasks/14-account-screen/implementation-log-step-1.md, ai/tasks/17-user-names/description-step-1.md, ai/tasks/17-user-names/implementation-log-step-1.md, ai/tasks/18-share-by-name/description-step-1.md, ai/tasks/18-share-by-name/implementation-log-step-1.md, ai/tasks/18-share-by-name/implementation-log-step-2.md, ai/tasks/19-remove-oneself/description-step-1.md, ai/tasks/19-remove-oneself/implementation-log-step-1.md, b78d16f]
last_verified: 2026-09-23
related: [suggestions-are-proposals, writes-retry-from-an-outbox, list-cache-holds-acknowledged-rows, list-data-scoped-by-rls, select-policy-gates-update-and-delete, refused-writes-return-zero-rows, server-stamps-done-at, realtime-is-a-nudge-to-a-per-user-inbox, deletion-is-a-tombstone, writes-can-land-on-a-tombstone, read-rooted-at-list-members, max-rows-is-a-silent-ceiling, supabase-local-stack, supabase-target-picked-at-runtime, otp-email-templates-carry-the-code, supabase-config-push-sends-the-whole-root, cloud-auth-mail-goes-through-resend, shoppingloop-is-the-visible-name-only, native-build-toolchain, google-native-signin-library-gaps, session-still-valid-guards-writes, signed-in-event-fires-on-restore-too, trigram-index-needs-three-characters]
---

Scope is set one task step at a time, by the `ai/tasks/<n>/description-step-<n>.md` that opens the
step — never by a document in `ai/suggestions/`, which is a proposal until a description promotes it
([suggestions-are-proposals](suggestions-are-proposals.md)). What is in, as of step 19:

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
| step 14 | an Account screen: plain "Sign out" moved off the `Lists` header behind it, alongside a separately confirmed "Sign out of all devices" (`supabase.auth.signOut({ scope: 'global' })`) |
| step 17 | every account gets a required, unique (case-insensitive), editable display name — a blocking `SetNameScreen` gate between sign-in and the rest of the app, an `Account` screen edit, and the sharing roster showing names instead of emails |
| step 18 | inviting is by name, not email: a live, debounced autocomplete (`search_users_by_name`, trigram-indexed, self-excluded, capped at 5) replaces the free-typed address field, and `share_list` now takes an id the search already resolved instead of resolving an email server-side |
| step 19 | a reader or writer can remove themselves from a list they don't own ("Leave list"), through a fourth membership RPC, `leave_list` — an owner keeps using the existing "Remove" control on their own row, unchanged |

**Still deliberately out: inviting someone with no account (`list_invites`), showing an owner how
widely a list is shared without opening it, passwords, and conflict resolution beyond
last-write-wins.** (Leaving a list you do not own — item 10 in `backlog/backlog.txt` — shipped in step
19, below.)

**Two of those are database limits, not backlog laziness** — neither is an afternoon of UI work:

- **Since step 18 this is enforced structurally, not just by a refusal.** There is no free-text field
  into `share_list` any more, only a tap on a `search_users_by_name` result, so the UI cannot even
  construct a request naming an account that doesn't exist. `share_list`'s `P0002` now guards only the
  narrower race of the account vanishing between the search and the tap. Conclusion unchanged: a
  stranger needs a `list_invites` table claimed at sign-up before they can be invited.
- A list you own cannot say "shared with 2 people": the `list_members` select policy shows you your
  own row, so any count the client computed would read `1` for everybody.

Equally deliberate, and in the same family: a sole owner deleting their account leaves an **ownerless
list nobody can see or clean up** — the alternative was cascading onto lists other people are in
([list-data-scoped-by-rls](list-data-scoped-by-rls.md)).

**"The user can create a list" means *many* named lists, not one standing list** — settled against a
genuinely ambiguous step-1 description, which is why there are two list screens (`Lists` →
`ListDetail`). Treat it as settled: do not "simplify" the product back to one list.

## What a landed step did *not* land

Each of these is easy to assume and wrong:

- **step 4, offline** — no sync engine (PowerSync is the answer if this ever needs real convergence),
  no connectivity library, no conflict resolution beyond last-write-wins, and no "wait for sync"
  confirmation when signing out with writes pending. Reading offline *did* land with it: without a
  cached copy a cold start with no signal shows an empty app
  ([writes-retry-from-an-outbox](writes-retry-from-an-outbox.md),
  [list-cache-holds-acknowledged-rows](list-cache-holds-acknowledged-rows.md)).
- **step 5, cloud** — no user-facing feature and no schema change. Nothing about the local-first
  workflow changed; web is still where work is verified
  ([supabase-local-stack](supabase-local-stack.md)).
- **step 6, SMTP** — phase 2 (a verified sending domain) landed 2026-09-17: a stranger's
  `signInWithOtp` now reaches a real inbox, not just the Resend account owner's. Deliverability
  itself is still unproven and no physical-device sign-in has ever completed against production
  ([cloud-auth-mail-goes-through-resend](cloud-auth-mail-goes-through-resend.md),
  [otp-email-templates-carry-the-code](otp-email-templates-carry-the-code.md)).
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
- **step 11, pagination** — no migration. The sharing roster and the lists themselves are **not**
  paged — lists stop at `MAX_ROWS` with a dev-time warning, `ListRow` shows no item count at all, and
  an item added past a loaded page surfaces one scroll away, by design
  ([read-rooted-at-list-members](read-rooted-at-list-members.md),
  [max-rows-is-a-silent-ceiling](max-rows-is-a-silent-ceiling.md)).
- **step 13, Google sign-in (phases 1-2)** — server and client both landed: `[auth.external.google]`
  validates a real token, and a native, `Platform.OS !== 'web'` "Continue with Google" button in
  `src/lib/googleSignIn.ts` (see [google-native-signin-library-gaps](google-native-signin-library-gaps.md)).
  Still not landed: any push to production, or a completed real-account sign-in on either device.
- **step 17, user names** — no backfill migration and no forced re-gate of an existing account before
  its next sign-in; every pre-step-17 row hits the same one-time gate as a brand-new account. No
  seeding from Google's `full_name` claim. (No length floor yet here — step 18 added one, below.)
- **step 18, share by name** — no scoping to co-members: `search_users_by_name` is an open search
  over every named account, resolved that way deliberately (`ai/suggestions/share-by-name.md`'s
  tradeoff). No client-side cap either — 5 rows is enforced once, server-side. Its second half added
  the length floor step 17 lacked: `set_name` now rejects under 3 characters, DB-enforced, no
  backfill needed — [trigram-index-needs-three-characters](trigram-index-needs-three-characters.md)
  has why. Still no character-set constraint.
- **step 19, leave list** — only a reader/writer's own row gets the "Leave list" control; an owner's
  existing "Remove" + `remove_member` path is unchanged, not migrated onto `leave_list`. No bulk leave
  and no "leave and delete my account" combination.

**Cloud is seven migrations behind local, not pushed at all** — deletion, purge scheduling, item
rename, session revocation, user names, share-by-name and leave-list (steps 9, 10, 15, 17, 18, 19,
every `supabase/migrations/*.sql` dated after `20260909000000`) — and no client has ever connected to
the cloud realtime socket. A pushed migration is schema-level proof, never behaviour-level
([supabase-local-stack](supabase-local-stack.md)).

**What to do:** do not add any of the out-of-scope items speculatively, and do not treat their
absence as a gap worth flagging in a review. When a new task description lands, re-read this entry
and update it — that is the moment it goes stale.

No `verify:` command — scope is a judgment fact.
