# Step 2 — Sign in with Apple

The user's requests and the decisions they settled are in
[description-step-1.md](description-step-1.md).

**Step 1 must land first.**

- Build to step 1's mockups.
- Take the visible text, the a11y label and the button's type, style and size from step 1's log.
  Where the log differs from this description, the log wins.

## Apple Developer (human)

- **The App ID `com.shoppingloop.app` needs the Sign in with Apple capability.**
  - Automatic signing adds it when it provisions for the new entitlement. That takes the hand-run
    `xcodebuild -allowProvisioningUpdates` from
    [ios-device-build-skips-provisioning-flags](../../kb/entries/ios-device-build-skips-provisioning-flags.md).
  - If Xcode cannot add it, the user enables it at developer.apple.com → Identifiers →
    `com.shoppingloop.app` → Sign in with Apple, as a primary App ID.
- **The simulator needs an Apple Account** signed in under Settings. The user signs in, because it
  needs two-factor authentication.

## Supabase

[config.toml](../../../supabase/config.toml), the `[auth.external.apple]` block:

```toml
enabled = true
client_id = "com.shoppingloop.app"   # the bundle id: the `aud` of a native identity token
skip_nonce_check = false
email_optional = false
```

- **No secret.** Remove the `secret = "env(SUPABASE_AUTH_EXTERNAL_APPLE_SECRET)"` line, or blank it.
  Confirm that CLI 2.116.0 starts with an Apple block that has no secret. Its validation is believed
  to exempt `apple` and `google`, but check rather than assume.
- **Comment the block** as the Google block is commented:
  - Why there is no secret: native-only sign-in.
  - Why the nonce check stays on: `signInAsync` takes a nonce.
  - Why `email_optional` stays `false`: `public.users.email` is `not null`, and Apple's token carries
    `email`, the relay address when the email is hidden.
- No `[remotes.production.auth]` change and no `config push` (step 1).
- Restart with `npx supabase stop && npx supabase start`, because auth config is read at start.
  Never `db reset` ([supabase-local-stack](../../kb/entries/supabase-local-stack.md)).
- **Check, and record both in the log** (the same checks as task 13 step 1):
  - `curl -s http://127.0.0.1:54321/auth/v1/settings | jq .external.apple` gives `true`.
  - A `POST /auth/v1/token?grant_type=id_token` with
    `{"provider":"apple","id_token":"not-a-real-token"}` answers with a token-validation error, not
    "provider disabled".

## Native

- Run `npx expo install expo-apple-authentication`.
- [app.json](../../../app.json): set `ios.usesAppleSignIn: true` and add `"expo-apple-authentication"`
  to `plugins`. Follow https://docs.expo.dev/versions/v57.0.0/sdk/apple-authentication/. This adds
  the `com.apple.developer.applesignin` entitlement.
