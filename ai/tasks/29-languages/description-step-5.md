# Step 5 — The layout pass: long languages on the phone

The user requests, decisions D1–D14 and the step plan are in
[description-step-1.md](description-step-1.md). This step needs step 4's catalogs.

## What this step delivers

Every screen fits its text in every D1 language, on the iPhone 18 Pro simulator, with the English screens
unchanged. The user signs off the shots.

[phone-is-the-product](../../kb/entries/phone-is-the-product.md) governs: looks are signed off on the iOS
simulator only, web only has to work, and the phone design is never bent for anything else.

## The pass

### 1. The long languages, every screen

- **Which and why:** German (`de`), Finnish (`fi`) and Hungarian (`hu`) run longest among D1's languages,
  and `pseudo` is English padded by about 40%. If these fit, the rest almost always fit.
- **What to shoot:** every screen and state in step 2's table, in all four.
  - Use targeted Maestro flows and the dev switch. Navigate by English labels, switch, shoot, switch back.
    Not `shoot-all.sh`.
  - Every screen changed in this task, so all of them are in scope.
  - Save to `screenshots/step-5/<locale>/<screen>-<state>.png`.
- **What to look for:**
  - text cut off;
  - an ellipsis where English has none;
  - overlap;
  - a control wrapping out of its fixed height;
  - a header's round buttons crowding its title.
- **The likely places:**
  - pills (`PillButton`, `ModeButton`);
  - `SegmentedPicker` (Day / Night / Auto);
  - `RolePicker`;
  - the add bar's sentence (`BarSentence`);
  - `CoverageLine`;
  - empty states;
  - the Notifications card's meta line;
  - `ScreenHeader` titles;
  - the Account confirm rows.
- **Fixed heights to check.** `grep -nE "\bheight: [0-9]" src` finds 29 fixed `height:` values (on
  2026-10-12). Check each one that holds text.

### 2. Fixes, in this order of preference

1. **A shorter translation.** Tighten the message's length hint in its comment and re-translate it with
   step 4's `--force`. The design does not move.
2. **A control that adapts only when its text needs it.** For example `minHeight` instead of `height`,
   `flexShrink`, or `numberOfLines` with `adjustsFontSizeToFit` and a floor of `minimumFontScale` 0.85 or
   more. The English rendering must stay pixel-identical: shoot it before and after.
3. **Anything that visibly changes the English screen: stop and ask the user,** with before and after
   shots. That is a design change.

**Never shorten the English (D5).** Fix web on the web side only. The mockups in `ai/ux/primary/` are the
design and are not edited.

### 3. The other 17 languages

- **Shoot the same set automatically** for `es`, `fr`, `it`, `pt-PT`, `sv`, `nb`, `pl`, `cs`, `sk`, `sl`,
  `hr`, `sr-Cyrl`, `sr-Latn`, `be`, `ru`, `uk` and `bg`.
- **Review the shots yourself** for the same defects, and fix with rule 1 or 2.
- **What the user sees:** only what changed, and nothing else from these.

### 4. Language choice on the device (D2)

- **Per-app:** in Settings → ShoppingLoop → Language, choose Polski. The app relaunches in Polish.
- **Preferred-language order.** Launch with `-AppleLanguages "(ja, pl)"` through `xcrun simctl launch`.
  Japanese has no catalog, so the app shows Polish. With `"(ja)"` alone it shows English.
- **Serbian:** with `"(sr-Latn)"` the app shows `sr-Latn`, and with `"(sr)"` it shows `sr-Cyrl`.
- **Sign in with Apple's button.**
  [theme-reaches-native-surfaces](../../kb/entries/theme-reaches-native-surfaces.md) says Apple draws its
  words in the device's language. Record whether they follow the per-app language instead, with a shot.

### 5. Web

In Playwright with the browser locale `de-DE`, the app opens in German. Shoot one screen. Web only has to
work.

## Verification

1. **The user signs off** every `de`, `fi`, `hu` and `pseudo` shot, plus the before/after pair of any fix
   from rule 2. Present them grouped by screen.
2. `npm test`, `npm run typecheck` and `npm run i18n:check` pass.
3. **The log lists** every defect found, by locale and screen, and its fix (rule 1, 2, or the user's
   decision under rule 3).

## After this step

- Write `implementation-log-step-5.md` beside this file. End it with a **KB candidates** table: this
  step's KB impact rows below, as actually built, plus anything else the step taught.
- Do not run `/librarian deposit 29`, whatever CLAUDE.md says. Step 7 deposits the whole task.

## KB impact

| entry | change |
|---|---|
| phone-is-the-product | languages are signed off on the iPhone 18 Pro through `de`, `fi`, `hu` and `pseudo`; fix with a shorter translation before touching layout |
| theme-reaches-native-surfaces | which language Apple's button follows when a per-app language is set |
| maestro-drives-the-native-ui | flows navigate in English and switch language through the dev link; `-AppleLanguages` through `simctl launch` |
