import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Item } from '../state/types';
import { colors, radius, spacing } from '../theme';

type Props = {
  item: Item;
  /** A `reader` still sees whether an item is done; they just cannot change it. */
  editable?: boolean;
  onToggle: () => void;
  /** Absent for a `reader`, who may neither bin an item nor bring one back. */
  onSetDeleted?: (deleted: boolean) => void;
};

export function ItemRow({ item, editable = true, onToggle, onSetDeleted }: Props) {
  // `doneAt` records when the item was checked off; nothing here shows the time, only the fact.
  const done = item.doneAt !== null;

  // In the bin, and only on screen because "Show deleted" is ticked. It is a real row still — the
  // database keeps it for thirty days — so it stays readable rather than being greyed into
  // illegibility, and the checkbox stops working because there is nothing to check off.
  const deleted = item.deletedAt !== null;

  return (
    <View style={[styles.row, deleted && styles.rowDeleted]}>
      <Pressable
        // Still a checkbox when read-only, and still labelled: the checked state is information a
        // reader wants. Only `disabled` changes, following `AddBar`'s precedent.
        accessibilityRole="checkbox"
        // `|| deleted` belongs in the state and not only on the prop below: on web the `disabled`
        // prop becomes `aria-disabled` and tells the truth by itself, but on native this object is
        // the whole signal, and a screen reader would otherwise offer to check off a binned row.
        accessibilityState={{ checked: done, disabled: !editable || deleted }}
        accessibilityLabel={item.title}
        accessibilityHint={
          editable ? (done ? 'Marks this item as not done' : 'Marks this item as done') : undefined
        }
        disabled={!editable || deleted}
        onPress={onToggle}
        style={({ pressed }) => [styles.tap, pressed && editable && styles.rowPressed]}>
        <View style={[styles.checkbox, done && styles.checkboxChecked]}>
          {done ? <Text style={styles.check}>✓</Text> : null}
        </View>
        <Text style={[styles.title, done && styles.titleDone]}>{item.title}</Text>
      </Pressable>

      {deleted ? <Text style={styles.tag}>Deleted</Text> : null}

      {onSetDeleted ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${deleted ? 'Restore' : 'Delete'} ${item.title}`}
          onPress={() => onSetDeleted(!deleted)}
          style={({ pressed }) => [styles.action, pressed && styles.rowPressed]}>
          <Text style={styles.actionText}>{deleted ? 'Restore' : 'Delete'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingRight: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowDeleted: {
    backgroundColor: colors.background,
  },
  // The padding lives on the tappable half so the whole title row stays a comfortable target.
  tap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  rowPressed: {
    opacity: 0.7,
  },
  tag: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  action: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  actionText: {
    fontSize: 14,
    color: colors.accent,
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
