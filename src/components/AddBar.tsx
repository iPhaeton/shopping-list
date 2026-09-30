import { useState } from 'react';
import type { TextInputProps } from 'react-native';
import { Pressable, Text, TextInput, View } from 'react-native';

import { themedStyles, useTheme } from '../state/ThemeContext';
import { fonts, radius, spacing } from '../theme';

type Props = {
  placeholder: string;
  /** Label for the submit button, also used as its accessibility label. */
  buttonLabel: string;
  /** What the field starts with. For editing something that already has a value, like a list name. */
  initialValue?: string;
  autoFocus?: boolean;
  onSubmit: (value: string) => void;
  /** Adds a `Cancel` button before the submit one — for an editor that replaces something else
   * while it is open, like `ItemRow`'s rename. */
  onCancel?: () => void;
  /** The field's own label, where its placeholder is not the right name for it — Sharing's `Name`.
   * Defaults to the placeholder. */
  accessibilityLabel?: string;
  /**
   * Hands the text to the caller: set, and the bar shows `value` and reports edits through
   * `onChangeText` instead of keeping a draft, and never clears itself — Sharing's invite field,
   * whose text drives a search and whose submit may fail.
   */
  value?: string;
  onChangeText?: (text: string) => void;
  /** Whether the button is live, where "has non-blank text" is not the rule — Sharing's needs a
   * person picked from its suggestions. */
  canSubmit?: boolean;
  autoCapitalize?: TextInputProps['autoCapitalize'];
};

/**
 * Text field + submit button: adding a list or an item, renaming a list, sharing a list (through
 * `UserAutocomplete`), and — through `onCancel` — `ItemRow`'s in-place rename. Owns its own draft
 * text and clears it once a non-blank value has been handed to `onSubmit`, unless the caller holds
 * the text through `value`.
 *
 * `initialValue` seeds that draft on mount only — it is a starting point, not a controlled value, so
 * a bar that is open while the underlying name changes keeps what the user is typing.
 */
export function AddBar({
  placeholder,
  buttonLabel,
  initialValue = '',
  autoFocus = false,
  onSubmit,
  onCancel,
  accessibilityLabel = placeholder,
  value: controlledValue,
  onChangeText,
  canSubmit: submittable,
  autoCapitalize,
}: Props) {
  const styles = useStyles();
  const { colors, scheme } = useTheme();
  const [draft, setDraft] = useState(initialValue);
  const controlled = controlledValue !== undefined;
  const value = controlled ? controlledValue : draft;
  const canSubmit = submittable ?? value.trim().length > 0;

  function change(text: string) {
    if (!controlled) setDraft(text);
    onChangeText?.(text);
  }

  function submit() {
    if (!canSubmit) return;
    onSubmit(value);
    if (!controlled) setDraft('');
  }

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={change}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardAppearance={scheme}
        selectionColor={colors.primary}
        accessibilityLabel={accessibilityLabel}
        autoCapitalize={autoCapitalize}
        autoFocus={autoFocus}
        returnKeyType="done"
        onSubmitEditing={submit}
        autoCorrect={false}
      />
      {onCancel ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={onCancel}
          hitSlop={4}
          style={({ pressed }) => [styles.cancel, pressed && styles.buttonPressed]}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={buttonLabel}
        accessibilityState={{ disabled: !canSubmit }}
        disabled={!canSubmit}
        onPress={submit}
        style={({ pressed }) => [
          styles.button,
          !canSubmit && styles.buttonDisabled,
          pressed && canSubmit && styles.buttonPressed,
        ]}>
        <Text style={styles.buttonText}>{buttonLabel}</Text>
      </Pressable>
    </View>
  );
}

// One pill: a borderless input flush against a filled pill button, both riding inside a single
// outlined pill container. `container` owns its own horizontal placement (`marginHorizontal`, the
// 20pt both mockups put it at) the way the pre-mockup card did; vertical spacing between it and its
// neighbors is the caller's, since the rhythm differs between the Lists header, List detail's
// header, and an item row.
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
    // Set, not left to the default: iOS reuses native text inputs, and one that was the code
    // field keeps its letter spacing unless told otherwise. See `codeInput` in `SignInScreen`.
    letterSpacing: 0,
  },
  // Plain text in the full ink, not `textMuted`: on `surface` that falls short of AA.
  cancel: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  cancelText: {
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: 17,
  },
  button: {
    height: 40,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    backgroundColor: colors.primaryDisabled,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: colors.onPrimary,
    fontFamily: fonts.sansSemiBold,
    fontSize: 17,
  },
}));
