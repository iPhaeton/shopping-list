# Project knowledgebase

Current truth about this project. Open the entries you need — paths are from the repo root.
Rules for adding and revising entries: [ai/kb/CHARTER.md](ai/kb/CHARTER.md).
Run `npm run kb:audit` to check every entry still holds.

**Stack and environment**

- [Expo SDK 54 is pinned](ai/kb/entries/expo-sdk-54-pinned.md) — read the v54.0.0 docs, not the latest (reference)
- [iOS simulator works; Android does not](ai/kb/entries/native-build-toolchain.md) — `npm run ios` boots a sim into Expo Go; no Android SDK and no CocoaPods, and no native dev build is needed (environment)
- [Supabase runs locally in Docker](ai/kb/entries/supabase-local-stack.md) — `npx supabase start`; the sign-in code lands in Mailpit; verify anything that touches it in the browser (environment)

**Scope**

- [Scope boundaries](ai/kb/entries/scope-boundaries.md) — named lists, OTP sign-in, owner-only persistence and offline writes in; sharing, realtime and deletion out (constraint)

**Auth**

- [The Supabase client is a module seam](ai/kb/entries/supabase-client-module-boundary.md) — only `src/lib/supabase.ts` imports supabase-js; tests mock it, or the query module above it (convention)
- [Both OTP email templates must render the token](ai/kb/entries/otp-email-templates-carry-the-code.md) — `confirmation` for new addresses, `magic_link` for returning ones (gotcha)

**State and persistence**

- [Ids and timestamps are minted outside the reducer](ai/kb/entries/ids-minted-outside-reducer.md) — they arrive on the action, keeping it pure (convention)
- [updateList preserves identity](ai/kb/entries/update-list-identity-preserving.md) — returns the original state object on a no-op (convention)
- [Writes are queued on disk and retried](ai/kb/entries/writes-retry-from-an-outbox.md) — optimistic, never dropped, and only a refusal re-fetches; the queries live in `src/lib/listsApi.ts` (decision)
- [The list cache holds acknowledged rows](ai/kb/entries/list-cache-holds-acknowledged-rows.md) — never the replayed view, and not only what a fetch returned (gotcha)
- [The database stamps `done_at`](ai/kb/entries/server-stamps-done-at.md) — the client sends a boolean through `set_item_done` and cannot update `items` at all (decision)
- [RLS scopes lists to their owner](ai/kb/entries/list-data-scoped-by-rls.md) — the client never filters and never sends `owner_id`; grants are half the story; no delete policy (constraint)
- [Revokes under Supabase's default grants](ai/kb/entries/supabase-default-grants-defeat-revokes.md) — column-level revokes are no-ops, and `from public` leaves `anon` (gotcha)
- [Hydration replaces list state](ai/kb/entries/first-fetch-replaces-list-state.md) — nothing may write before `status` is `'ready'` (gotcha)

**UI**

- [Theme tokens only](ai/kb/entries/theme-tokens-only.md) — no color or spacing literals outside `src/theme.ts` (convention)
- [Queries go through a11y labels](ai/kb/entries/queries-go-through-a11y-labels.md) — interactive elements keep role/label/state props; empty-state copy is asserted verbatim (convention)
- [Screens take navigation props](ai/kb/entries/screens-take-navigation-props.md) — never `useNavigation()`, so tests can stub it (convention)

**Testing**

- [RNTL 14 API changes](ai/kb/entries/rntl-14-api-changes.md) — `await` render/fireEvent/unmount; `toBeChecked` replaced `toHaveAccessibilityState`; `act` for external updates (gotcha)
- [tsconfig needs an explicit types array](ai/kb/entries/tsconfig-explicit-types-array.md) — without it the jest globals don't resolve (gotcha)
- [expo-crypto is undefined under jest](ai/kb/entries/expo-crypto-undefined-under-jest.md) — `randomUUID()` returns `undefined` silently; `jest.setup.ts` maps it to Node's and holds AsyncStorage's in-memory mock (gotcha)

---

**Nothing above covers what you need?** Run `/librarian ask <topic>` before answering from
assumption. It searches every entry, including ones this shortlist deliberately leaves out.
