# Suggestion — release ShoppingLoop on the App Store, sold by subscription

**Status:** proposal, not an approved step. Adopting any code part of it needs a new
`ai/tasks/<n>/description-step-<n>.md` first, and
[scope-boundaries](../kb/entries/scope-boundaries.md) updated afterwards by the librarian.

**Date:** 2026-09-24, written against commit `a2eb1f6`.

**Revised 2026-09-24: the seller is the owner's Polish sole proprietorship (JDG).** It is an active
VAT payer with a valid EU VAT number. Its registry details (name, address, NIP, bank accounts) are
in `~/Dropbox/jdg/firm-info.md`, outside this repo, and are deliberately not copied here. This
settled decisions 0.2 and 0.3 and added Polish tax and legal steps. The code phases did not change.
The tax points are what Polish sources describe; the owner's accountant confirms them (Phase 6,
step 8).

Four gaps block a release no matter what the pricing is:

- The app has no account deletion.
- There's no Sign in with Apple.
- There's no `eas.json`, so no store build can be made yet.
- The production Supabase database is seven migrations behind the local one.

The steps are ordered so Apple's slow paperwork runs while the code is written.

## 0. Three decisions that change the code (two now settled)

1. **What the subscription unlocks.** Recommended: a free tier (for example 1 list and no sharing)
   plus a paid "Pro" plan for unlimited lists and sharing. People invited to a Pro user's list would
   use it for free. With this model the server only has to check the subscription in two places:
   when a list is created and in `share_list`. The other option is a hard paywall, where nothing
   works without paying after a trial. The UI is simpler, but everyone invited must also pay, and
   every write function needs the check.
2. **Individual or company — settled: Individual.** Apple enrolls a sole proprietorship as an
   individual. A JDG is not a separate legal entity, so the Organization route and its D-U-N-S
   number don't apply. The seller name shown on the App Store is the owner's legal name, which is
   also the JDG's registered name.
3. **EU or not — settled: sell in the EU as a declared "trader".** Selling subscriptions from a
   Polish business makes you a trader under the EU's Digital Services Act, and leaving out the EU
   would mean leaving out Poland. Apple publishes the address, phone number and email on EU product
   pages. The address is already public in CEIDG; the phone and email are not, so use a separate
   phone number and `support@shopping-loop.com` (Phase 1, step 5).

## Phase 1: Accounts and paperwork (start first, these involve waiting)

1. **Join the Apple Developer Program** at developer.apple.com/programs/enroll. It costs $99 a year
   and needs an Apple ID with two-factor authentication. Enroll as an **Individual**, with Poland as
   the country and the legal name exactly as on your ID. The fastest way is the Apple Developer app
   on an iPhone, which scans your ID.
2. **Create the app record in App Store Connect** (Apps → "+" → New App):
   - Name "ShoppingLoop". Names must be unique across the whole store and are limited to 30
     characters. If it's taken, use something like "ShoppingLoop: Shared Lists".
   - Bundle ID `com.shoppingloop.app`, which is already set in [app.json](../../app.json).
   - SKU: any string, for example `shoppingloop-ios`.
