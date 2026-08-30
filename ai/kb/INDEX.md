# Project knowledgebase

Current truth about this project. Open the entries you need — paths are from the repo root.
Rules for adding and revising entries: [ai/kb/CHARTER.md](ai/kb/CHARTER.md).
Run `npm run kb:audit` to check every entry still holds.

**Stack and environment**

- [Expo SDK 54 is pinned](ai/kb/entries/expo-sdk-54-pinned.md) — read the v54.0.0 docs, not the latest (reference)
- [iOS simulator works; Android does not](ai/kb/entries/native-build-toolchain.md) — `npm run ios` boots a sim into Expo Go; no Android SDK and no CocoaPods, and no native dev build is needed (environment)
- [Supabase runs locally in Docker](ai/kb/entries/supabase-local-stack.md) — `npx supabase start`; the sign-in code lands in Mailpit; verify auth in the browser (environment)

**Scope**

- [Scope boundaries](ai/kb/entries/scope-boundaries.md) — many named lists and OTP sign-in in; list persistence, sharing, and deletion out (constraint)

**Auth**

- [The Supabase client is a module seam](ai/kb/entries/supabase-client-module-boundary.md) — only `src/lib/supabase.ts` imports supabase-js; tests mock that file (convention)
- [Both OTP email templates must render the token](ai/kb/entries/otp-email-templates-carry-the-code.md) — `confirmation` for new addresses, `magic_link` for returning ones (gotcha)

**State**

- [Ids are minted outside the reducer](ai/kb/entries/ids-minted-outside-reducer.md) — they arrive on the action, keeping it pure (convention)
- [updateList preserves identity](ai/kb/entries/update-list-identity-preserving.md) — returns the original state object on a no-op (convention)
- [Storage touches only ListsContext](ai/kb/entries/persistence-isolated-to-provider.md) — the plan for when list persistence lands (decision)

**UI**

- [Theme tokens only](ai/kb/entries/theme-tokens-only.md) — no color or spacing literals outside `src/theme.ts` (convention)
- [Queries go through a11y labels](ai/kb/entries/queries-go-through-a11y-labels.md) — interactive elements keep role/label/state props; empty-state copy is asserted verbatim (convention)
- [Screens take navigation props](ai/kb/entries/screens-take-navigation-props.md) — never `useNavigation()`, so tests can stub it (convention)

**Testing**

- [RNTL 14 API changes](ai/kb/entries/rntl-14-api-changes.md) — `await` render/fireEvent/unmount; `toBeChecked` replaced `toHaveAccessibilityState`; `act` for external updates (gotcha)
- [tsconfig needs an explicit types array](ai/kb/entries/tsconfig-explicit-types-array.md) — without it the jest globals don't resolve (gotcha)

---

**Nothing above covers what you need?** Run `/librarian ask <topic>` before answering from
assumption. It searches every entry, including ones this shortlist deliberately leaves out.
