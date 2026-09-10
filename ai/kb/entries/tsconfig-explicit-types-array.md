---
id: tsconfig-explicit-types-array
title: tsconfig needs an explicit types array or jest globals go unresolved
type: gotcha
status: current
tags: [typescript, testing, config]
sources: [ai/tasks/1/implementation-log-step-1.md, 6ef87a2]
last_verified: 2026-09-09
verify: tr -d '[:space:]' < tsconfig.json | grep -qE '"types":\[[^]]*"jest"'
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

The `verify:` command asserts `"jest"` is still *inside* the array, not merely that the key exists —
emptying it to `"types": []` is the regression that would otherwise slip through. Whitespace is
stripped first, so reformatting the array across several lines does not trip it.

**Demoted out of `INDEX.md` at step 8** (`indexed: false`), not retired: still true, still checked
every audit, and still found by `/librarian ask`. It left the shortlist because it is a one-file
config fact that only bites someone editing `tsconfig.json`, and the check catches that person
anyway — where the entries that replaced it in the index describe behaviour no check can catch.
