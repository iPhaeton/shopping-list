# Step 2 — implementation log: Sign in with Apple

2026-10-06. Scope: `description-step-2.md`, built to step 1's log (which wins where they differ). Local stack only;
no `config push`, no `db reset`, no cloud. iPhone only. No `/librarian deposit` (request 5). Nothing committed.

## Done by the user (manual)

- Enabled Sign in with Apple on App ID `com.shoppingloop.app` at developer.apple.com (primary App ID) before the build.
  The pre-step provisioning profile ("iOS Team Provisioning Profile: com.shoppingloop.app", expires 2027-10-05) had
  no `com.apple.developer.applesignin`.
- Signed the iPhone 18 Pro simulator in to their Apple Account (2FA).
- Typed the Apple Account password into Apple's sheet three times (first sign-in, returning user, the attempt after
  Stop Using), and a 2FA code in Settings → Sign in with Apple.
- Approved deleting `~/.gradle/caches` (4.2 GB) and `DerivedData/ShoppingLoop-*` (3.8 GB): the disk had 1.8 GB free,
  11 GB after.

## Supabase (`supabase/config.toml`)

`[auth.external.apple]`: `enabled = true`, `client_id = "com.shoppingloop.app"`, `skip_nonce_check = false`,
`email_optional = false`, **`secret` line removed**, each commented (native-only so no secret; nonce pair; relay email
and `users.email not null`). `npx supabase stop && npx supabase start` (no reset; rows kept).

- **CLI 2.116.0 starts with an Apple block that has no `secret`.** No validation error, and none needed blanking.
- `curl -s http://127.0.0.1:54321/auth/v1/settings | jq .external.apple` → `true`.
- `POST /auth/v1/token?grant_type=id_token` `{"provider":"apple","id_token":"not-a-real-token"}` →
  `{"code":400,"error_code":"validation_failed","msg":"Unable to detect issuer in ID token for Apple provider"}`
  (token validation, not "provider disabled").

## Native

- `npx expo install expo-apple-authentication` → `~57.0.2`. `app.json`: `ios.usesAppleSignIn: true`,
  `"expo-apple-authentication"` in `plugins`.
- `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx expo prebuild --platform ios` (clean, iOS only). Results:
  - `ios/ShoppingLoop/ShoppingLoop.entitlements` has `com.apple.developer.applesignin: [Default]`;
  - `Info.plist` has **`CFBundleAllowMixedLocalizations = true`**, added by the package's config plugin
    (`withIOSMixedLocales`);
  - `android/app/debug.keystore` MD5 `4d3dbe5438b4d52b2707d5c039d09afb` before and after (untouched).
- `npm run ios -- --device "iPhone 18 Pro" --no-bundler` (Metro started separately, no `CI`): built and installed.
  **The simulator build needed no profile and no hand-run `xcodebuild -allowProvisioningUpdates`.** The App ID
  capability was already on (user, above). The iPhone 13's profile still lacks the entitlement: a device build needs the
  hand-run first.
- **The regenerated `project.pbxproj` writes the team quoted:** `DEVELOPMENT_TEAM = "YZ75T58P4Z";`. That fails
  `ios-device-build-skips-provisioning-flags`' `verify:`, which greps the unquoted form (below).

**Settled by reading the package** (57.0.2, `src/`):

- Importing it is safe on every platform. The module loads with `requireOptionalNativeModule`, and the view only
  `if (Platform.OS === 'ios')`; elsewhere `AppleAuthenticationButton` renders `null`.
- `signInAsync` rejects with `code === 'ERR_REQUEST_CANCELED'` on a cancel.
- `formatFullName` exists, and throws off iOS.
- The view receives `onButtonPress` (`onPress` is renamed), and the other props spread onto it.

## Code

