import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Pressable, Text } from 'react-native';

import { themedStyles } from '../state/ThemeContext';
import { fonts, radius, spacing } from '../theme';

/**
 * A pill button. `outline` (the default) is the quiet one — Lists' Account, List detail's
 * Rename/Share, `BlockedBanner`'s Discard, Account's Sign out. `filled` is the one action a screen or
 * notice is asking for — Send code, Save name, restoring a binned list — in the same primary fill as
 * `AddBar`'s submit. `danger` is the confirmed destructive step (Remove, Leave list, sign out
 * everywhere); the button that only *opens* such a confirm stays `outline` with `tone="danger"`.
 *
 * Three heights, all measured off the mockups: `sm` 36 (header pills, Edit), `md` 46 (the two-button
 * rows of a confirm or an editor), `lg` 52 (a card's own action, as tall as its text field).
 *
 * Visible text and the a11y label may differ (`BlockedBanner`'s `Discard` is the precedent, and
 * List detail's `Rename`/`Share` read `Rename list`/`Share list`); by default they are the same. A
 * label that stays put while the visible text changes — `Saving…`, `Removing…` — is the same
 * mechanism.
 */
export function PillButton({
  label,
  visibleLabel = label,
  variant = 'outline',
  tone = 'default',
  size = 'sm',
  disabled = false,
  icon,
  style,
  onPress,
}: {
  label: string;
  visibleLabel?: string;
  variant?: 'outline' | 'filled' | 'danger';
  /** Only for `outline`: error-coloured text on the usual ring. */
  tone?: 'default' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  /** Drawn before the text — the G on `Continue with Google`. */
  icon?: ReactNode;
  /** Layout only — `flex`, margins, alignment. */
  style?: StyleProp<ViewStyle>;
  onPress: () => void;
}) {
  const styles = useStyles();
  const filled = variant === 'filled';
  const danger = variant === 'danger';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.pill,
        styles[size],
        filled && styles.pillFilled,
        filled && disabled && styles.pillFilledDisabled,
        danger && styles.pillDanger,
        !filled && disabled && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}>
      {icon}
      <Text
        numberOfLines={1}
        style={[
          styles.text,
          size !== 'sm' && styles.textTall,
          tone === 'danger' && styles.textDanger,
          filled && styles.textFilled,
          danger && styles.textOnDanger,
          size === 'lg' && styles.textLarge,
        ]}>
        {visibleLabel}
      </Text>
    </Pressable>
  );
}

const useStyles = themedStyles((colors) => ({
  pill: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sm: {
    height: 36,
  },
  md: {
    height: 46,
    paddingHorizontal: 22,
  },
  lg: {
    height: 52,
    paddingHorizontal: 22,
  },
  pillFilled: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  pillFilledDisabled: {
    borderColor: colors.primaryDisabled,
    backgroundColor: colors.primaryDisabled,
  },
  pillDanger: {
    borderColor: colors.error,
    backgroundColor: colors.error,
  },
  disabled: {
    opacity: 0.45,
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
  // Label sizes as the mockups draw them: 17 on a small outline pill (16 filled), 16 on a 46pt pill,
  // 17 on a 52pt one, whatever its weight.
  textTall: {
    fontFamily: fonts.sansMedium,
    fontSize: 16,
  },
  textLarge: {
    fontSize: 17,
  },
  textDanger: {
    color: colors.error,
  },
  textFilled: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 16,
    color: colors.onPrimary,
  },
  textOnDanger: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 16,
    color: colors.onError,
  },
}));
