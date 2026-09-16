# Implementation log — step 1: rename the app to ShoppingLoop

**Date:** 2026-09-16. Description: [description-step-1.md](description-step-1.md). Plan: the
approved plan-mode file (not checked in). The name itself comes out of
`ai/marketing/reconciled-naming-research.md`, where ShoppingLoop is a co-lead: no app-store match,
no USPTO record, no prior use found, and it carries "shopping", the base term the keyword data
validated as reading naturally worldwide.

The product is called **ShoppingLoop** everywhere a person sees it. Every machine-facing identifier
still says `shopping-list`.

## What was changed

Six one-line edits, `Shopping List` → `ShoppingLoop`:

| File | |
|---|---|
| `app.json` | `expo.name` — the installed app's label and the web `<title>` on first load |
| `src/navigation/RootNavigator.tsx` | `title` of the `SignIn` stack screen; the only in-app use of the name |
| `supabase/templates/otp-code.html` | "Enter this code in ShoppingLoop:" in the sign-in email body |
| `supabase/config.toml` | `sender_name` under `[remotes.production.auth.email.smtp]` — the From name on real mail |
| `README.md` | the H1 only; "A simple shopping list app…" on line 3 describes the app, it is not its name |
| `ai/docs/sign-in-round-trip.html` | eyebrow "ShoppingLoop · client auth" on the current auth doc |

**Left alone on purpose:**

- `expo.slug`, `expo.scheme` (`shopping-list`), `package.json` / `package-lock.json` `name`, and
  `project_id` in `supabase/config.toml`. The user chose visible-name-only at planning. The scheme
  in particular is load-bearing: `[remotes.production.auth]`'s `site_url` / `additional_redirect_urls`
  are `shopping-list://`, and the KB entry `supabase-config-push-sends-the-whole-root` verifies that
  string by grep. Renaming the scheme would have meant a production `config push`; renaming
  `project_id` would have renamed the local Docker containers and needed a `supabase stop` first.
- `ai/tasks/*`, `ai/marketing/*`, `ai/suggestions/*` — historical records and research; two of them
  quote the old `sender_name` line verbatim and stay as written.
- Code comments and SQL comments that say "a shopping list" as a generic noun
  (`20260910000000_deletion.sql`, `ListDetailScreen.tsx:100`, two test files).
- AsyncStorage keys are `lists:<uid>` / `outbox:<uid>` — no app name in them, nothing persisted is
  invalidated.

No test asserted on the `'Shopping List'` title, so no test changed.

## Decisions

**The name and the identifiers now differ, deliberately.** A later reader will see `ShoppingLoop`
in `expo.name` next to `"slug": "shopping-list"` and `"scheme": "shopping-list"` and may read it as
an oversight. It is not: nothing user-facing depends on the slug or scheme (Expo Go uses `exp://`,
the OTP flow renders no redirect into an email), and changing them would have pulled a production
config push and a KB verify line into what is otherwise a cosmetic change. If the scheme is ever
renamed, `site_url` / `additional_redirect_urls` under `[remotes.production.auth]` and that KB
entry's `verify:` line move with it, in the same commit.

**The production push is the user's step.** `sender_name` under `[remotes.production]` reaches the
cloud project only through `npx supabase config push`, a live change with no dry run. The file is
edited; the push is listed under follow-ups. Until it runs, real emails still arrive from
"Shopping List".

## Verification

- `npm run typecheck` — clean. `npm test` — 16 suites, 325 tests, all pass.
- `npm run kb:audit` — 0 errors, 11 warnings, all pre-existing (ground-moved and one length
  warning); none names a file this step touched. The one `verify:` that greps `shopping-list://`
  checks the scheme, which did not change.
- `git grep -n "Shopping List"` — every remaining hit is under `ai/marketing/`, `ai/suggestions/`,
  or `ai/tasks/`.
- Browser, `npx expo start --web` + Playwright: first-load `<title>` is `ShoppingLoop`; after
  signing out, the sign-in screen's `<h1>` reads `ShoppingLoop` and the tab title matches. (React
  Navigation on web sets `document.title` to the active screen's `title`, so a signed-in tab shows
  "My Lists" — expected, unchanged.)
- The email body was **not** re-checked in Mailpit: the CLI reads template files at
  `supabase start`, so the running local stack still serves the old text until it is restarted.
  One word changed in one `<p>`; the next `npx supabase stop && npx supabase start` picks it up.

## Follow-ups (not done here)

- `npx supabase config push`, **without** `--yes`, so the CLI prints the diff — it should show
  `sender_name` changing and nothing else. Needs `RESEND_API_KEY` resolvable from `.env`.
- Optionally rename the cloud project in the Supabase dashboard (`project_name` is still
  `shopping-list` per `npx supabase status`). Cosmetic, not in the repo.
- `ai/marketing/reconciled-naming-research.md` had an uncommitted edit before this step began
  (the ShoppingLoop row and the co-lead promotion). It is not this step's change and was left as
  found.