| file | what |
|---|---|
| `src/lib/appleSignIn.ts` (new) | `signInWithApple(): Promise<{ error }>`. Raw nonce `randomUUID()`, Apple gets `digestStringAsync(SHA256, raw)` (hex), Supabase gets raw. `ERR_REQUEST_CANCELED` → `{ error: null }`; any other throw → its message; no `identityToken` → `'Sign-in did not return an identity token'`. After success, `formatFullName(fullName).trim()` → `updateUser({ data: { full_name } })`, failure ignored. **Also re-exports `AppleAuthenticationButton`, `…ButtonType`, `…ButtonStyle`**, so it stays the one importer of the package |
| `src/state/SessionContext.tsx` | `signInWithApple` delegate (type, callback, value). **`withSameUser` keeps `prev.session` for the same user** (below) |
| `src/screens/SignInScreen.tsx` | `AppleAuthenticationButton` between `Send code` and Google, `Platform.OS === 'ios'` only: `CONTINUE`, `WHITE` when `useTheme().name === 'night'` else `BLACK`, `cornerRadius={26}`, `style={[action (marginTop 14), apple (height 52)]}`, `accessibilityLabel="Continue with Apple"`. Google's and Apple's handlers folded into `continueWith(signIn)`, guarded by `pending` (the native button has no `disabled`) |
| `src/screens/SetNameScreen.tsx` | `touched` ref set in `onChangeText`. An effect on `prefillFrom(session)` fills the draft only while it is empty and untouched (`draft \|\| suggested`). It never refills a field that was typed in and then cleared. `prefillFrom`'s comment names Apple |
| `src/screens/AccountScreen.tsx` | `RELAY_DOMAIN = '@privaterelay.appleid.com'`, and `isRelayAddress` (a type guard) is case-insensitive `endsWith`. For a relay address the email row takes the name row's layout (`nameRow`/`nameText`) with `PillButton label="Share email address" visibleLabel="Share"` → `Share.share({ message: email }).catch(() => {})`. The sentence is under it in `confirmText` + `relayNote` (`marginTop: 8`), before the divider. The address has no `numberOfLines`. Any other address is unchanged |
| `jest.setup.ts` | the `expo-crypto` mock gains `CryptoDigestAlgorithm.SHA256` and `digestStringAsync` (Node sha256 hex; throws for any other algorithm) |

**The `withSameUser` fix (a race found while planning, not in the description).**

- The race:
  - A live `SIGNED_IN` sets `nameRequired` with session S0 and starts `resolveName(S0)`.
  - `appleSignIn`'s `updateUser` then fires `USER_UPDATED`, and the listener sets `{ ...prev, session: S1 }` (S1
    carries `full_name`).
  - When the profile fetch resolves, `applyFetchedName(S0, …)` put S0 back.
- The fix: for the same user, the state's session is never older than the one a read captured, so `withSameUser` now
  keeps `prev.session`. That also stops a `TOKEN_REFRESHED` arriving mid-fetch from being reverted.
- `withSameUserOrLoading` still takes `next` from `loading`.
- Regression test: "keeps a session updated while the live sign-in was still confirming its name". **It fails with the
  old `withSameUser`** (checked by reverting the function), and passes with the fix.

**Confirmed: `USER_UPDATED` reaches the state.** It is not `SIGNED_IN`, so it takes the listener's
`{ ...prev, session }` branch.

## Tests (RNTL 14, awaited)

- **The five `SessionProvider` suites mock `../lib/appleSignIn`.** `SignInScreen.test` mocks it as
  `{ ...jest.requireActual(...), signInWithApple: jest.fn() }`, keeping the real button re-exports.
- **What RNTL sees.** jest-expo renders the native view as a host element carrying the screen's props (`buttonStyle`,
  `buttonType`, `cornerRadius`, `style`, `accessibilityLabel`).
  - `getByLabelText('Continue with Apple')` finds it.
  - **Plain `fireEvent.press` works.** It walks up from the host (which has `onButtonPress`) to
    `AppleAuthenticationButton`'s own `onPress`. `fireEvent(el, 'buttonPress')` is not needed.
