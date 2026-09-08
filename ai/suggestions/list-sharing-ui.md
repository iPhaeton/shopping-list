# Suggestion — the sharing UI

**Status:** proposal, not an approved step. It covers staging steps 2 and 3 of
[list-sharing.md](list-sharing.md), which
[step 1](../tasks/7-list-sharing/implementation-log-step-1.md) deliberately left unbuilt. Adopting it
needs an `ai/tasks/7-list-sharing/description-step-2.md` first, and it moves
[scope-boundaries](../kb/entries/scope-boundaries.md) again — sharing UI is currently listed as out.

**Date:** 2026-09-08

## Where this starts

The database side is done and verified: `list_members`, five role policies, `share_list`,
`set_member_role`, `remove_member`, `list_members_of`, the last-owner trigger, and a `set_item_done`
that raises on refusal. The client knows your `role` on every list, because `fetchLists` is rooted at
`list_members` and carries it.

Nothing in the UI reads that `role`. A `reader` sees an enabled **Add** button, taps it, and gets a
red banner with the database's own refusal in it. Correct, and not pleasant — and there is no way at
all to share a list from the app, so the feature is unreachable without `psql`.

Three properties of the schema decide the shape of everything below, and none of them are negotiable
from the client:

1. **Your role arrives free with the fetch.** No extra round trip, no extra state — role-gating the
   screens costs nothing and works offline.
2. **The roster does not.** `list_members_of` is an RPC, it is not in `State`, and it is not cached.
   A share sheet is therefore an online-only screen, unlike every other screen in this app.
3. **Only an owner may touch membership — including their own.** The `list_members` SELECT policy
   shows you one row (your own), and SELECT gates DELETE
   ([select-policy-gates-update-and-delete](../kb/entries/select-policy-gates-update-and-delete.md)).
   So there is no "leave this list" for a reader or a writer. Measured, not assumed: see below.

## Three measurements, taken before designing anything

Run against the local stack on 2026-09-08 with two real accounts and real user JWTs — the probe
created Alice and Bob through the admin API, had Alice create and share a list, and drove PostgREST
directly. The stack was left as it was found (empty).

### 1. A refused rename is silent — the `set_item_done` bug, one table over

| request as a **reader** | response |
|---|---|
| `PATCH /rest/v1/lists?id=eq.<id>` `{"name":"…"}` | **`204 No Content`**, empty body, no error |
| the same with `select=id,name` + `Prefer: return=representation` | **`200 OK`**, body **`[]`** |
| the same as the **owner** | `200 OK`, `[{"id":"…","name":"Weekly shop"}]` |

The first row is what `supabase.from('lists').update({ name }).eq('id', id)` sends today. No error
means `resultFor` returns `verdict: 'ok'`, so the outbox would drop the write **as delivered**, leave
the new name on screen, and let it silently revert at the next fetch. That is exactly the failure
`set_item_done`'s `raise` was added to close, arriving by a different route — RLS filters an `UPDATE`
to zero rows rather than refusing it.

**So `renameList` must ask for the row back and treat zero rows as a refusal.** This is the single
most important line in this document.

### 2. `P0002` comes back as HTTP 500, which `verdictFor` calls *retryable*

Measured by raising each code from a throwaway function through PostgREST (created, called, dropped):

| SQLSTATE | HTTP | raised by | `verdictFor` says |
|---|---|---|---|
| `P0001` | 400 | — | permanent |
| **`P0002`** | **500** | `share_list` "no account with that email yet"; `set_member_role` / `remove_member` "that person is not a member of this list" | **retryable** ✗ |
| `22023` | 400 | `share_list` "you already have this list" | permanent |
| `23514` | 400 | `keep_last_owner` "a list must keep at least one owner" | permanent |
| `42501` | 403 authenticated (401 anonymous) | every owner check, `set_item_done` | permanent |
| `23505` | 409 | duplicate insert | `applied` (matched on the code first) |

"No account with that email yet" is a *user error* — the most likely one on the share screen — and it
arrives classified as an outage. If sharing ever went through the outbox it would retry forever;
even called directly, any verdict-based error handling would hide the message behind "we'll try
again".

**Fix it in `verdictFor`, not in SQL:** its docstring already says it classifies "from the status and
the SQLSTATE", and `23505` is precedent for the code winning over the status.

