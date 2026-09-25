import { Pressable, Text, View } from 'react-native';

import { themedStyles } from '../state/ThemeContext';
import { fonts, radius, spacing } from '../theme';

export type SegmentedOption<T extends string> = { value: T; title: string };

type Props<T extends string> = {
  options: readonly SegmentedOption<T>[];
  value: T;
  /**
   * How to name one option, so two pickers on the same screen never collide in a query:
   * `Share as reader` in the invite form, `Set bob@example.com to writer` on a member row.
   */
  labelFor: (value: T) => string;
  disabled?: boolean;
  onChange: (value: T) => void;
};

/** A row of radio buttons, one of them checked. `RolePicker` and `AccountScreen`'s Appearance. */
export function SegmentedPicker<T extends string>({
  options,
  value,
  labelFor,
  disabled = false,
  onChange,
}: Props<T>) {
  const styles = useStyles();

  return (
    <View style={styles.group}>
      {options.map((option) => {
        const checked = option.value === value;

        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked, disabled }}
            accessibilityLabel={labelFor(option.value)}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={[styles.option, checked && styles.optionChecked, disabled && styles.optionDisabled]}>
            <Text style={[styles.text, checked && styles.textChecked]}>{option.title}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = themedStyles((colors) => ({
  group: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  option: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.outline,
    backgroundColor: colors.surface,
  },
  optionChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  optionDisabled: {
    opacity: 0.5,
  },
  text: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.text,
  },
  textChecked: {
    fontFamily: fonts.sansSemiBold,
    color: colors.onPrimary,
  },
}));
