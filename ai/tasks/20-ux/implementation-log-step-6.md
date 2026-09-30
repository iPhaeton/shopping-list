# Step 6 — implementation log: Sharing's invite bar in a pinned header

2026-09-30. Scope and design: `description-step-6.md` and the mockups it lists. Testing: iOS on the
**iPhone 18 Pro** simulator only (iOS 27, `FBA12E49-FAD0-4ACC-BB4C-37F987A3FCA5`). No Android run,
per the user.

## What changed

**`SharingScreen`**
- Drawn like List detail, with no `Backdrop`/`ScreenSky`/`ScreenHeader`/`HorizonFooter`.
- The root `View` is filled `bandAt(colors, 0).color`, then an optional pinned `ErrorBanner`
  (List detail's `pinned` block), then a `KeyboardAvoidingView` (iOS `padding`) around a `ScrollView`
  with `stickyHeaderIndices={[0]}` and `keyboardShouldPersistTaps="handled"`.
- `header` has List detail's layers, all present for the reasons in KB
  `list-headers-are-pinned-and-opaque`:
  - The `skyHorizon` fill on the outer `View`.
  - `overscrollSky`, 1000 pt above.
  - A padded block with `SkyFill`, the Back `IconButton`, and the title "Sharing" (serif 40/52,
    `marginTop` 10, `accessibilityRole="header"`).
  - The owner's invite bar (`slot`, `marginTop` 14).
  - Then `Hillside ground={band0}`.
- The member and not-found views get the same header without the bar, so the hill follows the title.
- The padded block has `zIndex: 1`. Without it `Hillside`, its later sibling, draws over the
  suggestions.
- **The role picker lives in `Hillside`'s children slot**, where List detail keeps Show deleted
  (`invitePicker`: `marginLeft` 20, `marginTop` 1, width 204).
  - It is rendered only while `selected !== null`.
  - The gate was `query.trim().length > 0` in step 5. The open suggestions hang over this slot, and
    the card's blur turned the checked segment into a dark blot. This was found while drawing the
    mockup: the blot showed in the HTML rendering too.
  - `inviteRole` is screen state, so a picked role survives the picker hiding.
- **Status-bar strip**: List detail's fix, copied (`statusBarSky`, drawn above the
  `KeyboardAvoidingView`, see Problems). The slice height is the header's padded block, measured by
  `onLayout` into `skyHeight` (default 224), not List detail's constant `DRAWN_SKY_H`. The member
  header is shorter, so a constant would misalign the gradient.
- **Hints on the land**:
  - `hintColor = contrastRatio(textSecondary, band0) >= 4.5 ? textSecondary : band0.ink`.
  - Day stays `textSecondary` at 4.52:1. Night gets `text` at 5.27:1, because `textSecondary` on
    `#56628a` is 2.74:1.
  - The `hint` style lost its colour, and `hintColor` is applied inline.
- Removed: the "Invite someone" heading, the invite section, the `spacer`, and `useKeyboardReveal`
  with the `bodyY`/`inviteBottom` refs. `AuthFrame` still uses `useKeyboardReveal`, Account still uses
  `Backdrop`/`ScreenHeader`/`HorizonFooter`, and nothing was deleted.
- The Share handler moved into `share()`, unchanged; `canInvite` is unchanged.
- The member cards, confirms, badges and every a11y label are untouched. The roster block was only
  re-indented into the `!list ? … : (…)` branch.

**`AddBar`**, with defaults unchanged for Lists, List detail and `ItemRow`:
- A controlled mode: `value` + `onChangeText`. The bar keeps no draft and never clears itself; the
  caller clears on success.
- `canSubmit` overrides the non-blank rule.
- `accessibilityLabel` for the input, defaulting to the placeholder.
- `autoCapitalize` is passed through.

**`UserAutocomplete`** is now the whole invite bar:
- An `AddBar` with placeholder "Start typing a name", `accessibilityLabel="Name"` (kept as a literal
  JSX prop: a KB verify greps it), button "Share", and `autoCapitalize="words"`.
