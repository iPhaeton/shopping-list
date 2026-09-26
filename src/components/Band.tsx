import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { View } from 'react-native';
import { Defs, LinearGradient, Path, Rect, Stop, Svg } from 'react-native-svg';

import { bandAt } from '../state/bands';
import { themedStyles, useTheme } from '../state/ThemeContext';

const WAVE_H = 20;

/**
 * A handful of gentle wave shapes, normalized to a 0–100 × 0–{@link WAVE_H} box, cycled by row
 * index so neighbouring rows don't repeat the exact same curve. Traced against the mockup by eye;
 * expect to retune these by overlaying a simulator screenshot.
 */
const WAVES = [
  `M0,12 C15,4 35,4 50,10 C65,16 85,16 100,8 L100,${WAVE_H} L0,${WAVE_H} Z`,
  `M0,7 C20,15 35,17 55,11 C75,5 90,3 100,9 L100,${WAVE_H} L0,${WAVE_H} Z`,
  `M0,14 C18,6 40,4 58,9 C76,14 88,17 100,11 L100,${WAVE_H} L0,${WAVE_H} Z`,
];

/**
 * One horizon-band row: a full-width flat fill, colored and inked by `bandAt` for its **visible
 * index** (never the list count — see `bandAt`'s own doc comment). The wavy top edge lives
 * entirely inside this row's own bounds: a backdrop rect in the row above's color, with this row's
 * own color painted over it as a wave, plus a light rim highlight. That keeps every row
 * self-contained — nothing depends on overflow bleeding across a `FlatList` row boundary, which is
 * fragile on Android and under `removeClippedSubviews`. The very first row (`index === 0`) has no
 * "row above," so it paints its wave straight onto whatever is already behind it.
 */
export function Band({
  index,
  children,
  style,
}: {
  index: number;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const band = bandAt(colors, index);
  const above = index > 0 ? bandAt(colors, index - 1) : null;
  const wave = WAVES[index % WAVES.length];

  return (
    <View style={[{ backgroundColor: band.color }, style]}>
      <View style={styles.decoration} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Svg width="100%" height={WAVE_H} viewBox={`0 0 100 ${WAVE_H}`} preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="bandRim" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors.bandRim} stopOpacity={0.2} />
              <Stop offset="1" stopColor={colors.bandRim} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {above ? <Rect x={0} y={0} width={100} height={WAVE_H} fill={above.color} /> : null}
          <Path d={wave} fill={band.color} />
          <Path d={wave} fill="url(#bandRim)" />
        </Svg>
      </View>
      {children}
    </View>
  );
}

const useStyles = themedStyles(() => ({
  decoration: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: WAVE_H,
  },
}));
