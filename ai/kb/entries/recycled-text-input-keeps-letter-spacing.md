---
id: recycled-text-input-keeps-letter-spacing
title: iOS recycles native text inputs, and one that was the code field keeps its letter spacing — every input style sets letterSpacing 0
type: gotcha
status: current
tags: [ios, styling, text-input, fabric]
sources: [ai/tasks/20-ux/implementation-log-step-1.md]
last_verified: 2026-09-25
verify: for f in $(grep -rl '<TextInput' src --include='*.tsx' | grep -v '\.test\.'); do grep -q 'letterSpacing: 0' "$f" || exit 1; done; grep -q 'letterSpacing: 6' src/screens/SignInScreen.tsx
related: [theme-tokens-only, phone-is-the-product]
indexed: false
---

**Symptom, iOS only:** once the sign-in code field (`codeInput` in
[SignInScreen](../../../src/screens/SignInScreen.tsx), `letterSpacing: 6`) has existed in a JS
session, other inputs' placeholders render spaced out — `N e w  l i s t  n a m e`,
`Y o u r  n a m e`. Reproduced on the iPhone 17e: sign out → code phase → sign in → the Lists
placeholder is spaced.

**Cause:** Fabric reuses native text-input views, and a recycled view keeps its old kerning when the
next style simply *omits* `letterSpacing`. Leaving the key out is not the same as the default.

**Fix, and the rule:** every input style sets `letterSpacing: 0` explicitly, with a comment saying
why. An agent tidying styles will read it as noise — it is not. A new `TextInput` anywhere under
`src/` needs the same; the `verify:` sweeps every non-test `.tsx` containing `<TextInput` and fails
if one lacks it. Web and jest never show the bug, so only a phone run would catch the omission
([phone-is-the-product](phone-is-the-product.md)).

Pre-existing, not caused by the theme work — found in task 20 step 1 because the new simulator
screenshots made it obvious. Retire this entry if a React Native upgrade stops the recycled view
carrying the old value.
