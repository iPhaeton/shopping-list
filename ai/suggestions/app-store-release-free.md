# Suggestion — release ShoppingLoop free on the App Store first

**Status:** proposal, not an approved step. Its code parts need an
`ai/tasks/<n>/description-step-<n>.md` first, exactly as in
[app-store-release.md](app-store-release.md).

**Date:** 2026-10-11, written against commit `a681ee6`.

**What this is.** An alternative to [app-store-release.md](app-store-release.md) (the "paid plan")
for when the app is expected to earn little or nothing. Version 1 is free: no subscription, no ads,
no in-app purchases. The paid plan stays the plan for adding a subscription later. Where a step
doesn't change, this document points to it by number instead of copying it.

**Why free first.** The JDG is on **ryczałt** (`~/Dropbox/jdg/firm-info.md`). Ryczałt taxes
revenue, not profit, and no cost reduces it. So:

- Selling brings the same paperwork whether the app earns 10 zł or 10,000 zł: the Paid Apps
  Agreement, the W-8BEN, trader status, a monthly invoice to Apple, the "np" entry in JPK_V7, the
  VAT-UE report, and PKD 58.29.Z.
- Every złoty from Apple is taxed (probably at 12%, the accountant confirms), while the app's costs
  reduce nothing.
- IP Box isn't available on ryczałt, and with near-zero income, switching to liniowy for it gains
  nothing.
- At 10 zł a month, Apple keeps about 3 zł for VAT and its 15% commission, and ryczałt takes about
  0.80 zł more. Covering only Apple and Supabase Pro (about 1,500 zł a year) would take about 20
  people paying all year.

Releasing free skips all of that, plus the paid plan's Phase 3 (subscriptions), the largest code
phase left.

## Already done (as of 2026-10-11)

- Apple Developer Program: paid, team `YZ75T58P4Z`, active since 2026-10-04.
- `support@shopping-loop.com` receives and replies
  ([support-address-and-mail-domains](../kb/entries/support-address-and-mail-domains.md)).
- The code App Review requires, which is the paid plan's 2.1, 2.2 and 2.4: Sign in with Apple
  (task 26), account deletion (task 25), invitations and blocking (task 28).
- A dev build runs on a registered iPhone 13, but only against the local database.

## 0. Three decisions

1. **Price — settled by this document: free, with nothing to buy.** The task 23 limits (100 owned
   lists, 1,000 lists, 1,000 items in a list) stay as they are. They guard against abuse; they are
   not a free tier.

2. **Hobby or business — open; the accountant's answers decide.** Only two setups are consistent:

   | | A. Business (JDG) | B. Hobby (private) |
   |---|---|---|
   | Who pays for services | the JDG, with its EU VAT number (reverse charge) | you, privately; some providers add VAT |
   | DSA trader status | trader: Apple publishes address, phone and email on EU product pages | non-trader: nothing published |
   | Virtual office and second phone | needed, unless the home address may be public | not needed |
   | Accountant's monthly work | the cost invoices | none |
   | Privacy policy and terms name | the JDG: name, address, NIP | you by name, plus the support email |
   | Adding a subscription later | the paid plan, from Phase 1 step 3 | move to A first (see the last section) |

   The Apple account is the same in both: enrolled as an Individual, in your legal name.

   Mixing the two, with the JDG paying the costs while you declare non-trader, is hard to defend: a
   business paying for the app is what makes its publisher a trader. Apple accepts non-trader for a
   free app with no ads or purchases, but the declaration is yours, and so is the legal risk.

   On ryczałt, neither setup lowers income tax. The money difference is VAT. In A, the
   reverse-charge VAT cancels out only if input VAT can be deducted for an app with no sales (email
   question 2). If it can't, A costs as much as B plus the trader overhead. On Supabase's free tier,
   the only bills are Apple's $99 and the domain, so the VAT at stake is under 100 zł a year.

   **Leaning: B**, unless the accountant says A's VAT is deductible *and* a published business
   address doesn't bother you.

3. **Supabase plan — open; decide before release.**
   - **Free:** $0. But a project with too little database activity over 7 days is paused. It stays
     down until you restore it by hand in Studio (possible within 90 days), and the free plan keeps
     no backups.
   - **Pro:** $25 a month (about 1,200 zł a year, and on ryczałt none of it is deductible). It has
     no pausing, and daily backups kept for 7 days.
   - Supabase says a few database requests a day keep a project awake, so your own daily use of the
     app probably does. A week away from it would not.
   - **Leaning:** stay free through TestFlight and the first weeks. Move to Pro once anyone besides
     you relies on the app, or at the first pause. Until then, a hand-run `npx supabase db dump
     --linked` is the only backup.

## Phase 1: Accounts and paperwork

1. ~~Join the Apple Developer Program~~ — done.
2. **Send the accountant email**
   [ai/paperwork/accountant-email-free.md](../paperwork/accountant-email-free.md). Its answers
   settle decision 0.2.
3. **Create the app record:** the paid plan's Phase 1 step 2, unchanged.
4. **Declare trader status** in App Store Connect, following decision 0.2. Without it, the app
   isn't available in the EU, and so not in Poland either.
   - As a trader: the address, a phone number and `support@shopping-loop.com`, all verified by
     Apple.
   - As a non-trader: nothing is published.
