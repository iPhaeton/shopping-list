import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Item } from '../state/types';
import { colors, radius, spacing } from '../theme';

export function ItemRow({ item, onToggle }: { item: Item; onToggle: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: item.done }}
      accessibilityLabel={item.title}
      accessibilityHint={item.done ? 'Marks this item as not done' : 'Marks this item as done'}
      onPress={onToggle}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={[styles.checkbox, item.done && styles.checkboxChecked]}>
        {item.done ? <Text style={styles.check}>✓</Text> : null}
      </View>
      <Text style={[styles.title, item.done && styles.titleDone]}>{item.title}</Text>
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
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  check: {
    color: colors.onAccent,
    fontSize: 14,
    lineHeight: 16,
    fontWeight: '700',
  },
  title: {
    flex: 1,
    fontSize: 17,
    color: colors.text,
  },
  titleDone: {
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
});
