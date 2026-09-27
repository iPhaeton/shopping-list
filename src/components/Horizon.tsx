import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Circle, Defs, G, LinearGradient, Path, RadialGradient, Stop, Svg } from 'react-native-svg';

import { themedStyles, useTheme } from '../state/ThemeContext';
import type { Palette } from '../theme';

/** The height of the box the hill's top edge is drawn in, along the strip's bottom. */
export const HILL_H = 20;

/**
 * The first band's top edge — a start point, then cubic segments of three points each — in a
 * 0–100 × 0–{@link HILL_H} box stretched across the strip's bottom: low under the switch on the
 * left, then a broad, nearly flat crest (y ≈ 4.5–5.5) across roughly 72–88% of the width. The sun's
 * center is a fixed {@link SUN_FROM_RIGHT}pt from the right edge, which lands inside that crest on
 * every phone width, so the hill cuts it at the same height wherever it sits. List detail's
 * `Hillside` draws this same edge, so both screens share one horizon.
 */
export const HILL_EDGE: readonly number[] = [0, 18, 25, 18, 45, 14, 62, 8, 72, 4.5, 88, 3, 100, 6];

/** How far the sun's center sits from the strip's right edge. */
export const SUN_FROM_RIGHT = 75;

/** How far above the strip's bottom the sun's center sits: on the hill's crest line, so the hill
 * hides exactly its lower half. */
export const SUN_LIFT = HILL_H - 5;

/** {@link HILL_EDGE} as SVG path data, its x stretched by `sx` and its y moved down by `dy`. */
export function hillEdge(sx: number, dy = 0): string {
  const at = (i: number) => `${+(HILL_EDGE[i] * sx).toFixed(2)},${HILL_EDGE[i + 1] + dy}`;
  let d = `M${at(0)}`;
  for (let i = 2; i < HILL_EDGE.length; i += 6) d += ` C${at(i)} ${at(i + 2)} ${at(i + 4)}`;
  return d;
}

const HILL = `${hillEdge(1)} L100,${HILL_H} L0,${HILL_H} Z`;

/** The celestial box's inset from the strip's right edge. */
const CEL_RIGHT = 20;
const CEL_W = 170;
const CEL_R = 25;
/** Tall enough for the glow (radius `CEL_R * 2.2`) above a center lifted {@link SUN_LIFT}. */
const CEL_H = 72;

function CelestialGraphic({ isDay, colors }: { isDay: boolean; colors: Palette }) {
  const cx = CEL_W - (SUN_FROM_RIGHT - CEL_RIGHT);
  const cy = CEL_H - SUN_LIFT;

  return (
    <Svg width={CEL_W} height={CEL_H} viewBox={`0 0 ${CEL_W} ${CEL_H}`}>
      <Defs>
        <RadialGradient id="glow" cx={cx} cy={cy} r={CEL_R * 2.2} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={colors.celestial} stopOpacity={isDay ? 0.55 : 0.2} />
          <Stop offset="1" stopColor={colors.celestial} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={cx} cy={cy} r={CEL_R * 2.2} fill="url(#glow)" />
      <Circle cx={cx} cy={cy} r={CEL_R} fill={colors.celestial} />
      {isDay ? (
        <G stroke={colors.textMuted} strokeWidth={1.6} strokeLinecap="round" fill="none">
          <Path d={`M${cx - 66} ${cy - 28} q6 -5 12 0`} />
          <Path d={`M${cx - 50} ${cy - 34} q6 -5 12 0`} />
          <Path d={`M${cx - 38} ${cy - 18} q6 -5 12 0`} />
        </G>
      ) : null}
    </Svg>
  );
}

/**
 * The strip behind the "Show deleted" switch: the sun by day (a warm glow, three small birds to
 * its left) or the moon by night (a soft halo), sinking behind a hill in `ground` — the color of
 * the band directly below, whose top edge this hill *is* (`Band` draws none for its first row).
 * Sun and hill live in one component so the hill can pass in front of the sun. `children` — the
 * switch row — renders on top, on the left; the graphic itself is decorative and hidden from
 * accessibility.
 *
 * Lists only. List detail draws `Hillside`, a fixed-height strip with a larger disc, over rows in the
 * same band colors and along the same {@link HILL_EDGE}.
 */
export function Horizon({ ground, children }: { ground: string; children?: ReactNode }) {
  const { name, colors } = useTheme();
  const styles = useStyles();

  return (
    <View style={styles.strip}>
      <View
        style={styles.celestial}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <CelestialGraphic isDay={name === 'day'} colors={colors} />
      </View>
      <View
        style={styles.hill}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <Svg width="100%" height={HILL_H} viewBox={`0 0 100 ${HILL_H}`} preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="hillRim" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors.bandRim} stopOpacity={0.2} />
              <Stop offset="1" stopColor={colors.bandRim} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Path d={HILL} fill={ground} />
          <Path d={HILL} fill="url(#hillRim)" />
        </Svg>
      </View>
      {children}
    </View>
  );
}

const useStyles = themedStyles(() => ({
  // The bottom padding keeps the switch clear of the hill's rise; `minHeight` includes it, so the
  // switch still centers in the same 64pt it always had.
  strip: {
    minHeight: 64 + 8,
    paddingBottom: 8,
    justifyContent: 'center',
  },
  celestial: {
    position: 'absolute',
    right: CEL_RIGHT,
    bottom: 0,
  },
  hill: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: HILL_H,
  },
}));
