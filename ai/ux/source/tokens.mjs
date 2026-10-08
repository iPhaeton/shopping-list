// Writes tokens.json beside this file: both palettes straight from src/theme.ts, each with
// `bandList` = bandAt(palette, 0..63) from src/state/bands.ts, and `landHint`, the colour SharingScreen
// gives a hint on band 0's land (`textSecondary` where it passes AA there, else the band's ink).
// Node >= 23.6 strips the types.
import { writeFileSync } from 'node:fs';
import { day, night } from '../../../src/theme.ts';
import { bandAt, contrastRatio } from '../../../src/state/bands.ts';

const landHint = (palette) => {
  const ground = bandAt(palette, 0);
  return contrastRatio(palette.textSecondary, ground.color) >= 4.5 ? palette.textSecondary : ground.ink;
};
const withBands = (palette) => ({ ...palette, bandList: Array.from({ length: 64 }, (_, i) => bandAt(palette, i)), landHint: landHint(palette) });
writeFileSync(new URL('./tokens.json', import.meta.url), JSON.stringify({ day: withBands(day), night: withBands(night) }, null, 2) + '\n');
