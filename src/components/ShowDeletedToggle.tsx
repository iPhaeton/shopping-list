import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme';

/**
 * The bin, behind a checkbox.
 *
 * **Rendered only when there is something in it** — `count` of zero means both screens leave this
 * out entirely. A toggle that reveals nothing is noise, and the app has no other permanently visible
 * control that does nothing when pressed.
 *
 * The state is the screen's own `useState` rather than a stored preference: no new storage key, no
 * version to bump, nothing to migrate, and it resets to hidden every time you arrive — which is the
 * right default, since the bin is somewhere you go deliberately. The cost is re-ticking it on each
 * screen, and that is accepted.
 *
 * Deleted rows ship in the same fetch as live ones, so ticking this is instant: no spinner and no
 * round trip. That is a large part of why this reads better than a separate "trash" screen would.
 */
export function ShowDeletedToggle({
  checked,
  count,
  onChange,
}: {
  checked: boolean;
  /** How many deleted rows are hiding behind it. */
  count: number;
  onChange: (checked: boolean) => void;
}) {
  const label = count === 1 ? 'Show 1 deleted' : `Show ${count} deleted`;

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={() => onChange(!checked)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={[styles.box, checked && styles.boxChecked]}>
        {checked ? <Text style={styles.check}>✓</Text> : null}
      </View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  rowPressed: {
    opacity: 0.7,
  },
  box: {
    width: 18,
    height: 18,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  check: {
    color: colors.onAccent,
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '700',
  },
  label: {
    fontSize: 14,
    color: colors.textMuted,
  },
});
