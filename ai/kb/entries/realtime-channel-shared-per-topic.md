---
id: realtime-channel-shared-per-topic
title: A second subscribeToChanges call for the same user shares, and can tear down, the first's channel
type: gotcha
status: current
tags: [supabase, realtime, state]
sources: [ai/tasks/19-remove-oneself/implementation-log-step-2.md, src/lib/listsChannel.ts, src/state/ListsContext.tsx, src/screens/SharingScreen.tsx]
last_verified: 2026-09-23
verify: test "$(grep -rn 'subscribeToChanges(userId' src --include='*.ts' --include='*.tsx' | grep -v '\.test\.' | wc -l | tr -d ' ')" = 1 && grep -q 'return subscribeToChanges(userId, onNudge, onNudge);' src/state/ListsContext.tsx && grep -q 'lastNudge: { listId: string | undefined } | null;' src/state/ListsContext.tsx && grep -q 'const { lists, userId, refresh, lastNudge } = useLists();' src/screens/SharingScreen.tsx && ! grep -q 'subscribeToChanges' src/screens/SharingScreen.tsx
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
`ListsContext`'s reducer state reads `lastNudge` off `useLists()` instead of calling
`subscribeToChanges` itself. `lastNudge` (`{ listId: string | undefined } | null`) is set by the same
`onNudge` wrapper the one subscription effect already calls for both `onChange` and `onResubscribe`; it
is a fresh object on every nudge, including two in a row naming the same list, so an effect keyed on it
by reference always re-fires. `listId` is `undefined` for a resubscribe or malformed payload, mirroring
`refreshSoon`'s own "not sure what changed" fallback. Do not open a second `subscribeToChanges` call for
a topic this app already holds open — route through `lastNudge` instead.

The `verify:` command asserts there is still exactly one call site of `subscribeToChanges(userId`
outside test files, that it is still `ListsContext`'s wrapped `onNudge, onNudge` pair, that
`lastNudge` is still exposed with its current shape, that `SharingScreen` still reads it from
`useLists()`, and that `SharingScreen` itself never calls `subscribeToChanges`.
