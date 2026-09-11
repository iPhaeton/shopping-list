-- The nightly job that calls `public.purge_deleted()`.
--
-- **Deliberately its own file, and read this before moving it.** A migration is applied as one
-- transaction, so a statement the target refuses rolls its whole file back. `pg_cron` is confirmed
-- present in `shared_preload_libraries` on the local Docker stack, but the cloud project is
-- unverified — `create extension` there is the one statement in this feature that may be refused.
-- Kept separate, a refusal costs the schedule and nothing else: the previous migration is already
-- applied and recorded, `purge_deleted` still works, and it can still be run by hand.
--
-- The price of that split, which is worth knowing before it bites: an **unapplied** migration wedges
-- every later `db push`, because the CLI retries unapplied files from the earliest one forward. If
-- this file fails against cloud, the next feature's migration cannot ship until either it is fixed
-- or `npx supabase migration repair --status applied 20260910000001` is run. "One file failed" and
-- "migrations are stuck" are the same event.
--
-- The fallback if `pg_cron` turns out to be unavailable is a lazy purge — collecting old tombstones
-- as a side effect of the next delete. It needs no scheduler and has a genuinely nice property (the
-- collector is driven by the same activity that makes the garbage), but it puts unpredictable
-- latency inside a user's tap, and "why was that delete slow" is a worse question to debug than "did
-- the nightly job run".

create extension if not exists pg_cron;

-- 03:30 **GMT** — `cron.timezone` is GMT, not the server's local zone, measured rather than assumed.
--
-- Safe to re-run: scheduling an existing job *name* upserts it — one row, same jobid, newest
-- schedule wins — so `npx supabase db reset` does not accumulate duplicates.
--
-- The job runs as `postgres`, which owns `purge_deleted`, so the `security definer` and the revoke in
-- the previous migration are consistent and nothing needs granting to make this work.
select cron.schedule('purge-deleted', '30 3 * * *', $$select public.purge_deleted()$$);

-- The failure mode here is silent and slow: no error, no alert, just a fetch that gets bigger every
-- month. Check `cron.job_run_details` once after deploying, and again a week later.
