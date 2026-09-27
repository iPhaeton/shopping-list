import { memo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Path, Svg } from 'react-native-svg';

import { themedStyles, useTheme } from '../state/ThemeContext';
import type { Item } from '../state/types';
import { fonts, radius, spacing } from '../theme';
import { AddBar } from './AddBar';
import { CheckIcon, PencilIcon, RestoreIcon, TrashIcon } from './icons';
import { IconButton } from './IconButton';

type Props = {
  item: Item;
  /** This row's position among the *visible* rows — only which way its divider swells hangs on it. */
  index: number;
  /** A `reader` still sees whether an item is done; they just cannot change it. */
  editable?: boolean;
  onToggle: (itemId: string) => void;
  /** Absent for a `reader`, who may not rename an item. Called with the new title, untrimmed. */
  onRename?: (itemId: string, title: string) => void;
  /** Absent for a `reader`, who may neither bin an item nor bring one back. */
  onSetDeleted?: (itemId: string, deleted: boolean) => void;
};

/**
 * The hairline between two rows: a gentle swell across the width, traced from the mockup
 * (≈1pt either way), inverted on every other row so neighbouring lines never run parallel. Drawn in
 * a box exactly as tall as it is displayed, so stretching it sideways never thickens the stroke.
 */
const DIVIDERS = ['M0,2.8 C65,1.2 130,1.2 195,2 C260,2.8 325,2.8 390,1.2', 'M0,1.2 C65,2.8 130,2.8 195,2 C260,1.2 325,1.2 390,2.8'];

/**
 * One item on List detail's ground. No fill of its own: the rows are transparent over the
 * screen-fixed `Ground`, so a long list reads as one stretch of land rather than a band per item.
 * Memoised, with callbacks taking the item's id, so the screen hands every row the same functions
 * and a tick on one row re-renders that row alone.
 */
export const ItemRow = memo(function ItemRow({
  item,
  index,
  editable = true,
  onToggle,
  onRename,
  onSetDeleted,
}: Props) {
  const styles = useStyles();
  const { colors } = useTheme();

  // `doneAt` records when the item was checked off; nothing here shows the time, only the fact.
  const done = item.doneAt !== null;

  // In the bin, and only on screen because "Show deleted" is ticked. It is a real row still — the
  // database keeps it for thirty days — so it stays readable rather than being greyed into
  // illegibility, and the checkbox stops working because there is nothing to check off.
  const deleted = item.deletedAt !== null;

  // The rename editor, in place of the row rather than in a bar at the top of the screen, so on a
  // long list it opens where the user just tapped. `AddBar` seeds its draft from the title when the
  // editor opens and not after — a starting point rather than a controlled value, so a rename
  // arriving from another device while this one is typing does not clobber the field. Row-local
  // state, which a `FlatList` may discard if the row is scrolled far enough to be unmounted;
  // accepted, as an open `AddBar` draft is.
  const [editing, setEditing] = useState(false);

  const divider =
    index > 0 ? (
      <View
        style={styles.divider}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <Svg width="100%" height={4} viewBox="0 0 390 4" preserveAspectRatio="none">
          <Path d={DIVIDERS[index % 2]} stroke={colors.divider} strokeWidth={1} fill="none" />
        </Svg>
      </View>
    ) : null;

  if (editing) {
    return (
      <View style={styles.row}>
        {divider}
        <View style={styles.editor}>
          <AddBar
            placeholder="Item name"
            buttonLabel="Save"
            initialValue={item.title}
            autoFocus
            onCancel={() => setEditing(false)}
            onSubmit={(draft) => {
              // Unchanged is not a rename: nothing is queued, so nothing is sent.
              if (draft.trim() !== item.title) onRename?.(item.id, draft);
              setEditing(false);
            }}
          />
        </View>
      </View>
    );
  }

  const inactive = !editable || deleted;

  return (
    <View style={styles.row}>
      {divider}
      <Pressable
        // Still a checkbox when read-only, and still labelled: the checked state is information a
        // reader wants. Only `disabled` changes, following `AddBar`'s precedent.
        accessibilityRole="checkbox"
        // `|| deleted` belongs in the state and not only on the prop below: on web the `disabled`
        // prop becomes `aria-disabled` and tells the truth by itself, but on native this object is
        // the whole signal, and a screen reader would otherwise offer to check off a binned row.
        accessibilityState={{ checked: done, disabled: !editable || deleted }}
        accessibilityLabel={item.title}
        accessibilityHint={
          editable ? (done ? 'Marks this item as not done' : 'Marks this item as done') : undefined
        }
        disabled={inactive}
        onPress={() => onToggle(item.id)}
        style={({ pressed }) => [styles.tap, pressed && !inactive && styles.pressed]}>
        <View style={[styles.checkbox, done && styles.checkboxChecked, inactive && styles.checkboxInactive]}>
          {done ? <CheckIcon color={colors.onPrimary} size={14} /> : null}
        </View>
        <Text style={[styles.title, done && styles.titleDone]} numberOfLines={2}>
          {item.title}
        </Text>
      </Pressable>

      {/* The tag takes the pencil's place: a binned row gets no rename, for the reason its checkbox
          is disabled — a rename would come straight back `target_deleted`, and Restore is the one
          thing to offer it. */}
      {deleted ? <Text style={styles.tag}>Deleted</Text> : null}

      {onRename && !deleted ? (
        <IconButton label={`Rename ${item.title}`} fill={colors.iconButtonFill} onPress={() => setEditing(true)}>
          <PencilIcon color={colors.text} size={16} />
        </IconButton>
      ) : null}

      {onSetDeleted ? (
        <IconButton
          label={`${deleted ? 'Restore' : 'Delete'} ${item.title}`}
          fill={colors.iconButtonFill}
          onPress={() => onSetDeleted(item.id, !deleted)}>
          {deleted ? <RestoreIcon color={colors.text} size={16} /> : <TrashIcon color={colors.text} size={16} />}
        </IconButton>
      ) : null}
    </View>
  );
});

// Geometry from the mockup: a 60pt row, the checkbox at x 24, the title at x 64, and the two
// 36pt icon buttons at x 280 and 328 — 12pt apart, 26pt in from the right edge.
const useStyles = themedStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 60,
    gap: spacing.md,
    paddingRight: 26,
  },
  divider: {
    position: 'absolute',
    top: -2,
    left: 0,
    right: 0,
    height: 4,
  },
  // The padding lives on the tappable half so the whole title row stays a comfortable target.
  tap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingLeft: 24,
    paddingVertical: spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
  // The editor spans the row edge to edge; `AddBar` sets its own 20pt sides inside it.
  editor: {
    flex: 1,
    marginRight: -26,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.checkboxOutline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  // A reader's rows and a binned row: still showing done or not, visibly not for tapping.
  checkboxInactive: {
    opacity: 0.45,
  },
  title: {
    flex: 1,
    fontFamily: fonts.sansMedium,
    fontSize: 19,
    color: colors.text,
  },
  titleDone: {
    fontFamily: fonts.sans,
    color: colors.textDone,
    textDecorationLine: 'line-through',
  },
  // `textDone`, not `textMuted`: it is the muted ink chosen to pass AA across the whole ground.
  tag: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 12,
    color: colors.textDone,
    textTransform: 'uppercase',
  },
}));
