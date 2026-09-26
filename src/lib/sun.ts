/**
 * Sunrise, sunset, and the sun's height, from NOAA's solar calculator
 * (gml.noaa.gov/grad/solcalc — the same formulas as its "General Solar Position" spreadsheet).
 * Pure arithmetic on UTC instants, good to about a minute between the polar circles; that is far
 * finer than the time-zone city it is fed ([zoneCoords.ts](./zoneCoords.ts)) can be.
 *
 * Latitude is north-positive and longitude east-positive, in degrees.
 */

/** The sun's centre this far below the horizon is "sunrise"/"sunset": refraction plus its radius. */
export const HORIZON = -0.833;

const DAY_MS = 86_400_000;
const rad = (degrees: number) => (degrees * Math.PI) / 180;
const deg = (radians: number) => (radians * 180) / Math.PI;

/** Julian centuries since J2000.0. */
function julianCentury(ms: number) {
  return (ms / DAY_MS + 2440587.5 - 2451545) / 36525;
}

/** Declination (degrees) and the equation of time (minutes) at an instant. */
function solarPosition(ms: number) {
  const t = julianCentury(ms);
  const meanLongitude = (((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360) + 360) % 360;
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const m = rad(meanAnomaly);
  const centre =
    Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m) * 0.000289;
  const omega = rad(125.04 - 1934.136 * t);
  const apparentLongitude = meanLongitude + centre - 0.00569 - 0.00478 * Math.sin(omega);
  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = rad(meanObliquity + 0.00256 * Math.cos(omega));

  const declination = deg(Math.asin(Math.sin(obliquity) * Math.sin(rad(apparentLongitude))));

  const y = Math.tan(obliquity / 2) ** 2;
  const l0 = rad(meanLongitude);
  const equationOfTime =
    4 *
    deg(
      y * Math.sin(2 * l0) -
        2 * eccentricity * Math.sin(m) +
        4 * eccentricity * y * Math.sin(m) * Math.cos(2 * l0) -
        0.5 * y * y * Math.sin(4 * l0) -
        1.25 * eccentricity * eccentricity * Math.sin(2 * m)
    );

  return { declination, equationOfTime };
}

/**
 * Sunrise or sunset in minutes after the UTC midnight of the day being solved, from the sun's
 * position at `ms`; `null` when the sun does not cross the horizon.
 */
function crossing(rise: boolean, ms: number, latitude: number, longitude: number) {
  const { declination, equationOfTime } = solarPosition(ms);
  const lat = rad(latitude);
  const dec = rad(declination);
  const cosHourAngle =
    Math.cos(rad(90 - HORIZON)) / (Math.cos(lat) * Math.cos(dec)) - Math.tan(lat) * Math.tan(dec);
  if (cosHourAngle < -1 || cosHourAngle > 1) return null;

  const hourAngle = deg(Math.acos(cosHourAngle));
  return 720 - 4 * (longitude + (rise ? hourAngle : -hourAngle)) - equationOfTime;
}

/**
 * The sunrise and sunset of the solar day centred on `day`'s UTC date — either may fall on the UTC
 * day before or after, far from Greenwich. `null` where it does not happen: both, through a polar
 * day or night. Like NOAA's calculator: a first estimate from the sun's position at UTC midnight,
 * refined once from its position at the estimate.
 */
export function sunEvents(
  day: Date,
  latitude: number,
  longitude: number
): { rise: Date | null; set: Date | null } {
  const dayStart = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());

  const event = (rise: boolean) => {
    const estimate = crossing(rise, dayStart, latitude, longitude);
    if (estimate === null) return null;
    const refined = crossing(rise, dayStart + estimate * 60_000, latitude, longitude);
    return refined === null ? null : new Date(dayStart + Math.round(refined * 60_000));
  };

  return { rise: event(true), set: event(false) };
}

/** The sun's centre above (+) or below (−) the horizon at `at`, in degrees, before refraction. */
export function sunElevation(at: Date, latitude: number, longitude: number): number {
  const ms = at.getTime();
  const { declination, equationOfTime } = solarPosition(ms);
  const utcMinutes = (((ms % DAY_MS) + DAY_MS) % DAY_MS) / 60_000;
  const hourAngle = rad((utcMinutes + equationOfTime + 4 * longitude) / 4 - 180);
  const lat = rad(latitude);
  const dec = rad(declination);
  const cosZenith =
    Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle);
  return 90 - deg(Math.acos(Math.min(1, Math.max(-1, cosZenith))));
}
