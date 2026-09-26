# Implementation log — task 20, step 2: Auto, night from sunset to sunrise

**Date:** 2026-09-26. Description: [description-step-2.md](description-step-2.md).

## What changed

**`scripts/build-zone-coords.mjs` → `src/lib/zoneCoords.ts` (generated, checked in).** Flat
`ZONE_COORDS: Record<zone, [lat, lon]>`, 2-decimal degrees, north/east positive. Built from IANA
**tzdata 2026c** — the same release as this Mac's `/usr/share/zoneinfo/+VERSION`. The Mac ships
`zone.tab` (identical to the release's) but no `backward`, so the release tarball is the input:

```bash
curl -sSfLO https://data.iana.org/time-zones/releases/tzdata2026c.tar.gz
mkdir tzdata && tar xzf tzdata2026c.tar.gz -C tzdata
node scripts/build-zone-coords.mjs tzdata
```

418 zones from `zone.tab` + 135 legacy names from `backward` = 553 keys, ~21 KB of source. Rules:
- A `zone.tab` name always keeps its own city, even where `backward` links it elsewhere
  (`Link Europe/Berlin Europe/Oslo` is ignored for Oslo).
- A `backward` line `Link TARGET NAME #= BETTER` is resolved through `BETTER` first. `#=` names the
  target the link would have if old parsers could follow links to links, and it is the nearer city:
  `Iceland` gets Reykjavik, not the Abidjan it formally links to. The same applies to
  `Australia/ACT` → Canberra's target and others. Chains are resolved iteratively.
- The 15 links whose target has no city are left out: `UTC`, `Etc/UTC`, `Etc/Universal`, `GMT0`,
  `Zulu`, and the like. `Etc/GMT±N` zones are not in either file. All of these hit the fallback.
- The output contains no `#`+hex text. `theme-tokens-only`'s `verify:` greps `src/` for color
  literals, and zone.tab comments were the risk.

**`src/lib/sun.ts`** is a port of NOAA's calculator code (`gml.noaa.gov/grad/solcalc/main.js`:
`calcSunriseSetUTC`, `calcSunriseSet`, `calcAzEl`), in UTC instants.
- `sunEvents(day, lat, lon) → { rise: Date | null, set: Date | null }` covers the solar day centred
  on `day`'s UTC date. As in NOAA's code, the first estimate uses the sun's position at 0h UTC and
  is refined once at the estimate. An event is `null` when the hour-angle cosine leaves [−1, 1].
- `sunElevation(at, lat, lon)` is the geometric elevation, with no refraction.
- `HORIZON = −0.833°`.
- It matches NOAA's own code **within 0.25 s** at all four reference city-dates. NOAA's `main.js`
  was run in Node, sliced to its calculation functions (lines 60–446).

**`src/lib/deviceTimeZone.ts`**: `Intl.DateTimeFormat().resolvedOptions().timeZone || null`, in a
try/catch. It is a module of its own so suites can `jest.mock` it.

**`src/state/resolveTheme.ts`** holds the pure `resolveTheme(preference, now, zone) → { name, next:
{ name, at } | null, timeZone }`.
- A fixed preference passes through with `next: null` and `timeZone: null`.
- Auto with coordinates:
  - collects rise/set for UTC days D−1…D+2 and sorts them
  - `name` comes from the last crossing ≤ now: a rise means day, a set means night
  - with no crossing in the window (polar), `name` is `sunElevation(now) > HORIZON`
  - `next` is the first crossing > now whose name differs and which falls within 24 h, else `null`
  - `timeZone` is the zone
- Auto without coordinates runs 19:00–07:00 on the **device clock** (`new Date(y, m, d, h)`), with
  `timeZone: null`.
- `describeNextChange(resolved, locale?)` returns `"<Night|Day> from <time>"`, or `"<Day|Night> all
  day today"` when `next` is null. It formats with `Intl.DateTimeFormat(locale, { timeStyle:
  'short', timeZone })`, where `timeZone` is the zone the time was computed for; the fallback path
  omits it and formats in device-local time. An unknown zone falls back to no `timeZone` option.