- **New tests:**
  - `appleSignIn.test.ts`, 10: the nonce pair is the real sha256; the scopes; a cancel; another rejection; no token;
    Supabase's error; the name saved; no name; empty name parts; `updateUser` failing.
  - `SignInScreen`, 9: iOS order; not on Android or web; BLACK, 26 and 52 by day; WHITE by night; the press; the
    failure banner; a cancel shows no banner; a press while Google is pending does nothing.
    - The night case renders `ThemeProvider`. It follows `theme-provider-suites-fake-the-clock`: `deviceTimeZone`
      mocked, fake clock at noon in Warsaw. The audit flagged the first version, which skipped both.
    - Its pass under `TZ=Pacific/Auckland` and `America/Los_Angeles` is confirmed.
  - `SetNameScreen`, 3: a late name fills an untouched field; never over typed text; never into a field typed in and
    cleared again.
  - `SessionContext`, 2: the Apple delegate; the `USER_UPDATED` race.
  - `AccountScreen`, 5: the relay sentence verbatim; in capitals; none for another address; none for
    `privaterelay.appleid.com@example.com`; `Share` sends the address alone.
- **Commands:**
  - `npm test`: 32 suites, **836 passed**.
  - `npm run typecheck`: clean.
  - `npm run kb:audit`: 1 error, 15 warnings (below).

## Simulator verification (iPhone 18 Pro, iOS 27, local stack, `.env` target commented out → local)

**Sign in with Apple works on the simulator.** Apple's sheet takes about 20 s to appear under load, and asks for the
Apple Account password (no Face ID); Maestro can choose Share/Hide and tap `close`.

| check | result |
|---|---|
| Share My Email | New account. `auth.identities` row `provider = apple`, `provider_id = identity_data->>'sub'`; `raw_user_meta_data.full_name` = the Apple name, saved ~5 s after the user row (so the gate was already up). The user reports the gate showed it prefilled, and they only tapped Continue. No migration copies `full_name` (grep), so `public.users.name` came from the gate |
| the automatic link | List `Apple share test` created; signed out; email-code sign-in (Mailpit) to the same address opened the same account (one `auth.users` row) with the list. `app_metadata.providers` stays `["apple"]` after the code sign-in |
| a returning user | Sheet shows "Sign in to ShoppingLoop" + `Sign In` (password). Opened Lists, no gate; `updated_at` moved only with the sign-in, so no name was sent |
| a cancelled sheet | `close` → still on Sign in, no banner, Google re-enabled |
| Google after the prebuild | Consent alert "“ShoppingLoop” Wants to Use “accounts.google.com” to Sign In" reached; cancelled |
| a11y | Maestro sees **two** elements labelled `Continue with Apple`, both at 654–706: the RN wrapper (the label set) and the native button. In German the native one reads `Mit Apple fortfahren` and the wrapper stays `Continue with Apple`, so the app's label keeps queries stable |
| Hide My Email via Apple | **Not reached** (below) |
| a relay address, end to end | Verified by email code with the mockup's `k2x9dqvmp7@privaterelay.appleid.com` (Mailpit catches it locally): the name gate, list `Relay test`, the sentence and `Share` on Account; then on the web (Playwright, `localhost:8081`), the same address and Mailpit code opened the same list, and web Account shows the sentence and `Share` |
| `Share` on the device | iOS share sheet with the address alone. `Copy` → `simctl pbpaste` = `k2x9dqvmp7@privaterelay.appleid.com`, nothing else |
| web with the package | loads with no errors and no new warnings (the RNGoogleSignIn and `pointerEvents` warnings predate this step) |

**Hide My Email was not reached on this Apple Account.**

- What happened:
  - Settings → Apple Account → Sign in with Apple lists the app as **"XC com shoppingloop app"**: the App ID's
    developer-portal name, which Xcode created. It is not `ShoppingLoop`.
  - iOS 27 labels the action `Delete`, then confirms "Stop Using Sign in with Apple for XC com shoppingloop app?" →
    `Stop Using`.
  - After that the entry left the list, but Apple's sheet still offered the returning-user `Sign In`, even after a
    simulator reboot.
  - Signing in went straight through, with no email choice, to the same account.
