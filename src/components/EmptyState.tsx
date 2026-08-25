import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '../theme';

export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.hint}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl * 2,
    gap: spacing.sm,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  hint: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
