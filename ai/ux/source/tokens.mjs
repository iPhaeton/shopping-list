// Writes tokens.json beside this file: both palettes straight from src/theme.ts, each with
// `bandList` = bandAt(palette, 0..63) from src/state/bands.ts. Node >= 23.6 strips the types.
import { writeFileSync } from 'node:fs';
import { day, night } from '../../../src/theme.ts';
import { bandAt } from '../../../src/state/bands.ts';

const withBands = (palette) => ({ ...palette, bandList: Array.from({ length: 64 }, (_, i) => bandAt(palette, i)) });
writeFileSync(new URL('./tokens.json', import.meta.url), JSON.stringify({ day: withBands(day), night: withBands(night) }, null, 2) + '\n');
