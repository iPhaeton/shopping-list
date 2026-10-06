# Step 1 — Mockups for Sign in with Apple

User requests (2026-10-06), verbatim, in order. This whole task comes from them:

1. "I want to add Apple login to the app. Suggest a way to do that"
2. "Write the task"
3. "Will it be possible to sing in on android to an account created with Apple Login?" The answer
   given: yes, with the email code, if the email was shared. With Hide My Email, the account's email
   is a relay address the user rarely knows. A code sent to it arrives only once the sending domain
   is registered with Apple's Private Email Relay.
4. "In the Account Screen, show the message for how to login on other devices for the users who hid
   their email."

Request 2 answered a suggestion made in chat. That suggestion is the design below. Points marked
*(decided in writing)* were picked when this task was written and reported to the user, who may
overturn them. The rest the suggestion proposed and request 2 accepted.

- **Native only, iOS only.** `expo-apple-authentication` shows Apple's sheet. Its `identityToken`
  goes to `supabase.auth.signInWithIdToken({ provider: 'apple' })`, the shape of
  [googleSignIn.ts](../../../src/lib/googleSignIn.ts). There is no `signInWithOAuth`, no Services
  ID and no web flow. The module has no Android or web implementation. Android keeps the email code
  and Google, and web keeps the email code. Social sign-in is native-only already
  ([social-sign-in.md](../../suggestions/social-sign-in.md), "Deliberately out").
- **No Apple client secret.** Native-only sign-in does not need one, so there is no six-month JWT to
  rotate.
- **The nonce is checked.** Unlike Google's free module, `signInAsync` takes a `nonce`, so
  `[auth.external.apple] skip_nonce_check` stays `false`.
- **Apple's name is a suggestion.** Apple sends it on the first authorization only. It is saved to
  `user_metadata.full_name`, which `SetNameScreen` already prefills from. It is never written to
  `public.users.name`.
- **Hide My Email makes a separate account.** A relay address matches no existing account, so the
  automatic link by email does not happen. This is accepted. There is no linking UI, and
  `enable_manual_linking` stays `false`.
- **Account tells a hidden-email user how to sign in elsewhere** (request 4).
  - A relay address ends in `@privaterelay.appleid.com`, which only Apple issues. For such an email,
    Account shows a sentence under the address: on an iPhone, use Sign in with Apple; on Android or
    the web, sign in with this address.
  - It shows on every platform. The same account can be open on Android after signing in with the
    code.
- **Deleting an Apple-linked account revokes Apple's token** (step 3). An Edge Function revokes it,
  then calls the same `delete_account()` with the caller's token, the shape task 25 step 1 settled.
  The phone gets a fresh `authorizationCode` by showing Apple's sheet again.
- **Local stack only. No `config push`, no function deploy.** *(decided in writing)* Cloud lacks
  task 25's migrations, so `delete_account()` is not there
  ([delete-account-removes-sole-owned-lists](../../kb/entries/delete-account-removes-sole-owned-lists.md)).
  Enabling Apple on cloud goes with the release
  ([app-store-release.md](../../suggestions/app-store-release.md)).
- **Device checks run on the iPhone only**, never the Android emulator. This is the user's standing
  instruction, first given as task 25's request 5.

| step | delivers |
|---|---|
| 1 (this) | mockups of Sign in with the Apple button, and of Account for a hidden email, signed off by the user. No code |
| 2 | Sign in with Apple: the provider config, `appleSignIn.ts`, the button, the name prefill, Account's hidden-email sentence |
| 3 | revoking Apple's token when an Apple-linked account is deleted: the project's first Edge Function |

Step 2 needs step 1. Step 3 needs step 2.

**Scope change:** [scope-boundaries](../../kb/entries/scope-boundaries.md) has email-code and Google
sign-in, not Apple. Steps 2 and 3 bring Apple in, on iOS only.

**Out of this task:**

- Anything on cloud (see above).
- Registering the sending domain with Apple's Private Email Relay, so that an email code reaches a
  relay address. Only cloud mail goes through Resend, and locally Mailpit catches every address.
  **It must be done before Apple is enabled on cloud:** Account's hidden-email sentence promises that
  the code arrives, and on cloud that is only true once the domain is registered.
- Apple's server-to-server notifications (consent revoked or account deleted at Apple).
- Storing Apple refresh tokens so that any device can revoke.

## Why first

[phone-is-the-product](../../kb/entries/phone-is-the-product.md): the mockups in `ai/ux/primary/` are
the design. Sign in gains a control, and Account gains a sentence.

## How to draw them

- **The harness draws Sign in already.** Since task 25 step 1, `SignInScreen` in
  [mock.js](../../ux/source/mock.js) draws the email phase, calibrated by `calib-sign-in`. Add the
  Apple button there.
