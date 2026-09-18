---
id: supabase-target-picked-at-runtime
title: The Supabase environment is chosen at runtime by platform, not compiled in
type: decision
status: current
tags: [supabase, environment, expo, config, architecture]
sources: [ai/tasks/5-supabase-cloud/implementation-log-step-1.md, ai/tasks/8-realtime/implementation-log-step-1.md, ai/tasks/13-google-sign-in/implementation-log-step-2.md, src/lib/supabaseTarget.ts, src/lib/supabase.ts, .env.example]
last_verified: 2026-09-18
verify: grep -q "Platform.OS === 'web'" src/lib/supabaseTarget.ts && grep -q "Device.isDevice ? 'cloud' : 'local'" src/lib/supabaseTarget.ts && test "$(grep -c 'process\.env\.EXPO_PUBLIC_SUPABASE_\(URL\|ANON_KEY\)_\(LOCAL\|CLOUD\)' src/lib/supabaseTarget.ts)" = 4 && test "$(grep -rl 'process\.env\.EXPO_PUBLIC_SUPABASE' src --include='*.ts' --include='*.tsx' | grep -v '\.test\.')" = src/lib/supabaseTarget.ts && grep -q "from './supabaseTarget'" src/lib/supabase.ts && grep -q "10.0.2.2" src/lib/supabaseTarget.ts
related: [supabase-local-stack, supabase-client-module-boundary, native-build-toolchain, supabase-config-push-sends-the-whole-root, expo-crypto-undefined-under-jest]
---

`pickTarget()` in [src/lib/supabaseTarget.ts](../../../src/lib/supabaseTarget.ts) decides, on every
start, which Supabase the client talks to:

| running on | target | why |
|---|---|---|
| web | local | Mailpit makes the code machine-readable; this is the verification path |
| iOS simulator | local | it shares the host's loopback, so a disposable database costs nothing |
| Android emulator | local | same target, a patched address — see below |
| physical device | cloud | a phone cannot reach this machine's `127.0.0.1:54321` at all |

`EXPO_PUBLIC_SUPABASE_TARGET=local|cloud` overrides all of it, which is how you put two clients on
one database — **set it in `.env` or a gitignored `.env.local`, not in the shell**, for the reason at
the bottom of this entry. Addresses and keys are in
[supabase-local-stack](supabase-local-stack.md).

**Decision: runtime, not build time.** One `expo start` serves the browser and Expo Go from the same
server and the same env — press `w` in an `npm start` session and both runtimes are live at once.
Anything baked in at build time therefore has to be *wrong* for one of them. `Platform.OS` and
`Device.isDevice` are read where the app actually runs and cannot mismatch that way.

**This reverses [ai/suggestions/production-supabase.md](../../suggestions/production-supabase.md) on
purpose, and that document still says the opposite.** Its "Environment selection" section rejected a
runtime `pickTarget()` — "the phone is not a verification path at all", so production values should
come from the build environment (EAS secrets, CI). Step 5's task made the phone a target, which
removes the premise, while web has to stay local for Mailpit. Do not restore the build-time approach
on the strength of that document; it is a proposal written before the requirement changed. (Note it
was itself reversing `supabase-persistence.md`, which had proposed exactly this shape. The current
form is closest to that older sketch, arrived at for a new reason.)

**`expo-device` is a dependency bought to keep the simulator on local.** `Platform.OS` is `'ios'`
for a simulator and a phone alike, so the cheap one-liner (`web ? local : cloud`) would have pointed
`npm run ios` at the production database. `Device.isDevice` is the only thing that separates them.
It is an Expo SDK module and ships inside Expo Go, so this still costs no native dev build —
[native-build-toolchain](native-build-toolchain.md) is unaffected.

Two properties of that flag are load-bearing and easy to break while tidying:

- **`Device.isDevice` is `true` on web.** The `Platform.OS === 'web'` check must run first, or the
  browser goes to cloud.
