import type { ReactNode } from 'react';
import { Pressable } from 'react-native';

import { themedStyles } from '../state/ThemeContext';
import { radius } from '../theme';

/**
 * A round icon button — the delete/restore control on a `ListRow`, the rename/delete/restore
 * controls on an `ItemRow`, a Sharing member's remove, and every screen's drawn back button. `fill`,
 * `outline`, and the icon's own color all come from the caller, since which combination is legible
 * depends on the band, sky or card underneath. With neither, the circle is only a hit target around
 * its glyph.
 */
export function IconButton({
  label,
  fill,
  outline,
  disabled = false,
  onPress,
  children,
}: {
  label: string;
  fill?: string;
  /** A 1pt ring in this color — the back button's outlined look, matching `PillButton`. */
  outline?: string;
  /** Faded as a whole, glyph and circle together — Sharing's remove for the sole owner. */
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const styles = useStyles();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.button,
        fill !== undefined && { backgroundColor: fill },
        outline !== undefined && { borderWidth: 1, borderColor: outline },
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}>
      {children}
    </Pressable>
  );
}

const useStyles = themedStyles(() => ({
  button: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.6,
  },
}));