- **Even when Apple does ask again, the same Apple Account returns to the same local account.**
  - Apple's `sub` is stable per Apple Account and team, and GoTrue matches the identity by `provider_id`.
  - So Hide My Email after Share My Email cannot make a separate account.
  - Only an Apple Account with no local identity gets a new account with a relay address.
- What is still open:
  - Apple issuing a relay address, and GoTrue storing it as `users.email`, stay unverified on the device.
  - Everything after the address was verified by email code (table).
- **GoTrue keeps neither `email` nor `is_private_email` in the Apple identity.** `identity_data` keys after the last
  sign-in: `iss, sub, provider_id, custom_claims, email_verified, phone_verified`. The domain test is the right one.

## Screenshots and compare-by-measure (`screenshots/step-2/`)

Files:

- `sign-in-apple-{day,night}-ios.png`;
- `account-hidden-email-{day,night}-ios.png` (Auto by day; Night);
- `sign-in-apple-german-day-ios.png` (the app's language set to `de`);
- `account-hidden-email-web.png`.

The status bar was overridden to 09:41. No shot shows the user's Apple Account.

| (pt, 402×874) | simulator (Maestro bounds, ±1 rounding) | mockup (`measure=1` at 402/874/62/34) |
|---|---|---|
| `Send code` / Apple / Google | 588–640 / 654–706 / 720–772 | 588–640 / 654–706 / 720–772 |
| relay address | 223–269, 2 lines, column 41–270 | 223–269, 2 lines, room 230 |
| sentence | 277–361, 4 lines | 277–361, 4 lines |
| `Share` pill | 282–361 | text 44 of 44 (the `Edit` pill reads ~2 pt wider than drawn too, a pre-existing harness-vs-device gap) |

**iOS breaks the address at `k2x9dqvmp7@privaterelay.ap` | `pleid.com`**, the same place the harness breaks it at 402.

**`AppleButton` recalibrated** (step 1 asked for it):

| inside, at 52 pt | simulator | old harness (43%, one size, gap 4) | new harness |
|---|---|---|---|
| logo ink | 12.0 × 14.7 at x 100.7 | 14.0 × 17.3 | 12.0 × 14.7 |
| logo → title gap (ink) | 7.7 | 5.3 | 7.7 |
| title ink width | 180.7 | 199.0 | 180.7 |
| "C" height | 15.0 | 16.7 | 15.0 |

- **The new harness values.** `APPLE_INSIDE = { title: 0.387, logo: 0.365, gap: 6.7 }`: the title at about 20.1 pt and
  the logo at about 19 pt, each its own size. The harness's text sits about 0.5 pt lower (web vs iOS baseline).
- **Files.** Only `sign-in-screen-apple-quiet-horizon{,-moonlit}.png` were re-rendered and replaced. All 28 other
  committed PNGs re-render byte-identical. `AppleButton` is reached only through `s.apple`, which only that scene
  sets. `clipped` is empty for every scene. `ai/ux/source/README.md`'s "not calibrated" note was replaced.

## Answers corrected from step 1

- **Answer 10 (the button's language).** Step 1 read that the in-process button would stay English. **It follows the
  device's language.** The config plugin sets `CFBundleAllowMixedLocalizations`; with the app's language `de`, the
  button reads `Mit Apple fortfahren` while the rest of the app stays English. The user had accepted the device's
  language either way.

## Problems

- **Maestro's taps on a button above the risen keyboard typed a key** (`Send code` → "t", `Continue` → "y"), a known
  trap. This happened after a simulator reboot brought the software keyboard back. Flows submitted with
  `pressKey: Enter` instead (scratchpad `sign-in-enter.yaml`; `eraseText: 60` did not clear a long field).
  - One junk local account (`…appleid.com.appleid.comt`) came of it. It was deleted through the app's own Account →
    Delete account.
- **After the reboot, iOS asked "Russian (Russia) Keyboard Detected".** Answered `Not Now`, so the KB's reset
  keyboards stay.
- **The share sheet ignores swipes and outside taps from Maestro**, and its elements vanish from the hierarchy after a
  moment. `Copy` was tapped by point (17%, 89%).
- **A crash, once, in `ExpoFabricView.injectInitializer`** (Expo `fatalError`, either AppContext lost or "cannot
  create view") at 15:20.
  - When: on `simctl launch … -AppleLanguages (de)` followed by `simctl openurl` (which timed out), i.e. a second
    bundle load during mount.
  - Not reproduced: every normal launch, before and after (about ten, including in `de` set through
    `defaults write com.shoppingloop.app AppleLanguages`), mounted the button fine.
  - Treated as a dev-client launch race. Unverified.
- **The audit (`npm run kb:audit`): 1 error, expected until step 4.**
  - `ios-device-build-skips-provisioning-flags`: its `verify:` greps `DEVELOPMENT_TEAM = YZ75T58P4Z;`, and the
    regenerated project has `"YZ75T58P4Z"`.
  - The 15 warnings are ground-moved by this step's edits.
- Machine load reached 30–40 during the Xcode build. One SetName test timed out cold (5.9 s) and passed on rerun.

## The iPhone 13 (after the simulator checks)

- `npm run ios -- --device` failed with exit 65: the profile "does not support the Sign In with Apple capability" /
  "`com.apple.developer.applesignin` … not registered". This is the KB's predicted case: a new entitlement needs the
  hand-run `xcodebuild … -allowProvisioningUpdates -allowProvisioningDeviceRegistration` once.
- **Run by the agent, the hand-run failed:** `Unable to log in with account … (Underlying error code -1001)`, a
  timeout. The agent's command sandbox blocks apple.com: `registry.npmjs.org` and google.com answer, while
  `www.apple.com`, `developerservices2.apple.com`, `idmsa.apple.com` and `gsa.apple.com` time out. Xcode could not
  reach Apple to make a profile, and fell back to the old one.
- **Run by the user in their own terminal, it worked.** A second profile, "iOS Team Provisioning Profile:
  com.shoppingloop.app", was created 2026-10-06 16:39 UTC (expires 2027-10-06) with `com.apple.developer.applesignin`.
  The old one, without it, is still in `~/Library/Developer/Xcode/UserData/Provisioning Profiles/`. The app was then
  installed with `npm run ios -- --device`.
- **Metro for the phone.** It was restarted with `EXPO_PUBLIC_SUPABASE_TARGET=local
  EXPO_PUBLIC_SUPABASE_URL_LOCAL=http://192.168.99.195:54321` (shell variables; `.env` untouched), so the phone uses the
  local stack.
  - The stack answers on the LAN address (HTTP 200).
  - The dev build's ATS is `NSAllowsLocalNetworking: true`, `NSAllowsArbitraryLoads: false`.

## The iPhone 13 sign-ins (by the user, 2026-10-06 16:49–16:55 UTC, local stack)

The user believed the phone was on cloud. Every request below is in the local `supabase_auth` log, with user agent
`ShoppingLoop/1 CFNetwork/… Darwin/27.0.0`: the dev build takes its target from the Metro above.

| UTC | what | result |
|---|---|---|
| 16:49:42 | Apple | 200, the account the simulator's Share My Email made (same Apple Account, same `sub`) |
| 16:50:22 | Google | 200, `identity_linked` google to that account (same verified address) |
| 16:50:54 | Apple | 200, same account |
| ~16:51 | Delete account | the account and its identities gone; `/logout` 403 `user_not_found` at 16:51:10 |
| 16:51:47, 16:53:52, 16:54:55 | Apple | **500**: `null value in column "email" of relation "users" violates not-null constraint` |
| 16:52:10 | Google | 200, `user_signedup`: a new account with the same address |

- **Why the 500.** Deleting the account removed the Apple identity, but Apple's authorization was not revoked
  (step 3), so Apple still treats the app as authorized. A later authorization's token carries no `email`. With no
  identity for the `sub` to match, GoTrue 2.196 creates a new `auth.users` row with no email, and
  `on_auth_user_created` → `handle_new_user()` fails on `public.users.email not null`.
  - No email means no automatic link either: the Google account with the same address was not found.
  - `email_optional = false` did not stop it: the id-token path returned a 500, not a clean 4xx. The comment in
    `supabase/config.toml` that said Apple's token "always carries `email`" was wrong and is corrected.
- **What the user saw:** a database error on Apple, and sometimes a "connection error". The connection errors are not
  in the auth log, so those attempts never reached the stack. The cause is unknown: the phone not reaching
  `192.168.99.195`, or Apple's sheet failing before it returned a token.
- **The lock-out lasts** until Apple's authorization is removed: Settings → Sign in with Apple → "XC com shoppingloop
  app" → `Delete` → `Stop Using`, or a revoke.
  - On the simulator, Stop Using did not reset the sheet.
  - On the iPhone 13 it did. Later the same day, on cloud with the phone, the user removed the app in Settings, then
    signed in with Apple.
  - Apple asked Share/Hide, and the user chose Hide.
  - Cloud got a new user and an `apple` identity at 17:19:02 UTC, with a `privaterelay.appleid.com` email,
    `full_name` set, and `providers` `["apple"]` (read-only `db query --linked`).
- **The relay delivers on cloud.**
  - The user signed in with the email code to that relay address.
  - The code reached their real Gmail through Apple's Private Email Relay, but **in spam**.
  - Gmail's reason: "This message is similar to messages that were identified as spam in the past".
  - Gmail's "Show original" gives SPF, DKIM and DMARC all `PASS`, so the relay kept the authentication. It is the
    content and the domain's reputation, not the setup.
  - The sending domain's DNS, by `dig` at 1.1.1.1:
    - DKIM: `resend._domainkey.mail.shopping-loop.com`.
    - SPF: on `send.mail.shopping-loop.com`, the return path, a CNAME to `send.forge.rmta.net`.
    - DMARC: `_dmarc.shopping-loop.com`, `p=none`.
  - Whether the domain is registered with Apple's relay is unknown to the agent.
- Cloud's `/auth/v1/settings` reports `external.apple: true`. The agent did not enable it, and nothing on cloud was
  touched. The same trigger is there, so the same lock-out applies on cloud.

## Left for step 3

- `app_metadata.providers` includes `'apple'` on a real session, and still does after an email-code sign-in to the
  same account.
- The app is listed under Settings → Sign in with Apple as **"XC com shoppingloop app"**: step 3's "no longer listed"
  check looks for that name. Renaming the App ID's description on the portal changes it.
- On iOS 27 the removal is `Delete` → `Stop Using`, behind a 2FA code. After it, the simulator's sheet still behaved
  as for a returning user.
- **Deleting an Apple account without a revoke locks Apple sign-in out with a 500** (the iPhone 13 section above).
  Step 3's revoke needs a second native sheet, so it only covers deletion on iOS. A deletion on web or Android leaves
  the same lock-out for the next Apple sign-in on iOS. The app shows GoTrue's raw database error.

## KB candidates (for step 4's deposit)

| entry | change |
|---|---|
| scope-boundaries | Sign in with Apple is in: native, iOS only (`AppleAuthenticationButton` only when `Platform.OS === 'ios'`). Android keeps the email code and Google; web keeps the email code. Account shows the hidden-email sentence and `Share` for any `@privaterelay.appleid.com` address, on every platform. Hide My Email is a separate account only for an Apple Account with no local identity: the same Apple Account always returns to the account its `sub` is linked to. Nothing on cloud. Registering the sending domain with Apple's Private Email Relay must come before Apple is enabled on cloud, or the sentence is false |
| native-build-toolchain | the `com.apple.developer.applesignin` entitlement (from `ios.usesAppleSignIn` + the plugin); the capability turned on by hand on the portal, after which a simulator build needs no profile, but the iPhone 13 needed the hand-run, which made a second profile with the entitlement (2026-10-06, expires 2027-10-06); **the agent's sandbox blocks apple.com, so an agent-run `-allowProvisioningUpdates` build fails with `-1001`: the user runs it in their own terminal**; a phone reaches the local stack through shell-variable overrides of `EXPO_PUBLIC_SUPABASE_TARGET`/`_URL_LOCAL` to the Mac's LAN address (ATS `NSAllowsLocalNetworking`); `prebuild --platform ios` kept `android/app/debug.keystore` byte-identical; the clean prebuild writes `DEVELOPMENT_TEAM = "YZ75T58P4Z"` quoted (fix `ios-device-build-skips-provisioning-flags`' `verify:` to accept it); Sign in with Apple works on the simulator with an Apple Account signed in (password each time, ~20 s to the sheet under load) |
| google-native-signin-library-gaps, or a new entry | Apple's module takes a nonce: SHA-256 hex to Apple, raw to Supabase, `skip_nonce_check = false`; no client secret for native-only, and CLI 2.116.0 starts without a `secret` line; Apple sends the name on the first authorization only, saved as `full_name`; the app is listed in Settings under the App ID's portal name; Stop Using (iOS 27: `Delete` → `Stop Using`) did not make the simulator's sheet ask again; GoTrue keeps no `email`/`is_private_email` in Apple's `identity_data`. **Extend its `verify:` to require `jest.mock('../lib/appleSignIn'` in every `SessionProvider` suite** |
| a new entry, or restored-session-state-waits-for-evidence | `withSameUser` keeps the state's session for the same user: a fetch that resolves after a `USER_UPDATED`/`TOKEN_REFRESHED` must not put back the session it captured |
| phone-is-the-product | the step-2 shots match step 1's mockups by measure (table); `AppleButton`'s inside is now calibrated (`APPLE_INSIDE`), and the two `sign-in-screen-apple*` PNGs were re-rendered; iOS breaks a relay address where the harness does at 402 |
| a new entry (from step 1's "maybe") | an email address has no line-break opportunity, so iOS breaks it between characters (confirmed: `…privaterelay.ap` / `pleid.com` at 402); a zero-width space is no fix |
| theme-reaches-native-surfaces, or the Apple entry | Apple's button follows the device's language, not the app's single English (the plugin's `CFBundleAllowMixedLocalizations`), and its style follows the app's resolved theme, not the system appearance |
| maestro-drives-the-native-ui | after a simulator reboot the software keyboard is back even with DeviceHub open, and `tapOn` a button above it typed a key: submit with `pressKey: Enter`; the iOS share sheet ignores Maestro's swipe/outside tap, and its elements drop out of the hierarchy (tap by point); Apple's sheet exposes `Share My Email`, `Hide My Email`, `Sign In`, `close`; a reboot can raise "Keyboard Detected" (answer `Not Now`) |
| delete-account-removes-sole-owned-lists | stale: "The migration itself is **not yet pushed to cloud**". `migration list --linked` on 2026-10-06 shows all 16 local migrations applied on cloud, and `public.delete_account` exists there. Step 1's "Cloud lacks task 25's migrations" is stale for the same reason |
| cloud-auth-mail-goes-through-resend | the first spam evidence (2026-10-06): a sign-in code relayed by Apple to Gmail landed in spam, "similar to messages that were identified as spam in the past", with SPF/DKIM/DMARC all `PASS`. The template (`otp-code.html`, subject "Your sign-in code") has no brand in the subject, no footer, no link, and no contact |
| queries-go-through-a11y-labels | the native Apple button is found by the label the app sets; RNTL's `press` reaches it through the composite's `onPress` |
