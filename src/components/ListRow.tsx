import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { bandAt } from '../state/bands';
import { canEditItems } from '../state/roles';
import { themedStyles, useTheme } from '../state/ThemeContext';
import type { List } from '../state/types';
import { fonts, spacing } from '../theme';
import { Band } from './Band';
import { ChevronIcon, RestoreIcon, TrashIcon } from './icons';
import { IconButton } from './IconButton';

export const ListRow = memo(function ListRow({
  list,
  index,
  onOpen,
  onSetDeleted,
}: {
  list: List;
  /** This row's position among the *visible* rows — what colors its band. Never the list count, so
   * creating a list never recolors the rows already on screen. */
  index: number;
  onOpen: (listId: string) => void;
  /** Absent for anyone but an owner, who alone may bin a list or bring one back. */
  onSetDeleted?: (listId: string, deleted: boolean) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const band = bandAt(colors, index);
  const deleted = list.deletedAt !== null;
  const shared = list.role !== 'owner';
  const subtitle = shared ? (canEditItems(list.role) ? 'Shared with you · can edit' : 'Shared with you · view only') : null;

  return (
    <Band index={index}>
      <Pressable
        accessibilityRole="button"
        // The label stays exactly `name` / `name, shared with you` regardless of role — the
        // visible subtitle is what splits into "can edit"/"view only" below.
        accessibilityLabel={shared ? `${list.name}, shared with you` : list.name}
        onPress={() => onOpen(list.id)}
        style={({ pressed }) => [styles.tap, pressed && styles.rowPressed]}>
        <View style={styles.text}>
          <Text style={[styles.name, { color: band.ink }]} numberOfLines={2}>
            {list.name}
          </Text>
          {subtitle ? (
            <Text style={[styles.summary, { color: band.ink }]}>{subtitle}</Text>
          ) : null}
        </View>
        {onSetDeleted ? <View style={styles.actionSpacer} /> : null}
        <ChevronIcon color={band.ink} size={16} />
      </Pressable>

      {onSetDeleted ? (
        <View style={styles.action} pointerEvents="box-none">
          <IconButton
            label={`${deleted ? 'Restore' : 'Delete'} ${list.name}`}
            fill={band.iconFill}
            onPress={() => onSetDeleted(list.id, !deleted)}>
            {deleted ? (
              <RestoreIcon color={band.ink} size={16} />
            ) : (
              <TrashIcon color={band.ink} size={16} />
            )}
          </IconButton>
        </View>
      ) : null}
    </Band>
  );
});

const useStyles = themedStyles(() => ({
  tap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.lg,
    paddingTop: 28,
    paddingBottom: 20,
    minHeight: 104,
  },
  rowPressed: {
    opacity: 0.85,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontFamily: fonts.sansMedium,
    fontSize: 22,
  },
  summary: {
    fontFamily: fonts.sans,
    fontSize: 15,
  },
  // Reserves room for the icon button, which renders in its own absolutely positioned layer below
  // so it stays a separate accessible element rather than nesting inside the row's own Pressable.
  actionSpacer: {
    width: 36,
  },
  // Stretches the full row height and centers within it, rather than a fixed `top` offset, so a
  // two-line wrapped name doesn't throw off the button's vertical position.
  action: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: spacing.lg + 16 + spacing.md,
    justifyContent: 'center',
  },
}));
