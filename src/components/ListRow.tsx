import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { List } from '../state/types';
import { colors, radius, spacing } from '../theme';

export function ListRow({
  list,
  onPress,
  onSetDeleted,
}: {
  list: List;
  onPress: () => void;
  /** Absent for anyone but an owner, who alone may bin a list or bring one back. */
  onSetDeleted?: (deleted: boolean) => void;
}) {
  const deleted = list.deletedAt !== null;

  // Somebody else's list that you have been given access to. It deliberately does not say *how
  // widely* a list you own is shared: the `list_members` select policy shows you your own row only,
  // so any count the client could compute would read `1` for everybody — convincing, and wrong.
  const shared = list.role !== 'owner';

  return (
    <View style={[styles.row, deleted && styles.rowDeleted]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={shared ? `${list.name}, shared with you` : list.name}
        onPress={onPress}
        style={({ pressed }) => [styles.tap, pressed && styles.rowPressed]}>
        <View style={styles.text}>
          <Text style={styles.name}>{list.name}</Text>
          {shared ? <Text style={styles.summary}>Shared with you</Text> : null}
          {deleted ? <Text style={styles.tag}>Deleted</Text> : null}
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>

      {onSetDeleted ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${deleted ? 'Restore' : 'Delete'} ${list.name}`}
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
  // The padding lives on the tappable half so the whole row stays a comfortable target.
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
