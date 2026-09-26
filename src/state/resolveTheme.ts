import { HORIZON, sunElevation, sunEvents } from '../lib/sun';
import type { ThemePreference } from '../lib/themePreference';
import { ZONE_COORDS } from '../lib/zoneCoords';
import type { ThemeName } from '../theme';

export type ThemeChange = { name: ThemeName; at: Date };

export type ResolvedTheme = {
  /** The palette to paint now. */
  name: ThemeName;
  /** Auto's next switch, if one comes within a day. Always `null` for a fixed choice. */
  next: ThemeChange | null;
  /** The zone whose city's sun decided it; `null` for the fixed-hours fallback or a fixed choice. */
  timeZone: string | null;
};

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Where a zone has no city to take a sunset from, night runs by the clock. */
const NIGHT_FROM_HOUR = 19;
const DAY_FROM_HOUR = 7;

/**
 * What the app paints, as a pure function of what the person chose, the time, and the device's
 * zone — `ThemeProvider` supplies the last two and re-asks at every change and every foreground.
 *
 * Auto is night from local sunset until the next sunrise, at the zone's principal city: the zone,
 * not the device's location, because location would cost a permission prompt for a cosmetic
 * feature. The price is a switch that can miss the true sunset by tens of minutes, more in very
 * wide zones (all of China is `Asia/Shanghai`). A zone with no city — `UTC`, `Etc/*`, one missing
 * from the table, or none at all — gets 19:00–07:00 on the device clock.
 */
export function resolveTheme(
  preference: ThemePreference,
  now: Date,
  zone: string | null
): ResolvedTheme {
  if (preference !== 'auto') return { name: preference, next: null, timeZone: null };

  const coords = zone ? ZONE_COORDS[zone] : undefined;
  return coords && zone ? bySun(now, coords, zone) : byClock(now);
}

function bySun(now: Date, [latitude, longitude]: readonly [number, number], zone: string) {
  // Four solar days around now, so both the last crossing and the next are in hand wherever the
  // zone sits relative to Greenwich.
  const crossings: ThemeChange[] = [];
  for (let offset = -1; offset <= 2; offset += 1) {
    const { rise, set } = sunEvents(new Date(now.getTime() + offset * DAY_MS), latitude, longitude);
    if (rise) crossings.push({ name: 'day', at: rise });
    if (set) crossings.push({ name: 'night', at: set });
  }
  crossings.sort((a, b) => a.at.getTime() - b.at.getTime());

  const last = crossings.filter((crossing) => crossing.at <= now).pop();
  // No crossing lately: a polar day or night, so the sun's height right now decides.
  const name: ThemeName = last
    ? last.name
    : sunElevation(now, latitude, longitude) > HORIZON
      ? 'day'
      : 'night';

  const next =
    crossings.find(
      (crossing) =>
        crossing.at > now &&
        crossing.name !== name &&
        crossing.at.getTime() - now.getTime() <= DAY_MS
    ) ?? null;

  return { name, next, timeZone: zone };
}

function byClock(now: Date): ResolvedTheme {
  const at = (dayOffset: number, hour: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour);

  if (now < at(0, DAY_FROM_HOUR)) {
    return { name: 'night', next: { name: 'day', at: at(0, DAY_FROM_HOUR) }, timeZone: null };
  }
  if (now < at(0, NIGHT_FROM_HOUR)) {
    return { name: 'day', next: { name: 'night', at: at(0, NIGHT_FROM_HOUR) }, timeZone: null };
  }
  return { name: 'night', next: { name: 'day', at: at(1, DAY_FROM_HOUR) }, timeZone: null };
}

const TITLES: Record<ThemeName, string> = { day: 'Day', night: 'Night' };

/**
 * The line under the Appearance picker while Auto is on: `Night from 19:12`, `Day from 06:48`, in
 * the device's clock format. With no switch within a day (a polar summer or winter), `Day all day
 * today`. Formatted in the zone the time was worked out for — the device's own, in the app —
 * and `locale` is only for tests: the app passes none and gets the device's.
 */
export function describeNextChange(resolved: ResolvedTheme, locale?: string): string {
  const { name, next, timeZone } = resolved;
  if (!next) return `${TITLES[name]} all day today`;
  return `${TITLES[next.name]} from ${clockTime(next.at, timeZone, locale)}`;
}

function clockTime(at: Date, timeZone: string | null, locale: string | undefined) {
  // The locale's own short time — `06:48` in Poland, `6:48 AM` in the US — not a pattern of ours.
  const options: Intl.DateTimeFormatOptions = { timeStyle: 'short' };
  if (timeZone) {
    try {
      return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(at);
    } catch {
      // A zone this `Intl` does not know: the device clock is the same zone anyway.
    }
  }
  return new Intl.DateTimeFormat(locale, options).format(at);
}
