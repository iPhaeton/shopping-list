import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radius, spacing } from '../theme';

type Props = {
  placeholder: string;
  /** Label for the submit button, also used as its accessibility label. */
  buttonLabel: string;
  onSubmit: (value: string) => void;
};

/**
 * Text field + submit button, shared by both screens. Owns its own draft text and
 * clears it once a non-blank value has been handed to `onSubmit`.
 */
export function AddBar({ placeholder, buttonLabel, onSubmit }: Props) {
  const [value, setValue] = useState('');
  const canSubmit = value.trim().length > 0;

  function submit() {
    if (!canSubmit) return;
    onSubmit(value);
    setValue('');
  }

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={placeholder}
        returnKeyType="done"
        onSubmitEditing={submit}
        autoCorrect={false}
      />
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

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  input: {
    flex: 1,
    height: 44,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: 16,
  },
  button: {
    height: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    backgroundColor: colors.accentDisabled,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: colors.onAccent,
    fontSize: 16,
    fontWeight: '600',
  },
});
