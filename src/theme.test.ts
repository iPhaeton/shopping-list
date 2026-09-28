import { contrastRatio } from './state/bands';
import { palettes, type Palette } from './theme';

/** WCAG AA for body text. */
const AA = 4.5;

const hex = (channels: number[]) =>
  `#${channels.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

const channelsOf = (color: string): number[] =>
  color.startsWith('#')
    ? [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)).concat(1)
    : (color.match(/[\d.]+/g) ?? []).map(Number);

/** `top` — a palette colour, opaque or with an alpha — laid over the opaque `below`. */
function over(top: string, below: string): string {
  const [r, g, b, a = 1] = channelsOf(top);
  const [br, bg, bb] = channelsOf(below);
  return hex([r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)]);
}

/**
 * Every surface body text sits on in step 5's screens, as the opaque colour it ends up. A card is
 * `cardFill` over whatever is behind it: the sky on Account and Sharing, the top three land bands on
 * Sign in and Set name. The blur under it is left out — it only mixes what is behind, and every one
 * of those backgrounds is listed.
 */
function surfaces(colors: Palette): Record<string, string> {
  const card = over(colors.cardFill, colors.skyTop);
  return {
    skyTop: colors.skyTop,
    skyHorizon: colors.skyHorizon,
    surface: colors.surface,
    bannerSurface: colors.bannerSurface,
    'card on the sky': card,
    'card on the sky, over the horizon': over(colors.cardFill, colors.skyHorizon),
    'card on band 0': over(colors.cardFill, colors.bands[0]),
    'card on band 1': over(colors.cardFill, colors.bands[1]),
    'card on band 2': over(colors.cardFill, colors.bands[2]),
    'field in a card': colors.fieldFill,
    'segmented track in a card': over(colors.controlFill, card),
  };
}

describe.each(Object.entries(palettes))('the %s palette', (_name, colors) => {
  const cases = Object.entries(surfaces(colors)).flatMap(([surface, background]) =>
    (['text', 'textSecondary', 'error', 'primary'] as const).map((ink) => [ink, surface, background] as const)
  );

  it.each(cases)('%s passes AA on %s', (ink, _surface, background) => {
    expect(contrastRatio(colors[ink], background)).toBeGreaterThanOrEqual(AA);
  });

  it('keeps a filled button legible', () => {
    expect(contrastRatio(colors.onPrimary, colors.primary)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(colors.onError, colors.error)).toBeGreaterThanOrEqual(AA);
  });
});