**`src/lib/themePreference.ts`**: `ThemePreference = ThemeName | 'auto'`, `DEFAULT = 'auto'`,
`isPreference` guard. **The stored format stays `v: 1`.** A bump would have discarded step 1's stored
`'day'`/`'night'`, which the description says to keep; an older build reading `'auto'` falls back
to its own default.

**`src/state/ThemeContext.tsx` (`ThemeProvider`):**
- `clock` state `{ now, zone }` read by `readClock()`; `reevaluate()` re-reads it.
- `resolved = useMemo(resolveTheme(preference ?? 'day', clock.now, clock.zone))`.
- A timer effect, active only under Auto: `setTimeout(reevaluate, min(max(next.at − Date.now(), 0),
  RECHECK_MS = 1 h))`, or `RECHECK_MS` when `next` is null. The effect is keyed on `[preference,
  clock, nextAt, reevaluate]`: `clock` is what re-arms after an hourly re-check that found nothing
  new. The cap also covers polar days, a wall clock moved under a running timer, and `setTimeout`'s
  2³¹ ms overflow.
- An `AppState` `'change'` → `'active'` listener, only under Auto, calls `reevaluate()`.
  react-native-web maps `AppState` to page visibility.
- `setPreference` also calls `reevaluate()`, so switching to Auto after hours on a fixed theme
  doesn't resolve against a stale `now`.
- The context value gains `nextChange: string | null` (the hint text, Auto only). `preference` now
  reports the real preference; step 1 reported `name`. The value memo is keyed on
  `name, scheme, colors, preference, nextChange, setPreference`, so an hourly re-check that changes
  nothing re-renders no consumer.
- **The context default is unchanged**: day palette, `preference: 'day'`, `nextChange: null`. That
  keeps every provider-less suite independent of the time of day.
- The gate is unchanged: Auto resolves synchronously, so it adds no wait.

**`src/screens/AccountScreen.tsx`**: `APPEARANCES` gains `{ value: 'auto', title: 'Auto' }` as the
third segment (order Day | Night | Auto). Under Auto, a `Text` sits inside the Appearance card under
the picker row: right-aligned, `fonts.sans` 14, `textMuted`, `marginTop: −spacing.sm`. On the 17e
the three segments fit beside the "Appearance" label.

**`.maestro/flows/set-theme.yaml`**: comment only. `THEME=Auto` works as-is. `shoot-all.sh` still
sets Day explicitly before its tours, so the new default does not reach its screenshots.

## Decisions not dictated by the description

- **Own NOAA port, no dependency.** `suncalc` is not NOAA's algorithm and ships no types, and the
  math is ~100 lines. No native module, no permission, no `app.json` change.
- **`timeStyle: 'short'`, not `hour: 'numeric'`.** The latter gave `Day from 6:48` in en-GB. The
  locale's own short time gives `06:48` in en-GB/pl/de and `6:48 AM` in en-US, matching the
  description's examples.
- **Polar copy:** `Day all day today` / `Night all day today` when no switch falls within 24 h.
- **The hint lives in the context as a string**, not as `next` + zone. A string keeps the memo
  stable and keeps formatting next to the resolution that decided the zone.
- **The hint formats in the zone the time was computed for.** On a device that zone equals
  device-local. In tests it makes the output independent of the process `TZ`.
- **No cross-fade.** It was optional; a switch is a context-value change as in step 1.

## Hermes `Intl`, measured through Metro's inspector (not assumed)

A Node 24 script (`fetch` Metro's `/json/list`, then `Runtime.evaluate` over the page's
`webSocketDebuggerUrl` with the global `WebSocket`) evaluated expressions in the running app:

