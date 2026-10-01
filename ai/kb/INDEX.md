# Project knowledgebase

Current truth about this project. Open the entries you need — paths are from the repo root.
Rules for adding and revising entries: [ai/kb/CHARTER.md](ai/kb/CHARTER.md).
Run `npm run kb:audit` to check every entry still holds.

**Stack and environment**

- [A native dev build works on both platforms](ai/kb/entries/native-build-toolchain.md) — `npm run ios`/`npm run android` build and install it, and Expo Go cannot run the app; Xcode 27 with only iOS 27, the iPhone 17e gone and the 18 Pro the prepared simulator; `pod install` needs `LANG=en_US.UTF-8`, prebuild now cleans by default, and the iOS `.app` lands in DerivedData; Metro started under `CI=1` never reloads; the disk runs nearly full, so check it before a native build; the Android dev client predates `expo-blur`; only `eas` and the Apple Developer account remain absent (environment)
- [Maestro drives the native app](ai/kb/entries/maestro-drives-the-native-ui.md) — `~/.maestro/bin/maestro` with `JAVA_HOME` set, not on PATH; a simulator needs its keyboards reset before `inputText` works, and shows no software keyboard until `killall DeviceHub`; the SDK 57 dev client's floating button covers the top-right pills until turned off; every screen's `Back` is drawn, and the screen underneath is still in the hierarchy; flows live in `.maestro/` (environment)
- [iOS 27 needs the scene life cycle](ai/kb/entries/ios-scene-support-is-opt-in.md) — `expo-build-properties`' `ios.enableSceneSupport` in `app.json` is what keeps the app from being killed at launch; SDK 57 leaves it opt-in, SDK 58 makes it redundant, so remove it then (decision)
- [Two Supabase environments](ai/kb/entries/supabase-local-stack.md) — a local Docker stack whose sign-in code lands in Mailpit, plus a linked cloud project; flows are verified in the browser; local may hold 1M load-test users that slow and crowd the name search (environment)
- [The target is picked at runtime](ai/kb/entries/supabase-target-picked-at-runtime.md) — browser and simulator get local, a physical device gets cloud, unless `EXPO_PUBLIC_SUPABASE_TARGET` overrides it — check `.env`, and any Metro already on 8081, before a Mailpit run; no build-time split works (decision)

**Scope**