- **It is a native constant, so it can arrive `undefined`** under jest-style module mocking. The
  branch falls back to `local` — towards the disposable database — rather than defaulting to cloud.

**`local` is not one address — the Android emulator needed a second patch, found only once a real
network call was driven from it.** The iOS Simulator really does share the Mac's network stack, so
`127.0.0.1:54321` reaches Docker as-is. The Android emulator runs its own network stack instead: a raw
TCP connect to its own `127.0.0.1:54321` gets refused (confirmed with `adb shell`), and `10.0.2.2` is
its fixed alias back to the host loopback. `localUrl()` in
[supabaseTarget.ts](../../../src/lib/supabaseTarget.ts) rewrites
`EXPO_PUBLIC_SUPABASE_URL_LOCAL`'s host to `10.0.2.2` only when `Platform.OS === 'android' &&
!Device.isDevice`; every other target keeps the literal env value. This shipped wrong for a full task
(13's phase 1 only ever booted the app on the emulator, never called Supabase from it) until phase 2's
Google sign-in became the first thing to make a real network call from the emulator and surfaced
"Network request failed".

**The two env pairs are symmetric (`_LOCAL` / `_CLOUD`), and neither is a default.** Keeping the old
unsuffixed `EXPO_PUBLIC_SUPABASE_URL` for local and adding only a `_CLOUD` pair would have been a
smaller diff, and would have implied a default that does not exist. Both pairs are also spelled out
in full because Metro substitutes `process.env.EXPO_PUBLIC_*` by literal text match; a name assembled
from the chosen target compiles cleanly and ships `undefined`. The `verify:` command counts all four
literals and asserts `supabaseTarget.ts` is the **only** non-test module that reads any of them.

**Why the picker is its own module** rather than a few lines inside `src/lib/supabase.ts`: testing it
there would drag `@supabase/supabase-js` into a jest run, which
[supabase-client-module-boundary](supabase-client-module-boundary.md) forbids. `supabase.ts` imports
`targets` and `pickTarget` from it and stays the thin client seam it was.

**Proving which target a native runtime picked takes making the wrong answer fail.** Booting Expo Go
and seeing the app work proves nothing when both pairs are filled in — either branch would render.

**The recipe this entry used to give for that does not work, and the correction is step 8's.** It
said "a shell variable beats `.env`, so blank the pair the app should not be using" and printed
`EXPO_PUBLIC_SUPABASE_URL_CLOUD= npx expo start`. Two separate mechanisms defeat it, both read out of
the installed Expo packages and confirmed against a served bundle on 2026-09-09
([supabase-local-stack](supabase-local-stack.md) has the details and pins the merge order with a
check):

1. **In the dev server the `.env` file wins over the shell.** The virtual `expo/virtual/env` module
   spreads the `.env*` files *over* `process.env`. Only a production export inlines from
   `process.env`, and this project never runs one.
2. **A blank value in a `.env*` file is dropped, not set.** Expo's transform keeps a parsed key only
   when its value is truthy, so `EXPO_PUBLIC_SUPABASE_URL_CLOUD=` in a file removes nothing — the
   lower-precedence file's value is still there.

So there is no "blank it and watch it throw" available. What works: put a **different, non-empty**
value (or `EXPO_PUBLIC_SUPABASE_TARGET`) in a gitignored `.env.local`, which does beat `.env`,
restart with `--clear`; and read the answer out of the served bundle rather than out of the shell —
`curl -s 'http://localhost:8081/index.bundle?platform=ios' | grep -o 'EXPO_PUBLIC_SUPABASE_TARGET[^,}]*'`
shows both the value the polyfill carries and the value the `.env` module supplies. The client still
throws on a *missing* pair, naming the target it chose, which remains the loudest signal when a pair
genuinely is not there. The simulator's branch was confirmed under the old reading; a physical phone
has still never been run.
