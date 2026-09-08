import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, spacing } from '../theme';

/**
 * A text button for a navigation header, wired up through `navigation.setOptions`.
 *
 * `SignOutButton` is the same shape and deliberately not refactored onto this: it carries its own
 * `accessibilityLabel`, and the knowledgebase entry covering a11y queries pins that with a `grep`
 * that `npm run kb:audit` runs. The duplication is ten lines of styles and is worth less than a
 * green audit; hand it to the librarian rather than fixing it here.
 */
export function HeaderButton({
  label,
  disabled = false,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <Text style={[styles.text, disabled && styles.textDisabled]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  pressed: {
    opacity: 0.6,
  },
  text: {
    color: colors.accent,
    fontSize: 16,
  },
  textDisabled: {
    color: colors.textMuted,
  },
});
