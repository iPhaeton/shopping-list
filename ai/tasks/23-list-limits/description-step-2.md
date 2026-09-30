# Step 2 — Limit owned lists, lists joined, and items per list

The user's requests 1–3 are quoted verbatim in [description-step-1.md](description-step-1.md). Two
later ones (2026-09-30) replace request 2's "created by" with ownership:

5. "Would it make it more difficult if I change limits like this:
   - 100 lists where the user is an owner
   - 1000 lists in total for a user
   - 1000 items in a list"
6. "Yes, update" (said after being told the owner version is slightly simpler)
7. "ok, 2 warnings" (said after being asked whether all three limits should warn in the app before
   they are hit, or only the two list limits)

**Step 1 must land first.** Overshoot is accepted, so memberships can exceed `MAX_ROWS`. The counts
below also come from the server, because a paged client cannot count.

## The limits

| limit | counts | ways past it |
|---|---|---|
| 100 owned lists | `list_members` rows with `role = 'owner'` for the user, list not in the bin | create a list, be shared a list as owner, be promoted to owner, restore a list you own |
| 1,000 lists in total | `list_members` rows for the user, any role, list not in the bin | create a list, be shared a list, restore a list |
| 1,000 items per list | the list's items, not in the bin | add an item, restore one |

- **Owned, not created.** An owner is a member by definition, so a user removed from or demoted on a
  list stops counting it. There is no stuck slot to design around.
- **Handing a list over frees the slot** (make someone else owner, then remove yourself). This
  looks like a loophole but is not one, because the recipient's own 100 limit still applies. The
  user was told this and did not object.
- **Nothing in the bin counts.** Binning frees a slot at once, and restoring takes one.
- **No locks. Overshoot is accepted** (request 3).
  - Count-then-insert races under READ COMMITTED, so simultaneous writes at a limit can both pass.
  - A restore checks only the caller, not the list's other members or owners.
  - Do **not** add `for update`, advisory locks, counter columns or serializable isolation.
- **Existing data is not touched and nothing is backfilled.** An account already over a limit keeps
  everything and cannot add more.

## Database: one migration

**Both list limits live on `list_members`. There is no trigger on `lists`.**

- **Before-insert trigger on `list_members`:**
  - It checks the total limit for `new.user_id`, and the owned limit as well when
    `new.role = 'owner'`.
  - It passes a row whose `(list_id, user_id)` already exists. `share_list` is an
    `insert … on conflict do update`, so a re-share is really a role change, and the update trigger
    below judges it.
  - This covers creating a list (the `on_list_created` → `grant_creator_ownership` insert, which is
    always `owner`) and `share_list` to a new member.
- **Before-update trigger on `list_members`:** it checks the owned limit for `new.user_id` only when
  `old.role <> 'owner' and new.role = 'owner'`. This covers `set_member_role` and `share_list`'s
  upsert. A demotion or any other update is never checked.
- **`add_item`:** the item limit.
- **`set_item_deleted(p_deleted => false)`:** the item limit, only when the target item is
  currently in the bin.
- **`set_list_deleted(p_deleted => false)`:** the caller's total and owned limits, only when the list
  is currently in the bin. Only an owner can restore, so the caller always counts toward both.

Inside the RPCs, each check goes after `session_still_valid()` and after the existing permission
and tombstone checks, so a caller without access learns nothing about counts.

**Retries must stay idempotent.** The outbox resends a write whose response was lost, even though
the database already holds it. A limit check that counts that row turns a success into a refusal,
and the outbox then drops the write and its dependents.

- **Creating a list is safe by construction. Keep it that way.**
  - A resent `list/created` fails on the `lists` primary key with `23505`, which the client
    classifies `applied`.
  - The membership insert, and with it both list checks, runs from an **after**-insert trigger, which
    never fires when the insert fails.
  - Moving either check into a **before**-insert trigger on `lists` would bring the trap back. A
    before trigger fires ahead of the primary-key check, so the resend would be refused as over the
    limit, and `dropDependents` would drop every item queued into the list.
- **`add_item` is not safe on its own.** It inserts with `on conflict (id) do nothing` and reports
  `applied`, but its count would include the already-saved row. Skip the count when `p_id` already
  exists.
- **The restore checks** run only when the row is actually in the bin, so a resent restore stays a
  no-op.
- The membership RPCs (`share_list`, `set_member_role`) are not queued or retried. They are answered
  on the Sharing screen while the user watches.

## Error codes

Use one SQLSTATE per limit.

**Each must reach the client as a 4xx.** Here is why:

- `verdictFor` in [listsApi.ts](../../../src/lib/listsApi.ts) treats a 5xx, or anything it does not
  recognise, as `retryable`.
- The outbox is serial and has no attempt cap. A limit refusal that arrives as a 5xx therefore
  retries every 30 s forever, and every write behind it stalls.
- The status PostgREST gives a SQLSTATE cannot be guessed: `P0002` came back 500
  ([writes-retry-from-an-outbox](../../kb/entries/writes-retry-from-an-outbox.md)).