- **Regenerate iOS only:** `npx expo prebuild --platform ios`.
  - Prebuild cleans by default ([native-build-toolchain](../../kb/entries/native-build-toolchain.md)).
  - Leaving `android/` alone keeps its `debug.keystore`, whose SHA-1 is registered with Google (task
    13 step 1's risk).
- Run the provisioning hand-run (above), then `npm run ios`.

## appleSignIn.ts

New [src/lib/appleSignIn.ts](../../../src/lib/appleSignIn.ts), built like
[googleSignIn.ts](../../../src/lib/googleSignIn.ts). It is the one importer of
`expo-apple-authentication`, as `googleSignIn.ts` is of its module.

`signInWithApple(): Promise<Result>`, where `Result` is the Google module's `{ error: string | null }`:

1. Make the nonce. The raw nonce is random, from `expo-crypto`. The hashed nonce is
   `digestStringAsync(CryptoDigestAlgorithm.SHA256, raw)`, in hex.
2. Call `signInAsync({ requestedScopes: [FULL_NAME, EMAIL], nonce: hashed })`.
3. **A cancel** throws with `code === 'ERR_REQUEST_CANCELED'`. Return `{ error: null }`. Confirm the
   code against the installed version.
4. **No `identityToken`:** return `{ error: 'Sign-in did not return an identity token' }`.
5. Call `signInWithIdToken({ provider: 'apple', token: identityToken, nonce: raw })`. On an error,
   return its message.
6. **On success, save the name** if `credential.fullName` gives a non-empty one:
   `supabase.auth.updateUser({ data: { full_name } })`.
   - Use the module's `formatFullName` if SDK 57 exports it. Otherwise join the given and family
     names with a space.
   - If `updateUser` fails, the sign-in still succeeds, because the name is only a suggestion.

**Who gets which nonce.** Apple copies the value it is given into the token's `nonce` claim
verbatim. GoTrue hashes the raw nonce and compares the result with that claim. So Apple gets the
hash and Supabase gets the raw value. Swapped, the sign-in fails with a nonce mismatch. Comment this,
and why each step exists, in the file, as `googleSignIn.ts` does.

## SessionContext

- Add `signInWithApple` beside `signInWithGoogle`, delegating outright.
- **Every suite that renders `SessionProvider` mocks `../lib/appleSignIn`**, as it mocks
  `../lib/googleSignIn`. Today there are five: `SessionContext`, `SignInScreen`, `SetNameScreen`,
  `SharingScreen` and `AccountScreen`.

## SignInScreen

- **Show `AppleAuthenticationButton`** in the email phase, only when `Platform.OS === 'ios'`, placed
  as step 1's mockups place it.
  - Set `buttonType`, `buttonStyle` (from the resolved theme), `cornerRadius` and the size as step 1
    settled.
  - Never set `backgroundColor` or `borderRadius` in `style`.
- **`continueWithApple` mirrors `continueWithGoogle`:** guarded by `pending`, and it clears and
  shows `error` the same way. The native button has no `disabled` prop, so the guard in the handler
  is what blocks a second press.
- **a11y.** Find out which label the native button exposes, and what RNTL sees under jest-expo's
  native-view mocking. Queries go through a11y labels
  ([queries-go-through-a11y-labels](../../kb/entries/queries-go-through-a11y-labels.md)). Record
  what worked.

## SetNameScreen

- **The prefill exists already, but can miss Apple's name.**
  - `prefillFrom` reads `user_metadata.full_name`, which GoTrue fills from Google's claim.
  - Apple's name arrives through `updateUser`, after `signInWithIdToken` resolves.
  - By then, `onAuthStateChange`'s `SIGNED_IN` may already have moved the state to `nameRequired`
    and mounted this screen.
  - `useState(() => prefillFrom(session))` reads only once, at mount, so it would miss the name.
- **Required:** while the draft is empty and the user has not typed, a `full_name` that arrives in
  the session later fills the field. It never replaces anything typed.
  - The state's session is believed to update on `USER_UPDATED`: it is the `onAuthStateChange`
    branch that spreads `{ ...prev, session }`. Confirm it.
- Update `prefillFrom`'s comment: the name is Google's claim or the one Apple sent.

## AccountScreen

[AccountScreen.tsx](../../../src/screens/AccountScreen.tsx), built to step 1's
`account-screen-hidden-email` mockups (request 4):

- **When:** the session's email ends in `@privaterelay.appleid.com`, compared case-insensitively.
  Only Apple issues that domain.
  - Do not test for an Apple identity instead. The same account opened on Android after signing in
    with the code must show the sentence too.
  - Apple's token also carries an `is_private_email` claim, but whether GoTrue keeps it in
    `identity_data` is unchecked. The domain is enough.
- **What:** step 1's sentence, under the address in the profile card, before the divider.
- Make the address `selectable`, or add a `Share` pill, whichever step 1 settled.
- Wrap or shrink a long address as step 1 settled. It must never be cut off.
- Put the domain in one named constant, with a comment saying why the domain is the test.

## Tests (jest)

Await `render` and `fireEvent` (RNTL 14).

- **`jest.setup.ts`'s `expo-crypto` mock** has only `randomUUID`
  ([expo-crypto-undefined-under-jest](../../kb/entries/expo-crypto-undefined-under-jest.md)). Add
  `digestStringAsync` and `CryptoDigestAlgorithm`, backed by `node:crypto`, so that tests check the
  real hash.
- **appleSignIn:**
  - Apple gets the SHA-256 hex of the nonce that Supabase gets raw.
  - The requested scopes are full name and email.
  - A cancel returns `{ error: null }` and does not call Supabase.
  - A missing token returns the error and does not call Supabase.
  - Supabase's error is passed on.
  - A full name leads to `updateUser({ data: { full_name } })`, and no name leads to no call.
  - A failing `updateUser` still returns `{ error: null }`.
- **SignInScreen:**
  - The Apple button shows on iOS only, not on Android or web.
  - Pressing it calls `signInWithApple`.
  - A failure shows in the banner.
  - A press while `pending` does nothing.
- **SetNameScreen:** a `full_name` arriving after mount fills an untouched empty field, and never
  overwrites typed text.
- **AccountScreen:**
  - A relay address shows step 1's sentence verbatim, including one written in capitals.
  - Any other address shows no sentence, including one that merely contains
    `privaterelay.appleid.com` before the `@`.
  - If step 1 chose `Share`, pressing it shares the address.

## Verification

1. **Local stack only.** First read `.env`'s `EXPO_PUBLIC_SUPABASE_TARGET`, and check for any Metro
   already on 8081 ([supabase-target-picked-at-runtime](../../kb/entries/supabase-target-picked-at-runtime.md)).
2. **iPhone 18 Pro simulator, local target.** Expo's docs call Sign in with Apple on the simulator
   "limited", so first find out whether it works there. If it does:
   - **Share My Email** (this is the check that matters most):
     1. Sign in with Apple. The name gate opens, prefilled with the Apple name.
     2. Set a name and create a list.
     3. Sign out, and sign in with the email code to the same address, read from Mailpit.
     4. The same list is there. That proves the automatic link.
   - **A returning user:** sign out, then sign in with Apple again. Lists opens with no name gate,
     and Apple sends no name this time.
   - **Hide My Email:**
     1. Remove ShoppingLoop under the simulator's Settings → Apple Account → Sign in with Apple
        ("Stop Using"), so that Apple asks again.
     2. Sign in with Apple and hide the email. A new account opens, with a
        `privaterelay.appleid.com` email and an empty Lists.
     3. Account shows the relay address with step 1's sentence under it. A Share My Email account's
        Account shows no sentence.
     4. **Follow the sentence on the web.** Create a list on the simulator. Then, in the browser
        (Playwright), sign in with the relay address and the code from Mailpit. The same list is
        there.
        - That proves everything up to Apple's relay. Apple forwarding the code exists only on
          cloud, and stays unverified until the domain is registered (step 1, "Out of this task").
   - **A cancelled sheet:** no banner, still on Sign in.
   - **Google** still signs in after the prebuild.
3. **If the simulator cannot do it** (no token, or an error from AuthenticationServices):
   - Use the registered iPhone 13 against the local stack over the LAN. Override by shell variable,
     never by editing `.env`:
     `EXPO_PUBLIC_SUPABASE_TARGET=local EXPO_PUBLIC_SUPABASE_URL_LOCAL=http://<the Mac's LAN IP>:54321`.
   - Check that the Supabase port answers on the LAN address, and that ATS lets the dev build load
     plain `http` from it.
   - If neither the simulator nor the iPhone works, record the round trip as unverified. **Never
     point the app at cloud**, where Apple is not enabled.
4. **Phone screenshots.** Shoot only the changed screens, day and night, on the simulator: Sign in,
   and Account for a relay address. Compare them by measure against step 1's mockups
   ([phone-is-the-product](../../kb/entries/phone-is-the-product.md)). **iPhone only.**
5. **Commands:** `npm test`, `npm run typecheck`, `npm run kb:audit`.

## KB impact (for the librarian)

| entry | change |
|---|---|
| scope-boundaries | Sign in with Apple is in: native, iOS only. Android keeps the email code and Google, and web keeps the email code. Hide My Email gives a separate account, which is accepted, and Account tells such a user how to sign in elsewhere. Nothing on cloud yet. Registering the sending domain with Apple's Private Email Relay must come before Apple is enabled on cloud, or that sentence is false |
| native-build-toolchain | the Sign in with Apple entitlement and how it was provisioned; prebuild with `--platform ios` keeps Android's debug keystore; what the simulator needed and whether Sign in with Apple worked there |
| google-native-signin-library-gaps, or a new entry | Apple's module does take a nonce: the hash goes to Apple and the raw value to Supabase. Apple sends the name on the first authorization only, saved as `full_name`, and "Stop Using" resets that. `appleSignIn` is mocked in every `SessionProvider` suite (extend the `verify`) |
| phone-is-the-product | the screenshots of Sign in and of Account for a hidden email match step 1's mockups |
