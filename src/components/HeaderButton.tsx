import { Pressable, Text } from 'react-native';

import { themedStyles } from '../state/ThemeContext';
import { fonts, spacing } from '../theme';

/**
 * A text button for a native navigation header, set via `navigation.setOptions`
 * (`ListDetailScreen`'s Rename/Share buttons). Since task 20 step 3, `Lists` no longer uses a
 * native header — its Account entry point is `PillButton`, drawn inside `ListsScreen` itself as
 * part of the sky/horizon composition — so this component now has one call site, not two.
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
  const styles = useStyles();

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

const useStyles = themedStyles((colors) => ({
  button: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  pressed: {
    opacity: 0.6,
  },
  text: {
    color: colors.primary,
    fontFamily: fonts.sans,
    fontSize: 16,
  },
  textDisabled: {
    color: colors.textMuted,
  },
}));
