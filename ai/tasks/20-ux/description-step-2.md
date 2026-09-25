# Step 2 — Auto: night from sunset to sunrise

Task plan, phone-first rules, design images, and palette: `description-step-1.md`. Step 1 left a per-device
`'day' | 'night'` preference and a Day/Night picker on `AccountScreen`.

Add a third choice, **Auto**. It resolves to Moonlit from local sunset until the next sunrise, and to
Quiet Horizon otherwise. Auto becomes the default for anyone who never chose. A stored `'day'` or
`'night'` from step 1 is kept.

## Where sunset comes from: the time zone, not location (decided)

1. Read the device's IANA zone with `Intl.DateTimeFormat().resolvedOptions().timeZone`.
2. Look it up in a bundled `zone → [lat, lon]` table built from the tz database's `zone.tab`. Use
   `zone.tab`, not `zone1970.tab`: the latter folds zones together (e.g. `Europe/Oslo` into
   `Europe/Berlin`). Resolve legacy names through the tz `backward` file (`Asia/Calcutta` →
   `Asia/Kolkata`).
3. Compute that date's sunrise and sunset with the NOAA solar-position algorithm, in pure JS: a
   small dependency such as `suncalc`, or your own. Add no native module.

**Why not the device's location:** it would mean a permission prompt for a cosmetic feature, and a
new data type in the App Privacy answers that `ai/suggestions/app-store-release.md` plans to declare.
It would also need this same fallback anyway, for a denied permission and for web. The time-zone
route works offline, on web, and synchronously at cold start.

**Accepted cost:** the switch can miss true sunset by tens of minutes, and by more in very wide zones
(all of China is `Asia/Shanghai`). Do not add a location fallback to close that gap; if precision is
wanted, it will be its own step.

**Fallbacks:**

- A zone missing from the table, an `Etc/*` zone, `UTC`, or no zone from `Intl` → night from 19:00 to
  07:00 local. Check what Hermes returns on the iOS simulator, not only on web.
- Polar day or polar night (no sunrise or sunset that date) → decide by whether the sun is above the
  horizon right now.

## Behavior

- The resolved theme is a pure function of (preference, now, zone). Test it that way, with the clock
  injected.
- While the app is open, it switches at the transition. Use a timer to the next sunrise/sunset, plus
  a fresh evaluation whenever `AppState` turns `active`. JS timers don't run in the background, and
  the zone may have changed on a trip. `AppState` is also what react-native-web maps to page
  visibility.
- A switch mid-session follows step 1's rule: no remount, nothing lost. A short cross-fade is
  welcome but not required.
- The picker gains `Auto` as a third option. While Auto is selected, a line under the picker says
  when the next change happens, in the device's clock format, e.g. "Night from 19:12" / "Day from
  06:48". It makes the approximation visible, and gives tests something to assert.

## Constraints

- No new native module, no permission, and no `app.json` change.
- Time-dependent tests use jest fake timers or an injected clock, never the real time of day.

## Done when

- Unit tests pin sunrise and sunset within ±10 minutes of NOAA's calculator for that zone's city.
  Cover Europe/Warsaw at both solstices, one southern-hemisphere zone, and
  `Arctic/Longyearbyen` in June (all-day day) and December (all-day night).
- One test drives an open app across sunset with fake timers and sees the palette flip. Another
  covers the re-evaluation on returning to the foreground.
- On the iPhone 17e simulator, Auto shows Moonlit after sunset and Quiet Horizon after sunrise, and
  the Account hint names the right next change. Check it on the phone, not web: Hermes's `Intl`
  zone is the real risk there. To reach a transition, use a `__DEV__`-only clock override or the
  simulator's time zone, and say which in the log. Web only has to not break.
- `npm test`, `npm run typecheck`, and `npm run kb:audit` pass.
