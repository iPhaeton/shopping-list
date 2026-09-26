import { describeNextChange, resolveTheme, type ResolvedTheme } from './resolveTheme';

const TOLERANCE_MS = 10 * 60_000;

function expectNear(actual: Date | undefined, expected: string) {
  expect(actual).toBeDefined();
  expect(Math.abs(actual!.getTime() - Date.parse(expected))).toBeLessThanOrEqual(TOLERANCE_MS);
}

it('passes a fixed choice straight through, with nothing to wait for', () => {
  const noon = new Date('2026-06-21T12:00:00+02:00');
  const midnight = new Date('2026-06-21T00:00:00+02:00');

  expect(resolveTheme('night', noon, 'Europe/Warsaw')).toEqual({
    name: 'night',
    next: null,
    timeZone: null,
  });
  expect(resolveTheme('day', midnight, 'Europe/Warsaw')).toEqual({
    name: 'day',
    next: null,
    timeZone: null,
  });
});

describe('Auto, where the zone has a city', () => {
  // Reference sunrises and sunsets: NOAA's calculator, as in `src/lib/sun.test.ts`.

  it('is day at noon in Warsaw, until sunset', () => {
    const resolved = resolveTheme('auto', new Date('2026-06-21T12:00:00+02:00'), 'Europe/Warsaw');

    expect(resolved.name).toBe('day');
    expect(resolved.next?.name).toBe('night');
    expectNear(resolved.next?.at, '2026-06-21T21:01:19+02:00');
    expect(resolved.timeZone).toBe('Europe/Warsaw');
  });

  it('is night after sunset in Warsaw, until the next morning', () => {
    const resolved = resolveTheme('auto', new Date('2026-06-21T23:30:00+02:00'), 'Europe/Warsaw');

    expect(resolved.name).toBe('night');
    expect(resolved.next?.name).toBe('day');
    expectNear(resolved.next?.at, '2026-06-22T04:14:30+02:00');
  });

  it('is night in the small hours, before that morning’s sunrise', () => {
    const resolved = resolveTheme('auto', new Date('2026-12-21T03:00:00+01:00'), 'Europe/Warsaw');

    expect(resolved.name).toBe('night');
    expectNear(resolved.next?.at, '2026-12-21T07:43:04+01:00');
  });

  it('switches at the very instant it promised', () => {
    const noon = resolveTheme('auto', new Date('2026-12-21T12:00:00+01:00'), 'Europe/Warsaw');
    const sunset = noon.next!.at;

    expect(resolveTheme('auto', new Date(sunset.getTime() - 1), 'Europe/Warsaw').name).toBe('day');
    expect(resolveTheme('auto', sunset, 'Europe/Warsaw').name).toBe('night');
  });

  it('follows the southern summer in Sydney', () => {
    const evening = resolveTheme('auto', new Date('2026-12-21T19:00:00+11:00'), 'Australia/Sydney');
    const lateEvening = resolveTheme('auto', new Date('2026-12-21T21:00:00+11:00'), 'Australia/Sydney');

    expect(evening.name).toBe('day');
    expectNear(evening.next?.at, '2026-12-21T20:05:23+11:00');
    expect(lateEvening.name).toBe('night');
  });

  it('is night by late afternoon in a Sydney June', () => {
    const resolved = resolveTheme('auto', new Date('2026-06-21T17:30:00+10:00'), 'Australia/Sydney');

    expect(resolved.name).toBe('night');
    expect(resolved.next?.name).toBe('day');
  });

  it.each(['00:00', '06:00', '12:00', '18:00', '23:59'])(
    'is day all day in a Longyearbyen June, at %s',
    (time) => {
      const now = new Date(`2026-06-21T${time}:00+02:00`);

      expect(resolveTheme('auto', now, 'Arctic/Longyearbyen')).toEqual({
        name: 'day',
        next: null,
        timeZone: 'Arctic/Longyearbyen',
      });
    }
  );

  it.each(['00:00', '06:00', '12:00', '18:00', '23:59'])(
    'is night all day in a Longyearbyen December, at %s',
    (time) => {
      const now = new Date(`2026-12-21T${time}:00+01:00`);

      expect(resolveTheme('auto', now, 'Arctic/Longyearbyen')).toEqual({
        name: 'night',
        next: null,
        timeZone: 'Arctic/Longyearbyen',
      });
    }
  );

  it('reads a legacy zone name as the zone it became', () => {
    const now = new Date('2026-06-21T12:00:00+05:30');

    const legacy = resolveTheme('auto', now, 'Asia/Calcutta');
    const current = resolveTheme('auto', now, 'Asia/Kolkata');

    expect(legacy.name).toBe(current.name);
    expect(legacy.next).toEqual(current.next);
  });

  it('keeps a zone’s own city even where tzdata folds it into another', () => {
    // zone1970.tab would have put Oslo's sunset at Berlin's, over an hour early in June.
    const now = new Date('2026-06-21T12:00:00+02:00');

    const oslo = resolveTheme('auto', now, 'Europe/Oslo').next!.at.getTime();
    const berlin = resolveTheme('auto', now, 'Europe/Berlin').next!.at.getTime();

    expect(oslo - berlin).toBeGreaterThan(60 * 60_000);
  });
});

describe('Auto, where the zone has no city', () => {
  // Built from local fields, so these hold in whatever zone the test process runs in.
  const localAt = (day: number, hour: number, minute = 0) => new Date(2026, 5, day, hour, minute);

  it.each([null, 'UTC', 'Etc/UTC', 'Etc/GMT+3', 'Mars/Olympus_Mons'])(
    'runs night from 19:00 to 07:00 on the device clock, for %s',
    (zone) => {
      expect(resolveTheme('auto', localAt(21, 6, 59), zone)).toEqual({
        name: 'night',
        next: { name: 'day', at: localAt(21, 7) },
        timeZone: null,
      });
      expect(resolveTheme('auto', localAt(21, 7), zone)).toEqual({
        name: 'day',
        next: { name: 'night', at: localAt(21, 19) },
        timeZone: null,
      });
      expect(resolveTheme('auto', localAt(21, 19), zone)).toEqual({
        name: 'night',
        next: { name: 'day', at: localAt(22, 7) },
        timeZone: null,
      });
    }
  );
});

describe('the hint under the picker', () => {
  const warsaw = (next: ResolvedTheme['next'], name: ResolvedTheme['name']): ResolvedTheme => ({
    name,
    next,
    timeZone: 'Europe/Warsaw',
  });

  it('names the next change in the zone’s local time, in the clock format of the locale', () => {
    const toNight = warsaw({ name: 'night', at: new Date('2026-06-21T21:01:19+02:00') }, 'day');
    const toDay = warsaw({ name: 'day', at: new Date('2026-12-22T06:48:00+01:00') }, 'night');

    expect(describeNextChange(toNight, 'en-GB')).toBe('Night from 21:01');
    expect(describeNextChange(toNight, 'en-US')).toMatch(/^Night from 9:01\sPM$/);
    expect(describeNextChange(toDay, 'en-GB')).toBe('Day from 06:48');
  });

  it('says so when no change comes within a day', () => {
    expect(describeNextChange(warsaw(null, 'day'), 'en-GB')).toBe('Day all day today');
    expect(describeNextChange(warsaw(null, 'night'), 'en-GB')).toBe('Night all day today');
  });

  it('uses the device clock for the fixed-hours fallback', () => {
    const resolved = resolveTheme('auto', new Date(2026, 5, 21, 12), 'UTC');

    expect(describeNextChange(resolved, 'en-GB')).toBe('Night from 19:00');
  });
});
