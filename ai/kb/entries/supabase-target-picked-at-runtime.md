---
id: supabase-target-picked-at-runtime
title: The Supabase environment is chosen at runtime by platform, not compiled in
type: decision
status: current
tags: [supabase, environment, expo, config, architecture]
sources: [ai/tasks/5-supabase-cloud/implementation-log-step-1.md, ai/tasks/8-realtime/implementation-log-step-1.md, ai/tasks/13-google-sign-in/implementation-log-step-2.md, ai/tasks/22-sticky-headers/implementation-log-step-1.md, src/lib/supabaseTarget.ts, src/lib/supabase.ts, .env.example, ai/tasks/20-ux/implementation-log-step-6.md, ai/tasks/26-apple-sign-in/implementation-log-step-2.md, ai/tasks/26-apple-sign-in/implementation-log-step-4.md, b15d384, 78f86a4]
last_verified: 2026-10-07
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

`EXPO_PUBLIC_SUPABASE_TARGET=local|cloud` overrides all of it, the browser and the simulator
included. That is how you put two clients on one database, and it is a trap: **this machine's `.env`
has held `EXPO_PUBLIC_SUPABASE_TARGET=cloud` since at least 2026-09-28**, which sent the simulator to
production. **A Metro already serving 8081 is as suspect**: on 2026-09-30 one left by `npm run ios`,
started without the override, had the app on cloud; stop it and restart with the override.
Maestro's `sign-in.yaml` asked cloud for a code to `maya@example.com` and got "Error sending magic
link email", which says nothing about the target. Before a run that reads Mailpit, check `.env` and
`.env.local` for the key. To force local without editing the user's `.env`, put it in the shell:
`EXPO_PUBLIC_SUPABASE_TARGET=local npx expo start --dev-client --clear`. A shell value beats every
`.env*` file today. That order has flipped once. Its mechanics, and the addresses and keys, are in
[supabase-local-stack](supabase-local-stack.md).

**A dev build takes its target from the Metro serving it, not from anything installed.** In task 26
the user believed the iPhone 13 was on cloud while it was on local. To put a physical phone on the
local stack, start Metro with both in the shell — `EXPO_PUBLIC_SUPABASE_TARGET=local
EXPO_PUBLIC_SUPABASE_URL_LOCAL=http://<the Mac's LAN IP>:54321`, `.env` untouched — since the
phone's own `127.0.0.1` is not the Mac. The dev build's ATS allows it (`NSAllowsLocalNetworking:
true`). A plain `npm start` afterwards sends the phone back to cloud. Before reading anything off a
phone, ask which Metro it loaded from.

**Decision: runtime, not build time.** One `expo start` serves the browser and the dev client from the
same server and the same env — press `w` in an `npm start` session and both runtimes are live at once.
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

**Proving which target a runtime picked takes reading the served bundle.** Seeing the app work
proves nothing when both pairs are filled in, since either branch would render, and a value in the
shell or a `.env*` file proves nothing until the bundle carries it. The `curl` recipe is in
[supabase-local-stack](supabase-local-stack.md). Do not count on blanking a pair to force a failure:
when step 8 tried it, a blank `.env*` value was dropped rather than set, and that has not been
re-measured since. The client still throws on a *missing* pair, naming the target it chose. The
simulator's and the browser's branches are confirmed, and a physical phone has run on local through
the override above.