So measure each code's status through `/rest/v1` on the local stack before wiring the client, and
record it in the log. PostgREST's `PTxxx` codes set the status explicitly, which is an option, not a
requirement. Classify by code, never by message.

**Each code reaches up to two readers:**

| limit | queued write → `humanize` sentence | Sharing screen → database's own words (`resultFor`, not rephrased) |
|---|---|---|
| owned | "You own 100 lists. Delete one or hand one over to make room." | share as owner, or promote: e.g. "they already own 100 lists" |
| total | "You're on 1,000 lists. Delete or leave one to make room." | share: e.g. "they are already on 1,000 lists" |
| items | "This list is full: 1,000 items at most." | n/a |

- The trigger messages are written for the Sharing screen: an owner reading about someone else, in
  the house style of "that account no longer exists".
- On the creator's own insert, `humanize` replaces that text, so one message serves both readers.

## Warnings in the app

**The user chose request 7: only the two list limits warn before the tap.** The item limit gets no
warning. Its enforcement is the database refusal alone.

- **Constants:** `MAX_OWNED_LISTS = 100`, `MAX_LISTS = 1000` and `MAX_ITEMS = 1000` go beside
  `MAX_ROWS` in `listsApi.ts`. They are kept equal to the migration by hand, with a comment on each
  side pointing at the other, like `MAX_ROWS` and `config.toml`. `MAX_ITEMS` is used only by the
  `humanize` sentence.
- **Lists.**
  - Read both counts during `hydrate`, alongside page 1.
  - Recommended: one `security invoker` RPC returning `(owned, total)`, rooted at `list_members`
    per [read-rooted-at-list-members](../../kb/entries/read-rooted-at-list-members.md). Measure it.
  - Hold the counts in state beside the list cursors, add them to the cache (`VERSION` bump), and
    count each pending `list/created` on this device toward both.
  - At either limit, `ListsScreen` replaces the "New list name" `AddBar` with the matching sentence.
- **Items: no count and no UI change.**
  - `fetchItems`, `List` and `ListDetailScreen` stay as they are.
  - The 1,001st item works like this:
    - It appears optimistically.
    - It is refused on flush, which is within about a second online, or on reconnect.
    - It disappears on the re-fetch, and the red banner shows the sentence.
  - The rejected option was a per-list server count. It goes stale after deletions: the add bar
    would stay hidden until the next reload, which offline means until reconnecting. That was not
    worth it for a limit a shopping list practically never reaches.
- **Not pre-checked:** Restore (the binned list's Restore and `BlockedBanner`), and the Sharing
  screen's role picker. The refusal and its message handle them.
- **The counts are approximate by design.** Other members' writes and the accepted overshoot make
  them so, and the database is the authority.

## Tests

- jest:
  - `verdictFor` classifies each code `permanent`.
  - `humanize` gives each sentence verbatim.
  - `ListsScreen` swaps its `AddBar` for the matching sentence at each list limit, and not below.
  - A refused `item/added` with the items code leaves one banner with the sentence.
  - Pending creates count toward the limit.
  - `SharingScreen` shows the database message on a refused share or promotion.
- SQL, run by hand as `authenticated` on the local stack, recorded in the log:
  - Each limit passes at 99 or 999 and refuses at 100 or 1,000.
  - Binned rows don't count.
  - Promotion refusals:
    - `set_member_role` to owner is refused at 100 owned.
    - `share_list` as owner is refused at 100 owned, both as a new member and as an upsert over a
      writer.
  - Things that must not be refused:
    - `share_list` as writer to someone at 100 owned succeeds.
    - Re-sharing an existing member at 1,000 total only changes the role.
    - Demoting a user frees an owned slot.
  - **Resends at the limit:**
    - An already-applied `insertList` still comes back `23505`.
    - An already-applied `add_item` still comes back `applied`.

## Verification

1. **Local stack only**, as in step 1.
2. **Browser:** reach each limit through the UI.
   - At either list limit, the sentence replaces the "New list name" bar.
   - Add the 1,001st item. It appears, then disappears, and the banner shows the items sentence.
   - Offline, queue a list with items past the owned limit, then reconnect. Expect the red banner
     with the sentence, the list gone, and its queued items gone with it (one banner, not a burst).
   - Promote a member who owns 100: the message appears on the Sharing screen.
   - Share with an account on 1,000: the message appears on the Sharing screen.
3. **Phone:** iOS simulator screenshots of the Lists screen showing each sentence, and nothing else.
   List detail's look does not change.
4. **Commands:** `npm test`, `npm run typecheck`, `npm run kb:audit`.

## KB impact (for the librarian)

| entry | change |
|---|---|
| scope-boundaries | the three limits are in, with overshoot accepted and ownership as the per-user cap |
| writes-retry-from-an-outbox | three new SQLSTATEs in `verdictFor` and `humanize`, with their measured statuses |
| list-cache-holds-acknowledged-rows | the `VERSION` bump |
| likely new entry | a limit check must let an already-applied resend through. A list check on `lists` would have to be a before-insert trigger, which fires ahead of the primary-key check, so the checks live on `list_members`. `add_item` skips the count for an existing id |
