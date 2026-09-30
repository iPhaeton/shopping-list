import { useWindowDimensions, View } from 'react-native';
import { Circle, Defs, G, LinearGradient, Path, RadialGradient, Stop, Svg } from 'react-native-svg';

import { themedStyles, useTheme } from '../state/ThemeContext';
import { SUN_FROM_RIGHT } from './Horizon';
import { smooth } from './Landscape';

/** Tall enough for the sun's glow above the hill it sinks behind. Everything is placed from here. */
const FOOTER_H = 170;

/** Distances below are traced on the 390×844 mockups, whose bottom this footer's bottom is. */
const TRACED_W = 390;
const TRACED_BOTTOM = 844;

/**
 * The near hill, in `bands[0]`, and the land in front of it, in `bands[1]` — `[x, y]` on the mockup,
 * traced every 20pt off `account-screen-quiet-horizon` (the same edges in its moonlit twin). The near hill's crest sits under the sun, as on Lists.
 */
const HILL: readonly (readonly [number, number])[] = [
  [0, 749], [20, 749], [40, 748.7], [60, 748.3], [80, 747.7], [100, 747], [120, 746], [140, 745],
  [160, 743.3], [180, 741.7], [200, 739.7], [220, 737.7], [240, 735.3], [260, 733.2], [280, 731.7],
  [300, 730.7], [320, 730.2], [340, 730], [360, 730.5], [380, 731.3], [390, 732.3],
];
const FRONT: readonly (readonly [number, number])[] = [
  [0, 786], [20, 784.3], [40, 782.7], [60, 781.7], [80, 780.7], [100, 780], [120, 779.3], [140, 779],
  [160, 778.7], [180, 779], [200, 779.3], [220, 780], [240, 781], [260, 782.3], [280, 784],
  [300, 785.7], [340, 787], [360, 786.3], [380, 784], [390, 782],
];

/** How far below an edge's lowest point its light rim fades out, as on `Landscape`. */
const RIM_H = 14;

/** The disc's centre, on the hill's crest line so the hill hides its lower half. */
const CEL_Y = 730;
const SUN_R = 30;
const MOON_R = 27;

/** Three birds to the sun's upper left, by day — each one's left end, from the sun's centre. The
 * same flock as List detail's `Hillside`. */
const BIRDS: readonly [number, number][] = [[-86, -31], [-64, -39], [-51, -21]];

/**
 * The foot of Account: a small sun (with its birds) or moon sinking behind a hill at the
 * right, and one more band of land in front, down to the bottom. It closes the page rather than
 * framing the screen: it sits after the last card, pushed to the bottom of a short page and scrolled
 * to on a long one, over the fixed sky of the `Backdrop` behind — so the glow and the space around
 * the disc are see-through, and only the land is solid.
 *
 * Below it, a block of the front band's color carries on past the bottom, so an iOS bounce at the end
 * of the page shows more land rather than the sky.
 */
export function HorizonFooter() {
  const { name, colors } = useTheme();
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const isDay = name === 'day';
  const sx = width / TRACED_W;
  const dy = FOOTER_H - TRACED_BOTTOM;
  const cx = width - SUN_FROM_RIGHT;
  const cy = CEL_Y + dy;
  const r = isDay ? SUN_R : MOON_R;
  const land = (edge: readonly (readonly [number, number])[]) =>
    `${smooth(edge, sx, dy)} L${width},${FOOTER_H} L0,${FOOTER_H} Z`;

  return (
    <View
      style={styles.footer}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Svg width={width} height={FOOTER_H}>
        <Defs>
          <RadialGradient id="hfGlow" cx={cx} cy={cy} r={r * 1.6} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={colors.celestial} stopOpacity={isDay ? 0.6 : 0.22} />
            <Stop offset="1" stopColor={colors.celestial} stopOpacity={0} />
          </RadialGradient>
          {[HILL, FRONT].map((edge, i) => (
            <LinearGradient
              key={i}
              id={`hfRim${i}`}
              x1="0"
              y1={Math.min(...edge.map(([, y]) => y)) + dy}
              x2="0"
              y2={Math.max(...edge.map(([, y]) => y)) + dy + RIM_H}
              gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={colors.bandRim} stopOpacity={0.2} />
              <Stop offset="1" stopColor={colors.bandRim} stopOpacity={0} />
            </LinearGradient>
          ))}
        </Defs>
        <Circle cx={cx} cy={cy} r={r * 1.6} fill="url(#hfGlow)" />
        <Circle cx={cx} cy={cy} r={r} fill={colors.celestial} />
        {isDay ? (
          <G stroke={colors.textMuted} strokeWidth={1.4} strokeLinecap="round" fill="none">
            {BIRDS.map(([bx, by], i) => (
              <Path key={i} d={`M${cx + bx},${cy + by} q3.25,-3.5 6.5,0 q3.25,-3.5 6.5,0`} />
            ))}
          </G>
        ) : null}
        <Path d={land(HILL)} fill={colors.bands[0]} />
        <Path d={land(HILL)} fill="url(#hfRim0)" />
        <Path d={land(FRONT)} fill={colors.bands[1]} />
        <Path d={land(FRONT)} fill="url(#hfRim1)" />
      </Svg>
      <View style={styles.below} />
    </View>
  );
}

const useStyles = themedStyles((colors) => ({
  footer: {
    height: FOOTER_H,
  },
  below: {
    position: 'absolute',
    top: FOOTER_H,
    left: 0,
    right: 0,
    height: 1000,
    backgroundColor: colors.bands[1],
  },
}));