| | iPhone 17e (iOS 26.5) | Pixel_10 (Android 37) |
|---|---|---|
| `resolvedOptions().timeZone`, no override | `Europe/Warsaw` | `Europe/Warsaw` |
| `resolvedOptions().locale` | `en-US` | `en-US` |
| `timeStyle: 'short'` | `9:01 PM` | `9:01 PM` |
| `timeZone: 'Asia/Calcutta'` (legacy) | accepted | accepted |
| `timeZone: 'Mars/Olympus_Mons'` | throws `RangeError` | throws `JSRangeErrorException` |

Both throws are caught in `clockTime`. On Android, after the device zone moved to
`America/Los_Angeles`, `Intl` reported the new zone at once, but `new Date().toString()` still said
`GMT+0200` about 30 s later; it had caught up (`GMT-0700`) a few minutes later. Only the
fixed-hours fallback reads `Date`'s local fields. The sun path uses UTC instants and an explicit
`timeZone`, so this lag does not reach it.

**Reading live React state on a device.** The same channel reads `ThemeProvider`'s `clock` state out
of the fiber tree: walk `__REACT_DEVTOOLS_GLOBAL_HOOK__.getFiberRoots(id)` for
`type.name === 'ThemeProvider'` and scan `memoizedState` for `{ zone, now }`. That gives the exact
instant of the last re-evaluation and the zone it read, which screenshots cannot. Filter
`/json/list` by `title` (`… (iPhone 17e)` vs `… (sdk_gphone16k_arm64)`) when both devices are
attached.

## Verification on the phone

**Route to a transition: the simulator's time zone, per launch — no `__DEV__` clock override, no
code for it.** `xcrun simctl terminate booted com.shoppingloop.app; SIMCTL_CHILD_TZ=<zone> xcrun simctl
launch booted com.shoppingloop.app`, then `xcrun simctl openurl booted
"exp+shopping-list://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081"`. `SIMCTL_CHILD_*`
env reaches the app process; Hermes's `Intl` and `Date` both follow `TZ`, as the inspector confirmed
(`Pacific/Fiji`, `GMT+1200`). A throwaway jest file ran `resolveTheme` over every table zone to pick
one whose sunset or sunrise was 5–15 minutes away. The first `openurl` after a fresh boot timed out
(`NSPOSIXErrorDomain 60`), but the app loaded anyway about 48 s later.

iPhone 17e, signed in as `maya@example.com`, whose stored Night from step 1 was still in force (kept,
as required):

1. **No override (Warsaw, 07:48 CEST):** picked Auto → Quiet Horizon, hint `Night from 6:25 PM`
   (resolver: 18:25:19). → `account-auto-day-warsaw.png`
2. **Live sunset, `Pacific/Fiji`:** launched at 17:49 FJT, Account showed `Night from 6:02 PM` with
   the name editor open. The inspector shows the provider re-checked at **06:02:54.723Z, 7 ms after
   the computed sunset (06:02:54.716Z)**. At 06:03:11 it was Moonlit with `Day from 5:52 AM`, and
   the name editor was still open. A remount would have reset `editingName`, so the open editor
   shows the switch remounted nothing. (Maestro's `inputText " draft"` into that field did not
   land, so no draft was shown there; the next run typed one.) →
   `account-auto-before-sunset-fiji.png`, `account-auto-after-sunset-fiji.png`
3. **Live sunrise, `Europe/Dublin`:** launched at 07:07 IST: Moonlit, Account `Day from 7:17 AM`.
   On Lists, `Sunrise draft` was typed into "New list name" with the keyboard up. The provider
   re-checked at **06:17:39.360Z, 5 ms after the computed sunrise (06:17:39.355Z)**. At 06:17:52 it
   was Quiet Horizon, **with the draft and the focus kept, the keyboard switched live from dark to
   light, and the status-bar icons dark**. Account then read `Night from 7:13 PM`. →
   `account-auto-night-dublin.png`, `lists-auto-draft-before-sunrise-dublin.png`,
   `lists-auto-just-before-sunrise-dublin.png`, `lists-auto-just-after-sunrise-dublin.png`,
   `account-auto-day-dublin.png`

Status bar clock reads 9:41 throughout: the step-1 `simctl status_bar` override was still in place.
It does not reflect the real or the overridden time.