- New props `canShare` and `onShare`.
- The suggestions `Card` is absolutely positioned at top 52 + 6, left/right 20, with
  `boxShadow 0 8 28 barShadow`. It is an overlay, no longer inline.
- The search and debounce are unchanged.

**Other components:**
- `TextField` lost its `on` prop and the `sky` look. The invite field was its only user.
- `SegmentedPicker`/`RolePicker` gained `size: 'small'`: 36 tall, text 15.5, option padding 6. On the
  18 Pro, "Reader" fits in a third of 204 pt without being cut short.
- `ScreenHeader` exports `HEADER_GAP` (13), which Sharing imports. `ListDetailScreen` keeps its own
  copy, untouched.
- Stale comments were fixed in `Backdrop`, `Card`, `HorizonFooter`, `Sky` (`SkyFill`, `ScreenSky`)
  and `ScreenHeader`.

**Tests**
- `SharingScreen.test`:
  - "offers a role and Share only once a name is being typed" became "keeps Share in the bar,
    disabled, and offers a role only once somebody is picked", which also covers the picker hiding
    when the name is edited.
  - "keeps the picked role…" now picks, chooses owner, empties the field, and picks again.
- `UserAutocomplete.test`: the harness passes `canShare={selected !== null}` and `onShare`. The new
  test covers Share disabled → live after a pick → `onShare`, and that the bar does not clear itself.

**`.maestro/flows/tour-signed-in.yaml`**:
- The drag-back `swipe` after `eraseText` is gone: the header is pinned.
- After `sharing-suggestions`, `tapOn: "Share with .*"`, then `takeScreenshot: sharing-picked-${THEME}`.
  Nothing is shared.
- Back is still tapped by point (`"10%,9%"`), which lands inside Back on the 18 Pro (Back is at
  y ≈ 75–111).

## Problems

- **iOS draws List detail's light blur over Sharing too.**
  - By night, the top ~50 pt of the new Sharing read `#2f3656`/`#2c3553` where the sky is `#10162e`,
    with the stars blurred. That is the (45,54,84) KB `list-headers-are-pinned-and-opaque` records for
    List detail.
  - The step-5 Sharing (a `ScrollView` inside `Backdrop`, whose own status-bar slice sat above it)
    never showed it.
  - The same cure works: an absolute sky strip drawn after the `KeyboardAvoidingView`. After it, the
    top samples `#10162e` → `#121831` down to the header, continuous.
  - So the blur is not specific to List detail's `FlatList`: a plain `ScrollView` with a pinned
    header gets it too. The source is still unidentified.
- **Suggestion rows below the header's frame take taps on iOS.** The overlay hangs out of the
  sticky header.
  - On the 18 Pro the header ends at y ≈ 320, and "Jor" gives five rows down to y ≈ 465.
  - `tapOn: "Share with Aaliyah Jordan 174851"`, the fifth row, picked the person and the role
    picker appeared.
  - Why it works: Fabric's `RCTViewComponentView betterHitTest` keeps hit-testing outside a view's
    bounds when its `overflowInset` is non-zero, and the sticky wrapper has `zIndex: 10`
    (`ScrollViewStickyHeader`), so it is hit first.
  - Untested on Android, which hit-tests through `TouchTargetHelper`.
- **Environment on arrival:**
  - The iPhone 17e simulator no longer exists, which fails KB `native-build-toolchain`'s verify
    (`grep -q 'iPhone 17e'`).
  - The 18 Pro had today's Debug dev client (08:53, with `ExpoBlur`), so no rebuild was needed.
  - An `npm run ios` Metro from 08:43 was serving on 8081 without the target override, so the app
    ran against cloud (`.env` has `EXPO_PUBLIC_SUPABASE_TARGET=cloud`). I stopped it and ran
    `EXPO_PUBLIC_SUPABASE_TARGET=local npx expo start --dev-client --port 8081`.
  - The app was then still signed in to another account ("List 1", "List 2"). I signed out and
    signed in as `maya@example.com` through the flows.
