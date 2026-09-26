import type { ReactNode } from 'react';
import { Pressable } from 'react-native';

import { themedStyles } from '../state/ThemeContext';
import { radius } from '../theme';

/**
 * A round, translucent icon button — the delete/restore control on a `ListRow`, and step 4's
 * rename/delete controls on an `ItemRow`. `fill` and the icon's own color both come from the
 * caller, since which pair is legible depends on the band or surface underneath.
 */
export function IconButton({
  label,
  fill,
  onPress,
  children,
}: {
  label: string;
  fill: string;
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
      style={({ pressed }) => [styles.button, { backgroundColor: fill }, pressed && styles.pressed]}>
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
