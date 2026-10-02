import { memo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { bandAt } from '../state/bands';
import { themedStyles, useTheme } from '../state/ThemeContext';
import type { Item } from '../state/types';
import { fonts, radius, spacing } from '../theme';
import { AddBar } from './AddBar';
import { CheckIcon, PencilIcon, RestoreIcon, TrashIcon } from './icons';
import { IconButton } from './IconButton';

type Props = {
  item: Item;
  /** This row's position among the *visible* rows — what colors its band, as on Lists. Items run
   * oldest first, so adding one never recolors the rows already on screen. */
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
 * One item on its own band of color — the same ramp as a `ListRow` on Lists, through `bandAt`, but
 * flat: rows meet in straight lines, not `Band`'s waves, and the one wavy edge on the screen is
 * `Hillside`'s hill above the first row. Every mark on it — title, ring, tick, glyphs — is in
 * the band's `ink`, which `bandAt` picks to clear AA on that band; no fixed color could, as the Day
 * ramp runs from pale to darker than the text and the ink flips from dark to light partway down.
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
  const band = bandAt(colors, index);

  // `doneAt` records when the item was checked off; nothing here shows the time, only the fact.
  const done = item.doneAt !== null;

  // In the bin, and only on screen because "Show deleted" switched the screen to it. It is a real row
  // still — the database keeps it for thirty days — so it stays readable rather than being greyed
  // into illegibility, and the checkbox stops working because there is nothing to check off.
  const deleted = item.deletedAt !== null;

  // The rename editor, in place of the row rather than in a bar at the top of the screen, so on a
  // long list it opens where the user just tapped. `AddBar` seeds its draft from the title when the
  // editor opens and not after — a starting point rather than a controlled value, so a rename
  // arriving from another device while this one is typing does not clobber the field. Row-local
  // state, which a `FlatList` may discard if the row is scrolled far enough to be unmounted;
  // accepted, as an open `AddBar` draft is.
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <View style={[styles.row, { backgroundColor: band.color }]}>
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
    <View style={[styles.row, { backgroundColor: band.color }]}>
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
        {/* Checked, the ring fills with the ink and the tick is cut out in the band's own color. */}
        <View
          style={[
            styles.checkbox,
            { borderColor: band.ink },
            done && { backgroundColor: band.ink },
            inactive && styles.checkboxInactive,
          ]}>
          {done ? <CheckIcon color={band.color} size={14} /> : null}
        </View>
        <Text style={[styles.title, { color: band.ink }, done && styles.titleDone]} numberOfLines={2}>
          {item.title}
        </Text>
      </Pressable>

      {/* A binned row gets no rename, for the reason its checkbox is disabled — a rename would come
          straight back `target_deleted`, and Restore is the one thing to offer it. No tag says it
          is deleted: the bin view shows nothing else. */}
      {onRename && !deleted ? (
        <IconButton label={`Rename ${item.title}`} fill={band.iconFill} onPress={() => setEditing(true)}>
          <PencilIcon color={band.ink} size={16} />
        </IconButton>
      ) : null}

      {onSetDeleted ? (
        <IconButton
          label={`${deleted ? 'Restore' : 'Delete'} ${item.title}`}
          fill={band.iconFill}
          onPress={() => onSetDeleted(item.id, !deleted)}>
          {deleted ? <RestoreIcon color={band.ink} size={16} /> : <TrashIcon color={band.ink} size={16} />}
        </IconButton>
      ) : null}
    </View>
  );
});

// Geometry from the mockup: a 60pt row, the checkbox at x 24, the title at x 64, and the two
// 36pt icon buttons at x 280 and 328 — 12pt apart, 26pt in from the right edge.
const useStyles = themedStyles(() => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 60,
    gap: spacing.md,
    paddingRight: 26,
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A reader's rows and a binned row: still showing done or not, visibly not for tapping.
  checkboxInactive: {
    opacity: 0.45,
  },
  title: {
    flex: 1,
    fontFamily: fonts.sansMedium,
    fontSize: 19,
  },
  // Struck through and lighter in weight, but the band's full ink: dimmed any further, a done title
  // would fall below AA on the bands where the ink only just clears it.
  titleDone: {
    fontFamily: fonts.sans,
    textDecorationLine: 'line-through',
  },
}));
