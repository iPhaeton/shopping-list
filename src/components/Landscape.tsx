import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Circle, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop, Svg } from 'react-native-svg';

import { useTheme } from '../state/ThemeContext';
import { STARS } from './Sky';

/** The screen the edges below were traced on — the iPhone 17e, and every mockup — and its top inset. */
const TRACED_W = 390;
const TRACED_H = 844;
const TRACED_INSET_TOP = 47;

/**
 * The land's edges, top to bottom, each separating one of `bands[0..4]` from what lies above it —
 * `[x, y]` in points on the 390×844 mockup, sampled every 20pt off `sign-in-screen-quiet-horizon`
 * and `set-name-screen-quiet-horizon` (the shorter card leaves the lower two in view). The second and
 * third run behind the card on both, so between the ends they are drawn, not traced. `fromBottom`
 * edges keep their distance from the bottom of a taller or shorter screen; the rest keep theirs from
 * the safe area's top, below which `AuthFrame` lays out the title and card.
 */
const EDGES: readonly { fromBottom: boolean; points: readonly (readonly [number, number])[] }[] = [
  {
    fromBottom: false,
    points: [
      [0, 338], [30, 333.3], [50, 330.3], [70, 327.7], [90, 325], [110, 323], [130, 321.3],
      [150, 320.3], [170, 320], [190, 320.7], [210, 321.7], [230, 323], [250, 324.3], [270, 325.7],
      [290, 326.7], [310, 327.3], [330, 327.3], [350, 326.7], [370, 324.7], [390, 322],
    ],
  },
  {
    fromBottom: false,
    points: [[0, 464], [19, 461.3], [100, 456], [190, 455], [280, 458], [350, 457], [375, 454.3], [390, 451]],
  },
  {
    fromBottom: false,
    points: [[0, 592], [19, 594.3], [100, 598], [200, 595], [300, 589], [375, 590.7], [390, 592.7]],
  },
  {
    fromBottom: true,
    points: [
      [0, 725.7], [20, 723], [40, 720.7], [60, 718.7], [80, 717], [100, 715.3], [120, 714.3],
      [140, 713.3], [160, 712.7], [180, 712.3], [200, 712.7], [220, 713], [240, 713.7], [260, 715],
      [280, 716.7], [300, 718.3], [320, 719.3], [340, 719.7], [360, 719], [380, 716.3], [390, 714],
    ],
  },
  {
    fromBottom: true,
    points: [
      [0, 801], [20, 802.7], [40, 804], [60, 805.7], [80, 806.7], [100, 807.7], [120, 808.3],
      [140, 808.7], [180, 808.7], [200, 808.3], [220, 807.3], [240, 806.3], [260, 805], [280, 803],
      [300, 800.7], [320, 799], [340, 797.7], [360, 797.3], [380, 798.3], [390, 800],
    ],
  },
];

/** The sun's or moon's centre: mid-screen, on the first edge's crest, so it hides the lower half. */
const CEL_Y = 318;
const SUN_R = 54;
const MOON_R = 46;

/** Three birds to the sun's upper left, by day — each one's left end, from the sun's centre. */
const BIRDS: readonly [number, number][] = [[-103, -56], [-80, -68], [-68, -42]];

/**
 * How far below an edge's lowest point its light rim fades out — the faint highlight every band's
 * top edge carries on Lists (`Band`), at the same strength.
 */
const RIM_H = 14;

/** How far down the stars reach: the sky above the first hill. */
const STAR_FIELD_H = 320;

/**
 * A smooth curve through `points` (a Catmull-Rom spline, as cubic Béziers), stretched to the real
 * width and moved down by `dy`.
 */
export function smooth(points: readonly (readonly [number, number])[], sx: number, dy: number): string {
  const p = points.map(([x, y]) => [x * sx, y + dy] as const);
  const at = (i: number) => p[Math.min(Math.max(i, 0), p.length - 1)];
  const n = (v: number) => +v.toFixed(2);
  let d = `M${n(p[0][0])},${n(p[0][1])}`;
  for (let i = 0; i < p.length - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${n(c1[0])},${n(c1[1])} ${n(c2[0])},${n(c2[1])} ${n(p2[0])},${n(p2[1])}`;
  }
  return d;
}

/**
 * The land behind Sign in and Set name, drawn from their mockups: the sky, the sun (with three birds)
 * or the moon (among stars) rising mid-screen behind a hill, and the five horizon bands below it
 * running to the bottom of the screen — the same colors, in the same order, as the rows of Lists.
 *
 * Fixed to the screen, never scrolled; `Backdrop` holds it and hides it from touches and screen
 * readers. One SVG at the real size — sizes by number, not percent, which iOS would draw once and
 * keep — so the disc stays round on every width. Ids are prefixed because on web every SVG on the page
 * shares one id space.
 */
export function Landscape() {
  const { name, colors } = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isDay = name === 'day';
  const sx = width / TRACED_W;
  // A taller status bar than the 17e's moves the upper land down with the title and card.
  const shift = insets.top - TRACED_INSET_TOP;
  const cx = width / 2;
  const cy = CEL_Y + shift;
  const r = isDay ? SUN_R : MOON_R;

  const bands = EDGES.map(({ fromBottom, points }) => {
    const dy = fromBottom ? height - TRACED_H : shift;
    const ys = points.map(([, y]) => y + dy);
    return {
      land: `${smooth(points, sx, dy)} L${width},${height} L0,${height} Z`,
      top: Math.min(...ys),
      bottom: Math.max(...ys),
    };
  });

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id="lsSky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.skyTop} />
          <Stop offset="1" stopColor={colors.skyHorizon} />
        </LinearGradient>
        <RadialGradient id="lsGlow" cx={cx} cy={cy} r={r * 2.2} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={colors.celestial} stopOpacity={isDay ? 0.55 : 0.2} />
          <Stop offset="1" stopColor={colors.celestial} stopOpacity={0} />
        </RadialGradient>
        {bands.map(({ top, bottom }, i) => (
          <LinearGradient
            key={i}
            id={`lsRim${i}`}
            x1="0"
            y1={top}
            x2="0"
            y2={bottom + RIM_H}
            gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={colors.bandRim} stopOpacity={0.2} />
            <Stop offset="1" stopColor={colors.bandRim} stopOpacity={0} />
          </LinearGradient>
        ))}
      </Defs>
      <Rect x={0} y={0} width={width} height={STAR_FIELD_H + shift + 20} fill="url(#lsSky)" />
      {isDay
        ? null
        : STARS.map(([xPercent, yPercent, starR, opacity], i) => (
            <Circle
              key={i}
              cx={(xPercent / 100) * width}
              cy={(yPercent / 100) * (STAR_FIELD_H + shift)}
              r={starR}
              fill={colors.celestial}
              opacity={opacity}
            />
          ))}
      <Circle cx={cx} cy={cy} r={r * 2.2} fill="url(#lsGlow)" />
      <Circle cx={cx} cy={cy} r={r} fill={colors.celestial} />
      {isDay ? (
        <G stroke={colors.textMuted} strokeWidth={1.5} strokeLinecap="round" fill="none">
          {BIRDS.map(([dx, dy], i) => (
            <Path key={i} d={`M${cx + dx},${cy + dy} q3.75,-4 7.5,0 q3.75,-4 7.5,0`} />
          ))}
        </G>
      ) : null}
      {bands.map(({ land }, i) => (
        <G key={i}>
          <Path d={land} fill={colors.bands[i]} />
          <Path d={land} fill={`url(#lsRim${i})`} />
        </G>
      ))}
    </Svg>
  );
}
