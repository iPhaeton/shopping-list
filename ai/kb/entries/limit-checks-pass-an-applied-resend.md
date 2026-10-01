---
id: limit-checks-pass-an-applied-resend
title: A database check on a queued write must let an already-applied resend through — so the list limits live on `list_members`, never in a BEFORE trigger on `lists`, and `add_item` skips its count for an id already there
type: constraint
status: current
tags: [supabase, postgres, triggers, outbox, offline, limits]
sources: [ai/tasks/23-list-limits/description-step-2.md, ai/tasks/23-list-limits/implementation-log-step-2.md, supabase/migrations/20261001000000_list_limits.sql, supabase/migrations/20260907000000_list_sharing.sql, src/lib/listsApi.ts, src/state/listsReducer.ts]
last_verified: 2026-10-01
verify: latest() { awk -v f="$1" '$0 ~ "^create (or replace )?function public\\." f "\\(" {b=""; on=1} on {b=b $0 "\n"} on && /^\$\$;/ {on=0} END {printf "%s", b}' supabase/migrations/*.sql; }; ! grep -rqiE 'before insert[a-z ]* on public\.(lists|items)( |$)' supabase/migrations && grep -A1 'create trigger on_list_created' supabase/migrations/*.sql | grep -q 'after insert on public.lists' && grep -A1 'create trigger limit_list_memberships' supabase/migrations/*.sql | grep -q 'before insert or update on public.list_members' && latest limit_list_memberships | grep -A3 "if tg_op = 'INSERT' then" | grep -q 'where m.list_id = new.list_id and m.user_id = new.user_id' && latest add_item | grep -B1 'perform public.check_item_limit(p_list_id);' | grep -q 'if not exists (select 1 from public.items i where i.id = p_id) then' && latest set_item_deleted | grep -q 'and i.deleted_at is not null' && latest set_list_deleted | grep -q 'and l.deleted_at is not null' && grep -q "if (code === '23505') return 'applied';" src/lib/listsApi.ts
related: [writes-retry-from-an-outbox, insert-returning-races-membership-trigger, ids-minted-outside-reducer, update-list-identity-preserving, writes-can-land-on-a-tombstone, scope-boundaries, list-data-scoped-by-rls]
---

**The outbox resends a write whose response was lost, though the database already holds it**
([writes-retry-from-an-outbox](writes-retry-from-an-outbox.md)). Ids minted up front make that resend
recognisable: `lists` refuses it on the primary key with `23505`, which `verdictFor` classifies
`applied`, and `add_item` inserts `on conflict (id) do nothing` and returns `'applied'`. A check that
runs ahead of either and counts the row the first attempt made turns that success into a refusal. A
refusal is `permanent`, so the outbox drops the write **and** `dropDependents` drops every write
queued into it: a list created offline at the limit would lose its items, though the list itself was
saved.

**A BEFORE trigger fires ahead of every uniqueness check, the primary key and `on conflict` alike.**
The limits (task 23 step 2) hit that twice:

- **A list limit cannot be a BEFORE INSERT trigger on `lists`** — it would fire for the resend before
  the primary key refuses it. Both list limits live on `list_members` instead, in
  `limit_list_memberships` (BEFORE INSERT OR UPDATE). The creator's row there comes from
  `on_list_created` → `grant_creator_ownership`, an **AFTER** INSERT trigger on `lists`, which never
  fires when the insert fails. Every other way onto a list or to ownership (`share_list`,
  `set_member_role`) is a `list_members` write too, so the one trigger sees them all.
- **`share_list`'s upsert fires BEFORE INSERT even when it will become an update.** So the trigger
  passes an insert whose `(list_id, user_id)` already exists, and the BEFORE UPDATE branch judges
  it — checking only a promotion to owner. Counting on the insert would refuse re-sharing someone
  already on the list at 1,000, which changes nothing but the role.

**An RPC that counts must skip the count for a write already applied.** `add_item` calls
`check_item_limit` only when no item with `p_id` exists. Both restores (`set_item_deleted`,
`set_list_deleted`, `p_deleted => false`) count only a row that is actually in the bin **and** that
the caller may restore, so a resent restore of a live row is a no-op, and a caller without access
falls through to the unchanged `42501` without learning anything about counts. Measured at the limit
on the local stack: a resent `POST lists` came back `409` `23505`, a resent `add_item` `200`
`"applied"`, a resent restore succeeded.

**The client's counts follow the same rule.** The reducer moves `listCounts` only on `list/created`'s
append branch and on a `list/setDeleted` that flips liveness, so `replay` and `foldPage` can apply a
pending write again over rows that already hold it
([update-list-identity-preserving](update-list-identity-preserving.md)). One accepted gap: a resent
create whose list sorts past the loaded pages is not in state, lands on the append branch, and is
counted once too often until the next full `hydrate`.

**What to do:** any new check on a write the outbox sends — a limit, a quota, a validation that reads
other rows — must answer "what if this exact write already landed?" with *pass*. Put it where the
resend never reaches (behind the uniqueness check, as the AFTER trigger's own insert is), or skip it
explicitly when the id or the target state already matches. Do not move the list checks onto
`lists`, and do not add locks to close the overshoot the counts allow
([scope-boundaries](scope-boundaries.md)).

The `verify:` asserts no BEFORE INSERT trigger on `lists` or `items`; `on_list_created` AFTER and
`limit_list_memberships` BEFORE on `list_members`; and, in each function's **latest** definition
across the migrations, the existing-membership pass, `add_item`'s skip, both restores' bin
condition — plus `23505` → `applied` in `verdictFor`.
