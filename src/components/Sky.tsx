import { useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { Circle, Defs, LinearGradient, Rect, Stop, Svg } from 'react-native-svg';

import { themedStyles, useTheme } from '../state/ThemeContext';

/**
 * Fixed star positions — percent of width, points from the top, radius, opacity. Hand-picked once
 * rather than `Math.random()`'d, so the sky never re-randomizes on a render
 * ([ai/tasks/20-ux/description-step-3.md] calls this out explicitly). The exact positions aren't
 * load-bearing; only that they stay put.
 */
const STARS: readonly [number, number, number, number][] = [
  [7, 18, 1.1, 0.8], [18, 42, 0.7, 0.5], [24, 12, 0.9, 0.65], [33, 58, 1.3, 0.9],
  [41, 24, 0.6, 0.4], [52, 46, 1, 0.7], [61, 15, 0.8, 0.55], [68, 66, 1.2, 0.85],
  [77, 30, 0.7, 0.5], [85, 10, 1, 0.75], [92, 50, 0.9, 0.6], [12, 70, 0.8, 0.45],
  [28, 82, 1.1, 0.7], [46, 74, 0.6, 0.4], [58, 88, 0.9, 0.6], [72, 78, 1.2, 0.8],
  [88, 68, 0.7, 0.5], [4, 40, 0.9, 0.55], [96, 30, 0.8, 0.65], [37, 8, 1, 0.7],
  [64, 40, 0.6, 0.4], [15, 25, 1.1, 0.8], [80, 84, 0.8, 0.5], [50, 6, 0.7, 0.45],
];

/**
 * List detail's star field, traced from its night mockup — percent of width, **points** from the
 * top, radius, opacity. Points rather than percent of height, unlike {@link STARS}: `SkyFill`
 * stretches to whatever height its region has, and a star placed by percent would jump every time
 * that region grew — a sync banner appearing, say. By points, the status-bar strip drawing the same
 * field over a different height lines up with the header underneath it exactly.
 */
const FILL_STARS: readonly [number, number, number, number][] = [
  [95.9, 15, 0.9, 0.8], [49.8, 17, 1.4, 0.9], [56.4, 22, 0.9, 0.8], [41.6, 24.5, 1, 0.9],
  [24.8, 28.5, 1.4, 0.75], [99.3, 28, 0.6, 0.4], [64.5, 44.5, 0.9, 0.8], [40.6, 49.5, 1.4, 0.95],
  [51.5, 53, 0.7, 0.6], [29.1, 72, 0.7, 0.5], [41.9, 75, 1, 0.65], [35, 98, 1, 0.9],
  [42.3, 98.5, 0.8, 0.55], [90.8, 109, 1, 0.6], [1, 120, 1.4, 0.55], [99.3, 123, 1, 0.65],
  [72.5, 123, 0.8, 0.95], [90.6, 132, 0.9, 0.75], [94.5, 139, 0.7, 0.5], [66.2, 150, 0.8, 0.8],
  [93.7, 159, 0.9, 0.5], [1, 172, 0.6, 0.5], [99.4, 180, 1, 0.55],
];

/**
 * The sky filling whatever region holds it — List detail's header, down to its `Hillside`: `skyTop`
 * at the top edge to `skyHorizon` at the bottom, which is exactly what `Hillside`'s flat sky
 * continues from, however tall the region above it has grown. Night draws {@link FILL_STARS}.
 * Purely decorative; the caller positions it and hides it from touches and screen readers.
 *
 * **It measures itself rather than sizing the SVG by percent.** A `height="100%"` drawing is laid
 * out once on iOS and kept: the header first renders while its items load, without the Add bar, and
 * the sky stayed that short once the bar arrived — the ground showed through behind the bar. Until
 * the first layout it draws at `initialHeight`, so a pushed screen's first frame is already sky.
 */
export function SkyFill({ initialHeight = 224 }: { initialHeight?: number }) {
  const { name, colors } = useTheme();
  const styles = useFillStyles();
  const { width: windowWidth } = useWindowDimensions();
  const [size, setSize] = useState({ width: windowWidth, height: initialHeight });

  return (
    <View
      style={styles.fill}
      onLayout={({ nativeEvent: { layout } }) => {
        if (layout.width !== size.width || layout.height !== size.height) {
          setSize({ width: layout.width, height: layout.height });
        }
      }}>
      <Svg width={size.width} height={size.height} pointerEvents="none">
        <Defs>
          <LinearGradient id="skyFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.skyTop} />
            <Stop offset="1" stopColor={colors.skyHorizon} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={size.width} height={size.height} fill="url(#skyFill)" />
        {name === 'night'
          ? FILL_STARS.map(([xPercent, y, r, opacity], i) => (
              <Circle
                key={i}
                cx={(xPercent / 100) * size.width}
                cy={y}
                r={r}
                fill={colors.celestial}
                opacity={opacity}
              />
            ))
          : null}
      </Svg>
    </View>
  );
}

const useFillStyles = themedStyles(() => ({
  fill: {
    flex: 1,
  },
}));

/**
 * The sky gradient behind the header and first bands — bounded to `height`, not full-screen, so
 * the screen's own background (the last band's color) is what a bottom overscroll reveals, and
 * this is what a top overscroll reveals. Night draws a fixed star field on top. Purely decorative.
 */
export function Sky({ height, width = 400 }: { height: number; width?: number }) {
  const { name, colors } = useTheme();

  return (
    <Svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Defs>
        <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.skyTop} />
          <Stop offset="1" stopColor={colors.skyHorizon} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill="url(#sky)" />
      {name === 'night'
        ? STARS.map(([xPercent, yPercent, r, opacity], i) => (
            <Circle
              key={i}
              cx={(xPercent / 100) * width}
              cy={(yPercent / 100) * height}
              r={r}
              fill={colors.celestial}
              opacity={opacity}
            />
          ))
        : null}
    </Svg>
  );
}
