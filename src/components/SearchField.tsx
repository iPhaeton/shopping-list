import { Pressable, TextInput, View } from 'react-native';

import { themedStyles, useTheme } from '../state/ThemeContext';
import { fonts, radius, spacing } from '../theme';
import { CloseIcon, SearchIcon } from './icons';

/**
 * The search field, on `AddBar`'s surface — outline, shadow, the 20pt inset — in the Create / Add
 * bar's place while a screen is in search mode. The text is the screen's: it filters as it is typed,
 * with no submit and no debounce.
 *
 * The × (`Clear search`) shows only while there is something to clear. There is no `Cancel`:
 * search is the resting state, so there is no panel to close. When the × is absent its 44pt stays,
 * so typing the first letter moves nothing.
 */
export function SearchField({
  placeholder,
  value,
  onChangeText,
}: {
  /** Also the field's label: `Search lists` / `Search items`. */
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
}) {
  const styles = useStyles();
  const { colors, scheme } = useTheme();

  return (
    <View style={styles.container}>
      <SearchIcon color={colors.textMuted} size={18} />
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardAppearance={scheme}
        selectionColor={colors.primary}
        accessibilityLabel={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChangeText('')}
          hitSlop={4}
          style={({ pressed }) => [styles.clear, pressed && styles.pressed]}>
          <CloseIcon color={colors.textMuted} size={18} />
        </Pressable>
      ) : (
        <View style={styles.clear} />
      )}
    </View>
  );
}

const useStyles = themedStyles((colors) => ({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    marginHorizontal: 20,
    gap: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.surfaceOutline,
    backgroundColor: colors.surface,
    boxShadow: `0px 3px 16px ${colors.barShadow}`,
  },
  input: {
    flex: 1,
    height: '100%',
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: 17,
    // Set, not left to the default: iOS reuses native text inputs — see `AddBar`.
    letterSpacing: 0,
  },
  clear: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
}));
