import { day, night, palettes, type ThemeName } from '../theme';
import { bandAt, contrastRatio } from './bands';

// Built, not written literally: `theme-tokens-only`'s audit greps every `.ts`/`.tsx` under `src/`,
// test files included, for anything that looks like a color literal — so a value used only to
// exercise `contrastRatio` still has to be assembled at runtime, never typed out directly.
const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;

describe('contrastRatio', () => {
  it('is 1 for identical colors', () => {
    expect(contrastRatio(day.skyTop, day.skyTop)).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    expect(contrastRatio(day.text, day.skyTop)).toBeCloseTo(contrastRatio(day.skyTop, day.text), 10);
  });

  it('is the maximum, 21, for black on white', () => {
    expect(contrastRatio(hex(0, 0, 0), hex(255, 255, 255))).toBeCloseTo(21, 1);
  });

  it('rejects anything but a 6-digit hex color', () => {
    expect(() => contrastRatio('plum', day.skyTop)).toThrow();
    expect(() => contrastRatio(`#${'f'.repeat(3)}`, day.skyTop)).toThrow();
  });
});

describe('bandAt', () => {
  const themes: ThemeName[] = ['day', 'night'];

  it.each(themes)('picks ink that clears WCAG AA (4.5:1) on every band, %s', (name) => {
    const colors = palettes[name];
    colors.bands.forEach((_, index) => {
      const band = bandAt(colors, index);
      expect(contrastRatio(band.ink, band.color)).toBeGreaterThanOrEqual(4.5);
    });
  });

  it('picks the dark-ink token on the day palette\'s lightest bands and the light-ink token on its darkest', () => {
    expect(bandAt(day, 0).ink).toBe(day.text);
    expect(bandAt(day, 1).ink).toBe(day.text);
    expect(bandAt(day, 2).ink).toBe(day.text);
    expect(bandAt(day, 3).ink).toBe(day.onPrimary);
    expect(bandAt(day, 4).ink).toBe(day.onPrimary);
    expect(bandAt(day, 5).ink).toBe(day.onPrimary);
  });

  it('picks the light-ink token on every night band', () => {
    for (let index = 0; index < night.bands.length; index += 1) {
      expect(bandAt(night, index).ink).toBe(night.text);
    }
  });

  it('pairs the icon fill with whichever ink it chose', () => {
    const lightBand = bandAt(day, 0);
    expect(lightBand.iconFill).toBe(day.iconButtonFill);

    const darkBand = bandAt(day, 5);
    expect(darkBand.iconFill).toBe(day.iconButtonFillInverse);
  });

  it('bounces across the six-step ramp past index 5 without ever repeating a step on the next row', () => {
    // 0,1,2,3,4,5,4,3,2,1,0,1,2,3,4,5,4,3,2,1,0 — reflects at each end one step in, so the
    // darkest/lightest step is never immediately followed by itself.
    const steps = Array.from({ length: 21 }, (_, index) => bandAt(day, index).color);
    const expected = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0].map(
      (bandIndex) => day.bands[bandIndex],
    );
    expect(steps).toEqual(expected);

    // No two adjacent rows ever land on the same color, including across every reflection.
    for (let index = 1; index < steps.length; index += 1) {
      expect(steps[index]).not.toBe(steps[index - 1]);
    }
  });

  it('clamps a negative index to the first band', () => {
    expect(bandAt(day, -1)).toEqual(bandAt(day, 0));
  });

  it('caches results per palette object, so repeated calls do not recompute', () => {
    expect(bandAt(day, 2)).toBe(bandAt(day, 2));
  });
});
