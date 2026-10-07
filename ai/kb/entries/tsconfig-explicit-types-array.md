---
id: tsconfig-explicit-types-array
title: tsconfig needs an explicit types array or jest globals go unresolved, and its exclude replaces the base's list rather than extending it
type: gotcha
status: current
tags: [typescript, testing, config, deno]
sources: [ai/tasks/1/implementation-log-step-1.md, 6ef87a2, ai/tasks/26-apple-sign-in/implementation-log-step-3.md, 9421c3c]
last_verified: 2026-10-07
verify: tr -d '[:space:]' < tsconfig.json | grep -qE '"types":\[[^]]*"jest"' && x="$(tr -d '[:space:]' < tsconfig.json | grep -oE '"exclude":\[[^]]*\]')" && for d in node_modules babel.config.js metro.config.js jest.config.js android ios supabase/functions; do echo "$x" | grep -q "\"$d\"" || exit 1; done
related: [rntl-14-api-changes]
indexed: false
---

[tsconfig.json](../../../tsconfig.json) carries `"types": ["jest", "react", "node"]`. Without it,
`npm run typecheck` fails across every test file even though `@types/jest` is installed:

```
Cannot find name 'describe' / 'it' / 'expect'
Cannot use namespace 'jest' as a value
```

**Why:** `expo/tsconfig.base` leaves the ambient type roots narrower than the default, so the jest
globals never get pulled in.

**What to do:** do not "clean up" that `types` array — it looks redundant and is not. Adding a
library that ships ambient globals means adding it to this list.

**`exclude` is the same trap the other way round.** A tsconfig's `exclude` *replaces* the base's
list, it does not extend it. Since task 26 step 3 this one restates `expo/tsconfig.base`'s six
entries (`node_modules`, the three `*.config.js`, `android`, `ios`) and adds `supabase/functions`:
the Edge Functions run on Deno, with `npm:` imports and the `Deno` global this project's TypeScript
knows nothing of, so `npm run typecheck` would fail on them. Writing only `["supabase/functions"]`
would silently drop the base's six and type-check `node_modules` and the native folders. A new
Deno-side directory goes in this list; a base entry never leaves it.

The `verify:` command asserts `"jest"` is still *inside* the `types` array, not merely that the key
exists — emptying it to `"types": []` is the regression that would otherwise slip through — and
that `exclude` still holds the base's six plus `supabase/functions`. Whitespace is stripped first,
so reformatting either array across several lines does not trip it.

**Demoted out of `INDEX.md` at step 8** (`indexed: false`), not retired: still true, still checked
every audit, and still found by `/librarian ask`. It left the shortlist because it is a one-file
config fact that only bites someone editing `tsconfig.json`, and the check catches that person
anyway — where the entries that replaced it in the index describe behaviour no check can catch.
