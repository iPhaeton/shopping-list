---
id: realtime-channel-shared-per-topic
title: A second subscribeToChanges call for the same user shares, and can tear down, the first's channel
type: gotcha
status: current
tags: [supabase, realtime, state, notifications]
sources: [ai/tasks/19-remove-oneself/implementation-log-step-2.md, ai/tasks/19-remove-oneself/implementation-log-step-3.md, ai/tasks/28-invitations/implementation-log-step-3.md, 5ab9b85, src/lib/listsChannel.ts, src/state/ListsContext.tsx, src/state/NotificationsContext.tsx, src/screens/SharingScreen.tsx, src/screens/NotificationsScreen.tsx]
last_verified: 2026-10-09
verify: test "$(grep -rn 'subscribeToChanges(userId' src --include='*.ts' --include='*.tsx' | grep -v '\.test\.' | wc -l | tr -d ' ')" = 1 && grep -q 'return subscribeToChanges(userId, onNudge, onResubscribe, onNotifications);' src/state/ListsContext.tsx && grep -q 'lastNudge: { listId: string | undefined } | null;' src/state/ListsContext.tsx && grep -q 'lastNotificationsNudge: object | null;' src/state/ListsContext.tsx && grep -q 'const onNotifications = () => setLastNotificationsNudge({});' src/state/ListsContext.tsx && grep -q 'const { lists, userId, refresh, lastNudge } = useLists();' src/screens/SharingScreen.tsx && grep -q 'const { lastNotificationsNudge } = useLists();' src/state/NotificationsContext.tsx && grep -q 'lastNotificationsNudge } = useLists();' src/screens/NotificationsScreen.tsx && ! grep -rq 'subscribeToChanges' src/screens src/state/NotificationsContext.tsx --exclude='*.test.tsx'
related: [realtime-is-a-nudge-to-a-per-user-inbox, writes-retry-from-an-outbox, queries-go-through-a11y-labels]
indexed: false
---

`@supabase/realtime-js`'s `RealtimeClient.channel(topic)` returns the *same* instance for a topic
already open, keyed by the topic string (confirmed by reading
`node_modules/@supabase/realtime-js/src/RealtimeClient.ts` directly, not inferred). This app opens
exactly one topic per signed-in user, `user:<uid>`
([realtime-is-a-nudge-to-a-per-user-inbox](realtime-is-a-nudge-to-a-per-user-inbox.md)), already held
open for the whole `signedIn` session by [ListsContext](../../../src/state/ListsContext.tsx)'s one
subscription effect. A second `subscribeToChanges(userId, …)` call anywhere else for the same user
does not open a second socket subscription — it shares that instance. Its own `onChange` binding does
fire correctly, but its **cleanup** (`removeChannel` → `unsubscribe()` + `teardown()`) tears down the
*shared* channel, not just its own listener.

Step 19-2 hit this while wiring [SharingScreen](../../../src/screens/SharingScreen.tsx)'s roster —
local `useState`, deliberately outside `ListsContext`'s reducer, see
[writes-retry-from-an-outbox](writes-retry-from-an-outbox.md) — to live-update on a nudge.
`SharingScreen` unmounts on every "back" navigation; a second subscription opened there would have
silently killed `ListsContext`'s own realtime subscription for the rest of the session the first time
anyone visited Sharing and navigated away.

**What to do:** a screen or hook that needs to react to a nudge but isn't (or can't be) part of
`ListsContext`'s reducer state reads one of its two nudge values off `useLists()` instead of calling
`subscribeToChanges` itself:

- **`lastNudge`** (`{ listId: string | undefined } | null`), for `list/changed` — set by the `onNudge`
  wrapper, which is also the channel's `onChange`. `listId` is `undefined` for a resubscribe or a
  malformed payload, mirroring `refreshSoon`'s "not sure what changed" fallback. `SharingScreen`
  reads it (destructured beside `lists`, `userId`, `refresh`) and re-reads its roster and invitations
  when it names this list or nothing.
- **`lastNotificationsNudge`** (`object | null`), for `notifications/changed` — the channel's fourth
  callback, `onNotifications`, sets a fresh `{}` (task 28 step 3).
  [NotificationsContext](../../../src/state/NotificationsContext.tsx)'s unread count and
  [NotificationsScreen](../../../src/screens/NotificationsScreen.tsx) both read it.

`ListsContext`'s `onResubscribe` bumps **both**, since a reconnect may have missed either kind. Each
is a fresh object on every nudge, so an effect keyed on it by reference always re-fires — two in a
row naming the same list included. A new event on the same topic gets a new callback on the one
`subscribeToChanges` and a new value here, never a second channel.

The `verify:` command asserts there is still exactly one call site of `subscribeToChanges(userId`
outside test files, that it is still `ListsContext`'s four-callback form, that both nudge values are
exposed with their current shapes, that `SharingScreen`, `NotificationsContext` and
`NotificationsScreen` read them from `useLists()`, and that no screen or `NotificationsContext` calls
`subscribeToChanges`.
