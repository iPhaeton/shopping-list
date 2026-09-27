# Implementation log — task 20, step 4: the List detail screen, built to the mockup

**Date:** 2026-09-27. Description: [description-step-4.md](description-step-4.md).

## Decisions the user made during the step

1. **The header row scrolls away with the content** (drawn in the screen, `headerShown: false`), the
   same as Lists' Account pill — not pinned. Offered: pinned custom header via
   `setOptions({ header })`. Consequence: `Chrome` in `ListDetailScreen.test.tsx` had nothing left to
   render and was removed (see "For the librarian").
2. **Web browser back stays unwired.** The description says browser back must "keep working"; it
   never worked: `NavigationContainer` has no `linking` prop, and
   `node_modules/@react-navigation/native/src/NavigationContainer.tsx:81` enables `useLinking` (the
   only thing that writes browser history) only when one is passed. Offered: a web-only `linking`
   config (URLs, back/forward, a reload guard for "List not found" while lists load). Declined —
   on web the drawn Back button is the way back, as the native header's button was before.
3. **react-native-screens 4.16.0 → 4.19.0**, past Expo SDK 54's pin (`~4.16.0`). Forced by a
   bug this step exposed; details below. Offered alternatives: a patch-package fix on 4.16, or a
   drawn `headerLeft` on Sharing.

## What changed

**Layering (`ListDetailScreen`)** — the design needs a ground gradient fixed to the *screen* while
the hill scrolls with the content, and no seam between them at any offset. Back to front:

1. `Ground` (new): absolute, full screen, outside the `KeyboardAvoidingView`, not scrolled. SVG
   gradient holds `groundTop` down to `LAND_TOP = 290` (fraction of `useWindowDimensions().height`),
   then linear to `groundBottom` at the bottom — sampled: the mockup is exactly `groundTop` right
   under the land line and `groundBottom` at y 840.
2. Pinned `ErrorBanner`/`BlockedBanner` in a `skyTop` View with `paddingTop: insets.top` (they
   were pinned before too; the blocked one stalls the outbox until answered).
