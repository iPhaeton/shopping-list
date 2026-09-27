---
id: auto-theme-follows-the-time-zone
title: Auto takes sunset from the device's time zone, never its location — the zone's principal city through NOAA's formulas, and 19:00–07:00 where a zone has no city
type: decision
status: current
tags: [theme, time, hermes, intl, privacy, scope]
sources: [ai/tasks/20-ux/description-step-2.md, ai/tasks/20-ux/implementation-log-step-2.md, ai/tasks/21-expo-sdk-57/implementation-log-step-1.md]
last_verified: 2026-09-27
verify: grep -q "DEFAULT: ThemePreference = 'auto'" src/lib/themePreference.ts && ! grep -qiE 'location' package.json app.json && grep -q "'Europe/Oslo': \[59.92, 10.75\]" src/lib/zoneCoords.ts && grep -q "'Iceland': \[64.15, -21.85\]" src/lib/zoneCoords.ts && ! grep -qE "^  '(UTC|UCT|GMT[^']*|Zulu|Universal|Greenwich|Etc/[^']*)':" src/lib/zoneCoords.ts && ! grep -qE 'get(Hours|Minutes|Date|Day|Month|FullYear|TimezoneOffset)\(' src/lib/sun.ts
related: [scope-boundaries, theme-reaches-native-surfaces, theme-provider-suites-fake-the-clock, metro-inspector-reads-live-app-state, phone-is-the-product]
indexed: false
---

**Auto** (task 20 step 2) is Night from local sunset until the next sunrise, Day otherwise, and the
default for anyone who never chose; a stored `'day'`/`'night'` is kept. The pure
`resolveTheme(preference, now, zone)` in [resolveTheme.ts](../../../src/state/resolveTheme.ts)
decides; `ThemeProvider` feeds it `new Date()` and the zone from
[deviceTimeZone.ts](../../../src/lib/deviceTimeZone.ts), and re-reads both at the switch it
expects next and whenever `AppState` turns `active`.

**Why the zone and not the device's location** — the task description decided this, not the
implementer:

- location is a permission prompt for a cosmetic feature;
- it adds a data type to the App Privacy questionnaire that `ai/suggestions/app-store-release.md`
  plans to answer (email, name, user content, user ID, purchases — no location);
- it would need this same fallback anyway, for a denied permission and for web;
- the zone works offline, on web, and **synchronously at cold start**, so the theme gate waits on
  nothing new.

**Accepted cost:** the switch can miss true sunset by tens of minutes, by more in very wide zones
(all of China is `Asia/Shanghai`). **Do not add a location fallback to close that gap** — precision,
if ever wanted, is its own step with its own permission and privacy answer. The Account hint
(`Night from 7:12 PM`) exists partly to make the approximation visible.

**The city table is generated — regenerate it, never hand-edit.**
[zoneCoords.ts](../../../src/lib/zoneCoords.ts) comes from
[build-zone-coords.mjs](../../../scripts/build-zone-coords.mjs), run on an unpacked IANA tzdata
release (2026c; the command is in the script header). macOS ships `zone.tab` in
`/usr/share/zoneinfo` but not `backward`, hence the tarball. Choices a regeneration must keep:

- **`zone.tab`, not `zone1970.tab`.** The latter folds `Europe/Oslo` into `Europe/Berlin`, putting
  Oslo's sunset at Berlin's — over an hour off at midsummer.
- **Legacy names from `backward`** (`Asia/Calcutta`), resolved through a line's `#= BETTER` target
  first: `Iceland` gets Reykjavik, not the Abidjan it formally links to. A `zone.tab` name always
  keeps its own city.
- **Zones with no city stay out** — `UTC`, `Etc/*`, and the links to them. They, an unknown zone, and
  a missing one get night 19:00–07:00 on the device clock. A polar day or night (no crossing) is
  decided by the sun's elevation right now.
- **No `#`+hex text in the output** — `theme-tokens-only`'s `verify:` greps all of `src/` for colour
  literals, and `zone.tab`'s comments were the risk.

**Own NOAA port, no dependency.** [sun.ts](../../../src/lib/sun.ts) is NOAA's calculator code
(`gml.noaa.gov/grad/solcalc/main.js`) and matches it within 0.25 s; `suncalc` is a different
algorithm and ships no types. No native module, no `app.json` change.

**Hermes `Intl` was measured on both platforms, not assumed**, through
[metro-inspector-reads-live-app-state](metro-inspector-reads-live-app-state.md). It was measured on
SDK 54 (iPhone 17e iOS 26.5, `Pixel_10` Android 37), then again under SDK 57's Hermes V1 (iOS 27,
Android 37), with the same answers: `resolvedOptions().timeZone` gives the IANA name,
`timeStyle: 'short'` and `timeZone:` are honoured, legacy names are accepted, and an unknown zone
**throws**. The error was `JSRangeErrorException` on Android before Hermes V1 and is a plain
`RangeError` on both platforms now. `clockTime` uses a bare `catch`, so keep it that broad. **On Android, `Date`'s local offset
lags a zone change by minutes while `Intl` follows at once.** That is why the sun path works in UTC
instants and formats with an explicit `timeZone`; only the no-city fallback reads `Date`'s local
fields. Keep it that way — the `verify:` fails on a local-field getter in `sun.ts`.

**Known gap:** a transition that passes while the app is closed can put the other sky's colour on
the next cold start's root view — [theme-reaches-native-surfaces](theme-reaches-native-surfaces.md).
