import type { TextInputProps } from 'react-native';
import { TextInput } from 'react-native';

import { themedStyles, useTheme } from '../state/ThemeContext';
import { fonts, radius } from '../theme';

type Props = Omit<TextInputProps, 'placeholderTextColor' | 'keyboardAppearance' | 'selectionColor'>;

/**
 * The pill text field every form uses: 52 tall, 17pt sans, and the three native colors — the
 * placeholder, the keyboard, the caret — taken from the theme so no call site can forget one.
 * Everything else, the accessibility label included, is passed straight through; `style` is laid
 * over the pill (the code field's centered, spaced digits).
 */
export function TextField({ style, ...props }: Props) {
  const styles = useStyles();
  const { colors, scheme } = useTheme();

  return (
    <TextInput
      {...props}
      style={[styles.field, style]}
      placeholderTextColor={colors.textMuted}
      keyboardAppearance={scheme}
      selectionColor={colors.primary}
    />
  );
}

const useStyles = themedStyles((colors) => ({
  field: {
    // A no-op on native. On web a text input is not positioned by default, so inside a `Card` the
    // absolutely positioned blur layer painted over it and blurred the field itself.
    position: 'relative',
    height: 52,
    paddingHorizontal: 20,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.fieldOutline,
    backgroundColor: colors.fieldFill,
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: 17,
    // Set, not left to the default: iOS reuses native text inputs, and one that was the code field
    // would keep its letter spacing — every placeholder after it came out spaced.
    letterSpacing: 0,
  },
}));