```ts
// PostgREST answers P0002 with 500 — measured, 2026-09-08 — and 500 otherwise means "the server is
// having a moment, send it again". The sharing RPCs raise it for "no account with that email yet",
// which is a refusal that will never succeed. The code decides, the status does not.
if (code === 'P0002') return 'permanent';
```

The alternative — a migration changing three `raise ... errcode = 'P0002'` to `P0001` — is equally
correct and costs a `db push` to a cloud project that already has the function. Prefer the client
fix; note the SQL if the cloud is being re-pushed anyway for another reason.

### 3. A non-owner cannot leave a list, and finds out silently

`DELETE /rest/v1/list_members?list_id=eq.<id>&user_id=eq.<self>` as a reader returns **`204`**, and
`psql` confirms the row is still there. `remove_member` as a reader returns `403 "only an owner can
remove members from this list"`. So:

- **Do not build a "Leave this list" button.** The honest v1 is that only an owner removes people.
- The 204 is the same trap as measurement 1. Any new `DELETE` or `UPDATE` the client sends must ask
  for a representation and check what came back, or it is a write that lies.

`list_members_of` **does** work for a reader — it returned the full roster with emails — so showing
*who else has access* is available to every member, not just owners.

## Shape of the change

| file | |
|---|---|
| `src/state/roles.ts` | new — `canEditItems` / `canManageList`, the client's copy of `role >= 'writer'` |
| `src/state/types.ts` | `WriteAction` gains `list/renamed` |
| `src/state/listsReducer.ts` | one case for it |
| `src/lib/outbox.ts` | coalesce renames per list; `dropDependents` learns about them. **`VERSION` stays 1** |
| `src/lib/listsApi.ts` | `renameList` (with `.select()`), `fetchMembers`, `shareList`, `setMemberRole`, `removeMember`, `P0002` in `verdictFor` |
| `src/state/ListsContext.tsx` | `renameList`, role guards, `refresh` exposed, re-fetch on foreground |
| `src/components/ItemRow.tsx` | optional `editable` |
| `src/components/AddBar.tsx` | optional `initialValue` |
| `src/components/ListRow.tsx` | "Shared with you" badge |
| `src/components/HeaderButton.tsx` | new — the header's text button, so `ListDetail` gets two of them |
| `src/components/RolePicker.tsx` | new — reader / writer / owner, three radios |
| `src/screens/ListDetailScreen.tsx` | role-gated Add bar, rename bar, header buttons, read-only note |
| `src/screens/SharingScreen.tsx` | new |
| `src/navigation/types.ts` + `RootNavigator.tsx` | the new route |

Untouched on purpose: `replay.ts`, `listCache.ts` (`List` gains no field, so **no `VERSION` bump** —
a cached v2 blob is still exactly right), `SessionContext`, every migration.

## 1. Roles in the client — display only

```ts
// src/state/roles.ts
import type { Role } from './types';

/** Mirrors the enum's declaration order, which is what `role >= 'writer'` means in the policies. */
const RANK: Record<Role, number> = { reader: 0, writer: 1, owner: 2 };

export const canEditItems = (role: Role) => RANK[role] >= RANK.writer;
export const canManageList = (role: Role) => role === 'owner';
```

The database decides; this decides which controls exist. Every guard below is a courtesy to the user,
never a security boundary — a reader whose optimistic item appears and then vanishes with a red
banner is a worse experience than an Add bar that was never there.

## 2. `ListDetail`, by role

- **reader** — no `AddBar`; `ItemRow`s render checked state but do not respond; a muted line under
  the banners reads `Read only — you can see this list but not change it.`; the empty state's hint
  changes to `Nobody has added anything yet.` (the *title* stays `Nothing on this list`, so the
  existing test still passes).
- **writer** — today's screen exactly.
- **owner** — plus two header buttons, `Rename list` and `Share list`. `Rename list` toggles a rename
  bar above the Add bar: an `AddBar` with `initialValue={list.name}`, placeholder/label `List name`,
  button `Save`; submitting hides it again.

`ItemRow` keeps `accessibilityRole="checkbox"` and its label when read-only — the checked state is
information a reader wants — and gains `accessibilityState={{ checked, disabled: !editable }}` plus
`disabled` on the `Pressable`, following `AddBar`'s precedent. Existing `getAllByRole('checkbox')`
ordering assertions keep working.

