import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { themedStyles } from '../state/ThemeContext';
import { radius } from '../theme';

/**
 * A round icon button — the Lists header's three, the delete/restore control on a `ListRow`, the
 * rename/delete/restore controls on an `ItemRow`, a Sharing member's remove and an invitation's
 * withdraw, and every screen's drawn back button. `fill`,
 * `outline`, and the icon's own color all come from the caller, since which combination is legible
 * depends on the band, sky or card underneath. With neither, the circle is only a hit target around
 * its glyph.
 */
export function IconButton({
  label,
  value,
  fill,
  outline,
  disabled = false,
  dot = false,
  onPress,
  children,
}: {
  label: string;
  /** Read after the label as its `accessibilityValue` — what the magnifier's dot stands for. */
  value?: string;
  fill?: string;
  /** A 1pt ring in this color — the back button's outlined look, matching `PillButton`. */
  outline?: string;
  /** Faded as a whole, glyph and circle together — Sharing's remove for the sole owner. */
  disabled?: boolean;
  /**
   * A `primary` dot on the top-right of the ring: something here wants a look — a search or sort in
   * effect behind the magnifier, unread notifications behind the bell. Decoration only; `value` is
   * what a screen reader hears.
   */
  dot?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const styles = useStyles();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityValue={value === undefined ? undefined : { text: value }}
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
      {dot ? <View style={styles.dot} /> : null}
    </Pressable>
  );
}

const useStyles = themedStyles((colors) => ({
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
  // 12pt overall, its ring in `skyTop` so it reads as cut out of the outline it sits on — every
  // dotted button sits on the sky.
  dot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.skyTop,
    backgroundColor: colors.primary,
  },
  pressed: {
    opacity: 0.6,
  },
}));
