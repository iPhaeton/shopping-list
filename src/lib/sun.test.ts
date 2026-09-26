import { HORIZON, sunElevation, sunEvents } from './sun';
import { ZONE_COORDS } from './zoneCoords';

/**
 * Reference times are NOAA's own: its calculator's code (gml.noaa.gov/grad/solcalc/main.js,
 * `calcSunriseSet`) run for each zone's `zone.tab` city, as local time on that date. The tolerance
 * is the one the feature needs, not the one this code achieves.
 */
const TOLERANCE_MS = 10 * 60_000;

function expectNear(actual: Date | null, expected: string) {
  expect(actual).not.toBeNull();
  expect(Math.abs(actual!.getTime() - Date.parse(expected))).toBeLessThanOrEqual(TOLERANCE_MS);
}

/** The solar day NOAA would compute for this calendar date at this zone's city. */
function eventsOn(zone: string, date: string) {
  const [latitude, longitude] = ZONE_COORDS[zone];
  return sunEvents(new Date(`${date}T12:00:00Z`), latitude, longitude);
}

function elevationAt(zone: string, instant: string) {
  const [latitude, longitude] = ZONE_COORDS[zone];
  return sunElevation(new Date(instant), latitude, longitude);
}

describe('Europe/Warsaw', () => {
  it('rises and sets at the June solstice as NOAA says', () => {
    const { rise, set } = eventsOn('Europe/Warsaw', '2026-06-21');

    expectNear(rise, '2026-06-21T04:14:18+02:00');
    expectNear(set, '2026-06-21T21:01:19+02:00');
  });

  it('rises and sets at the December solstice as NOAA says', () => {
    const { rise, set } = eventsOn('Europe/Warsaw', '2026-12-21');

    expectNear(rise, '2026-12-21T07:43:04+01:00');
    expectNear(set, '2026-12-21T15:25:01+01:00');
  });
});

describe('Australia/Sydney, south of the equator', () => {
  // Far east of Greenwich, the local morning is the previous UTC evening.
  it('has its short day in June', () => {
    const { rise, set } = eventsOn('Australia/Sydney', '2026-06-21');

    expectNear(rise, '2026-06-21T06:59:55+10:00');
    expectNear(set, '2026-06-21T16:53:47+10:00');
  });

  it('has its long day in December', () => {
    const { rise, set } = eventsOn('Australia/Sydney', '2026-12-21');

    expectNear(rise, '2026-12-21T05:40:36+11:00');
    expectNear(set, '2026-12-21T20:05:23+11:00');
  });
});

describe('Arctic/Longyearbyen, past the polar circle', () => {
  it('has neither sunrise nor sunset in June, and the sun stays up — even at midnight', () => {
    expect(eventsOn('Arctic/Longyearbyen', '2026-06-21')).toEqual({ rise: null, set: null });
    expect(elevationAt('Arctic/Longyearbyen', '2026-06-21T12:00:00+02:00')).toBeGreaterThan(HORIZON);
    expect(elevationAt('Arctic/Longyearbyen', '2026-06-21T00:00:00+02:00')).toBeGreaterThan(HORIZON);
  });

  it('has neither sunrise nor sunset in December, and the sun stays down — even at noon', () => {
    expect(eventsOn('Arctic/Longyearbyen', '2026-12-21')).toEqual({ rise: null, set: null });
    expect(elevationAt('Arctic/Longyearbyen', '2026-12-21T12:00:00+01:00')).toBeLessThan(HORIZON);
  });
});

it('puts the sun where NOAA does at noon', () => {
  // NOAA's `calcAzEl` gives 60.30° and 14.16° with refraction; refraction adds under 0.1° up there.
  expect(elevationAt('Europe/Warsaw', '2026-06-21T12:00:00+02:00')).toBeCloseTo(60.3, 0);
  expect(elevationAt('Europe/Warsaw', '2026-12-21T12:00:00+01:00')).toBeCloseTo(14.1, 0);
});
