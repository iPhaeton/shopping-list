import type { ReactNode } from 'react';
import { Pressable } from 'react-native';

import { themedStyles } from '../state/ThemeContext';
import { radius } from '../theme';

/**
 * A round icon button — the delete/restore control on a `ListRow`, the rename/delete/restore
 * controls on an `ItemRow`, and List detail's back button. `fill`, `outline`, and the icon's own
 * color all come from the caller, since which combination is legible depends on the band, ground,
 * or sky underneath. With neither, the circle is only a hit target around its glyph.
 */
export function IconButton({
  label,
  fill,
  outline,
  onPress,
  children,
}: {
  label: string;
  fill?: string;
  /** A 1pt ring in this color — the back button's outlined look, matching `PillButton`. */
  outline?: string;
  onPress: () => void;
  children: ReactNode;
}) {
  const styles = useStyles();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.button,
        fill !== undefined && { backgroundColor: fill },
        outline !== undefined && { borderWidth: 1, borderColor: outline },
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
  pressed: {
    opacity: 0.6,
  },
}));
