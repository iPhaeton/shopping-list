# Step 2 — the sharing UI

**Date:** 2026-09-08
**Description:** [description-step-2.md](description-step-2.md) — "Implement the list sharing UI.
Take into account the suggestion at `ai/suggestions/list-sharing-ui.md`."

Step 1 built the entire database side and no UI. This step built the UI: role gating, list rename,
a sharing screen, and a re-fetch when the app comes back to the front. All four of the suggestion's
staging steps landed in one step, confirmed with the user before any code was written, along with
the choice of two header buttons over one.

## What exists now

| file | |
|---|---|
| `src/state/roles.ts` | new — `canEditItems` / `canManageList` |
| `src/state/types.ts` | `Action` gains `list/renamed` |
| `src/state/listsReducer.ts` | one case for it |
| `src/lib/outbox.ts` | coalesces renames; `dropDependents` learns about them. **`VERSION` stayed 1** |
| `src/lib/listsApi.ts` | `updateListName`, `fetchMembers`, `shareList`, `setMemberRole`, `removeMember`, `Member`, `P0002` in `verdictFor` |
| `src/state/ListsContext.tsx` | `renameList`, role guards, `userId` and `refresh` exposed, foreground re-fetch |
| `src/components/ItemRow.tsx` | optional `editable` |
| `src/components/AddBar.tsx` | optional `initialValue` |
| `src/components/ListRow.tsx` | "Shared with you" |
| `src/components/HeaderButton.tsx` | new |
| `src/components/RolePicker.tsx` | new |
| `src/screens/ListDetailScreen.tsx` | role-gated Add bar, rename bar, header buttons, read-only note |
| `src/screens/SharingScreen.tsx` | new |
| `src/navigation/{types,RootNavigator}.tsx` | the `Sharing` route |

Untouched, as planned: `replay.ts`, `listCache.ts` (`List` gained no field, so no `VERSION` bump),
`SessionContext`, and every migration. **No SQL was written in this step.**

## Decisions, and why

**`updateListName`, not the suggestion's `renameList`.** `listsApi` names functions after the
database verb (`insertList`, `insertItem`, `setItemDone`); the context names them after the user's
verb (`createList`, `addItem`, `toggleItem`). Keeping that split avoids the context's `renameList`
shadowing the import that module-scope `send()` needs — a shadow that compiles and works, and would
mislead the next reader.

**`SharingScreen` gets the current user from `ListsContext`, not `useSession()`.** The provider
already takes `userId` as a prop, so exposing it costs nothing and keeps `SessionProvider` and the
auth mock out of a third test suite. The screen needs it to mark your own roster row and to notice
when your own membership is gone.

**Membership writes deliberately skip the outbox**, for the suggestion's four reasons — the binding
one being that `share_list` resolves the email server-side, so "no account with that email yet" has
to be answered while the user is still looking at the field they typed it into. The screen holds
`members` / `pending` / `error` in `useState`, the way `SignInScreen` holds its phases, and calls
`listsApi` directly.

**The screen chooses its error message from `verdict`, not from `status`.** `retryable` →
`You need a connection to change who has access.`, anything else → the database's own message
verbatim. That is what makes the `P0002` fix load-bearing rather than incidental: without it, a typo
in the invite field would be reported as an outage.

**`refresh` is a guarded wrapper; the internal one was renamed `hydrate`.** `flush` guards itself
against a fetch, but nothing guarded a fetch against a flush — a read issued mid-flush can come back
without the write in the air just as the loop dequeues it, and the row vanishes until the next
fetch. The guard could **not** go inside `hydrate`: the flush loop's own rollback re-fetch runs with
`flushing.current` set and has to go through. So `hydrate` stayed unguarded and private, and the
exposed `refresh` skips when `flushing` or `retry` is set.

**`SignOutButton` was not refactored onto the new `HeaderButton`,** though they are the same ten
lines. `queries-go-through-a11y-labels`'s `verify:` command greps `accessibilityLabel` inside
`src/components/SignOutButton.tsx`, and only the librarian may edit that entry — the duplication is
worth less than a green `kb:audit`. Handed over as a candidate fact instead.

## Problems hit

**The plan gated the wrong button.** It said header buttons were owner-only *and* that the sharing
screen was reachable by every member — which cannot both be true, since the button is the only way
in. Caught while scripting the browser run, before Bob's session existed to expose it. Fixed:
`Share list` renders for every member (the roster is readable by all of them), `Rename list` only
for an owner. Two suites moved with it.