- **18 Pro prep:**
  - The keyboards were never reset on this device (`AppleKeyboards` unset). I wrote it plus the
    `com.apple.Preferences` NOs and `DidShowContinuousPathIntroduction`, then rebooted the simulator.
  - I set `EXDevMenuShowFloatingActionButton NO` with the app terminated.
  - The `status_bar` override shows `09:41`: the simulator's locale is 24-hour.
- **Load:** the machine sat at load 17–74 (XProtect, ANECompilerService). One `inputText: Jor`
  typed only "J", and a rerun typed it whole: KB `maestro-drives-the-native-ui`'s load gotcha.
- **Test data:** to scroll a roster longer than the screen, I shared Groceries with three generated
  users ("Aaliyah Jordan 174851/17351/152351", as readers) through the UI. I removed them afterwards
  with a `delete from public.list_members …` on the local stack, restoring Maya/Sam/Priya.
- **The full `shoot-all.sh` run was abandoned.**
  - It stopped in `sign-in.yaml`: Maestro typed `mxample.com` for `maya@example.com` under load, and
    the server refused it ("Unable to validate email address: invalid format").
  - The run had already made `s6shot-day@example.com` on the local stack (harmless).
  - The user then ruled: **screenshot only the changed screens, always**.
  - Step 6's shots come from scratch flows that open Sharing directly. The long roster was seeded by
    SQL `insert into public.list_members`, and a `trap` deleted it on exit.
- **A shot taken right after `extendedWaitUntil: Leave list` caught the push mid-slide**: the screen
  had rounded corners and black edges (`sharing-member-night`). Retaken after
  `waitForAnimationToEnd`, and the tour got the same wait before its `sharing-member` shot.

## Verification

- `npm test`: 28 suites, 586 tests pass. `npm run typecheck` is clean.
- `npm run kb:audit` before the deposit: 3 errors, each expected:
  - `queries-go-through-a11y-labels` greps `query.trim().length > 0 ?`, which is gone by design.
  - `screens-take-navigation-props` greps `onBack={() => navigation.goBack()}` in `SharingScreen`,
    which is now `onPress` on a plain `IconButton`.
  - `native-build-toolchain` greps for the iPhone 17e simulator, which is gone.
- **iPhone 18 Pro, both themes:**
  - Rest, suggestions (five rows over the strip and cards, frosted), picked (the picker in the strip,
    Share live) and scrolled (cards passing under the hill, the header fixed) match the step-6
    mockups.
  - The night status-bar strip was checked by pixel sampling.
- **Screenshots:** `ai/tasks/20-ux/screenshots/step-6/`, 14 PNGs, all from the iPhone 18 Pro, Sharing
  only, `-day`/`-night`:
  - `sharing`: the owner at rest.
  - `sharing-remove`: Sam's Remove confirm.
  - `sharing-suggestions`: "Jor".
  - `sharing-picked`: the first suggestion picked.
  - `sharing-scrolled`: three extra readers seeded, the roster dragged 30% up.
  - `sharing-member`: Birthday party as a reader.
  - `sharing-leave`: the Leave confirm.
  
  The suggestions show generated users ("Aaliyah Jordan …"), not the seed's Jordan/Jorge/Jorja, since
  the stack holds the 1M load-test users.
- **Web** (Playwright, 390×844, the same Metro, local):
  - Maya signed in with a Mailpit code, then "Jor" → five suggestions floating over the cards →
    clicked the fifth (below the header) → the role picker appeared in the strip → "Share as reader"
    → Share → Remove → Confirm remove. The roster ended back at Maya/Sam/Priya, checked in SQL.
  - The header's wrapper is `position: sticky; top: 0; z-index: 10`.
  - Birthday party's member view: the Leave confirm opens and Cancel closes it. The list was not left.
- **Not verified:** Android (by instruction), and the `List not found` state on device (jest covers
  it).
