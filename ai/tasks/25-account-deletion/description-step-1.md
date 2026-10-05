# Step 1 — Mockups for deleting an account

User requests (2026-10-05), verbatim, in order. This whole task comes from them:

1. "Suggest a way to implement the accunt deletion"
2. "The lists where the deleted user is the only owner should also be deleted. The user should be
   notified about that and that the lists where he is not the only owner will outlive his account."
3. "What is account_deletion_preview for?", then "Yes, drop it. A general warning is enough." This
   was said after being told two things. A per-list preview needs a server read, because the app can
   see neither other owners' membership rows nor every page of lists. A general sentence needs no
   read at all.
4. "Create the tasks to implement the feature."
5. "No tests should be run on Android simulator - only on iPhone." This was said after the
   descriptions were written. Every step's device checks run on the iOS simulator only, never on the
   `Pixel_10` emulator.

Settled in that conversation. These are decisions, not open questions:

- **One `security definer` RPC, `delete_account()`.** It is not an Edge Function calling
  `auth.admin.deleteUser`, which [app-store-release.md](../../suggestions/app-store-release.md)
  §2.2 proposed. The RPC deletes the lists and the account in one transaction. Every write in this
  app is already a guarded RPC, and the project has no functions infrastructure. Revoking a Sign in
  with Apple token needs an Edge Function, but Sign in with Apple is not built. When it is, that
  function revokes the Apple token and then calls this same RPC with the user's token.
- **Every list the user is the only owner of is deleted permanently.** That includes lists live or
  binned, shared or not. Every other list stays with its members (request 2).
- **The warning is one general sentence.** There is no per-list preview and no
  `account_deletion_preview()` (request 3).
- **Online only, answered synchronously.** It is never queued in the outbox.

| step | delivers |
|---|---|
| 1 (this) | mockups in `ai/ux/primary/`, signed off by the user. No code |
| 2 | the migration: `delete_account()`. No app change |
| 3 | the app: "Delete account" on Account, clearing the device, a notice on Sign in |

Step 2 does not depend on this step and may land first. Step 3 needs both.

**Scope change:** [scope-boundaries](../../kb/entries/scope-boundaries.md) has no account deletion.
For step 19 it records "no 'leave and delete my account'", and it calls an ownerless list the
deliberate consequence of deleting an account. This task brings account deletion in and removes
that consequence.

## Why first

[phone-is-the-product](../../kb/entries/phone-is-the-product.md): the mockups in `ai/ux/primary/` are
the design, and Account gains a control and a confirm state.

## How to draw them

- **The harness does not draw Account yet.** [ai/ux/source/](../../ux/source/README.md) draws Lists
  and List detail only.
  - Add an Account screen to `mock.js`.
  - Calibrate it first, the way `calib-lists` was calibrated: add a `calib-account` scene that
    reproduces task 20 step 5's 17e simulator shots,
    `ai/tasks/20-ux/screenshots/step-5/account-{day,night}.png`, and run `offsets.py` against them.
  - Record the per-region offsets in the log.
- Geometry is in [AccountScreen.tsx](../../../src/screens/AccountScreen.tsx)'s `useStyles`: cards at
  x 20–370, 10 pt apart, content 21 pt in from their edges, the first card's top at y 172.
- Use components that exist: `Card`, `PillButton` and `ErrorBanner`.
  - "Sign out of all devices" is `PillButton` with `tone="danger"`, and its confirm button is
    `variant="danger"`. Add whatever of `tone`, `variant` and `size` the harness's `PillButton`
    lacks.
- **Do not redraw or overwrite** `account-screen-quiet-horizon*` or
  `account-screen-editing-quiet-horizon*`.

## The images

Each in day (`-quiet-horizon.png`) and night (`-quiet-horizon-moonlit.png`), so four files:

| file stem | state |
|---|---|
| `account-screen-delete` | resting Account with the new "Delete account" control |
| `account-screen-delete-confirm` | its confirm open: the warning, `Cancel`, and the danger confirm |

## What the images must settle

Record each answer in the log, with the user's sign-off.

- **Placement.** Recommended: a card of its own below the sign-out card, holding one `tone="danger"`
  `lg` pill. Its confirm opens inside that card, exactly as "Sign out of all devices" opens inside
  the card above. The alternative is a third row in the sign-out card.
- **The fold.** Does the open confirm fit at 390×844, and at the iPhone 18 Pro's 402×874? If not,
  does opening it scroll the warning into view? Step 3 builds whichever is chosen.
- **Both confirms open at once.** Recommended: allowed, as two independent confirms are today. Their
  a11y labels are unique either way.
- **The resting design.** Do the new images replace `account-screen-quiet-horizon*` and
  `account-screen-editing-*` as the current Account design, or sit beside them? Ask the user, and
  never overwrite a mockup without being asked.
- **The Sign in notice gets no image.** It is the existing `You were signed out on another device.`
  notice (`SignInScreen`'s `notice` style) with different words. Confirm with the user that no image
  is needed.
- **Copy and a11y labels.** This is the starting table. The final one goes in the log, and step 3
  asserts it verbatim:

  | element | a11y label | visible text |
  |---|---|---|
  | control | `Delete account` | `Delete account` |
  | warning | — | `Deleting your account can't be undone. Lists you're the only owner of will be deleted, including for anyone you shared them with. Lists that have another owner will stay with their members.` |
  | cancel | `Cancel deleting account` | `Cancel` |
  | confirm | `Confirm delete account` | `Yes, delete my account`, then `Deleting…` while the request runs |
  | offline failure (`ErrorBanner`) | — | `You need a connection to delete your account.` |
  | Sign in notice | — | `Your account was deleted.` |

  - The warning must carry both halves of request 2: lists the user solely owns go, for everyone on
    them, and every other list stays.
  - "Have another owner" covers the lists where the user is a reader or writer too, because every
    list keeps at least one owner (`keep_last_owner`).
  - The labels follow the existing patterns: `Cancel editing name` with visible text `Cancel`, and
    `Confirm sign out of all devices`
    ([queries-go-through-a11y-labels](../../kb/entries/queries-go-through-a11y-labels.md)).
- **AA contrast** for the warning text and the danger tones, on the card fill in both palettes.

## Done when

- The four PNGs are in `ai/ux/primary/`, rendered by the harness. The new scenes and the
  `calib-account` scene are committed in `mock.js`.
- The log records each answer above, the user's acceptance, the calibration offsets, and the final
  copy table.
- The user has signed off. Step 3 does not start before that.

## KB impact (for the librarian)

| entry | change |
|---|---|
| phone-is-the-product | the new Account mockups, which state each shows, and which Account images are now current. The harness draws Account |
| scope-boundaries | nothing yet. Steps 2 and 3 bring the scope change |
