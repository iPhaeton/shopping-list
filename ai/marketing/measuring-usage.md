# Measuring whether the free app is used

**Status: guidance, not a decision.** Written for the free-first release in
[app-store-release-free.md](../suggestions/app-store-release-free.md), whose last section says to
add a subscription "once usage justifies it". This is how to tell.

**Date:** 2026-10-11, written against commit `322e939`. The SQL below was run on the local
database that day; re-check column names if a Supabase upgrade lands before you use it.

Neither main source needs new code.

## 1. App Store Connect → Analytics

Collected by Apple automatically and for free:

- Impressions, product page views and downloads (first-time and re-downloads), by country and
  source.
- Sessions, active devices, retention (how many people still use the app after 1, 7 or 28 days)
  and crashes.

The usage metrics in the second group only count people who agreed to share analytics with
developers, which is a minority. Read them as a trend, not a headcount. Downloads alone say little:
many people install, try once and leave.

## 2. The Supabase database (the accurate source)

Everyone has to sign in, and the app renews its sign-in token whenever it's used after an hour or
more (`jwt_expiry = 3600` in [supabase/config.toml](../../supabase/config.toml)). Supabase stamps each
renewal in `auth.sessions.refreshed_at`. So a session renewed in the last 7 days means someone used
the app this week.

Run this in the SQL Editor of the **cloud** project in Supabase Studio:

```sql
select
  (select count(*) from public.users) as accounts,
  (select count(*) from public.users where created_at > now() - interval '7 days') as new_7d,
  (select count(distinct user_id) from auth.sessions
    where greatest(refreshed_at, created_at) > now() - interval '7 days') as active_7d,
  (select count(distinct user_id) from auth.sessions
    where greatest(refreshed_at, created_at) > now() - interval '30 days') as active_30d,
  (select count(*) from public.items where created_at > now() - interval '7 days') as items_added_7d;
```

| Column | Means |
|---|---|
| `accounts` | every account ever made and not deleted |
| `new_7d` | sign-ups this week |
| `active_7d` / `active_30d` | people who opened the app this week / month |
| `items_added_7d` | whether the app is actually used for shopping, not just opened |

Caveats:

- Subtract yourself and your test accounts.
- Signing out deletes the session row, so a signed-out user stops counting until they sign in
  again.
- `items` has no author column, so item counts are per app, not per person.

For a rough number without SQL, Supabase's Usage page shows monthly active users, counted the
same way (a sign-in or token refresh in the billing cycle).

## 3. Direct signals

Ratings and reviews on the App Store, and emails to `support@shopping-loop.com`.

## Not recommended for v1: an analytics SDK

Firebase, PostHog and the like add code, change the App Privacy answers, and in the EU may need a
consent prompt. The database already knows what matters.

## What counting users obliges

Counting users from your own data is "Analytics" in Apple's App Privacy terms, which include
"measuring audience size". So:

- In App Store Connect → App Privacy, tick **Analytics** as a purpose next to App Functionality
  for the data types the query reads (user ID, other user content).
- Add one line to the privacy policy saying usage is counted in aggregate.

## When usage justifies a subscription

The free plan estimates that covering about 1,500 zł a year (Apple plus Supabase Pro) takes about
20 people paying all year. Usually only a few percent of regular users pay, so a subscription
starts to make sense at **several hundred weekly active users** who are still there month after
month. That's a rule of thumb, not a threshold. Watch how many accounts older than a month are
still active, not the download count:

```sql
select count(distinct s.user_id) as returning_30d
from auth.sessions s
join public.users u on u.id = s.user_id
where u.created_at < now() - interval '30 days'
  and greatest(s.refreshed_at, s.created_at) > now() - interval '30 days';
```
