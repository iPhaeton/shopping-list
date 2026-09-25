# Step 5 — Sign in, Set name, Account, Sharing, and the launch

Finish the theme across everything steps 3–4 did not touch, in the same language: the sky, serif
titles, pills, frosted cards, and circular icon buttons. Design images, palette, task plan, and
phone-first rules: `description-step-1.md`. Steps 3–4's screens are the reference.

## What changes

- **Sign in (both phases) and Set name.** This is the first screen a new user sees.
  - The sky, with the sun or moon rising behind a wave. "ShoppingLoop" in the serif display face.
    The form in a frosted card.
  - Primary actions are filled pills. `Resend code` and `Use a different email` are quiet text
    links. The code field keeps its wide letter spacing.
  - `Continue with Google` (native only) is an outlined pill.
  - The preference is per device, so Auto and a stored choice apply here too, while signed out.
- **Account.** Frosted cards on the sky, each with an Account title in the serif:
  - email
  - name, with Edit
  - Appearance: the step 1–2 picker as a segmented pill control, with the Auto hint
  - Sign out
  - Sign out of all devices, with its danger confirm
- **Sharing.**
  - Member cards.
  - `RolePicker` as the same segmented pill control as Appearance.
  - The Remove and Leave confirm rows, with the danger button.
  - The `UserAutocomplete` suggestions as a surface card under the field.
  - The `Invite someone` heading.
- **Shared pieces not yet restyled:** `ErrorBanner`, `BlockedBanner`, and `EmptyState` wherever they
  still carry the flat look, plus `HeaderButton`, `RolePicker`, and `RootNavigator`'s loading view
  (the sky, not a flat fill).
- **Launch screen.**
  - `app.json` has no splash configuration today, and `assets/splash-icon.png` sits unused.
    Configure the native splash (the `expo-splash-screen` config plugin; see the Expo v54 docs) on the
    Quiet Horizon sky, with a Moonlit `dark` variant.
  - A native launch screen can only follow the *system* appearance, not the in-app choice. Accept
    that.
  - What must hold: the splash stays up until step 1's gate (preference + fonts) resolves, so the
    first frame after it is already the right theme.
  - The app icon is out of scope.

## Constraints

- Every label and every piece of copy pinned in `ai/kb/entries/queries-go-through-a11y-labels.md`
  stays. That includes:
  - the fixed-label-over-changing-text confirms
  - `` `Remove ${displayNameFor(member)}` ``
  - `` `Share with ${user.name}` ``
  - `Only an owner can change who has access.`
  - `A list must keep at least one owner.`
- `Continue with Google` stays native-only (`Platform.OS !== 'web'`).
- A splash or `app.json` change shows up natively only after a dev-client rebuild.

## Done when

- A final sweep of every screen and state, in both themes, on the iPhone 17e and iPhone 17 Pro Max
  simulators and the Android emulator. No screen still carries the pre-task look. On web, every
  screen works; its looks may differ.
- No token in `src/theme.ts` is left unused; delete whatever the migration orphaned.
- Body text passes WCAG AA on every surface in both themes.
- On the iOS simulator, a cold start at night shows no light frame between the splash and the first
  paint. Check it with Night chosen, and with Auto after sunset.
- `npm test`, `npm run typecheck`, and `npm run kb:audit` pass.
- Day and night screenshots of every screen are in `ai/tasks/20-ux/screenshots/step-5/`.