Two header buttons is the one place this design spends a little too much: on a narrow phone the list
name truncates. The alternative is one `Share list` button with rename moved inside that screen,
which costs rename its discoverability. Either is a ten-line change; take the second if the header
looks bad on a real device.

## 3. `ListRow` says when a list is not yours

`role !== 'owner'` appends `Shared with you` to the summary line and to the composed accessibility
label (`Groceries, 1 of 3 done, shared with you`). A list you own reads exactly as it does today, so
no existing query moves.

**A list you own cannot say "shared with 2 people", and should not try.** The `list_members` SELECT
policy shows you your own row only, so a `list_members(count)` embed returns `1` for everybody —
convincing and wrong. Owners learn who has access from the sharing screen, one tap away. Changing
that needs a definer RPC returning counts for all your lists, which is a schema change and a second
feature.

## 4. Rename — the only new write

`WriteAction` gains one member, so the outbox, `replay` and the reducer keep their single vocabulary
for "a write" ([writes-retry-from-an-outbox](../kb/entries/writes-retry-from-an-outbox.md)):

```ts
| { type: 'list/renamed'; id: string; name: string }
```

Reducer: trim, ignore blank, and go through `updateList` so a rename to the same name returns the
original state object ([update-list-identity-preserving](../kb/entries/update-list-identity-preserving.md)).

Outbox: `enqueue` coalesces `list/renamed` per list id for the reason it coalesces `item/setDone` —
an absolute value, only the newest one worth sending — and `dropDependents` drops queued renames for
a `list/created` the database refused. **`VERSION` stays `1`.** A bump moves the blob aside as broken
and throws away unsent writes, and it buys nothing: a v1 blob can only contain actions that are still
valid.

`listsApi`, where measurement 1 lands:

```ts
/**
 * `.select()` is not decoration. Row-level security filters a refused rename to zero rows rather
 * than refusing it, and PostgREST answers that with 204 and no error — measured — which `resultFor`
 * would classify `ok`. The outbox would then drop the write as delivered and the old name would
 * come back at the next fetch with nothing to explain it. Asking for the row back is what turns a
 * silent no into a loud one, exactly as `set_item_done`'s `raise` does one table over.
 */
export async function renameList(id: string, name: string): Promise<Result> {
  const { data, error, status } = await supabase
    .from('lists')
    .update({ name })
    .eq('id', id)
    .select('id');

  if (error) return resultFor(error, status);
  if (data?.length) return { error: null, verdict: 'ok' };
  return { error: 'You can no longer rename this list.', verdict: 'permanent' };
}
```

