import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { searchUsers, type UserSuggestion } from '../lib/membersApi';
import { colors, radius, spacing } from '../theme';

const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 300;

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  onSelect: (user: UserSuggestion) => void;
  /** What the parent currently holds selected — gates the search and hides the suggestion list once
   * something is picked, without this component duplicating state the parent already owns. */
  selected: UserSuggestion | null;
  disabled?: boolean;
};

/**
 * A name field that suggests at most 5 other accounts as you type, debounced so every keystroke
 * doesn't fire a query. Renders its suggestions inline below the input rather than as an overlay —
 * `SharingScreen` is inside a `ScrollView`, and a pushed-down list avoids the z-index/clipping risk
 * an absolute one would carry there.
 */
export function UserAutocomplete({ value, onChangeText, onSelect, selected, disabled = false }: Props) {
  const [suggestions, setSuggestions] = useState<UserSuggestion[]>([]);

  useEffect(() => {
    if (selected) {
      setSuggestions([]);
      return;
    }

    const trimmed = value.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const { users } = await searchUsers(trimmed);
        if (!cancelled) setSuggestions(users ?? []);
      })();
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, selected]);

  return (
    <View>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder="Start typing a name"
        placeholderTextColor={colors.textMuted}
        accessibilityLabel="Name"
        autoCapitalize="words"
        autoCorrect={false}
      />
      {suggestions.length > 0 ? (
        <View style={styles.suggestions}>
          {suggestions.map((user, index) => (
            <Pressable
              key={user.userId}
              accessibilityRole="button"
              accessibilityLabel={`Share with ${user.name}`}
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={() => onSelect(user)}
              style={[styles.suggestion, index > 0 && styles.suggestionDivider]}>
              <Text style={styles.suggestionText}>{user.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    height: 44,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 16,
  },
  suggestions: {
    marginTop: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  suggestion: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  suggestionDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  suggestionText: {
    fontSize: 16,
    color: colors.text,
  },
});
