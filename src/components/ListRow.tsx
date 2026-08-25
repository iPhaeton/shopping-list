import { Pressable, StyleSheet, Text, View } from 'react-native';

import { countDone } from '../state/listsReducer';
import type { List } from '../state/types';
import { colors, radius, spacing } from '../theme';

export function ListRow({ list, onPress }: { list: List; onPress: () => void }) {
  const done = countDone(list);
  const summary =
    list.items.length === 0 ? 'No items yet' : `${done} of ${list.items.length} done`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${list.name}, ${summary}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={styles.text}>
        <Text style={styles.name}>{list.name}</Text>
        <Text style={styles.summary}>{summary}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowPressed: {
    opacity: 0.7,
  },
  text: {
    flex: 1,
    gap: spacing.xs,
  },
  name: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  summary: {
    fontSize: 14,
    color: colors.textMuted,
  },
  chevron: {
    fontSize: 24,
    lineHeight: 24,
    color: colors.textMuted,
  },
});
