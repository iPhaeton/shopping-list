import type { ReactNode } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { Circle, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop, Svg } from 'react-native-svg';

import { themedStyles, useTheme } from '../state/ThemeContext';
import { HILL_H, SUN_FROM_RIGHT, SUN_LIFT, hillEdge } from './Horizon';

/** The strip's height: from the add bar's foot (y 224 on the mockup) to the first row (y 306). */
const STRIP_H = 82;

/** The sun's or moon's center, from the strip's top — on the hill's crest line, as on Lists. */
const CEL_Y = STRIP_H - SUN_LIFT;

/** Three birds to the sun's left, by day — their left ends, from the sun's center. */
const BIRDS: readonly [number, number][] = [[-85, -31], [-64, -37], [-51, -21]];

/** A few stars low over the land by night, from the right edge (points) and the top. */
const LOW_STARS: readonly [number, number, number, number][] = [
  [89, 7.5, 1.1, 0.75], [45.5, 18, 1.1, 0.8], [31, 24.5, 1.1, 0.9], [388, 34, 0.6, 0.8],
];

/**
 * List detail's horizon: the sun by day (warm glow, three birds) or the moon by night (a soft halo),
 * sinking behind a hill in `ground` — the color of the first item's band, whose top edge this hill
 * *is*. It is the only wavy edge on the screen: the rows below it are flat bands that meet in
 * straight lines. `children` — the Show deleted switch — renders on top, on the left.
 *
 * **The hill is Lists' hill** — `HILL_EDGE` from `Horizon`, the same height along the strip's bottom
 * and stretched the same way, with the same faint rim, and the sun centered on its crest line the
 * same distance from the right edge. Only the strip is a fixed height and the disc larger, as the
 * List detail mockup draws them.
 *
 * One SVG at the real width, not a stretched viewBox, so the disc stays a circle on every phone. Ids
 * are prefixed because on web every SVG on the page shares one id space.
 */
export function Hillside({ ground, children }: { ground: string; children?: ReactNode }) {
  const { name, colors } = useTheme();
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const isDay = name === 'day';
  const cx = width - SUN_FROM_RIGHT;
  const r = isDay ? 36 : 34;

  const edge = hillEdge(width / 100, STRIP_H - HILL_H);
  const land = `${edge} L${width},${STRIP_H} L0,${STRIP_H} Z`;

  return (
    <View style={styles.strip}>
      <View
        style={styles.art}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <Svg width={width} height={STRIP_H}>
          <Defs>
            <RadialGradient id="hsGlow" cx={cx} cy={CEL_Y} r={r * 1.6} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={colors.celestial} stopOpacity={isDay ? 0.6 : 0.22} />
              <Stop offset="1" stopColor={colors.celestial} stopOpacity={0} />
            </RadialGradient>
            <LinearGradient id="hsRim" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors.bandRim} stopOpacity={0.2} />
              <Stop offset="1" stopColor={colors.bandRim} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={width} height={STRIP_H} fill={colors.skyHorizon} />
          {isDay
            ? null
            : LOW_STARS.map(([fromRight, y, starR, opacity], i) => (
                <Circle key={i} cx={width - fromRight} cy={y} r={starR} fill={colors.celestial} opacity={opacity} />
              ))}
          <Circle cx={cx} cy={CEL_Y} r={r * 1.6} fill="url(#hsGlow)" />
          <Circle cx={cx} cy={CEL_Y} r={r} fill={colors.celestial} />
          {isDay ? (
            <G stroke={colors.textMuted} strokeWidth={1.4} strokeLinecap="round" fill="none">
              {BIRDS.map(([dx, dy], i) => (
                <Path key={i} d={`M${cx + dx},${CEL_Y + dy} q3.25,-3.5 6.5,0 q3.25,-3.5 6.5,0`} />
              ))}
            </G>
          ) : null}
          <Path d={land} fill={ground} />
          <Path d={land} fill="url(#hsRim)" />
        </Svg>
      </View>
      {children}
    </View>
  );
}

const useStyles = themedStyles(() => ({
  // The top padding puts the switch's track at y 240, where the mockup draws it.
  strip: {
    height: STRIP_H,
    paddingTop: 8,
  },
  art: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
}));
