/**
 * The two Quiet Horizon palettes — `day`, and `night` ("Moonlit"). Same keys in both, named for the
 * role a color plays rather than what it looks like, so a component never needs to know which theme
 * it is in. Read at render through `useTheme()`/`themedStyles` (`src/state/ThemeContext.tsx`), never
 * at import: a module-scope `StyleSheet.create` would freeze whichever palette was current then.
 *
 * The sky-to-sun rows were sampled from the Lists mockups (a compressed PNG, so close approximations);
 * `groundTop` through `divider` are the exact values the List detail mockups were drawn with.
 * `bands`, the ground, `farHill`, `celestial`, the switch, and `iconButtonFill` are first used when
 * the screens are built to the mockups; they are defined now so the palette lives in one place.
 */
export type Palette = {
  /** The sky, top of the screen → near the horizon. A flat screen background uses `skyTop`. */
  skyTop: string;
  skyHorizon: string;
  /** Inputs, cards, rows. */
  surface: string;
  surfaceOutline: string;
  /** The sync banner, one step apart from `surface`. */
  bannerSurface: string;
  text: string;
  /** Placeholders, chevrons, hints. */
  textMuted: string;
  /** A checked-off item's title. Passes AA across the whole item ground. */
  textDone: string;
  /** Filled buttons and checked controls. Inverts between themes: dark on light, light on dark. */
  primary: string;
  /** A label or tick on `primary`. */
  onPrimary: string;
  primaryDisabled: string;
  /** Outlined pills and buttons. */
  outline: string;
  switchTrack: string;
  switchKnob: string;
  /** The sun by day, the moon by night. */
  celestial: string;
  /** Horizon bands, top → bottom. */
  bands: readonly [string, string, string, string, string, string];
  /** The stretch of land items sit on, top → bottom of the screen. */
  groundTop: string;
  groundBottom: string;
  /** Drawn at 85% opacity. */
  farHill: string;
  checkboxOutline: string;
  iconButtonFill: string;
  divider: string;
  /** Passes AA as text on every surface of its own theme. */
  error: string;
  /** A label on an `error` fill. */
  onError: string;
};

export const day: Palette = {
  skyTop: '#dee6f0',
  skyHorizon: '#e6e4f0',
  surface: '#f6f6fa',
  surfaceOutline: '#ffffff',
  bannerSurface: '#f8f8fc',
  text: '#2c2f4e',
  textMuted: '#75778f',
  textDone: '#52546f',
  primary: '#2e3460',
  onPrimary: '#f7f4fb',
  primaryDisabled: '#989fb6',
  outline: '#a6abbc',
  switchTrack: '#c8c8d6',
  switchKnob: '#fefefe',
  celestial: '#feecd2',
  bands: ['#e4d8ea', '#d0c4e0', '#b2a8d2', '#5e5a92', '#4a4e82', '#2e3460'],
  groundTop: '#e6dbee',
  groundBottom: '#d6cae4',
  farHill: '#e3d8ec',
  checkboxOutline: '#6e7090',
  iconButtonFill: 'rgba(255,255,255,0.55)',
  divider: 'rgba(44,47,78,0.11)',
  error: '#b3261e',
  onError: '#ffffff',
};

export const night: Palette = {
  skyTop: '#10162e',
  skyHorizon: '#161c3a',
  surface: '#282e48',
  surfaceOutline: '#4a4f64',
  bannerSurface: '#343c68',
  text: '#eef0fa',
  textMuted: '#a9aecb',
  textDone: '#c3c7de',
  primary: '#e6e2fa',
  onPrimary: '#1b2137',
  primaryDisabled: '#666880',
  outline: '#5f6376',
  switchTrack: '#40445c',
  switchKnob: '#e8eaf4',
  celestial: '#f8f9fd',
  bands: ['#56628a', '#465276', '#384264', '#2c3452', '#202842', '#161c30'],
  groundTop: '#434e78',
  groundBottom: '#2a3252',
  farHill: '#56628a',
  checkboxOutline: '#c9cde6',
  iconButtonFill: 'rgba(255,255,255,0.12)',
  divider: 'rgba(255,255,255,0.09)',
  error: '#ff9b90',
  onError: '#1b2137',
};

export type ThemeName = 'day' | 'night';

export const palettes: Record<ThemeName, Palette> = { day, night };

/**
 * One family per weight, named as `ThemeProvider` loads them. Set the family and leave `fontWeight`
 * out: Android does not pick a weight inside a custom family, it just renders the one it was given.
 * Both themes use the same fonts.
 */
export const fonts = {
  /** Screen titles. */
  serif: 'SourceSerif4_400Regular',
  sans: 'NunitoSans_400Regular',
  sansSemiBold: 'NunitoSans_600SemiBold',
  sansBold: 'NunitoSans_700Bold',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

export const radius = {
  sm: 8,
  md: 12,
  pill: 999,
};
