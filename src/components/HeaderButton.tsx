import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, spacing } from '../theme';

/**
 * A text button for a navigation header. Used both from inside a screen via
 * `navigation.setOptions` (`ListDetailScreen`'s Rename/Share buttons) and from a static
 * `Stack.Screen` `options` function (`RootNavigator`'s Account entry point on `Lists`).
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
