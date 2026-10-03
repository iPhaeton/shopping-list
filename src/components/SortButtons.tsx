import { Pressable, Text, View } from 'react-native';

import type { ItemSort, ListSort, SortKey } from '../state/arrange';
import { themedStyles, useTheme } from '../state/ThemeContext';
import { fonts, radius, spacing } from '../theme';
import { ArrowDownIcon, ArrowUpIcon } from './icons';

/** What each button reads as: its label, then its state as `accessibilityValue`. */
const LABELS: Record<SortKey, string> = {
  todo: 'Sort by to do',
  az: 'Sort by name',
  date: 'Sort by date added',
};

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

  return (
    <View style={styles.row}>
      {keys.map((key) => {
        const { on, face, value, arrow } = describe(sort, key);
        const ink = on ? colors.onPrimary : colors.text;

        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={LABELS[key]}
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
        face: todo === 'last' ? 'To Do Last' : 'To Do First',
        value: todo === null ? 'Off' : todo === 'first' ? 'To do first' : 'To do last',
      };
    }
    case 'az':
      return {
        on: sort.az !== null,
        face: sort.az === 'desc' ? 'Z–A' : 'A–Z',
        value: sort.az === null ? 'Off' : sort.az === 'asc' ? 'A to Z' : 'Z to A',
      };
    case 'date':
      return {
        on: true,
        face: 'Date',
        value: sort.date === 'asc' ? 'Oldest first' : 'Newest first',
        arrow: sort.date === 'asc' ? 'up' : 'down',
      };
  }
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
