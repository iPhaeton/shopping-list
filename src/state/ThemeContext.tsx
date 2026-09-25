// One subpath per weight: the package index `require`s all sixteen files, and Metro would bundle
// every one of them.
import { NunitoSans_400Regular } from '@expo-google-fonts/nunito-sans/400Regular';
import { NunitoSans_600SemiBold } from '@expo-google-fonts/nunito-sans/600SemiBold';
import { NunitoSans_700Bold } from '@expo-google-fonts/nunito-sans/700Bold';
import { SourceSerif4_400Regular } from '@expo-google-fonts/source-serif-4/400Regular';
import { useFonts } from 'expo-font';
import * as SystemUI from 'expo-system-ui';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Appearance, Platform, StyleSheet } from 'react-native';

import { readThemePreference, writeThemePreference, type ThemePreference } from '../lib/themePreference';
import { day, fonts, palettes, type Palette, type ThemeName } from '../theme';

const FONT_FILES = {
  [fonts.serif]: SourceSerif4_400Regular,
  [fonts.sans]: NunitoSans_400Regular,
  [fonts.sansSemiBold]: NunitoSans_600SemiBold,
  [fonts.sansBold]: NunitoSans_700Bold,
};

type ThemeContextValue = {
  /** The palette on screen now. Step 2's `'auto'` is why this and `preference` are separate. */
  name: ThemeName;
  /** What native surfaces are told — the status bar, the keyboard, system dialogs. */
  scheme: 'light' | 'dark';
  colors: Palette;
  /** What the person chose on this device. */
  preference: ThemePreference;
  /** Applies at once and persists. */
  setPreference: (preference: ThemePreference) => void;
};

/**
 * The default is the day palette, not an error for a missing provider: component and screen suites
 * render without `ThemeProvider`, and this is what lets them do so untouched — and never wait on
 * font loading. In the app, `ThemeProvider` sits above everything that reads this.
 */
const ThemeContext = createContext<ThemeContextValue>({
  name: 'day',
  scheme: 'light',
  colors: day,
  preference: 'day',
  setPreference: () => {},
});

/**
 * **Nothing paints until the preference and the fonts are read.** A night user must never see a day
 * frame at cold start, so there is no default to render in the meantime — the same rule
 * `SessionContext` follows for a restored session. A font that fails to load falls back to the
 * system face rather than holding the app closed.
 *
 * After that, a switch only changes the context value. Nothing is keyed by theme and this never
 * renders a different tree, so the navigation stack, open editors, drafts, and scroll positions all
 * survive it.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference | null>(null);
  const [fontsLoaded, fontError] = useFonts(FONT_FILES);

  useEffect(() => {
    let cancelled = false;
    void readThemePreference().then((stored) => {
      if (!cancelled) setPreferenceState(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const name: ThemeName = preference ?? 'day';
  const scheme = name === 'night' ? 'dark' : 'light';
  const colors = palettes[name];

  // The native half: system alerts, the keyboard, text-selection menus, and the root view behind the
  // app. Layout effect so it lands before the first frame is painted. react-native-web has neither.
  useLayoutEffect(() => {
    if (preference === null || Platform.OS === 'web') return;
    Appearance.setColorScheme(scheme);
    void SystemUI.setBackgroundColorAsync(colors.skyTop);
  }, [preference, scheme, colors]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    // A failed write costs the choice at the next cold start, not now; nothing to show for it.
    writeThemePreference(next).catch(() => undefined);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ name, scheme, colors, preference: name, setPreference }),
    [name, scheme, colors, setPreference]
  );

  if (preference === null || !(fontsLoaded || fontError)) return null;

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/**
 * The one way a component styles itself against the theme. Called at module scope in place of
 * `StyleSheet.create`, it returns a hook; the component calls that hook at render.
 *
 *     const useStyles = themedStyles((colors) => ({ row: { backgroundColor: colors.surface } }));
 *     …
 *     const styles = useStyles();
 *
 * Styles are built once per palette and kept, so a render costs a map lookup.
 */
export function themedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (colors: Palette) => T & StyleSheet.NamedStyles<any>
): () => T {
  const cache = new Map<Palette, T>();

  return function useStyles() {
    const { colors } = useTheme();
    let styles = cache.get(colors);
    if (!styles) {
      styles = StyleSheet.create(factory(colors));
      cache.set(colors, styles);
    }
    return styles;
  };
}
