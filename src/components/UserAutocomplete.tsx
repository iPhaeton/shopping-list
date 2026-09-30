import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { searchUsers, type UserSuggestion } from '../lib/membersApi';
import { themedStyles } from '../state/ThemeContext';
import { fonts, spacing } from '../theme';
import { AddBar } from './AddBar';
import { Avatar } from './Avatar';
import { Card } from './Card';

const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 300;

/** `AddBar`'s height, and the gap the mockup leaves between it and the suggestions. */
const BAR_H = 52;
const SUGGESTIONS_GAP = 6;

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  onSelect: (user: UserSuggestion) => void;
  /** What the parent currently holds selected — gates the search and hides the suggestion list once
   * something is picked, without this component duplicating state the parent already owns. */
  selected: UserSuggestion | null;
  /** Whether `Share` is live — the parent's call: somebody picked, and nothing in flight. */
  canShare: boolean;
  onShare: () => void;
  disabled?: boolean;
};

/**
 * Sharing's invite bar: `AddBar`'s pill — the name field with `Share` inside it, as Lists and List
 * detail put their Create and Add — suggesting at most 5 other accounts as you type, debounced so
 * every keystroke doesn't fire a query.
 *
 * **The suggestions float over whatever lies below the bar** — the header's `Hillside` and the
 * member cards — rather than pushing it down: the bar lives in a pinned header, and a header that
 * grew with every keystroke would shove the whole roster about. So they hang outside this view's
 * bounds, and two things keep them live there. The caller must raise the block holding this bar
 * over its later siblings (`zIndex`), or those draw on top. And a tap outside a parent's frame
 * still reaches a child on iOS only because Fabric keeps hit-testing through a view whose children
 * overflow it (a nonzero `overflowInset`) — the rows below the header's own bottom edge rely on it.
 */
export function UserAutocomplete({
  value,
  onChangeText,
  onSelect,
  selected,
  canShare,
  onShare,
  disabled = false,
}: Props) {
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
      <AddBar
        value={value}
        onChangeText={onChangeText}
        placeholder="Start typing a name"
        accessibilityLabel="Name"
        autoCapitalize="words"
        buttonLabel="Share"
        canSubmit={canShare}
        onSubmit={onShare}
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

// A frosted card of 44pt rows hanging 6pt under the bar, in the bar's own 20pt margins, with a
// deeper shadow than a card resting on the land — it floats over the header and the roster.
const useStyles = themedStyles((colors) => ({
  suggestions: {
    position: 'absolute',
    top: BAR_H + SUGGESTIONS_GAP,
    left: 20,
    right: 20,
    boxShadow: `0px 8px 28px ${colors.barShadow}`,
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