5. **Skip:** the Paid Apps Agreement, bank account, W-8BEN and Small Business Program (the paid
   plan's Phase 1 steps 3–4), and RevenueCat (step 7). A free app only needs the Free Apps
   Agreement, which came with the developer program.
6. **Web pages** (the paid plan's step 5, changed). Check what's already on shopping-loop.com
   against this:
   - The privacy policy lists no purchase status and no RevenueCat. The data controller is the JDG
     (A) or you by name (B).
   - The terms and privacy policy have Polish versions.
   - The DPAs to accept are Supabase's and Resend's only.
7. **Expo account and `eas-cli`:** the paid plan's step 6, unchanged. `eas` isn't installed yet.
8. **Publish the Google OAuth consent screen:** the paid plan's step 9, unchanged.
9. **Billing:** in A, the paid plan's step 10 without RevenueCat. In B, use personal billing, and
   nothing goes to the accountant.

## Phase 2: Code

Only one item of the paid plan's Phase 2 is left:

- **2.3 Links in the app.** Put Privacy Policy, Terms and a `support@shopping-loop.com` contact
  link on [AccountScreen](../../src/screens/AccountScreen.tsx). Nothing in `src/` links to
  shopping-loop.com yet.

The paid plan's Phase 3 (subscriptions) is skipped entirely. Nothing here builds anything a
subscription would later have to undo.

## Phase 3: Release build setup

This is the paid plan's Phase 4, with these changes:

- **4.1 [app.json](../../app.json):** `supportsTablet` is still `true`, so set it to `false`. Add
  `usesNonExemptEncryption: false`.
- **4.2 EAS:** unchanged, minus the RevenueCat key.
- **4.3 Production Supabase.** The "seven migrations behind" there is stale:
  - Cloud was checked last on 2026-10-06, and only task 26's `20261007000000_apple_tokens.sql` was
    missing then. The four task 28 migrations after it
    (`20261008000000_invitations.sql` through `20261009100000_unblock_restores_invitations.sql`) are most likely missing too. Check with
    `npx supabase migration list --linked`, then run `npx supabase db push`.
  - Deploy the three Edge Functions (`delete-account`, `store-apple-token`,
    `reset-apple-sign-in`) and set the secrets they read. None of them exists on cloud yet.
  - Run `config push` only by hand, as the paid plan says. Its Y/n prompt is the only review.
  - The free plan runs Edge Functions and the nightly `pg_cron` purges, so decision 0.3 doesn't
    change this step.

## Phase 4: Test on a real iPhone against production

This is the paid plan's Phase 5, minus the three purchase tests. A dev build runs on the iPhone 13,
but none of this has ever run against production:

- Sign-in by email code, Google and Apple.
- Realtime between two phones. No client has ever connected to the cloud realtime socket.
- Adding items offline, then reconnecting.
- Invitations, accepting, declining and blocking, between two accounts.
- Deleting an account, both one made with Apple and one without.

## Phase 5: Store listing and submission

This is the paid plan's Phase 6, with these changes:

- **Price:** Free, in Pricing and Availability.
- **App Privacy:** email address, name, other user content and user ID. No purchase history.
- **Review notes:** the demo account and the name screen. There's no paywall to explain.
- **Step 6** (subscriptions on the version page): skip.
- **Step 7:** releasing manually or automatically after approval both work. There's no income to
  time.
- **Step 8** (the accountant meeting): replaced by the email in Phase 1 step 2. Nothing has to
  happen before Release.
- **Step 9** (PKD 58.29.Z): only if the accountant says so, and only in A.

## Costs

| | Supabase free | Supabase Pro |
|---|---|---|
| Apple Developer Program | $99/year | $99/year |
| Supabase | $0 | $25/month |
| Domain (Cloudflare) | about $10/year | about $10/year |
| Resend, EAS Build | free | free |
| **Total** | **about $110/year (about 400 zł)** | **about $410/year (about 1,500 zł)** |

In setup A, add the virtual office and phone. On ryczałt, none of this reduces tax.

## Adding a subscription later

Do this once usage justifies it:

1. If you're on setup B, move to A first. Declare trader status, move billing to the JDG, and
   rename the privacy policy's controller.
2. Ask the accountant the questions this release skipped: the W-8BEN, VAT on Apple's payments,
   which month income belongs to, the ryczałt rate for App Store income, and whether the extra
   revenue moves the JDG into a higher health-contribution band (the bands change at 60,000 and
   300,000 zł a year).
3. Follow the paid plan: decision 0.1, Phase 1 steps 3, 4, 7 and 8, Phase 3, and Phase 6 steps 6,
   8 and 9. Supabase Pro stops being optional at that point.
4. Existing users shouldn't lose access to lists they already have. Pick the free tier with that
   in mind.

## How this fits the repo's workflow

The only code is Phase 2's links and Phase 3's `app.json` changes. Each starts as an
`ai/tasks/<n>/description-step-<n>.md` (the next free number is 29) and ends with an
implementation log and `/librarian deposit`. Updating production Supabase is operations, not
code. Phase 1 can start now.
