import { Pressable, Text } from 'react-native';

import { themedStyles } from '../state/ThemeContext';
import { fonts, radius, spacing } from '../theme';

/**
 * A pill button. `outline` (the default) is the quiet one — Lists' Account, List detail's
 * Rename/Share, `BlockedBanner`'s Discard. `filled` is the one action a notice is asking for —
 * restoring a binned list, or a blocked write's restore — in the same primary fill as `AddBar`'s
 * submit.
 *
 * Visible text and the a11y label may differ (`BlockedBanner`'s `Discard` is the precedent, and
 * List detail's `Rename`/`Share` read `Rename list`/`Share list`); by default they are the same.
 */
export function PillButton({
  label,
  visibleLabel = label,
  variant = 'outline',
  onPress,
}: {
  label: string;
  visibleLabel?: string;
  variant?: 'outline' | 'filled';
  onPress: () => void;
}) {
  const styles = useStyles();
  const filled = variant === 'filled';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.pill, filled && styles.pillFilled, pressed && styles.pressed]}>
      <Text style={[styles.text, filled && styles.textFilled]}>{visibleLabel}</Text>
    </Pressable>
  );
}

const useStyles = themedStyles((colors) => ({
  pill: {
    height: 36,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillFilled: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  pressed: {
    opacity: 0.6,
  },
  text: {
    fontFamily: fonts.sans,
    fontSize: 17,
    color: colors.text,
    letterSpacing: 0,
  },
  textFilled: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 16,
    color: colors.onPrimary,
  },
}));
