---
id: shoppingloop-is-the-visible-name-only
title: The product is ShoppingLoop wherever a person sees it — every machine identifier still says shopping-list, on purpose
type: decision
status: current
tags: [product, naming, expo, config, deployment]
sources: [ai/tasks/12-rename-shoppingloop/description-step-1.md, ai/tasks/12-rename-shoppingloop/implementation-log-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-2.md, ai/marketing/reconciled-naming-research.md, app.json, supabase/config.toml, ai/tasks/13-google-sign-in/implementation-log-step-2.md]
last_verified: 2026-09-18
verify: test "$(node -p "require(\"./app.json\").expo.name")" = ShoppingLoop && grep -q "title: 'ShoppingLoop'" src/navigation/RootNavigator.tsx && grep -q "^sender_name = \"ShoppingLoop\"$" supabase/config.toml && grep -q "in ShoppingLoop:" supabase/templates/otp-code.html && test "$(node -p "require(\"./app.json\").expo.slug")" = shopping-list && test "$(node -p "require(\"./package.json\").name")" = shopping-list && grep -q "^project_id = \"shopping-list\"$" supabase/config.toml && test "$(node -p "require(\"./app.json\").expo.scheme")" = "$(sed -n "s/^site_url = \"\(.*\):\/\/\"$/\1/p" supabase/config.toml)"
related: [supabase-config-push-sends-the-whole-root, scope-boundaries, otp-email-templates-carry-the-code, supabase-local-stack, native-build-toolchain]
---

Step 12 renamed the app to **ShoppingLoop** — the name came out of
[ai/marketing/reconciled-naming-research.md](../../marketing/reconciled-naming-research.md) (no
app-store match, no USPTO record, carries "shopping"). The rename was scoped at planning to the
**visible name only**, so [app.json](../../../app.json) now reads `"name": "ShoppingLoop"` two lines
above `"slug": "shopping-list"` and `"scheme": "shopping-list"`. That is not an oversight to tidy up.

| a person sees | says | a machine reads | says |
|---|---|---|---|
| `expo.name` — installed app label, web `<title>` on first load | ShoppingLoop | `expo.slug`, `expo.scheme` | `shopping-list` |
| `SignIn` screen `title` in `RootNavigator` — the only in-app use | ShoppingLoop | `package.json` / lockfile `name` | `shopping-list` |
| `sender_name` under `[remotes.production.auth.email.smtp]` | ShoppingLoop | root `project_id` in `config.toml` | `shopping-list` |
| `otp-code.html` body, README H1, `ai/docs` eyebrow | ShoppingLoop | the repo folder | `shopping-list` |

**Why the identifiers stayed.** Nothing user-facing depends on them — Expo Go opens `exp://`, and
the code-based OTP flow renders no redirect into an email — while each rename has a real cost:

- **`scheme` is chained to production.** `site_url` and `additional_redirect_urls` under
  `[remotes.production.auth]` are `shopping-list://`, and
  [supabase-config-push-sends-the-whole-root](supabase-config-push-sends-the-whole-root.md) pins that
  literal in its `verify:`. Renaming the scheme means moving those two keys **in the same commit**, a
  live `npx supabase config push`, and superseding this entry — not a cosmetic edit.
- **`project_id` names the local Docker containers.** Changing it renames them, so `npx supabase
  stop` has to run *before* the edit, not after ([supabase-local-stack](supabase-local-stack.md)).
- `package.json` `name` would churn the lockfile for nothing.

**What to do.** Leave the mismatch alone; the `verify:` asserts both halves and that the scheme still
equals the production `site_url` scheme. Three things trip a verifier of the rename:

- `sender_name` reaches the cloud project only through `npx supabase config push` (no dry run —
  [supabase-config-push-sends-the-whole-root](supabase-config-push-sends-the-whole-root.md)); it
  was remote by the 2026-09-17 push, whose diff showed only `admin_email` moving. Read the
  dashboard's SMTP sender, not this file, to know what real mail says.
- The local stack serves a template as read at `supabase start`; after editing `otp-code.html`,
  restart before checking Mailpit ([otp-email-templates-carry-the-code](otp-email-templates-carry-the-code.md)).
- React Navigation on web sets `document.title` to the *active screen's* title, so a signed-in tab
  reads "My Lists"; the app name shows only on the sign-in screen and the installed label.

"Shopping List" survives verbatim under `ai/tasks/`, `ai/marketing/` and `ai/suggestions/` — history
and research, not a missed sweep — and "a shopping list" in comments and SQL is a noun, not the name.
