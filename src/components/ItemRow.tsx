import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Item } from '../state/types';
import { colors, radius, spacing } from '../theme';

type Props = {
  item: Item;
  /** A `reader` still sees whether an item is done; they just cannot change it. */
  editable?: boolean;
  onToggle: () => void;
};

export function ItemRow({ item, editable = true, onToggle }: Props) {
  // `doneAt` records when the item was checked off; nothing here shows the time, only the fact.
  const done = item.doneAt !== null;

  return (
    <Pressable
      // Still a checkbox when read-only, and still labelled: the checked state is information a
      // reader wants. Only `disabled` changes, following `AddBar`'s precedent.
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done, disabled: !editable }}
      accessibilityLabel={item.title}
      accessibilityHint={
        editable ? (done ? 'Marks this item as not done' : 'Marks this item as done') : undefined
      }
      disabled={!editable}
      onPress={onToggle}
      style={({ pressed }) => [styles.row, pressed && editable && styles.rowPressed]}>
      <View style={[styles.checkbox, done && styles.checkboxChecked]}>
        {done ? <Text style={styles.check}>✓</Text> : null}
      </View>
      <Text style={[styles.title, done && styles.titleDone]}>{item.title}</Text>
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
