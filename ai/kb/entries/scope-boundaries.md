---
id: scope-boundaries
title: Scope — named lists, OTP sign-in, owner-only persistence and offline writes in; sharing, realtime, and deletion out
type: constraint
status: current
tags: [scope, product]
sources: [ai/tasks/1/description-step-1.md, ai/tasks/1/implementation-log-step-1.md, ai/tasks/2/description-step-2.md, ai/tasks/2/implementation-log-step-2.md, ai/tasks/3/description-step-1.md, ai/tasks/3/implementation-log-step-1.md, ai/tasks/4-offline-support/description-step-1.md, ai/tasks/4-offline-support/implementation-log-step-1.md, ai/tasks/5-supabase-cloud/description-step-1.md, ai/tasks/5-supabase-cloud/implementation-log-step-1.md, ai/tasks/6-custom-smtp/description-step-1.md, ai/tasks/6-custom-smtp/implementation-log-step-1.md]
last_verified: 2026-09-03
related: [writes-retry-from-an-outbox, list-cache-holds-acknowledged-rows, list-data-scoped-by-rls, supabase-local-stack, supabase-target-picked-at-runtime, otp-email-templates-carry-the-code, supabase-config-push-sends-the-whole-root]
---

Scope is set one task step at a time. What is in, as of step 6:

| | |
|---|---|
| step 1 | create named lists, add items, mark/unmark items done |
| step 2 | email OTP sign-in and sign-out, a session that survives a reload, a `users` table |
| step 3 | lists and items in Postgres, one owner each, surviving a reload |
| step 4 | writes queued on disk and retried until they land; the lists readable with no signal |
| step 5 | a cloud Supabase project as a second environment, which a physical device talks to |
| step 6 (phase 1) | custom SMTP pushed to production; sign-in mail is real mail now, but the app stays structurally single-user until phase 2 |

**Still deliberately out: sharing, realtime, deletion, passwords, and conflict resolution beyond
last-write-wins.**

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

**Offline moved in at step 4, and this entry used to forbid it** — "do not build a queue, a retry
loop or a local cache speculatively" was right until
[ai/tasks/4-offline-support/description-step-1.md](../../tasks/4-offline-support/description-step-1.md)
asked for changes to be *guaranteed* to reach the database. All three now exist: an outbox, a
backoff loop and a cached copy of the lists
([writes-retry-from-an-outbox](writes-retry-from-an-outbox.md),
[list-cache-holds-acknowledged-rows](list-cache-holds-acknowledged-rows.md)). Reading offline came
in with it, decided with the user before the work started: without a cached copy a cold start with
no signal shows an empty app, and the shop-with-no-bars scenario the queue exists for never happens.

What step 4 still left out, on purpose: no sync engine (PowerSync is the answer if this ever needs
real convergence), no connectivity library, no conflict resolution beyond last-write-wins, and no
"wait for sync" confirmation when signing out with writes pending.

**A cloud environment moved in at step 5**, from
[ai/tasks/5-supabase-cloud/description-step-1.md](../../tasks/5-supabase-cloud/description-step-1.md):
a linked project, `supabase/config.toml` split into local truth plus production overrides, and a
physical device pointed at cloud. What did *not* move in at step 5: any user-facing feature, any
schema change, custom SMTP, and the `config push` itself — the file was written, the production
project had not been updated from it. Nothing about the local-first workflow changed; web is still
where work is verified ([supabase-local-stack](supabase-local-stack.md)).

**Custom SMTP moved in at step 6, phase 1 only — and the step-5 paragraph above used to say the
`config push` itself hadn't happened. It has now.**
[ai/tasks/6-custom-smtp/description-step-1.md](../../tasks/6-custom-smtp/description-step-1.md)
pushed `[remotes.production.auth.email.smtp]` (Resend) and raised
`[remotes.production.auth.rate_limit] email_sent` to 30; a live dashboard read-back confirmed both
landed, along with the two OTP templates the push carries by inheritance
([otp-email-templates-carry-the-code](otp-email-templates-carry-the-code.md),
[supabase-config-push-sends-the-whole-root](supabase-config-push-sends-the-whole-root.md)). What did
*not* move in: multi-user sign-in. Resend's sandbox sender (`onboarding@resend.dev`) delivers only to
the address that owns the Resend account, so a stranger's `signInWithOtp` request is accepted by the
API and the mail silently never arrives — the app stays structurally single-user until phase 2
verifies a sending domain. Also not done: an actual physical-device sign-in against the new config,
which needs two runs (a brand-new address, then the same one again) that nothing has run yet. Treat
the push and the dashboard read-back as config-level proof, not delivery proof — do not read this
entry as saying device sign-in now works end to end.

**`ai/suggestions/*.md` are proposals, not scope.** They read like plans because they are — full
schema and design for Supabase-backed list persistence, a biometric unlock layer, and a cloud
Supabase project alongside the local stack — but nothing in them is approved until it arrives as an
`ai/tasks/<n>/description-step-<n>.md`, and a document being *partly* implemented does not promote
the rest of it. Step 2
implemented the auth half of `otp-biometric-auth.md` *only* because a task description asked for it,
step 3 the first staging step of `supabase-persistence.md`, step 5 the project/schema/config sections
of `production-supabase.md`, and step 6 phase 1 of that document's custom-SMTP section (§4) — each
because a task description asked for it. The biometric half is still just a proposal, and it needs a
native dev build besides; so are that document's `list_members` table and its realtime subscriptions.
§4's phase 2 (a verified sending domain) is also still just a proposal — phase 1 is the only part of
it that has landed.

**A suggestion can also be *overruled* by the step that implements the rest of it.** That document's
"Environment selection" section argued against runtime target-switching; step 5 did it anyway,
because the task made the phone a target and removed the section's premise
([supabase-target-picked-at-runtime](supabase-target-picked-at-runtime.md)). So a suggestion is not
merely un-promoted until a task lands — parts of it can be wrong afterwards, and the document is
never edited to say so. Check the KB before treating a suggestion's reasoning as current.

**What to do:** do not add any of the out-of-scope items speculatively, and do not treat their
absence as a gap worth flagging in a review. When a new task description lands, re-read this entry
and update it — that is the moment it goes stale.

No `verify:` command — scope is a judgment fact.
