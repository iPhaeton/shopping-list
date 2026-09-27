import type { ReactNode } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { Circle, ClipPath, Defs, G, Path, RadialGradient, Rect, Stop, Svg } from 'react-native-svg';

import { themedStyles, useTheme } from '../state/ThemeContext';

/** The strip's height: from the add bar's foot (y 224 on the mockup) to the first row (y 306). */
const STRIP_H = 82;

/**
 * The width the mockup was drawn at. Everything here is placed in it and stretched horizontally to
 * the real width — the sun included, so it stays behind the hilltop on every phone.
 */
const DRAWN_W = 390;

/**
 * The front edge of the land, left to right, in the mockup's strip coordinates (y = mockup y − 224):
 * low on the left under the switch, rising to a rounded hilltop at x 300 that the sun or moon sits
 * behind, then falling off toward the right edge. The top is curved hard enough (a radius of about
 * 150pt) that the land cuts the disc along an arc. The mockups ran it nearly flat across the disc,
 * which read as a ruled line.
 */
const LAND: readonly number[] = [0, 76, 60, 74.5, 130, 71.5, 195, 69, 225, 67.85, 268, 59.5, 300, 59.5, 332, 59.5, 362, 66.5, 390, 70];

/**
 * The far hill's crest, left to right. Its tail runs down under the land's rise to the hilltop, so
 * the two meet in a valley well to the left of the disc.
 */
const FAR_HILL: readonly number[] = [0, 59, 40, 50.5, 75, 46, 115, 46.3, 150, 46.5, 185, 52, 225, 64, 245, 70, 265, 76, 290, 82];

/** The sun's or moon's center: under the hilltop's crest, a little below it, so the hill hides
 * slightly more than the disc's lower half. */
const CEL_X = 300;
const CEL_Y = 62;

/** Three birds to the sun's left, by day — their left ends. */
const BIRDS: readonly [number, number][] = [[215, 31], [236, 25], [249, 41]];

/** A few stars low over the land by night: x, y, radius, opacity. */
const LOW_STARS: readonly [number, number, number, number][] = [
  [301, 7.5, 1.1, 0.75], [344.5, 18, 1.1, 0.8], [359, 24.5, 1.1, 0.9], [2, 34, 0.6, 0.8],
];

/** Joins `[x0, y0, x1, y1, …]` as a path of cubic segments after the first point, stretching x. */
function curve(points: readonly number[], sx: number): string {
  const at = (i: number) => `${(points[i] * sx).toFixed(2)},${points[i + 1]}`;
  let d = `M${at(0)}`;
  for (let i = 2; i < points.length; i += 6) d += ` C${at(i)} ${at(i + 2)} ${at(i + 4)}`;
  return d;
}

/**
 * List detail's horizon: the sun by day (warm glow, three birds) or the moon by night (a soft halo),
 * sitting behind a far hill and the front of the land. `children` — the Show deleted switch —
 * renders on top, on the left.
 *
 * **The land here is a hole, not a shape — the far hill included.** Everything this draws is
 * clipped to the region above *both* the far hill and the land's front edge; below them the strip is
 * transparent, and what shows through is `Ground`, the screen-fixed layer behind the whole list.
 * That is the difference from `Horizon` on the Lists screen, whose hill is filled in the first
 * band's color: there the bands are opaque and scroll with the hill, here the ground stays put while
 * the hill scrolls over it, so any hill with its own fill would seam against the ground at every
 * scroll offset but one. The mockups did fill the far hill, a shade off the ground — invisible by
 * day, but by night lighter, which drew the land's front edge as a line across it.
 *
 * One SVG at the real width, not a stretched viewBox, so the disc stays a circle on every phone; the
 * curves are traced at the mockup's 390pt and stretched horizontally. Ids are prefixed because on
 * web every SVG on the page shares one id space.
 */
export function Hillside({ children }: { children?: ReactNode }) {
  const { name, colors } = useTheme();
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const sx = width / DRAWN_W;
  const isDay = name === 'day';
  const cx = CEL_X * sx;
  const r = isDay ? 36 : 34;

  const aboveLand = `${curve(LAND, sx)} L${width},0 L0,0 Z`;
  // Above the far hill where it runs, and the full height past its end, where the land hides it.
  const farEnd = (FAR_HILL[FAR_HILL.length - 2] * sx).toFixed(2);
  const aboveFarHill = `${curve(FAR_HILL, sx)} L${farEnd},${STRIP_H} L${width},${STRIP_H} L${width},0 L0,0 Z`;

  return (
    <View style={styles.strip}>
      <View
        style={styles.art}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <Svg width={width} height={STRIP_H}>
          <Defs>
            <ClipPath id="hsAboveLand">
              <Path d={aboveLand} />
            </ClipPath>
            <ClipPath id="hsAboveFarHill">
              <Path d={aboveFarHill} />
            </ClipPath>
            <RadialGradient id="hsGlow" cx={cx} cy={CEL_Y} r={r * 1.6} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={colors.celestial} stopOpacity={isDay ? 0.6 : 0.22} />
              <Stop offset="1" stopColor={colors.celestial} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <G clipPath="url(#hsAboveLand)">
            <G clipPath="url(#hsAboveFarHill)">
              <Rect x={0} y={0} width={width} height={STRIP_H} fill={colors.skyHorizon} />
              {isDay
                ? null
                : LOW_STARS.map(([x, y, starR, opacity], i) => (
                    <Circle key={i} cx={x * sx} cy={y} r={starR} fill={colors.celestial} opacity={opacity} />
                  ))}
              <Circle cx={cx} cy={CEL_Y} r={r * 1.6} fill="url(#hsGlow)" />
              <Circle cx={cx} cy={CEL_Y} r={r} fill={colors.celestial} />
              {isDay ? (
                <G stroke={colors.textMuted} strokeWidth={1.4} strokeLinecap="round" fill="none">
                  {BIRDS.map(([x, y], i) => (
                    <Path key={i} d={`M${(x * sx).toFixed(2)},${y} q3.25,-3.5 6.5,0 q3.25,-3.5 6.5,0`} />
                  ))}
                </G>
              ) : null}
            </G>
          </G>
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
