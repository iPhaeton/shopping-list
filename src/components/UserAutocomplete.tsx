import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { searchUsers, type UserSuggestion } from '../lib/membersApi';
import { themedStyles } from '../state/ThemeContext';
import { fonts, spacing } from '../theme';
import { Avatar } from './Avatar';
import { Card } from './Card';
import { TextField } from './TextField';

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
  const styles = useStyles();
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
      <TextField
        on="sky"
        value={value}
        onChangeText={onChangeText}
        placeholder="Start typing a name"
        accessibilityLabel="Name"
        autoCapitalize="words"
        autoCorrect={false}
      />
      {suggestions.length > 0 ? (
        <Card style={styles.suggestions}>
          {suggestions.map((user, index) => (
            <Pressable
              key={user.userId}
              accessibilityRole="button"
              accessibilityLabel={`Share with ${user.name}`}
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={() => onSelect(user)}
              style={({ pressed }) => [
                styles.suggestion,
                index > 0 && styles.suggestionDivider,
                pressed && styles.pressed,
              ]}>
              <Avatar id={user.userId} name={user.name} size={30} />
              <Text style={styles.suggestionText} numberOfLines={1}>
                {user.name}
              </Text>
            </Pressable>
          ))}
        </Card>
      ) : null}
    </View>
  );
}

// The field on the sky, in `AddBar`'s surface; the suggestions a frosted card of 44pt rows under it,
// as the owner's Sharing mockup draws them.
const useStyles = themedStyles((colors) => ({
  suggestions: {
    marginTop: 6,
  },
  suggestion: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: 15,
  },
  suggestionDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  pressed: {
    opacity: 0.6,
  },
  suggestionText: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 17,
    color: colors.text,
  },
}));