- **Apple draws the inside of the button, not the app.** `AppleAuthenticationButton` is the native
  `ASAuthorizationAppleIDButton`. Its logo, words, font and colours are Apple's, and `style` may not
  set `backgroundColor` or `borderRadius` (the module's SDK 57 docs, after Apple's guidelines).
  - What the app sets: `buttonType` (`SIGN_IN`, `CONTINUE`, `SIGN_UP`), `buttonStyle` (`WHITE`,
    `WHITE_OUTLINE`, `BLACK`), `cornerRadius`, and the size, through `style`.
  - Draw the inside as close to Apple's as the harness allows. Only the frame is design. Step 2's
    simulator shot is the truth for the inside: if it differs, step 2 recalibrates the mockup.
- Geometry is in [SignInScreen.tsx](../../../src/screens/SignInScreen.tsx)'s `useStyles`: each
  52 pt `lg` pill sits 14 pt below the one above (`action`).
- **Account:** `AccountScreen` in `mock.js` draws it, calibrated by `calib-account`, since task 25
  step 1. The profile card is `label('Email') + value(s.email)`, then the divider, then the name. The
  sentence goes under the address, before the divider.
  - Use a realistic relay address: about ten random characters before `@privaterelay.appleid.com`.
    It is longer than any address drawn so far.
  - For the sentence, start from the confirm sentence's type: 15/21, `textSecondary`.
- **Do not redraw or overwrite** `sign-in-screen-*`, `sign-in-code-screen-*` or `account-screen-*`.

## The images

Each in day (`-quiet-horizon.png`) and night (`-quiet-horizon-moonlit.png`), so four files:

| file stem | state |
|---|---|
| `sign-in-screen-apple` | the email phase with the Apple button |
| `account-screen-hidden-email` | resting Account for a relay address, with the sentence under it |

The code phase does not change: the button appears in the email phase only, as Google's does.

## What the images must settle

Record each answer in the log, with the user's sign-off.

- **Order.** Recommended: Apple, then Google, both below `Send code`. Apple's guidelines ask that its
  button be no less prominent than other providers' buttons, and same size placed first meets that.
  The alternative is Apple below Google.
- **Type.** Recommended: `CONTINUE`, which matches `Continue with Google`.
- **Style per theme.** Recommended: `BLACK` in Day and `WHITE` in Night. It follows the app's
  resolved theme (Day, Night or Auto), not the system appearance. Check that the button reads against
  the card fill in both palettes. `WHITE_OUTLINE` is the fallback.
- **Size and corners.** Recommended: the `lg` pill's 52 pt height, and its corner radius through
  `cornerRadius`, so that the button lines up with the Google pill.
- **The fold.** Does the email phase still fit at 390×844, and at the iPhone 18 Pro's 402×874, with
  one more 52 + 14 pt row? If not, say what moves.
- **The resting design.** Does `sign-in-screen-apple*` replace `sign-in-screen-quiet-horizon*` as
  the current Sign in, or sit beside it? Ask the user, and never overwrite a mockup without being
  asked. Recommended: `sign-in-screen-deleted*` gets no new image, because it differs only by the
  notice.
- **The relay address on Account.**
  - Does it fit on one line at 17 pt in the card, at 390 and at 402 pt wide? If not, choose between
    wrapping and shrinking. Recommended: wrap, so the address is never cut off.
  - Recommended: the address is `selectable`, so it can be long-pressed and copied. The alternative
    is a `Share` pill (React Native's own `Share`, no new dependency), so the user can send the
    address to themselves. That costs a control and its own label.
- **Copy and a11y labels.** The starting table. The final one goes in the log, and step 2 asserts it
  verbatim:

  | element | a11y label | visible text |
  |---|---|---|
  | Apple button | `Continue with Apple` | Apple's own: `Continue with Apple` on an English device |
  | Account's hidden-email sentence | — | `This address hides your real email. On another iPhone, use Sign in with Apple. On Android or the web, sign in with this address, and Apple forwards the code to your inbox.` |

  - iOS draws the Apple button's words in the device's language, while the rest of the app is
    English. Say whether that is acceptable. It is Apple's text, so the app cannot change it.
  - The sentence must say both ways in: Apple on an iPhone, and the email code with this address
    everywhere else. It must not promise that Google works: a Google email never matches a relay
    address.
- **AA contrast** for the sentence on the card fill, in both palettes.

## Done when

- The four PNGs are in `ai/ux/primary/`, rendered by the harness, and the new scenes are committed in
  `mock.js`.
- The log records each answer above, the user's acceptance and the final copy table.
- The user has signed off. Step 2 does not start before that.

## KB impact (for the librarian)

| entry | change |
|---|---|
| phone-is-the-product | the new Sign in and Account mockups, what each shows, and which Sign in image is now current |
| scope-boundaries | nothing yet. Steps 2 and 3 bring the scope change |
