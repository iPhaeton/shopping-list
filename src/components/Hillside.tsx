import type { ReactNode } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { Circle, ClipPath, Defs, G, Path, RadialGradient, Rect, Stop, Svg } from 'react-native-svg';

import { themedStyles, useTheme } from '../state/ThemeContext';

/** The strip's height: from the add bar's foot (y 224 on the mockup) to the first row (y 306). */
const STRIP_H = 82;

/** The width the mockup was drawn at. Curves are traced in it and stretched to the real width. */
const DRAWN_W = 390;

/**
 * The front edge of the land, left to right, in the mockup's own strip coordinates (y = mockup
 * y − 224): low on the left under the switch, a broad crest around x 240, easing down past the sun.
 * Traced from the images to within half a point.
 */
const LAND: readonly number[] = [0, 76, 80, 69.5, 150, 62.5, 240, 59, 300, 60, 340, 65.5, 370, 65.3, 380, 65, 386, 64.5, 390, 64];

/** The far hill's crest, left to right; it runs on under the land, which hides the rest. */
const FAR_HILL: readonly number[] = [0, 59, 40, 50.5, 75, 46, 115, 46.3, 160, 46.5, 200, 52, 250, 60];

/** The sun's or moon's center, from the right edge and the strip's top — on the land line, so the
 * land hides exactly its lower half. The disc stays this far from the right on a wider phone. */
const CEL_FROM_RIGHT = 90;
const CEL_Y = 62;

/** Three birds to the sun's left, by day — their left ends, from the right edge and the top. */
const BIRDS: readonly [number, number][] = [[175, 31], [154, 25], [141, 41]];

/** A few stars low over the land by night, from the right edge (points) and the top. */
const LOW_STARS: readonly [number, number, number, number][] = [
  [89, 7.5, 1.1, 0.75], [45.5, 18, 1.1, 0.8], [31, 24.5, 1.1, 0.9], [388, 34, 0.6, 0.8],
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
  const cx = width - CEL_FROM_RIGHT;
  const r = isDay ? 36 : 34;

  const aboveLand = `${curve(LAND, sx)} L${width},0 L0,0 Z`;
  // Above the far hill where it runs, and the full height past its end, where the land hides it.
  const aboveFarHill = `${curve(FAR_HILL, sx)} L${(250 * sx).toFixed(2)},${STRIP_H} L${width},${STRIP_H} L${width},0 L0,0 Z`;

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
                : LOW_STARS.map(([fromRight, y, starR, opacity], i) => (
                    <Circle key={i} cx={width - fromRight} cy={y} r={starR} fill={colors.celestial} opacity={opacity} />
                  ))}
              <Circle cx={cx} cy={CEL_Y} r={r * 1.6} fill="url(#hsGlow)" />
              <Circle cx={cx} cy={CEL_Y} r={r} fill={colors.celestial} />
              {isDay ? (
                <G stroke={colors.textMuted} strokeWidth={1.4} strokeLinecap="round" fill="none">
                  {BIRDS.map(([fromRight, y], i) => (
                    <Path key={i} d={`M${width - fromRight},${y} q3.25,-3.5 6.5,0 q3.25,-3.5 6.5,0`} />
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