3. **Set up payments** in App Store Connect → Business. Accept the **Paid Apps Agreement** and add
   one of the JDG's business bank accounts. Nothing can be sold, and subscriptions can't really be
   tested, until the agreement shows "Active".
   - Tax form: **W-8BEN** (the individuals' form, not W-8BEN-E), in your own name, claiming the
     US–Poland tax treaty to reduce US withholding. The NIP is probably the "foreign tax ID".
   - Fill it in as best you can now. If the accountant wants a different treaty claim (Phase 6,
     step 8), submit a corrected form before release. With no sales yet, nothing has been withheld.
4. **Apply to the App Store Small Business Program.** It cuts Apple's commission from 30% to 15%.
5. **Publish three web pages on shopping-loop.com**, each naming the business (name, address, NIP):
   - A Privacy Policy. It names the JDG as the GDPR data controller and says what is collected
     (email, display name, lists and items, purchase status) and who processes it (Supabase,
     Resend, Google, Apple, RevenueCat).
   - Terms of Use. Polish law on electronic services requires terms of service ("regulamin") for
     the account and sync service, so write your own rather than only linking Apple's standard
     EULA.
   - A Support page with a contact email.
   - Because the app sells to Polish consumers, the terms and the privacy policy also need Polish
     versions.
   - `support@shopping-loop.com` needs a mailbox that receives mail. Today the domain only sends
     (Resend, from the `mail.` subdomain). The same address is the email Apple publishes for the
     trader status.
   - Accept the data processing agreements (DPAs) in the Supabase, Resend and RevenueCat
     dashboards. Supabase already runs in the EU (eu-west-1); Resend and RevenueCat are US
     companies, and their DPAs cover the data transfer.
6. **Create an Expo account** (free), then install and log into the build tool:
   `npm i -g eas-cli && eas login`.
7. **Create a RevenueCat account.** It checks Apple's receipts, keeps each user's subscription
   status, and notifies the server when someone pays or cancels. It's free until $2.5k a month in
   revenue.
8. **Upgrade the cloud Supabase project to Pro** ($25 a month). Free projects pause after about
   7 days without traffic, which would be a full outage for paying users.
9. **Publish the Google OAuth consent screen** (Google Cloud Console → OAuth consent screen →
   Publish app). While it's in "Testing" mode, only listed test users can use "Continue with
   Google".
10. **Buy every service as the business.** Put the EU VAT number in the billing settings of
    Supabase, RevenueCat, Expo and Resend, so they invoice the JDG without VAT, and keep the Apple
    Developer Program invoice too. Hand them to the accountant with the usual monthly documents:
    the reverse-charge VAT on them belongs to the month of purchase, not the release month.

## Phase 2: Code Apple requires, whatever the price

**2.1 Sign in with Apple.** App Review guideline 4.8 requires it because the app offers Google
sign-in. The alternative is to hide Google on iOS for version 1. Adding Apple is recommended,
because reviewers can also use it to sign in.

- Run `npx expo install expo-apple-authentication`. In [app.json](../../app.json), add
  `"usesAppleSignIn": true` under `ios` and add `"expo-apple-authentication"` to `plugins`.
- Create `src/lib/appleSignIn.ts`, built like
  [src/lib/googleSignIn.ts](../../src/lib/googleSignIn.ts):
  - Make a random nonce and pass its SHA-256 hash (using `expo-crypto`, already installed) to
    `AppleAuthentication.signInAsync({ requestedScopes: [FULL_NAME, EMAIL], nonce })`.
  - Then call
    `supabase.auth.signInWithIdToken({ provider: 'apple', token: identityToken, nonce: rawNonce })`.
  - Apple supports the nonce, so don't copy Google's `skip_nonce_check = true`.
- In [src/state/SessionContext.tsx](../../src/state/SessionContext.tsx), add `signInWithApple` next
  to `signInWithGoogle`.
- In [src/screens/SignInScreen.tsx](../../src/screens/SignInScreen.tsx), show Apple's native
  `AppleAuthenticationButton` on iOS, at least as prominent as the Google button.
- In [supabase/config.toml](../../supabase/config.toml), set `[auth.external.apple]` to
  `enabled = true` and `client_id = "com.shoppingloop.app"`. Native-only sign-in needs no secret.
- **Review risk:** Apple rejects apps that ask for a name after Sign in with Apple, and
  [SetNameScreen](../../src/screens/SetNameScreen.tsx) is a required gate. Apple sends `fullName`
  only on a user's very first sign-in. On that sign-in, prefill the name field with it and describe
  the field as a "public display name others see when you share". Explain the same in the review
  notes.
- Every test suite that renders `SessionProvider` will need a `jest.mock` for the new module, the
  same way the Google one does.

**2.2 In-app account deletion.** Guideline 5.1.1(v) requires it. Today
[AccountScreen](../../src/screens/AccountScreen.tsx) can only sign out.

- Add a Supabase Edge Function `delete-account`. The project has no functions yet. The function
  identifies the caller from their login token and deletes them with the admin API
  (`auth.admin.deleteUser`).
- The database's foreign keys already cascade from the deleted user. Still to decide: what happens
  to shared lists where that user was the only owner. Today they would be left with no owner.
- If the account was created with Apple, Apple also requires revoking its token:
  - On the phone, call `signInAsync` again to get a fresh `authorizationCode` and send it to the
    function.
  - The function exchanges the code at `appleid.apple.com/auth/token`, then calls `/auth/revoke`.
  - This needs a "Sign in with Apple" key (a .p8 file) from the developer account, stored as a
    function secret.
- On AccountScreen, add "Delete account" behind the same two-step confirm that "Sign out of all
  devices" uses:
  - Warn that deleting the account does **not** cancel the subscription, and offer a "Manage
    subscription" button.
  - After deleting, clear the local caches (list cache, offline write queue, name cache) and sign
    out.

**2.3 Show privacy policy and terms links inside the app,** on AccountScreen and the paywall. Apple
wants the privacy policy reachable in the app, not only in the store.

**2.4 Likely review question: strangers can put a list on someone's screen.**
`search_users_by_name` searches every account, and `share_list` adds the person without asking
them. Guideline 1.2 expects a way to block or report abusive users. "Leave list" already exists;
adding "Block this person", or a step where the invitee accepts, would close the gap. This can be
done before the first review or after.

## Phase 3: Subscriptions

**3.1 In App Store Connect** (the app → Monetization → Subscriptions):

- Create a subscription group, for example "ShoppingLoop Pro".
- Add products, for example `com.shoppingloop.app.pro.monthly` and
  `com.shoppingloop.app.pro.yearly`. Each needs a price, a duration, a display name and
  description, and a screenshot of the paywall for the reviewer. A free trial can be added as an
  introductory offer.
- In Users and Access → Integrations → In-App Purchase, create a key (a .p8 file). RevenueCat needs
  it.
- In App Information → App Store Server Notifications, paste the URL RevenueCat gives you.

**3.2 In RevenueCat:**

- Add the iOS app with the bundle ID and the .p8 key, and import both products.
- Create an entitlement called `pro` that includes both products, and an offering that contains
  both.
- Add a webhook that calls the Supabase function (3.4), with a secret Authorization header.

**3.3 App code**

- Run `npx expo install react-native-purchases`. Add `react-native-purchases-ui` too for
  RevenueCat's ready-made paywall. Purchases don't work in Expo Go, but a dev build already exists.
- Create `src/lib/purchases.ts` as the only module that imports the SDK. This follows the same rule
  as `src/lib/supabase.ts`, so tests mock one file. It exposes `configure`, `logIn`, `logOut`,
  `isPro`, `purchase`, `restore` and `manageSubscriptions`.
- In `SessionContext`:
  - After sign-in, call `Purchases.logIn(session.user.id)`. The subscription then follows the
    account across devices, and the webhook knows which user paid.
  - Call `logOut` on sign-out and on account deletion.
  - Keep a `pro` flag, updated from `getCustomerInfo()` and `addCustomerInfoUpdateListener`.
- Add a `PaywallScreen` to [RootNavigator](../../src/navigation/RootNavigator.tsx). It opens when a
  free user tries a Pro action (a second list, or the Sharing screen). Apple requires the paywall to
  show:
  - The plan name, billing period and price, read from the store and never hard-coded.
  - What happens when the trial ends, and that the plan renews automatically unless cancelled.
  - A **Restore Purchases** button, plus links to the Terms and Privacy Policy.
- On AccountScreen, show the current plan, "Restore purchases" and "Manage subscription".

**3.4 Server code.** This makes the rules hold even if someone calls the Supabase API directly, the
same way sharing roles are enforced in the database.

- Add a migration with a `subscriptions` table (`user_id`, `expires_at`). Users can read only their
  own row and can't write to it. Add an `is_pro(uid)` helper.
- Add an Edge Function `revenuecat-webhook`. It checks the secret header, fetches the user's
  current status from RevenueCat's REST API, and saves `expires_at`. Fetching the status is safer
  than trusting the event itself, because events can arrive out of order.
- Enforce Pro in the database at list creation and in `share_list`.
- **Offline-queue gotcha:** list creation goes through the offline write queue. A "not Pro" refusal
  needs its own result kind in `resultFor`
  ([src/lib/listsApi.ts:307](../../src/lib/listsApi.ts#L307)) that opens the paywall, the way a
  revoked session is flagged today. Otherwise it's treated as an ordinary refusal.

**3.5 Keep the browser test loop working.** The RevenueCat SDK doesn't run on web. Make
`purchases.ts` report Pro on web, and give local test accounts Pro with a SQL insert (for example a
snippet in `supabase/snippets/`).

## Phase 4: Release build setup

**4.1 Changes to [app.json](../../app.json):**

- Set `"supportsTablet": false` for version 1. With `true`, iPad screenshots are required and Apple
  will test on iPad. With `false`, the app still runs on iPads in iPhone mode.
- Add `"ios": { "config": { "usesNonExemptEncryption": false } }`. The app only uses HTTPS, so this
  skips the export-encryption question on every upload.
- The icon is already fine: 1024×1024 with no transparency.

**4.2 Set up EAS:**

- Run `eas init` and `eas build:configure`. In `eas.json`, give the production profile
  `"autoIncrement": true` and `"environment": "production"`, and set
  `"appVersionSource": "remote"` under `cli`.
- **Important:** `.env` is gitignored, so EAS never uploads it. Without it,
  [src/lib/supabase.ts](../../src/lib/supabase.ts) throws on the first launch. Store the values in
  EAS instead:

  ```
  eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL_CLOUD --value <url> --visibility plaintext
  eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY_CLOUD --value <key> --visibility plaintext
  eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_TARGET --value cloud --visibility plaintext
  ```

  Add the RevenueCat iOS public key the same way. The third variable makes `pickTarget()` in
  [src/lib/supabaseTarget.ts](../../src/lib/supabaseTarget.ts) always choose production in a store
  build, instead of relying on "is this a real phone".

**4.3 Bring production Supabase up to date.** It hasn't received anything since step 9.

- Run `npx supabase db push` to apply the seven pending migrations plus the new ones.
- Run `npx supabase config push` to enable the Google and Apple providers:
  - Run it **by hand in a real terminal, without `--yes`**. It prints the diff and asks Y/n, and
    that prompt is the only chance to review
    ([supabase-config-push-sends-the-whole-root](../kb/entries/supabase-config-push-sends-the-whole-root.md)).
  - First set `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` and `RESEND_API_KEY` in the shell.
  - Consider raising `email_sent` above 30 per hour. The limit covers the whole project, so on
    launch day the 31st sign-in email in an hour would fail.
- Deploy the two functions with `npx supabase functions deploy` and set their keys with
  `npx supabase secrets set`.

## Phase 5: Test on a real iPhone (this app has never run on one)

1. Build with `eas build -p ios --profile production`, then upload with
   `eas submit -p ios --latest`. When EAS asks, let it log into the Apple account. It creates the
   certificates and turns on the Sign in with Apple capability.
2. In TestFlight, add yourself as an internal tester (no review needed) and install the app.
3. Test each of these against production. None of them has been done before:
   - Sign-in by email code, Google and Apple.
   - Realtime updates between two phones.
   - Adding items offline, then reconnecting.
   - Buying a plan (TestFlight purchases are free test purchases with sped-up renewals).
   - Letting the plan expire, so the account drops back to free.
   - Restoring the purchase on a second device.
   - Deleting an account, both one made with Apple and one without.

## Phase 6: Store listing and submission

1. **Screenshots:** 3–10 images at 6.9-inch iPhone size (1320×2868). The iPhone 17 Pro Max
   simulator saves exactly that size with Cmd+S.
2. **Text:** subtitle, description, keywords, support URL and privacy policy URL. Put the Terms of
   Use link in the description.
3. **App Privacy questionnaire:** declare email address, name, other user content, user ID and
   purchase history. Mark all of them "linked to the user", "not used for tracking", purpose "App
   functionality". With no tracking, no tracking permission prompt is needed.
4. **Age rating questionnaire:** answer truthfully about users sharing content with each other.
5. **App Review Information:** reviewers can't read your inbox to get the email code.
   - Tell them to use Sign in with Apple.
   - Also give them a demo account whose mailbox they can open (a dedicated address, with its
     webmail login in the notes). Fill it with a few lists, including a shared one.
   - Explain the name screen and where the paywall appears.
6. On the version page, under **In-App Purchases and Subscriptions**, select both products. A first
   subscription is only reviewed together with an app version.
7. Submit and choose **"Manually release"**. Review usually takes 1–2 days, and approval then does
   not make the app live. Nothing before release counts as income: TestFlight and sandbox purchases
   are free test purchases.
8. **Meet the accountant, after approval and before pressing Release.** Questions to bring:
   1. Which treaty article to claim on the W-8BEN, and whether the foreign tax ID is the NIP or the
      PESEL.
   2. Which month App Store income belongs to, for VAT and for income tax, and when to issue the
      invoice to Apple. Apple pays up to 45 days after each month ends and holds amounts below its
      minimum payout, so the first VAT and income-tax deadlines can come before the first payout.
   3. Whether the expected VAT treatment holds: a service to Apple Distribution International
      (Ireland), "np" / reverse charge, reported in JPK_V7 and VAT-UE.
   4. Whether IP Box (5% income tax on income from software you wrote) makes sense with the current
      tax form. It is claimed in the annual return, so it can be decided later, even for past years
      through a corrected return. The evidence is this repo's git history and `ai/tasks/*` logs,
      plus the cost invoices and Apple's reports, so don't rewrite or squash the history.
   5. How to credit US tax withheld by Apple against Polish tax.
   6. What the accountant needs each month (Apple's reports from Payments and Financial Reports, the
      service invoices).

   **Exception:** if the JDG is on ryczałt, IP Box needs a switch to liniowy or skala. That can only
   start with a new year and must be declared by 20 February. If the release lands in early 2027 and
   the meeting could fall after 20 February 2027, send that one question earlier; an email is enough.
9. **Press Release.** Within 7 days, add PKD **58.29.Z** (software publishing) to the CEIDG entry.
   It's free and done online. The current only code, 62.10.B, covers programming for clients, not
   selling your own app.

## Costs

| | Cost |
|---|---|
| Apple Developer Program | $99/year |
| Apple's commission | 15% with the Small Business Program |
| Supabase Pro | $25/month |
| RevenueCat | free under $2.5k/month revenue, then 1% |
| EAS Build | the free plan's monthly build quota is enough |
| Resend | free up to 100 emails a day |

All of these are invoiced to the JDG (Phase 1, step 10).

## How this fits the repo's workflow

Phase 2.1, 2.2 and Phase 3 are new scope. Following [CLAUDE.md](../../CLAUDE.md), each should start
as an `ai/tasks/<n>/description-step-<n>.md`, for example 20 Sign in with Apple, 21 account
deletion, 22 subscriptions and 23 release build. Each should end with an implementation log and
`/librarian deposit`. Phase 1 can start right away, since Apple enrollment and the Paid Apps
Agreement take the longest.
