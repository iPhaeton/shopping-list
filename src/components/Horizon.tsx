import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Circle, Defs, G, LinearGradient, Path, RadialGradient, Stop, Svg } from 'react-native-svg';

import { themedStyles, useTheme } from '../state/ThemeContext';
import type { Palette } from '../theme';

const HILL_H = 20;

/**
 * The first band's top edge, in a 0–100 × 0–{@link HILL_H} box stretched across the strip's bottom:
 * low under the switch on the left, then a broad, nearly flat crest (y ≈ 4.5–5.5) across roughly
 * 72–88% of the width. The sun's center is a fixed 75pt from the right edge (`right: 20` plus
 * `CEL_W - 55`), which lands inside that crest on every phone width, so the hill cuts it at the same
 * height wherever it sits.
 */
const HILL = `M0,18 C25,18 45,14 62,8 C72,4.5 88,3 100,6 L100,${HILL_H} L0,${HILL_H} Z`;

/** How far above the strip's bottom the sun's center sits: on the hill's crest line, so the hill
 * hides exactly its lower half. */
const SUN_LIFT = HILL_H - 5;

const CEL_W = 170;
const CEL_R = 25;
/** Tall enough for the glow (radius `CEL_R * 2.2`) above a center lifted {@link SUN_LIFT}. */
const CEL_H = 72;

function CelestialGraphic({ isDay, colors }: { isDay: boolean; colors: Palette }) {
  const cx = CEL_W - 55;
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
 * Lists only. List detail draws `Hillside` instead: its items sit on a ground fixed to the screen
 * while the hill scrolls, so a hill filled with a color of its own would seam against it.
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
    right: 20,
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
