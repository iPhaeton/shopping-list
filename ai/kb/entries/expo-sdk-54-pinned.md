---
id: expo-sdk-54-pinned
title: The project is on Expo SDK 54 — read the v54 docs, not the latest
type: reference
status: current
tags: [expo, versions, docs]
sources: [4d55c18, ai/tasks/1/implementation-log-step-1.md]
last_verified: 2026-09-11
verify: grep -q '"expo": "\^54' package.json
related: [native-build-toolchain]
indexed: false
---

> **Demoted from `INDEX.md` at step 9, still true.** Its headline instruction is already auto-loaded
> into every session by [AGENTS.md](../../../AGENTS.md), which opens with the v54.0.0 docs link, so
> the index line was buying a second copy of a fact nobody could miss. The version table below is the
> part that is not duplicated anywhere; reach it from
> [native-build-toolchain](native-build-toolchain.md) or by asking.

The stack, as of commit `4d55c18` ("Downgrade expo go sdk to 54"):

| | |
|---|---|
| Expo SDK | ^54.0.37 |
| React Native | 0.81.5 |
| React | 19.1.0 |
| TypeScript | ~5.9.2 |
| jest-expo | ~54.0.18 |

**Read the versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing Expo code.**
The unversioned docs track the newest SDK and will describe APIs this project does not have.

**Why it matters:** [ai/tasks/1/implementation-log-step-1.md](../../tasks/1/implementation-log-step-1.md)
records the delivered stack as Expo 57.0.16 / RN 0.86.2 / React 19.2.3 / TS 6.0.3, and its
follow-ups note that AGENTS.md pointed at the v57 docs. That was true on 2026-08-25 and is the
reason the log is not the place to learn the current stack. The log is not edited — journals are
immutable — and this entry is the current truth that supersedes it.
