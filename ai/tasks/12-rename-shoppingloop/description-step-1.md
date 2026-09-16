Rename the app to ShoppingLoop.

Scope agreed at planning: **visible name only**. `expo.slug`, `expo.scheme`, `package.json`'s
`name`, and the local stack's `project_id` in `supabase/config.toml` all stay `shopping-list`.
`sender_name` under `[remotes.production]` changes in the file; `npx supabase config push` is the
user's, not this step's. The repo folder is not renamed.
