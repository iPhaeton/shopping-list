import { Pressable, Text, View } from 'react-native';

import { themedStyles } from '../state/ThemeContext';
import { fonts, radius } from '../theme';

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
  /**
   * What the track sits on. `card` (the default) tints whatever card holds it — Account's
   * Appearance, a Sharing member row. `surface` is the invite row's, drawn straight on the sky, so
   * it takes a text field's fill and rim instead.
   */
  track?: 'card' | 'surface';
  /** `compact` is a Sharing member row's, 4pt shorter than the rest. */
  size?: 'regular' | 'compact';
  onChange: (value: T) => void;
};

/**
 * A pill track of radio buttons, the checked one an inset `primary` pill. `RolePicker` and
 * `AccountScreen`'s Appearance. Segments share the width equally, so the checked pill does not
 * change size as it moves. Disabled fades the whole control — the sole owner's own role.
 */
export function SegmentedPicker<T extends string>({
  options,
  value,
  labelFor,
  disabled = false,
  track = 'card',
  size = 'regular',
  onChange,
}: Props<T>) {
  const styles = useStyles();

  return (
    <View
      style={[
        styles.track,
        size === 'compact' && styles.trackCompact,
        track === 'surface' && styles.trackSurface,
        disabled && styles.disabled,
      ]}>
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
            style={[styles.option, checked && styles.optionChecked]}>
            <Text numberOfLines={1} style={[styles.text, checked && styles.textChecked]}>
              {option.title}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = themedStyles((colors) => ({
  track: {
    flexDirection: 'row',
    height: 44,
    padding: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.controlFill,
  },
  trackCompact: {
    height: 40,
  },
  trackSurface: {
    borderColor: colors.surfaceOutline,
    backgroundColor: colors.surface,
  },
  disabled: {
    opacity: 0.45,
  },
  option: {
    flex: 1,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionChecked: {
    backgroundColor: colors.primary,
  },
  text: {
    fontFamily: fonts.sans,
    fontSize: 17,
    color: colors.text,
  },
  textChecked: {
    fontFamily: fonts.sansMedium,
    color: colors.onPrimary,
  },
}));