**`dropDependents` did not compile.** Its `list/created` arm was
`ops.filter((op) => op.type === 'list/created' || op.listId !== failed.id)`, and `list/renamed`
carries `id`, not `listId`. Anticipated in the plan and rewritten to branch on `op.type` explicitly.
This is the union doing its job: a new `WriteAction` cannot be added without every exhaustive switch
being revisited.

**`fetchMembers` would have crashed on a null body.** Found by a test that stubbed
`{ data: null, error: null }` for a different assertion. A set-returning function with no rows can
answer that way, and an empty roster is a fine answer while a crash is not — fixed in the source
(`(data ?? [])`), not in the test.

**`select=` alone is not enough — `Prefer: return=representation` is what returns the rows.** A
hand-rolled `curl` PATCH carrying only `select=id` came back **204 with an empty body**, the same as
without it, which briefly looked like the whole fix failing. supabase-js's `.select()` adds the
`Prefer` header itself, which is why the app's own PATCH returned **200**. Re-running the curl with
the header reproduced the refusal exactly. Worth knowing: reproducing a postgrest-js call by hand
needs the header, or the reproduction lies.

**Header buttons are not directly renderable in RNTL.** `navigation.setOptions` is a stub, so
`headerRight` never mounts. Rather than rendering it into a second tree — which would leave the
button's `setRenaming` pointing at a different component instance — `ListDetailScreen.test.tsx`
grew a `Chrome` wrapper whose `setOptions` keeps the last options in state and renders them in the
*same* tree. That mirrors what the navigator actually does and makes the rename bar assertable.

**`navigation.setOptions` assertion broke,** as the plan predicted: `headerRight` now travels in the
same call as `title`. Changed to `expect.objectContaining`.

## How it was verified

`npm test` (146 tests, 11 suites), `npm run typecheck`, and `npm run kb:audit` — **0 errors**, so
every existing `verify:` command still holds, including the outbox entry's dispatch/enqueue count
and the a11y-label greps. The 12 warnings are "ground moved" staleness flags, which is the deposit's
job.

Then a browser run against the local stack with two real accounts (Alice through the app's own OTP
flow via Mailpit; Bob through the admin API, then OTP). The stack was empty before and was left
empty after — both accounts, the list and its items were removed.

1. **Owner.** Both header buttons present. Rename bar opens pre-filled with the current name; saving
   changed the header, the row, and the database.
2. **`P0002`.** Inviting `nobody@example.com` rendered `no account with that email yet` in the
   alert, left the address in the field, and the network tab shows `rpc/share_list` sent **once**.
3. **Measurement 1, the important one.** The network tab shows
   `PATCH /rest/v1/lists?id=eq.<id>&select=id => 200 OK` — the request carries `select=`. Driving
   the same request as Bob (a reader) with the headers supabase-js sends returned **`200` with body
   `[]`**: zero rows, no error, which `updateListName` turns into a `permanent` refusal. Without the
   `.select()` it is a `204` that `resultFor` would call `ok`, and the outbox would drop the write as
   delivered.
4. **Reader.** Bob's list row said *Shared with you* in both the visible text and the composed label.
   His detail screen had no Add bar, no Rename button, the read-only line, and disabled checkboxes —
   Playwright refused to click one (`aria-disabled="true"`, pointer events off). His sharing screen
   showed the full roster and `Only an owner can change who has access.`
5. **Foreground re-fetch.** Bob (promoted to writer) inserted an item out of band. Alice's tab did
   not have it; dispatching `visibilitychange` hidden→visible brought it in.
6. **Offline.** With the context offline, a rename stayed on screen under the muted sync banner (not
   the red one) while the database still held the old name; reconnecting flushed it and the new name
   landed.
7. **Last owner.** As sole owner, Alice's own demote and remove were disabled with the hint.
   Promoting Bob to owner unlocked them and dropped the hint. Removing herself bounced her to
   *My Lists* with the list gone from it. The trigger's own refusal was confirmed separately in
   `psql` — `ERROR: a list must keep at least one owner` — so the race the disabled control cannot
   cover is still caught.

Also confirmed in passing: `set_item_done` refuses a reader with `42501` → 403, and a non-owner's
`DELETE` on `list_members` returns **204 having deleted nothing** (measurement 3). That second one is
why there is no "Leave this list" button; it is already item 10 in `backlog/backlog.txt`.

## Not built, on purpose

Inviting an address with no account (`list_invites`), leaving a list you do not own, showing an owner
how widely a list is shared without opening it, realtime, and deletion. All still out, all for the
reasons the suggestion gives.

One incidental observation, not caused by this step: deleting an account through the admin API leaves
its lists and items behind as orphans with no `list_members` rows. Nothing in the app can reach them.
Out of scope here, but it is the shape of a real cleanup question if account deletion ever matters.