- [Scope boundaries](ai/kb/entries/scope-boundaries.md) — named lists, OTP sign-in, offline writes, sharing, realtime, deletion, paged items and paged lists, required unique names, leaving a list, Day/Night/Auto themes, and list and item limits (overshoot accepted, no locks) in; invites out; `ai/suggestions/*.md` is never scope (constraint)
- [The phone is the product](ai/kb/entries/phone-is-the-product.md) — since task 20: looks are signed off on the iOS simulator — the iPhone 18 Pro now, which no longer overlays the 390×844 mockups — shooting only the screens a step changed, and web only has to work; fix web on the web side, never bend the phone design; the mockups in `ai/ux/primary/` are the design, task screenshots are not (Lists' faint band rim is deliberate, never "restore" it); steps 5–6's screens are unverified on Android; web shows no checked state and has no browser back (constraint)

**Auth**

- [The Supabase client is a module seam](ai/kb/entries/supabase-client-module-boundary.md) — only `src/lib/supabase.ts` imports supabase-js; tests mock it, or the query module above it, so a value a screen shows lives outside `listsApi` (convention)
- [`onAuthStateChange`'s `'SIGNED_IN'` fires on restore too](ai/kb/entries/signed-in-event-fires-on-restore-too.md) — a cold-start session restore broadcasts the same event a live sign-in does; `SessionContext`'s `hasResolvedOnce` ref is what tells them apart (gotcha)
- [A restored session waits for evidence](ai/kb/entries/restored-session-state-waits-for-evidence.md) — `AuthState` stays `loading`, mounting nothing, until a name-cache read or fetch actually decides `signedIn` vs. `nameRequired`; setting `signedIn` before either answered flashed the full app on every cold start (gotcha)
- [Signing out globally does not revoke a live access token](ai/kb/entries/session-still-valid-guards-writes.md) — the eleven write RPCs check `auth.sessions` fresh on every call and raise if it is gone, and a `psql` test of one needs a real `session_id`; reads and list creation are deliberately still uncovered (decision)
- [A revoked-session write redirects, it does not error](ai/kb/entries/session-revoked-write-redirects.md) — `resultFor` flags it before `humanize()` erases the message; the outbox leaves it queued to replay at the next sign-in, and every synchronous RPC caller (`SharingScreen`, `AccountScreen`, `SetNameScreen`) checks the same flag inline (decision)

**State and persistence**

- [Writes are queued on disk and retried](ai/kb/entries/writes-retry-from-an-outbox.md) — optimistic, never dropped, only a refusal re-fetches; seven write actions, four reads, and membership writes stay out (decision)
- [A refused write comes back as zero rows](ai/kb/entries/refused-writes-return-zero-rows.md) — 204 and no error, so an UPDATE or DELETE must ask for the row back or it lies (gotcha)
- [The list cache holds acknowledged rows](ai/kb/entries/list-cache-holds-acknowledged-rows.md) — never the replayed view, not only what a fetch returned, and every page of lists and of items that was loaded, cursors included, and the list counts as read; cache `VERSION` 7, outbox 1 (gotcha)
- [The database stamps `done_at`](ai/kb/entries/server-stamps-done-at.md) — the client sends a boolean through `set_item_done`, which raises on refusal, and cannot update `items` at all (decision)
- [RLS scopes list data by membership](ai/kb/entries/list-data-scoped-by-rls.md) — reader/writer/owner, the client never filters, grants are half the story; the one delete policy is on `list_members` (constraint)
- [The list read starts at `list_members`](ai/kb/entries/read-rooted-at-list-members.md) — uncorrelated policy subqueries, no definer helper in a policy; both paged reads, items and lists, are keyset with a redundant `gte` that decides the plan, and a page of lists costs every membership after its cursor (decision)
- [Hydration replaces list state](ai/kb/entries/first-fetch-replaces-list-state.md) — nothing may write before `status` is `'ready'`; it runs on every foreground and nudge, re-reads every loaded page and the list counts or fails whole, and the flush guard lives in `refresh`; a dispatch read back in the same commit sets its refs synchronously (gotcha)
- [Realtime is a nudge to a per-user inbox](ai/kb/entries/realtime-is-a-nudge-to-a-per-user-inbox.md) — the database fans out `user:<uid>` broadcasts, the client answers with the fetch it already had; never a delta, never `postgres_changes` (decision)
- [Deleting is a tombstone](ai/kb/entries/deletion-is-a-tombstone.md) — `deleted_at` stays on the row, the bin's first page ships with the fetch that opens the list, every render goes through `liveItems`/`liveLists`, and a nightly purge is the only hard delete (decision)
- [A check on a queued write must pass a resend that already landed](ai/kb/entries/limit-checks-pass-an-applied-resend.md) — a BEFORE trigger fires ahead of the primary key and `on conflict`, so the list limits live on `list_members`, never on `lists`; `add_item` and the restores skip the count for a write already applied (constraint)
- [A write can land on a tombstone](ai/kb/entries/writes-can-land-on-a-tombstone.md) — `target_deleted` rides with `ok`, the op waits at the head of the outbox, and the client decides by role whether to offer a restore (decision)

**UI**

- [Queries go through a11y labels](ai/kb/entries/queries-go-through-a11y-labels.md) — interactive elements keep role/label/state props; empty-state copy is asserted verbatim (convention)
- [Screens take navigation props](ai/kb/entries/screens-take-navigation-props.md) — never `useNavigation()`, so tests can stub it; no screen has a native header — each draws its own, `Back` included — and a stub would drop any `headerRight` (convention)

---

**Nothing above covers what you need?** Run `/librarian ask <topic>` before answering from
assumption. It searches every entry, including ones this shortlist deliberately leaves out.
