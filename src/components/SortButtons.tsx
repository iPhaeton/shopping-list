import { t } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Pressable, Text, View } from 'react-native';

import type { ItemSort, ListSort, SortKey } from '../state/arrange';
import { themedStyles, useTheme } from '../state/ThemeContext';
import { fonts, radius, spacing } from '../theme';
import { ArrowDownIcon, ArrowUpIcon } from './icons';

/** What each button reads as: its label, then its state as `accessibilityValue`. */
function labelFor(key: SortKey): string {
  switch (key) {
    case 'todo':
      return t({ comment: 'VoiceOver only: the sort button that puts items still to do first or last.', message: 'Sort by to do' });
    case 'az':
      return t({ comment: 'VoiceOver only: the sort button that sorts alphabetically.', message: 'Sort by name' });
    case 'date':
      return t({ comment: 'VoiceOver only: the sort button that sorts by when each was added.', message: 'Sort by date added' });
  }
}

/**
 * The sort, one toggle button per key, **left to right in priority order** — the leftmost lit button
 * decides first (List detail `To Do` · `A–Z` · `Date`, Lists `A–Z` · `Date`). A tap moves that key
 * on (`nextSort`): `To Do` and `A–Z` cycle off → on → reversed → off, `Date` only flips its arrow and
 * is always lit.
 *
 * Equal widths, so a face that changes (`A–Z` → `Z–A`) never moves its neighbours. Lit is the
 * `primary` fill; off is the field's `surface`, under the search field it belongs with.
 */
export function SortButtons({
  sort,
  keys,
  onPress,
}: {
  sort: ListSort | ItemSort;
  keys: readonly SortKey[];
  onPress: (key: SortKey) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  // The copy comes from `labelFor` and `describe`, outside render; reading the context re-renders
  // the buttons when the language changes.
  useLingui();

  return (
    <View style={styles.row}>
      {keys.map((key) => {
        const { on, face, value, arrow } = describe(sort, key);
        const ink = on ? colors.onPrimary : colors.text;

        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={labelFor(key)}
            accessibilityValue={{ text: value }}
            onPress={() => onPress(key)}
            style={({ pressed }) => [styles.button, on && styles.buttonOn, pressed && styles.pressed]}>
            <Text numberOfLines={1} style={[styles.face, on && styles.faceOn]}>
              {face}
            </Text>
            {arrow === 'up' ? <ArrowUpIcon color={ink} size={16} /> : null}
            {arrow === 'down' ? <ArrowDownIcon color={ink} size={16} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** A key's face and spoken state. An unlit button shows the face its first tap turns on. */
function describe(
  sort: ListSort | ItemSort,
  key: SortKey
): { on: boolean; face: string; value: string; arrow?: 'up' | 'down' } {
  switch (key) {
    case 'todo': {
      const todo = 'todo' in sort ? sort.todo : null;
      return {
        on: todo !== null,
        face:
          todo === 'last'
            ? t({
                comment:
                  'Sort button (lit): items still to do go last, so done items come first. Fits about 10 characters, one of three equal buttons.',
                message: 'To Do Last',
              })
            : t({
                comment: 'Sort button: items still to do go first. Fits about 10 characters, one of three equal buttons.',
                message: 'To Do First',
              }),
        value:
          todo === null
            ? off()
            : todo === 'first'
              ? t({ comment: 'VoiceOver only: the to-do sort button is on, items still to do first.', message: 'To do first' })
              : t({ comment: 'VoiceOver only: the to-do sort button is on, done items first.', message: 'To do last' }),
      };
    }
    case 'az':
      return {
        on: sort.az !== null,
        face:
          sort.az === 'desc'
            ? t({
                comment: 'Sort button (lit), reverse alphabetical: the last and first letters of the alphabet. Fits about 10 characters.',
                message: 'Z–A',
              })
            : t({
                comment: 'Sort button, alphabetical: the first and last letters of the alphabet. Fits about 10 characters.',
                message: 'A–Z',
              }),
        value:
          sort.az === null
            ? off()
            : sort.az === 'asc'
              ? t({ comment: 'VoiceOver only: a sort order, alphabetical.', message: 'A to Z' })
              : t({ comment: 'VoiceOver only: a sort order, reverse alphabetical.', message: 'Z to A' }),
      };
    case 'date':
      return {
        on: true,
        face: t({
          comment:
            'Sort button (noun): sorts by the date each list or item was added, its arrow showing the direction. Fits about 8 characters beside the arrow.',
          message: 'Date',
        }),
        value:
          sort.date === 'asc'
            ? t({ comment: 'VoiceOver only: the date sort button\'s state, oldest added first.', message: 'Oldest first' })
            : t({ comment: 'VoiceOver only: the date sort button\'s state, newest added first.', message: 'Newest first' }),
        arrow: sort.date === 'asc' ? 'up' : 'down',
      };
  }
}

/** A sort button that is not lit. */
function off(): string {
  return t({ comment: 'VoiceOver only: a sort button is switched off.', message: 'Off' });
}

const useStyles = themedStyles((colors) => ({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginHorizontal: 20,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    height: 36,
    gap: spacing.xs,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.surfaceOutline,
    backgroundColor: colors.surface,
  },
  buttonOn: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  pressed: {
    opacity: 0.7,
  },
  face: {
    fontFamily: fonts.sans,
    fontSize: 15.5,
    color: colors.text,
    letterSpacing: 0,
  },
  faceOn: {
    fontFamily: fonts.sansMedium,
    color: colors.onPrimary,
  },
}));