**Android `Pixel_10`** (a `google_apis_playstore` image, so no `adb root`). Metro was shared via
`adb reverse tcp:8081 tcp:8081`, and the freshly booted emulator's "System UI isn't responding"
needed Wait.
- Auto was picked from a stored Day: Quiet Horizon, `Night from 6:25 PM`.
- **The trip:** Home, then change the zone, then resume. `cmd time_zone_detector
  suggest_manual_time_zone` is refused (shell lacks `SUGGEST_MANUAL_TIME_AND_ZONE`). This worked:
  `adb shell cmd time_zone_detector set_time_zone_state_for_tests --zone_id <zone>
  --user_should_confirm_id false`, which sets `persist.sys.timezone`.
- Los Angeles: Moonlit, `Day from 6:44 AM`. Tokyo: Quiet Horizon, `Night from 5:32 PM`.
- **A false alarm, recorded so nobody chases it:** screenshots taken 2–3 s after resume twice
  showed the *previous* zone's state. The inspector probe showed the provider re-checked once,
  **~3 s after `am start`, reading the new zone correctly**; the screenshots simply came before the
  re-render on a loaded emulator (an inspector call timed out in that same window). There is no
  stale-zone read.
- Restored afterwards: zone `Europe/Warsaw`, `set_auto_detection_enabled true`.

**iPhone 17 Pro Max:** the same DerivedData `.app`, no override. Its first launch after boot showed
the dev client's developer-menu explainer; Maestro's "Continue" tap opened the dev menu itself,
which was closed by tapping its ✕ at `point: "89%,47%"`. Picking Auto gave Quiet Horizon and
`Night from 6:25 PM`, with the three segments on one row. → `account-auto-day-warsaw-17-pro-max.png`

**Web (Playwright MCP, 390×844, local stack, signed-in session).**
- The stored `{"v":1,"preference":"day"}` from step 1 was kept, and the picker shows Day, Night,
  Auto.
- Choosing Auto stores `{"v":1,"preference":"auto"}`, shows `Night from 6:25 PM`, and paints the
  day sky `rgb(222,230,240)`. It survives a reload.
- No errors; the two console warnings (google-signin on web, `pointerEvents`) predate this step.

## Tests

`npm test`: **26 suites / 472 tests** (was 24 / 426). `npm run typecheck`: clean. `npm run kb:audit`:
0 errors (warnings are "ground moved" only).

- **New:** `src/lib/sun.test.ts` (7) pins each case within ±10 min of NOAA's own code at the
  zone's `zone.tab` city:
  - Warsaw, both solstices: 04:14:18 / 21:01:19 CEST and 07:43:04 / 15:25:01 CET
  - Sydney, both solstices: 06:59:55 / 16:53:47 AEST and 05:40:36 / 20:05:23 AEDT
  - Longyearbyen, June: no events and the sun above the horizon at noon and at midnight
  - Longyearbyen, December: no events and the sun below the horizon at noon
  - NOAA's noon elevation for Warsaw
- **New:** `src/state/resolveTheme.test.ts` (27):
  - fixed pass-through
  - Warsaw day/night/small hours, with `next` within ±10 min of NOAA
  - the flip exactly at `next.at` (1 ms before is still day)
  - Sydney in both seasons
  - Longyearbyen at five hours each in June and December, with `next: null`
  - `Asia/Calcutta` ≡ `Asia/Kolkata`; Oslo's sunset over an hour after Berlin's
  - the 19:00/07:00 fallback for `null`, `UTC`, `Etc/UTC`, `Etc/GMT+3`, and an unknown zone
  - `describeNextChange` in en-GB/en-US, the polar copy, and fallback formatting
