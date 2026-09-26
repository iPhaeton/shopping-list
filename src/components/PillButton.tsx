import { Pressable, Text } from 'react-native';

import { themedStyles } from '../state/ThemeContext';
import { fonts, radius, spacing } from '../theme';

/**
 * An outlined pill button — the header's "Account" entry point here, and step 4's Rename/Share.
 * Visible text and the a11y label may differ (`BlockedBanner`'s `Discard` is the precedent); this
 * screen's Account button uses the same string for both.
 */
export function PillButton({
  label,
  visibleLabel = label,
  onPress,
}: {
  label: string;
  visibleLabel?: string;
  onPress: () => void;
}) {
  const styles = useStyles();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.pill, pressed && styles.pressed]}>
      <Text style={styles.text}>{visibleLabel}</Text>
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
  pressed: {
    opacity: 0.6,
  },
  text: {
    fontFamily: fonts.sans,
    fontSize: 17,
    color: colors.text,
    letterSpacing: 0,
  },
}));
