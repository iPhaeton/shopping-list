import * as SplashScreen from 'expo-splash-screen';

let hidden = false;

/**
 * Lets the native launch screen go, once — called by whatever `RootNavigator` puts on screen first,
 * the moment it is fully there: the loading view once its emblem image has loaded (an image decodes
 * asynchronously, and a splash hidden before that uncovered the sky without it for a second), or the
 * navigator once it is ready. Both render only after `ThemeProvider`'s gate, so the frame the splash
 * uncovers is already in the right theme.
 */
export function hideSplash() {
  if (hidden) return;
  hidden = true;
  SplashScreen.hide();
}
