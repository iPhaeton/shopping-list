import { Circle, Defs, LinearGradient, Rect, Stop, Svg } from 'react-native-svg';

import { useTheme } from '../state/ThemeContext';

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
