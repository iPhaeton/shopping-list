# Project knowledgebase

Current truth about this project. Open the entries you need — paths are from the repo root.
Rules for adding and revising entries: [ai/kb/CHARTER.md](ai/kb/CHARTER.md).
Run `npm run kb:audit` to check every entry still holds.

**Stack and environment**

- [A native dev build now works end to end](ai/kb/entries/native-build-toolchain.md) — `npm run ios`/`npm run android` build and install it, not Expo Go (`expo start --go` still reaches Expo Go); CocoaPods, both bundle identifiers, and `expo-dev-client` are set; only `eas` and the Apple Developer account remain absent (environment)
- [Two Supabase environments](ai/kb/entries/supabase-local-stack.md) — a local Docker stack whose sign-in code lands in Mailpit, plus a linked cloud project; verify in the browser (environment)
- [The target is picked at runtime](ai/kb/entries/supabase-target-picked-at-runtime.md) — browser and simulator get local, a physical device gets cloud; no build-time split works (decision)
- [`config push` sends the whole root config](ai/kb/entries/supabase-config-push-sends-the-whole-root.md) — `[remotes.production]` holds only what differs, unset keys inherit, there is no dry run and no read-back, and the `[Y/n]` prompt defaults to Y under automation (gotcha)

**Scope**

- [Scope boundaries](ai/kb/entries/scope-boundaries.md) — named lists, OTP sign-in, offline writes, sharing, realtime, deletion and paged items in; invites, leaving a list and paged lists out; `ai/suggestions/*.md` is never scope (constraint)
- [ShoppingLoop is the visible name only](ai/kb/entries/shoppingloop-is-the-visible-name-only.md) — `expo.name`, the sign-in title, the mail sender and template say it; `slug`, `scheme`, `package.json` and `project_id` stay `shopping-list`, and the scheme is chained to production `site_url` (decision)

**Auth**

- [The Supabase client is a module seam](ai/kb/entries/supabase-client-module-boundary.md) — only `src/lib/supabase.ts` imports supabase-js; tests mock it, or the query module above it (convention)
- [Cloud auth mail goes through Resend](ai/kb/entries/cloud-auth-mail-goes-through-resend.md) — from `no-reply@mail.shopping-loop.com`, the one verified domain, so any address gets the code now; DNS resolving is not verification, a `403` from `POST /emails` is the only local signal and gates the push (environment)

**State and persistence**

- [updateList preserves identity](ai/kb/entries/update-list-identity-preserving.md) — returns the original state object on a no-op (convention)
- [Writes are queued on disk and retried](ai/kb/entries/writes-retry-from-an-outbox.md) — optimistic, never dropped, only a refusal re-fetches; seven write actions, three reads, and membership writes stay out (decision)
- [A refused write comes back as zero rows](ai/kb/entries/refused-writes-return-zero-rows.md) — 204 and no error, so an UPDATE or DELETE must ask for the row back or it lies (gotcha)
- [The list cache holds acknowledged rows](ai/kb/entries/list-cache-holds-acknowledged-rows.md) — never the replayed view, not only what a fetch returned, and every page a list had loaded; cache `VERSION` 5, outbox 1 (gotcha)
- [The database stamps `done_at`](ai/kb/entries/server-stamps-done-at.md) — the client sends a boolean through `set_item_done`, which raises on refusal, and cannot update `items` at all (decision)
- [RLS scopes list data by membership](ai/kb/entries/list-data-scoped-by-rls.md) — reader/writer/owner, the client never filters, grants are half the story; the one delete policy is on `list_members` (constraint)
- [The list read starts at `list_members`](ai/kb/entries/read-rooted-at-list-members.md) — uncorrelated policy subqueries, no definer helper in a policy; the items read is keyset with a redundant `gte` that decides the plan (decision)
- [`max_rows` is a silent ceiling on embeds too](ai/kb/entries/max-rows-is-a-silent-ceiling.md) — `MAX_ROWS` mirrors it by hand, `PAGE_SIZE` stays under it, never set it under `[remotes.production]` (gotcha)
- [A SELECT policy gates UPDATE and DELETE too](ai/kb/entries/select-policy-gates-update-and-delete.md) — self-only visibility silently zeroes an owner policy, so member management is RPCs (gotcha)
- [Revokes under Supabase's default grants](ai/kb/entries/supabase-default-grants-defeat-revokes.md) — column-level revokes are no-ops, `from public` leaves `anon`, and a policy's helper must keep them (gotcha)
- [Hydration replaces list state](ai/kb/entries/first-fetch-replaces-list-state.md) — nothing may write before `status` is `'ready'`; it runs on every foreground and every nudge now, and the flush guard lives in `refresh` (gotcha)
- [Realtime is a nudge to a per-user inbox](ai/kb/entries/realtime-is-a-nudge-to-a-per-user-inbox.md) — the database fans out `user:<uid>` broadcasts, the client answers with the fetch it already had; never a delta, never `postgres_changes` (decision)
- [Deleting is a tombstone](ai/kb/entries/deletion-is-a-tombstone.md) — `deleted_at` stays on the row, the bin's first page ships with the fetch that opens the list, every render goes through `liveItems`/`liveLists`, and a nightly purge is the only hard delete (decision)
- [A write can land on a tombstone](ai/kb/entries/writes-can-land-on-a-tombstone.md) — `target_deleted` rides with `ok`, the op waits at the head of the outbox, and the client decides by role whether to offer a restore (decision)

**UI**

- [Queries go through a11y labels](ai/kb/entries/queries-go-through-a11y-labels.md) — interactive elements keep role/label/state props; empty-state copy is asserted verbatim (convention)
- [Screens take navigation props](ai/kb/entries/screens-take-navigation-props.md) — never `useNavigation()`, so tests can stub it; a stub means `headerRight` never mounts (convention)

**Testing**

- [RNTL 14 API changes](ai/kb/entries/rntl-14-api-changes.md) — `await` render/fireEvent/unmount; `toBeChecked` replaced `toHaveAccessibilityState`; `act` for external updates (gotcha)

---

**Nothing above covers what you need?** Run `/librarian ask <topic>` before answering from
assumption. It searches every entry, including ones this shortlist deliberately leaves out.
