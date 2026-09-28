import { BlurView } from 'expo-blur';
import type { ReactNode } from 'react';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import { Platform, StyleSheet, View } from 'react-native';

import { themedStyles, useTheme } from '../state/ThemeContext';
import { radius } from '../theme';
import { useBlurTarget } from './Backdrop';

/**
 * A frosted card: whatever lies behind it — the land on Sign in, the sky and its stars on Account
 * and Sharing — blurred, then `cardFill` over that, a white rim by day, and a soft shadow (none by
 * night, where `barShadow` is transparent). Every step-5 mockup draws its cards this way; over the
 * sign-in bands, the blur is what keeps a band's edge from showing through the card as a hard line.
 *
 * The blur lives in its own clipped layer because `BlurView` ignores `borderRadius`, and the shadow
 * on the outer view because a clip would cut it off. Outside a `Backdrop` there is nothing to blur
 * on Android, so the card is `cardFill` alone.
 *
 * `style` pads and places the card; its content is the caller's.
 */
export function Card({
  children,
  style,
  onLayout,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const styles = useStyles();
  const { name } = useTheme();
  const target = useBlurTarget();
  const blur = Platform.OS !== 'android' || target !== null;

  return (
    <View style={[styles.card, style]} onLayout={onLayout}>
      <View style={styles.clip} pointerEvents="none">
        {blur ? (
          <BlurView
            tint={name === 'night' ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
            intensity={50}
            blurTarget={target ?? undefined}
            blurMethod="dimezisBlurViewSdk31Plus"
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <View style={styles.fill} />
      </View>
      {children}
    </View>
  );
}

const useStyles = themedStyles((colors) => ({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.surfaceOutline,
    boxShadow: `0px 4px 18px ${colors.barShadow}`,
  },
  // Inside the border: an absolute child is laid out in the padding box, so its corners are the
  // card's radius less the 1pt rim.
  clip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.lg - 1,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.cardFill,
  },
}));
