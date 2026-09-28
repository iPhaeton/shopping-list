import type { StyleProp, ViewStyle } from 'react-native';
import { Text, View } from 'react-native';

import { themedStyles } from '../state/ThemeContext';
import { fonts, radius, spacing } from '../theme';

/**
 * A write the database *refused*, or a read that came back with nothing to show. Not a write that
 * merely has not landed yet — those are queued and retried, and `SyncBanner` says so quietly.
 *
 * By the time this renders, the state behind it has been re-fetched, so what the user sees
 * underneath is what the database holds.
 */
export function ErrorBanner({ message, style }: { message: string; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();

  return (
    <View accessibilityRole="alert" style={[styles.banner, style]}>
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

// A notice card in the pill language: the sync banner's fill, rounded to `radius.lg` because the
// message can run to several lines, and the error color carried by the ring and the text alone. The
// margins suit a banner across a screen; one inside a card (Account's name, the sign-in forms) passes
// `style` to drop them.
const useStyles = themedStyles((colors) => ({
  banner: {
    marginHorizontal: 20,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.bannerSurface,
  },
  text: {
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.error,
  },
}));