3. `KeyboardAvoidingView` (iOS `padding`) → transparent `FlatList`. `ListHeaderComponent` is a JSX
   value built inline (keeps AddBar drafts; keeps the `<SyncBanner pending={pending} />` literal
   in the file for `sync-banner-mount-is-unconditional`'s `verify:`):
   - an overscroll sky: absolute `top: -1000`, height 1000, `skyTop` — iOS pull-down shows sky;
   - the upper region over a `SkyFill` (new, `Sky.tsx`): header row, title, `SyncBanner`, the y-172
     slot (Add bar / binned-list card / read-only pill);
   - `Hillside` (new): 82pt strip holding the switch.
   Rows are transparent `ItemRow`s. Empty, loading and not-found all go through
   `ListEmptyComponent` (one return for every state; the old early returns are gone), the paging
   spinner through `ListFooterComponent`.
4. A status-bar strip: absolute, `insets.top` tall, clipped, over a `SkyFill` 224pt tall (the
   mockup's upper-sky height), so at scroll 0 it matches the header's sky and after scrolling the
   status bar stays on sky (as `ListsScreen` does).

**`Hillside` — the land is a hole, not a shape.** One SVG at the real width. Everything it draws
(flat `skyHorizon`, night stars, sun glow + disc + birds / moon, far hill at 0.85) sits inside a
`ClipPath` of the region *above* the land's front edge; below it the strip is transparent and
`Ground` shows through. A hill with its own fill (what `Horizon` does on Lists, over opaque bands)
would seam against a screen-fixed gradient at every offset but one. Curves traced from the mockup
by pixel (`LAND`, `FAR_HILL` in 390-wide strip coordinates, stretched by `width / 390`); the disc
(r 36 day / 34 night) and birds are anchored `90pt` from the right edge instead, so the disc stays
round and cut in half on every width. SVG ids prefixed (`hs…`): web shares one id space per page.

**`SkyFill` measures itself** (`onLayout` → numeric `Svg` size; `initialHeight` 224 for the first
frame). First version used `width/height="100%"` and a bounding-box gradient: on iOS the drawing
kept the size it had on first layout — the header renders first while items load, without the Add
bar — so the sky stopped under the title and the ground showed through behind the Add bar. Stars
(`FILL_STARS`) are placed in points from the top, traced from the night mockup (status-bar glyphs
and the hill edge filtered out), so they never jump when the region grows and the status-bar strip
lines up with them exactly.

**Header.** Back = `IconButton` with a new `outline` prop and `ChevronIcon direction="left"`,
label `Back`, `navigation.goBack()`. `PillButton label="Rename list" visibleLabel="Rename"` (only
when `manageable`) and `label="Share list" visibleLabel="Share"` (whenever the list exists). Title
serif 40, `lineHeight: 52`, `accessibilityRole="header"`, `numberOfLines={2}`. **The rename bar
replaces the title in place** (same 52pt), so opening it moves nothing below. `setOptions` now
carries only `{ title }` — still read by the web tab and by Sharing's iOS back button (the tour taps
`Groceries`). `RootNavigator`: `ListDetail` gets `options={{ headerShown: false }}`.
`HEADER_GAP = 13` puts the row at y 60 on the 17e (`insets.top` is 47 there).

**`ItemRow`** — `memo`, callbacks take the item id (`onToggle(itemId)`, `onRename(itemId, title)`,
`onSetDeleted(itemId, deleted)`), screen passes `useCallback`s and a `useCallback` `renderItem`
(same shape as step 3's `ListRow`). Transparent 60pt row; checkbox Pressable a11y untouched
(`{ checked: done, disabled: !editable || deleted }`, label, hint); 26pt circle at x 24, 2pt
`checkboxOutline` ring, checked = `primary` fill + `CheckIcon` in `onPrimary`; title x 64,
`sansMedium` 19 (done: `sans`, `textDone`, line-through). Disabled look (reader, binned row):
checkbox at opacity 0.45. Editable live row: pencil + trash `IconButton`s at x 280/328,
`iconButtonFill`, `text` glyph. Binned row: `Deleted` tag (`textDone` — passes AA on the ground,
`textMuted` does not) in the pencil's slot, restore button in the trash's; label expression kept
verbatim. Divider: a 4pt-tall SVG at the row's top (index > 0), 1pt `divider` stroke, one swell
per width, inverted on odd rows (mockup: ±~0.8pt, phase flips per row). **The editor is now
`AddBar`** (`placeholder="Item name"`, `buttonLabel="Save"`, `initialValue`, new `autoFocus` and
`onCancel` props) — labels unchanged, unchanged-title-sends-nothing kept in `ItemRow`'s `onSubmit`.

**Shared components, changed because both mockups disagree with step 3:**
- `AddBar` `marginHorizontal` 16 → 20 (both mockups: x 20–370). Day shadow under the pill via
  `boxShadow` (New Architecture, works on iOS/Android/web) with a new `barShadow` token —
  `rgba(44,47,78,0.14)` day, fully transparent night (the moonlit mockups draw none).
- `ShowDeletedToggle` `paddingHorizontal` 16 → 24 (both mockups put the track at x 24).
- `TrashIcon` redrawn: lid, handle, tapering bin, no inner lines, stroke 2 — both mockups draw it
  that way. `RestoreIcon` stroke 1.6 → 2 to match; new `PencilIcon` (stroke 2), `CheckIcon`.
- Notices in the pill/card language, copy untouched: `ErrorBanner` and `BlockedBanner` are
  `bannerSurface` cards with `radius.lg` (new token, 20); Error keeps its `error` ring and text;
  Blocked's actions are `PillButton variant="filled"` (new) + `PillButton label="Discard my change"
  visibleLabel="Discard"`, wrapping. Read-only line: a `bannerSurface` rounded pill; binned-list
  notice: card + filled `Restore ${list.name}` pill (owners only). `ErrorBanner` is also on
  Account/Sharing/SetName — same spacing, new card look ahead of step 5.
- `HeaderButton.tsx` deleted — no call sites left.
- `Horizon.tsx`'s doc comment no longer promises reuse here.

## The iOS 26 back-button bug, and the screens upgrade

Hiding `ListDetail`'s native header exposed
[react-native-screens#3294](https://github.com/software-mansion/react-native-screens/issues/3294).
Reproduced on the 17e (iOS 26.5) with Maestro, each variant from a fresh launch:
- Lists → Groceries → Share list → native back → Share list → native back: **the second back is
  dead**, the button stuck in its pressed glow; only a restart fixes it.
- Lists → Groceries → Share list → native back → drawn Back → Account → native back: **dead too**.
- ListDetail round trips alone, and Lists ↔ Account alone (Lists is the root): fine.

Cause, read in `node_modules/react-native-screens/ios/RNSScreenStack.mm` 4.16.0: on iOS 26,
`navigationBar:shouldPopItem:` sets the back button wrapper's `userInteractionEnabled = false`, and
only `navigationBar:didPopItem:` turns it back on — by finding the back button in the bar. When the
destination hides the bar (a non-root `headerShown: false` screen), that lookup evidently misses —
inferred from the code and the symptoms, not stepped through — and the disabled state carries into
the next back button. 4.19.0 ships "delay setting navigation bar visibility to
mitigate bar button bug on iOS 26"; it drops RN ≤ 0.79 (we are 0.81.5) and removes the old v5
native-stack code (unused — we are on `@react-navigation/native-stack` 7). Installed with
`npm install react-native-screens@~4.19.0` (not `npx expo install`, which would re-pin 4.16), then
`cd ios && pod install`, then a rebuild of both dev clients.

**Verified fixed on 4.19.0** (iOS dev client rebuilt, same 17e): from a Groceries → Share list →
native back that has already happened, three more Share list → native back round trips all pop;
and the Account-after-Sharing variant pops. On 4.16 the first of those was already dead.
`npm test` 489/489 and `npm run typecheck` pass on 4.19.

**A dev-only false alarm met while verifying it:** the dev client's blue **"Refreshing…"** banner
(top ~58pt, over the back button) appears on its own — on a push that fetches (Sharing, Account),
after page 2 loads — with no project file changing (checked with `find -newer`). A Maestro tap on
the back button while it shows lands on the banner and does nothing; that looked like the #3294
bug again until screenshots taken around the tap showed the banner. Maestro cannot see it (it is
not in the app's hierarchy), so `extendedWaitUntil: notVisible: Refreshing...` does not wait for
it; screenshots were retaken until a pixel check at (15% width, y 150px) was no longer the banner's
blue. Not present in a release build.

## Other findings

- **Maestro cannot perform the iOS edge-swipe back.** Its `swipe` from x 0–1% (fast and slow)
  popped neither List detail nor Sharing — Sharing has a native header, where the gesture certainly
  works, so this is Maestro's synthesized touch, not the app. Worse, the touch lands on the content:
  one attempt toggled the row under it (Bananas). The swipe on a headerless `ListDetail` is
  therefore verified by source only: `RNSScreenStack` makes itself the
  `interactivePopGestureRecognizer`'s delegate and `gestureRecognizerShouldBegin:` returns YES for
  it with no reference to the header. **Needs one swipe by hand.**
- **`tapOn: My Lists` can hit the wrong element.** After a theme switch on Account, Maestro's
  text match resolved to Lists' own `My Lists` title (still in the hierarchy underneath) rather than
  the back button; tapping the back button by point (`18%, 8%`) is reliable.
- **A tap during scroll momentum is spent stopping the scroll** — `scrollUntilVisible` returns while
  the list still coasts; `waitForAnimationToEnd` before the next tap. Scrolling back up 420 rows
  times out; a tap on the status bar (`point: 50%, 1%`) scrolls to top.
- **`PAGE_SIZE` is 400**, so "60+ items (scroll into page 2)" needs more than 400 rows: page 2 was
  checked with a 420-item list (Crate 401–420 arrive on scroll, on the 17e and on web).
- The `Add`/`Create` button reads grey (`primaryDisabled`) while the field is empty; the mockups
  draw it enabled. Kept — it is the real disabled state, and step 3 signed Lists off the same way.
- Web console: two React warnings about `accessibilityElementsHidden`/`importantForAccessibility`
  on a DOM element come from step 3's `Sky` passing them to `<Svg>`; they appear on the Lists
  screen before List detail is opened. Not introduced here, not fixed here.

## Verification

**Suites:** `npm test` 27 suites / **489 tests** (was 485 at step 3's end — with 4 new here:
Back calls `goBack`; a not-found list still offers Back and no Share; visible `Rename`/`Share` under
the full labels; the rename bar swaps out the title and it returns renamed; plus `getByRole('header')`
and `getByText('Deleted')` assertions added to two existing tests). `npm run typecheck` clean.
`npm run kb:audit`: one expected failure, `screens-take-navigation-props` (the `headerRight` grep —
candidate fact 1); every other entry, including `theme-tokens-only`, `queries-go-through-a11y-labels`,
`sync-banner-mount-is-unconditional` and `absolute-decoration-needs-pointer-events-on-its-wrapper`,
passes. A full-suite run during the Xcode rebuild failed 2–11 tests by timeout (suites took 45–80 s
instead of 2–5 s); the same suite passes with the CPU idle.

**Calibration against the mockup** (17e, `insets.top` 47; pixel positions found by scanning each
image): back ring top 60.0 / 60.0, Share pill top 60.0 / 60.0, Add bar top 172.0 / 172.0, switch
top 240.3 / 240.7, land at x 10 280.7 / 281.0 and at x 380 289.0 / 289.0, first checkbox top
323.0 / 323.0 (mockup / simulator, pt). The title's glyph top sat 1.6pt high; the title and its
rename slot moved down 2pt with the slot below shortened to match, so the Add bar stays at 172.

**iPhone 17e, both themes** (Maestro through a throwaway tour; seed data below): the mockup state,
side by side with each image — same composition, colors, type; the Add bar typed into with the
keyboard up (bar stays above it); the list rename bar open; an item's editor opened on row 8 —
iOS scrolled it above the keyboard on its own, no code needed; the bin shown, scrolled (restore
icon, `Deleted` tag, dimmed checkbox; the hill moves over the ground with no seam; the status-bar
strip keeps the bar on sky); an empty list; 3 items; 64 items scrolled; **page 2** of a 420-item
list (Crate 401–420 arrive on scroll); a reader (no buttons, dimmed checkboxes, read-only pill); a
binned list as its owner (card + Restore pill) and as a writer (card only). Top overscroll shows
sky. Drawn Back works everywhere it was tapped.

**iPhone 17 Pro Max** (same `.app`, installed from DerivedData): Groceries, Day and Night — header
clears the Dynamic Island, the land stretches, the disc stays round and right-anchored, the ground
runs to the taller bottom.

**Android `Pixel_10`** (dev client rebuilt for screens 4.19: `npx expo run:android --no-bundler`,
BUILD SUCCESSFUL in 27m 30s): Groceries, Night and Day; **hardware back** from List detail returns
to Lists; keyboard up with the Add bar typed into — bar stays visible (Gboard stays light at Night;
it ignores `keyboardAppearance`, pre-existing).

**Web** (Playwright MCP, 390×844, `s4owner`): every state works — checking, the switch, list rename
(open, save, close), item rename (open, cancel), item delete → shown in the bin → restore, the
reader, both binned lists (owner's Restore restores it — re-binned afterwards), Share → Sharing →
back → drawn Back, and page 2 of the 420-item list (scroll height 25 483 ≈ 306 + 420 × 60). Taps
reach the header and the first rows; the ground paints behind the rows.

**Not seen on a device:** `ErrorBanner` and `BlockedBanner` in their new card look — neither can be
raised from the UI on demand (list names are not unique, so a duplicate rename is accepted; a
blocked write needs a write queued offline onto something another member binned). Their copy,
roles and labels are covered by the suites; the look is two `View` styles and two `PillButton`s.
Also not run end to end: `.maestro/flows/tour-signed-in.yaml` after its `tapOn: Back` edit (it
needs the `maya`/`Sam` seed); the `Back` taps themselves were exercised by the scratch tour on iOS.

**Environment notes.** The long-running `expo start --web` (19 h old, pid 23031) wedged at ~40% CPU
with nothing asking it for anything and took 55 s per Android bundle — past the dev client's read
timeout, so the emulator showed `SocketTimeoutException` / "isn't responding". Killed and restarted
(`BROWSER=none npx expo start --web`): 11 s. The Pro Max's first bundle load also timed out once and
succeeded on Reload.

**Seed.** `node .maestro/seed.mjs s4owner@example.com s4member@example.com` (the new Groceries),
then a scratch script, same helpers: `Bakery run` (3), `Big shop` (64), `Warehouse club` (420),
`Old camping trip` (owner's, binned, one item done), `Office party` (member's, shared to the owner
as writer, binned by the member). `Hardware store` from the seed is the empty list; `Birthday party`
the reader case. Fresh addresses, so no existing local data was touched. GoTrue refuses a second
OTP to the same address inside its rate window (429 `over_email_send_rate_limit`); re-run after it.

## Screenshots

`ai/tasks/20-ux/screenshots/step-4/`, all from simulators/emulator, 17e unless named:
`list-detail-{mockup-state,keyboard-add,rename-list,rename-item-keyboard,bin-shown,empty,3-items,64-items-scrolled,page-2,reader,binned-owner,binned-writer}-{day,night}.png`,
`list-detail-17-pro-max-{day,night}.png`, `list-detail-android-{day,night}.png`. The 17e set was
taken on the screens 4.19 build.

## For the librarian — candidate facts

1. **`ListDetail` has no native header** (`headerShown: false`), like `Lists`. The drawn header —
   Back, Rename/Share pills, serif title — lives in `ListDetailScreen`'s own tree.
   [screens-take-navigation-props](../../kb/entries/screens-take-navigation-props.md): the
   `grep -q 'headerRight' src/screens/ListDetailScreen.test.tsx` clause is now false by design (the
   `Chrome` wrapper is gone; nothing in the app uses `setOptions({ headerRight })` any more), and the
   "Copy that wrapper" paragraph has no live example. `setOptions` still carries `{ title }`, still
   asserted with `expect.objectContaining`.
2. [queries-go-through-a11y-labels](../../kb/entries/queries-go-through-a11y-labels.md): the
   `HeaderButton` row is stale (file deleted). New labels: `Back` (List detail's drawn back button,
   role `button`), `Rename list`/`Share list` are now `PillButton`s whose **visible** text is
   `Rename`/`Share`; `Restore ${list.name}` is a filled `PillButton`; the item editor's `Cancel` and
   `Save` now come from `AddBar`'s new `onCancel`. `ItemRow`'s checkbox state is unchanged (the
   entry's table already predates `|| deleted`; the file reads
   `{ checked: done, disabled: !editable || deleted }`).
3. **react-native-screens is 4.19.0, not Expo 54's pinned `~4.16.0`** — why (#3294, above), how it
   was installed (`npm install`, not `npx expo install`, which would downgrade it), and that
   `expo-doctor`/`npx expo install --check` will flag it. Anyone re-running `npx expo install --fix`
   must not let it go back to 4.16 while any non-root screen hides its header.
4. **Maestro cannot drive the iOS edge-swipe back**, and a failed attempt taps the content under
   it; `tapOn: <title>` for a native back button can match the screen underneath — tap by point.
   Scroll-momentum and status-bar-tap tricks above.
   ([maestro-drives-the-native-ui](../../kb/entries/maestro-drives-the-native-ui.md))
5. **A `height="100%"` react-native-svg drawing is not redrawn on iOS when its parent grows** —
   measure with `onLayout` and pass numbers. Cost a round trip here (`SkyFill`).
6. **The fixed-ground, land-as-window technique** (`Ground` + `Hillside`'s `ClipPath`), and why
   `Horizon` (Lists) could not be reused: a filled hill seams against a screen-fixed gradient.
7. **Web browser back does nothing inside the app** — no `linking` on `NavigationContainer`; the
   user chose to leave it (decision 2).
8. `AddBar` margins 20 (both mockups), `ShowDeletedToggle` track at x 24, the redrawn `TrashIcon`,
   the `barShadow` token (transparent at night), `radius.lg` for notice cards.
9. `.maestro/seed.mjs`'s Groceries is now the List detail mockup's state (ten items, three done,
   Paper towels in the bin); `tour-signed-in.yaml` leaves List detail with `tapOn: Back`.