- **`src/state/ThemeContext.test.tsx`** now runs every test on `jest.useFakeTimers({ now: Warsaw
  noon })` with `deviceTimeZone` mocked. `AppState.addEventListener` is spied to capture listeners
  (`jest.restoreAllMocks` is in its `beforeEach`, so the spy is re-made each test).
  - "starts in day" became "starts in Auto", and "falls back to day" became "falls back to Auto".
  - New: Auto at night, a stored Day kept at 23:30, and the **open app across sunset and back at
    sunrise**. The draft and the mount count are intact, and `Appearance.setColorScheme` goes
    `'dark'` then `'light'`.
  - New: **foreground re-check**. After `setSystemTime` past sunset it stays day until the listener
    fires `'active'`. The variant has the zone mock change to `Australia/Sydney` before the
    foreground event.
  - The clock advances through `letTimePass`, in 10-minute `act` steps. A timer armed in an effect
    is registered only when `act` flushes, so one long `advanceTimersByTime` would run past the
    re-armed timer.
- **`src/screens/AccountScreen.test.tsx`**, appearance `describe` (fake clock and mocked zone added
  there only):
  - "Day checked by default" became "Auto checked by default"
  - new: the hint `/^Night from \d/` at noon
  - new: night palette plus `/^Day from \d/` at 23:30
  - new: the hint hidden under Day and back under Auto
  - the stored-Night test also asserts no hint
- **`src/lib/themePreference.test.ts`**: defaults and fallbacks now `'auto'`; `auto`/`day`/`night`
  round-trip; a v1 `'day'`/`'night'` is kept.
- **Mutation-checked:**
  - the timer callback made a no-op → the sunset test fails
  - `clock` dropped from the timer deps → the sunset test fails at the sunrise half (the hourly cap
    fires and never re-arms)
  - the `'active'` check broken → both foreground tests fail
- **Time-zone and locale independence:** the five theme suites pass under `TZ` =
  `Pacific/Auckland`, `America/Los_Angeles`, `UTC`, and `Asia/Kolkata`, with `LANG=pl_PL.UTF-8`.

## Accepted gaps / flagged for the user

- **Cold start after a transition that happened while the app was closed** can show the *other*
  sky's colour on the empty root view for the moment before the gate opens.
  `expo-system-ui`'s `setBackgroundColorAsync` persists the last session's colour and restores it
  before JS runs (step 1). Native code cannot know the sunset. No content is painted in the wrong
  theme. Reasoned from step 1's measurement, not re-measured.
- The time-zone approximation itself (tens of minutes; more in `Asia/Shanghai`-wide zones) is
  accepted by the description. No location fallback.
- The hint uses `textMuted`, so step 1's flag applies: day `textMuted` is below AA on `surface`
  (4.07:1).

## For the librarian — candidate facts

1. **Auto theme** (decision): zone → `zone.tab` city (not `zone1970.tab`), then `backward`
   preferring `#=`, then NOAA, with the fallback 19:00–07:00. The table is generated: the
   regeneration command and tzdata version are above and in the file header. No location, because
   of the permission and the App Privacy answers.
2. **Time-dependent tests** (convention/gotcha): Auto is the default, so any suite that renders
   `ThemeProvider` without a stored choice depends on the time of day. It must fake the clock and
   mock `src/lib/deviceTimeZone`. Provider-less suites are safe because the context default stays
   fixed day. Advance faked time in `act` steps, because effect-armed timers only register after
   `act` flushes.
3. **Moving a device's time zone** (environment):
   - iOS simulator: `SIMCTL_CHILD_TZ=<zone> xcrun simctl launch …` then the dev-client `openurl`;
     Hermes `Intl` and `Date` follow.
   - Android emulator: `cmd time_zone_detector set_time_zone_state_for_tests --zone_id <zone>
     --user_should_confirm_id false` (`suggest_manual_time_zone` is refused); restore it afterwards.
4. **Reading live app state on a device** (environment): Metro `/json/list`, then
   `Runtime.evaluate`, then the React DevTools hook's fiber roots. It evaluates `Intl`, and reads
   provider state with a timestamp.
5. **Hermes `Intl` on both platforms** (reference): `timeStyle` and `timeZone` are supported,
   legacy names are accepted, and an unknown zone throws. On Android `Date`'s local offset lags a
   zone change by a while; `Intl` does not.
