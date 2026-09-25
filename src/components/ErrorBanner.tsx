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
export function ErrorBanner({ message }: { message: string }) {
  const styles = useStyles();

  return (
    <View accessibilityRole="alert" style={styles.banner}>
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const useStyles = themedStyles((colors) => ({
  banner: {
    margin: spacing.lg,
    marginBottom: 0,
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.surface,
  },
  text: {
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.error,
  },
}));
