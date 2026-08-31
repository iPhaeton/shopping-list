---
id: scope-boundaries
title: Scope — named lists, OTP sign-in, and owner-only persistence in; sharing, realtime, and deletion out
type: constraint
status: current
tags: [scope, product]
sources: [ai/tasks/1/description-step-1.md, ai/tasks/1/implementation-log-step-1.md, ai/tasks/2/description-step-2.md, ai/tasks/2/implementation-log-step-2.md, ai/tasks/3/description-step-1.md, ai/tasks/3/implementation-log-step-1.md]
last_verified: 2026-08-31
related: [optimistic-list-writes, list-data-scoped-by-rls, supabase-local-stack]
---

Scope is set one task step at a time. What is in, as of step 3:

| | |
|---|---|
| step 1 | create named lists, add items, mark/unmark items done |
| step 2 | email OTP sign-in and sign-out, a session that survives a reload, a `users` table |
| step 3 | lists and items in Postgres, one owner each, surviving a reload |

**Still deliberately out: sharing, realtime, deletion, offline support, and passwords.**

**List persistence moved in at step 3 and this entry used to say otherwise.**
[ai/tasks/3/description-step-1.md](../../tasks/3/description-step-1.md) asked for persistence and
explicitly deferred sharing, so `lists` and `items` got owner-only row-level security and no
membership table — see [list-data-scoped-by-rls](list-data-scoped-by-rls.md). It is staging step 1
of `ai/suggestions/supabase-persistence.md`; the rest of that document is still a proposal.
(Note the filename: task 3's description and log are `-step-1`, not `-step-3`.)

**Auth moved in at step 2**, from
[ai/tasks/2/description-step-2.md](../../tasks/2/description-step-2.md): email OTP sign-in with
Supabase and "the `users` table" — singular, and read literally, so list data stayed in memory for
one more step. Between step 2 and step 3 the session survived a reload and the lists did not; that
gap is now closed, and any advice you remember to the contrary is out of date.

**"The user can create a list" means *many* named lists, not one standing list.** The step-1
description was singular and genuinely ambiguous; the question went to the user and the answer was
many. That reading is why there are two list screens (`Lists` → `ListDetail`) and why the app
depends on React Navigation at all. Treat it as settled: do not "simplify" the product back to one
list, and do not re-litigate the ambiguity from the description alone.

**Deleting lists and items was deliberately not built.** It is absent from every description so far,
so it was left out on purpose; it is not an oversight waiting to be fixed. It goes as far as the
database: there is no delete policy on either table.

**Offline is not solved either.** A write lost to bad signal is lost, and an error banner is all
that says so — see [optimistic-list-writes](optimistic-list-writes.md). Do not build a queue,
a retry loop or a local cache speculatively.

**`ai/suggestions/*.md` are proposals, not scope.** They read like plans because they are — full
schema and design for Supabase-backed list persistence, a biometric unlock layer, and a cloud
Supabase project alongside the local stack — but nothing in them is approved until it arrives as an
`ai/tasks/<n>/description-step-<n>.md`, and a document being *partly* implemented does not promote
the rest of it. Step 2
implemented the auth half of `otp-biometric-auth.md` *only* because a task description asked for it,
and step 3 the first staging step of `supabase-persistence.md` for the same reason. The biometric
half is still just a proposal, and it needs a native dev build besides; so are that document's
`list_members` table, its realtime subscriptions, and everything in `production-supabase.md`.

**What to do:** do not add any of the out-of-scope items speculatively, and do not treat their
absence as a gap worth flagging in a review. When a new task description lands, re-read this entry
and update it — that is the moment it goes stale.

No `verify:` command — scope is a judgment fact.
