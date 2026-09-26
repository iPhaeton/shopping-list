import type { Palette } from '../theme';

/**
 * WCAG relative-luminance contrast ratio between two `#rrggbb` colors, 1–21. Symmetric in its
 * arguments. Only the 6-digit hex form is accepted — every palette value is one.
 */
export function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const match = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!match) throw new Error(`contrastRatio: not a 6-digit hex color: ${hex}`);
    const n = parseInt(match[1], 16);
    const channels = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff].map((c) => {
      const cs = c / 255;
      return cs <= 0.03928 ? cs / 12.92 : ((cs + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };

  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

export type Band = {
  color: string;
  ink: string;
  iconFill: string;
};

const cache = new WeakMap<Palette, Band[]>();

/**
 * A row's horizon band by its **visible position**, never the list count — so creating a list
 * never recolors the rows above it. Past the ramp's last step the color holds; `bandRim`
 * (`Band.tsx`'s wave decoration) is what keeps two rows holding the same step apart.
 *
 * `ink`/`iconFill` are picked by contrast, not by index: whichever of `colors.text` /
 * `colors.onPrimary` scores higher against the band color wins, paired with the icon-button fill
 * built for that ink (`iconButtonFill` under `text`, `iconButtonFillInverse` under `onPrimary` —
 * the wider fill fails the 3:1 icon-contrast floor once it sits under a light glyph on a dark
 * band). Every band in both palettes clears WCAG AA 4.5:1 for text with this pairing — see
 * `bands.test.ts`.
 */
export function bandAt(colors: Palette, index: number): Band {
  let bands = cache.get(colors);
  if (!bands) {
    bands = colors.bands.map((color) => {
      const useOnPrimary = contrastRatio(colors.onPrimary, color) > contrastRatio(colors.text, color);
      return useOnPrimary
        ? { color, ink: colors.onPrimary, iconFill: colors.iconButtonFillInverse }
        : { color, ink: colors.text, iconFill: colors.iconButtonFill };
    });
    cache.set(colors, bands);
  }
  return bands[Math.min(Math.max(index, 0), bands.length - 1)];
}
