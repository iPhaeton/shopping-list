import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme';

/**
 * Writes go to the database in the background, so they can fail after the screen has already moved.
 * This is where that gets said out loud — the state behind it has been re-fetched, so what the user
 * sees underneath is what the database holds.
 */
export function ErrorBanner({ message }: { message: string }) {
  return (
    <View accessibilityRole="alert" style={styles.banner}>
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
    fontSize: 15,
    color: colors.error,
  },
});
