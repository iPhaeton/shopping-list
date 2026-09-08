import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Role } from '../state/types';
import { colors, radius, spacing } from '../theme';

/** Declaration order, weakest first — the same order the database's enum is written in. */
const ROLES: Role[] = ['reader', 'writer', 'owner'];

const TITLES: Record<Role, string> = { reader: 'Reader', writer: 'Writer', owner: 'Owner' };

type Props = {
  value: Role;
  /**
   * How to name one option, so two pickers on the same screen never collide in a query:
   * `Share as reader` in the invite form, `Set bob@example.com to writer` on a member row.
   */
  labelFor: (role: Role) => string;
  disabled?: boolean;
  onChange: (role: Role) => void;
};

export function RolePicker({ value, labelFor, disabled = false, onChange }: Props) {
  return (
    <View style={styles.group}>
      {ROLES.map((role) => {
        const checked = role === value;

        return (
          <Pressable
            key={role}
            accessibilityRole="radio"
            accessibilityState={{ checked, disabled }}
            accessibilityLabel={labelFor(role)}
            disabled={disabled}
            onPress={() => onChange(role)}
            style={[styles.option, checked && styles.optionChecked, disabled && styles.optionDisabled]}>
            <Text style={[styles.text, checked && styles.textChecked]}>{TITLES[role]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  option: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  optionChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  optionDisabled: {
    opacity: 0.5,
  },
  text: {
    fontSize: 14,
    color: colors.text,
  },
  textChecked: {
    color: colors.onAccent,
    fontWeight: '600',
  },
});