`ListsContext.renameList` mints nothing (the id is the list's), guards on `canManageList`, then
`dispatch(op); void enqueueOp(op);` like its three siblings — which also keeps
`writes-retry-from-an-outbox`'s `verify:` command balanced, since it counts those two lines and
demands they match.

The same guard shape goes into `addItem` and `toggleItem`:

```ts
if (!canEditItems(list.role)) {
  setError('You have read-only access to this list.');
  return;
}
```

Unreachable from the UI once the controls are gated — which is the point of writing it, since the
next screen to touch these functions will not remember the rule.

## 5. The sharing screen

Route `Sharing: { listId: string }`, screen `SharingScreen`, title **Sharing**, reachable by the
`Share list` header button — **for every member, not only owners**, because measurement 3 showed the
roster is readable by all of them and "who else can see my shopping list" is a fair question for a
reader to ask.

```
┌ Sharing ─────────────────────────────────────┐
│ [ErrorBanner, when there is something to say] │
│                                               │
│ People with access                            │
│   alice@example.com (you)          owner      │
│   bob@example.com    [R][W][O]     Remove     │  ← owner only
│                                               │
│ Invite someone                     ← owner only│
│   [ you@example.com        ] [R][W][O] [Share]│
│                                               │
│ Only an owner can change who has access.      │  ← everyone else
└───────────────────────────────────────────────┘
```

**Its state is local, not in `ListsContext`.** The roster is not `State.lists`, the reducer models no
members, and `replay` would have nothing to fold — so the screen holds `members`, `pending` and
`error` in `useState` the way `SignInScreen` holds its phase. It calls `listsApi` directly, which
keeps the module seam intact ([supabase-client-module-boundary](../kb/entries/supabase-client-module-boundary.md))
and lets its suite mock four plain functions.

**Membership writes are deliberately *not* queued in the outbox.** Four reasons, and the first is the
only one that would matter on its own:

1. `share_list` resolves an email server-side. "No account with that email yet" has to be answered
   while the user is looking at the field they typed it into; queued, it is an error about a stranger
   arriving an hour later with no context.
2. The reducer has no member state to update optimistically, so there is nothing to show while it is
   queued and nothing for `replay` to preserve.
3. The roster cannot be read offline at all, so the screen is unusable offline regardless.
4. A `member/removed` action in `types.ts` would trip `writes-retry-from-an-outbox`'s `verify:`
   command (`! grep -qE "removed'|deleted'" src/state/types.ts`) — the audit is right to complain,
   because that entry's promise is about writes the *reducer* owns.

So each control disables itself while its request is in flight and re-fetches the roster after it,
and offline it fails honestly: `status === 0` → `You need a connection to change who has access.`,
anything else → the database's own message, rendered verbatim in `ErrorBanner` as the app already
does elsewhere.

**Three things the screen must get right beyond the happy path:**

- **The last owner.** `keep_last_owner` raises 23514 → 400 → permanent. Compute `owners.length === 1`
  from the roster and disable your own demote/remove with the hint `A list must keep at least one
  owner.` — the same string the database raises, so there is one wording. Keep rendering the
  database's refusal too: two clients can race, and the trigger is the one that decides.
- **Removing or demoting yourself.** Both are legal for an owner when another owner remains. After
  any mutation the screen calls the roster fetch *and* `refresh()` from `ListsContext` (newly
  exposed — a read, so it is safe at any time after mount). If your own membership is gone from the
  response, `navigation.popToTop()`: the list is no longer yours to look at.
- **No confirmation dialog.** `Alert` is not usable on web, which is where this gets verified
  ([supabase-local-stack](../kb/entries/supabase-local-stack.md)), and removal is reversible by
  re-sharing. Two-step confirmation can come later if it is ever wanted.

`RolePicker` renders three `accessibilityRole="radio"` pressables with
`accessibilityState={{ checked }}`, and takes a `labelFor` so two pickers never collide in a query:
`Share as reader` in the invite form, `Set bob@example.com to writer` on a member row. Re-sharing an
address that is already a member is an upsert in `share_list`, so the invite form doubles as a
promote — nothing extra to build.

## 6. Freshness — re-fetch when the app comes to the front

Today `refresh()` runs once, on mount. That was fine when you were the only writer; with sharing, a
list someone changed an hour ago stays stale until a cold start, which reads as sharing being broken.

The existing `AppState` / `online` effect is the hook, and it needs one piece of care:

```ts
const resume = () => {
  if (retry.current) clearTimeout(retry.current);
  retry.current = null;
  attempt.current = 0;

  void (async () => {
    await flush();
    // `flush` guards itself against a fetch; nothing guards a fetch against a flush. A read issued
    // while a write is in the air can come back without that write just as the loop removes it from
    // the queue — and the row disappears from the screen until the next fetch. `flushing` is still
    // set if a loop was already running (flush returned early), and `retry` is set if backoff took
    // over, which means we are offline and a fetch would fail anyway.
    if (!flushing.current && !retry.current) await refresh();
  })();
};
```

Add `visibilitychange` alongside `online` on web: coming back to a tab is the foreground event that
matters there, and `online` only fires when connectivity changes.

**Not proposed:** realtime subscriptions (out of scope, and a foreground fetch covers the actual
complaint) and pull-to-refresh (`RefreshControl` is the shakiest part of react-native-web, and web is
where this is verified).

## Accessibility labels, which are the test surface

Per [queries-go-through-a11y-labels](../kb/entries/queries-go-through-a11y-labels.md), these are
load-bearing:

| element | role | label | state |
|---|---|---|---|
| header buttons | button | `Rename list`, `Share list` | — |
| rename bar | — | input `List name`, button `Save` | `disabled` when blank |
| `ItemRow`, read-only | checkbox | item title | `{ checked, disabled: true }` |
| `ListRow`, shared | button | `${name}, ${summary}, shared with you` | — |
| roster spinner | — | `Loading who has access` | — |
| role option | radio | `Share as reader` / `Set ${email} to writer` | `{ checked }` |
| remove | button | `Remove ${email}` | `{ disabled }` while in flight or sole owner |
| invite | — | input `Email address`, button `Share` | `{ disabled }` while blank or in flight |

Copy asserted verbatim by tests: `Read only — you can see this list but not change it.`,
`Nobody has added anything yet.`, `Only an owner can change who has access.`,
`A list must keep at least one owner.`, `You need a connection to change who has access.`,
`You have read-only access to this list.`, `Shared with you`.

## Staging

Each stage leaves the app working and is worth verifying on its own.

1. **Roles are visible.** `roles.ts`, read-only `ListDetail`, `ItemRow.editable`, the `ListRow` badge,
   the guards in `ListsContext`. No new screens, no new writes, no new queries. This is the stage
   that stops a reader being handed a button that fails.
2. **Rename.** `list/renamed` end to end, including `renameList`'s `.select()` and the `P0002` line in
   `verdictFor` (which belongs here because it is a `listsApi` change, even though stage 3 is what
   provokes it).
3. **The sharing screen.** `fetchMembers` / `shareList` / `setMemberRole` / `removeMember`,
   `RolePicker`, `HeaderButton`, `SharingScreen`, the route.
4. **Foreground re-fetch.** Small, and the one thing that makes a shared list feel alive.

## Proving it

Unit suites cover the reducer, the outbox coalescing, both screens and the guards — all four are
plain RNTL work against a mocked `listsApi`, with `await` on render and fireEvent
([rntl-14-api-changes](../kb/entries/rntl-14-api-changes.md)).

What they cannot cover is the part this document is mostly about. **Two accounts, two browser
profiles, on the local stack** (Mailpit hands out a code for any address you invent; production SMTP
still delivers only to the account owner —
[scope-boundaries](../kb/entries/scope-boundaries.md), step 6 phase 1):

1. Alice shares with Bob as `reader`. Bob's list shows *Shared with you*, has no Add bar, and his
   checkboxes do not respond.
2. Alice promotes Bob to `writer`. Bob foregrounds his tab and can now add an item; Alice foregrounds
   hers and sees it.
3. Bob renames the list → refused, banner, name reverts. **Confirm in the network tab that the PATCH
   carried `select=` and came back `[]`** — this is the one failure that looks identical to success
   if the code is wrong.
4. Alice invites `nobody@example.com` → `no account with that email yet`, and the request is *not*
   retried (watch the network tab; before the `verdictFor` fix it would be).
5. Alice demotes herself while sole owner → `a list must keep at least one owner`, control already
   disabled. Alice promotes Bob to owner, then removes herself → she is bounced back to the list
   screen and the list is gone from it.
6. With no network: the lists still render, the sharing screen says a connection is needed, and a
   rename made offline lands when the network returns.

## Knock-on to the knowledgebase

Hand these to `/librarian deposit` after the step, not before:

- [scope-boundaries](../kb/entries/scope-boundaries.md) — the sharing UI moves in; "every screen
  sharing would need" stops being out. Still out: `list_invites`, leaving a list you do not own,
  realtime, deletion.
- [writes-retry-from-an-outbox](../kb/entries/writes-retry-from-an-outbox.md) — `list/renamed` joins
  the outbox; membership writes deliberately do not, with the four reasons above; `verdictFor` gains
  a second code-over-status rule.
- [server-stamps-done-at](../kb/entries/server-stamps-done-at.md) — its "any new write path must fail
  loudly or not at all" now has a second instance that fails *quietly by default*: a filtered UPDATE
  or DELETE returning 204. That is probably worth its own entry — the rule is "a PostgREST write
  whose refusal is expressed as zero rows must ask for a representation".
- [queries-go-through-a11y-labels](../kb/entries/queries-go-through-a11y-labels.md) — the new
  components and the `ListRow` label composition.
- [first-fetch-replaces-list-state](../kb/entries/first-fetch-replaces-list-state.md) — hydration is
  no longer a one-time event; the ordering rule against the flush loop is new and easy to get wrong.

## What this still does not do

- **Invite someone who has no account.** `share_list` raises `P0002` for an unknown address; a
  `list_invites` table claimed by `handle_new_user` at sign-up is a separate feature.
- **Leave a list you do not own.** Measurement 3. It needs either a self-service delete policy or a
  fourth RPC.
- **Show an owner how widely a list is shared without opening it.** Section 3.
- **Realtime.** Step 4 above is the cheap 80%.
- **Delete anything.** Unchanged, and still a decision rather than an omission.
