import { BlurTargetView } from 'expo-blur';
import { createContext, useContext, useRef, type ReactNode, type RefObject } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { themedStyles } from '../state/ThemeContext';

const BlurTargetContext = createContext<RefObject<View | null> | null>(null);

/**
 * What a `Card` above this backdrop blurs, or `null` outside one — a suite rendering a card on its
 * own, say. Only Android reads the ref: iOS and web blur whatever lies behind natively.
 */
export function useBlurTarget(): RefObject<View | null> | null {
  return useContext(BlurTargetContext);
}

/**
 * A screen drawn over fixed art — the sign-in landscape, Account's and Sharing's sky: the art fills
 * the screen and never scrolls, and `children` (the screen's own scrolling content) lie on top.
 *
 * The art sits in a `BlurTargetView`, which is what Android's blur samples (expo-blur's `blurTarget`);
 * on iOS and web it is a plain `View`. The target has to mount before any `Card` does — `BlurView`
 * reads the ref once, on mount — which rendering it first, as an earlier sibling, guarantees.
 *
 * The wrapper, not just the drawing, is `pointerEvents="none"` and hidden from screen readers: on
 * web an absolute layer with the default `auto` eats taps meant for the content above it.
 *
 * **The status bar stays on the art.** The art's own top slice is drawn a second time over the status
 * bar, on top of the content: since the art is fixed to the screen, the slice matches what lies behind
 * it pixel for pixel, so at rest it is invisible — and whatever scrolls up under the clock (a title,
 * a card) disappears beneath it rather than showing through.
 */
export function Backdrop({ art, children }: { art: ReactNode; children: ReactNode }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const target = useRef<View>(null);

  return (
    <View style={styles.screen}>
      <View
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <BlurTargetView ref={target} style={StyleSheet.absoluteFill}>
          {art}
        </BlurTargetView>
      </View>
      <BlurTargetContext.Provider value={target}>{children}</BlurTargetContext.Provider>
      <View
        style={[styles.statusBar, { height: insets.top }]}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        {art}
      </View>
    </View>
  );
}

const useStyles = themedStyles((colors) => ({
  // The sky's own top colour, for whatever the art has not painted yet on a first frame.
  screen: {
    flex: 1,
    backgroundColor: colors.skyTop,
  },
  statusBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
}));
