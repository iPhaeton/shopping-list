import { useWindowDimensions, View } from 'react-native';
import { Defs, LinearGradient, Rect, Stop, Svg } from 'react-native-svg';

import { themedStyles, useTheme } from '../state/ThemeContext';

/**
 * Where the land starts on screen with the list scrolled to the top (its edge, `Hillside`'s, runs
 * y 290–304 at 390×844). The gradient holds `groundTop` down to here
 * and only then starts toward `groundBottom`, so the stretch just under the hill is the exact
 * `groundTop` the mockup was drawn with.
 */
const LAND_TOP = 290;

/**
 * The stretch of land List detail's items sit on — one layer the size of the screen, behind the
 * scrolling list, never inside it. The gradient therefore belongs to the screen, not the content:
 * a 200-item list scrolls *over* it instead of stretching it into one flat color, and every
 * overscroll and every short list shows more of the same ground. The rows above it are
 * transparent, and so is the land in `Hillside` — a window onto this layer, which is why the hill
 * can never seam against the ground however far the list has scrolled.
 *
 * `pointerEvents="none"` sits on the wrapper, not only the SVG: an absolute layer on web takes
 * touches above its static siblings regardless of order.
 */
export function Ground() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { height } = useWindowDimensions();
  const start = Math.min(LAND_TOP / Math.max(height, 1), 1);

  return (
    <View
      style={styles.layer}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.groundTop} />
            <Stop offset={start} stopColor={colors.groundTop} />
            <Stop offset="1" stopColor={colors.groundBottom} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#ground)" />
      </Svg>
    </View>
  );
}

const useStyles = themedStyles(() => ({
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
}));
