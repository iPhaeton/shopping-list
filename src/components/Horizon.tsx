import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Circle, Defs, G, Path, RadialGradient, Stop, Svg } from 'react-native-svg';

import { themedStyles, useTheme } from '../state/ThemeContext';
import type { Palette } from '../theme';

const CEL_W = 170;
/**
 * The visible strip above the horizon line. The sun/moon's own center sits exactly on this
 * height's bottom edge (`cy === CEL_H`), so only its top half ever falls inside the `viewBox` —
 * the "half-sunk behind the first band" look, without clipping across a component boundary.
 */
const CEL_H = 60;
const CEL_R = 25;

function CelestialGraphic({ isDay, colors }: { isDay: boolean; colors: Palette }) {
  const cx = CEL_W - 55;
  const cy = CEL_H;

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
 * its left) or the moon by night (a soft halo), sitting half-sunk behind the first horizon band.
 * `children` — the switch row — renders on top, on the left; the graphic itself is decorative and
 * hidden from accessibility. Reused by List detail (step 4).
 */
export function Horizon({ children }: { children?: ReactNode }) {
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
      {children}
    </View>
  );
}

const useStyles = themedStyles(() => ({
  strip: {
    minHeight: 64,
    justifyContent: 'center',
  },
  celestial: {
    position: 'absolute',
    right: 20,
    bottom: 0,
  },
}));
