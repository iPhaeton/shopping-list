import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { themedStyles, useTheme } from '../state/ThemeContext';
import type { Item } from '../state/types';
import { fonts, radius, spacing } from '../theme';

type Props = {
  item: Item;
  /** A `reader` still sees whether an item is done; they just cannot change it. */
  editable?: boolean;
  onToggle: () => void;
  /** Absent for a `reader`, who may not rename an item. Called with the new title, untrimmed. */
  onRename?: (title: string) => void;
  /** Absent for a `reader`, who may neither bin an item nor bring one back. */
  onSetDeleted?: (deleted: boolean) => void;
};

export function ItemRow({ item, editable = true, onToggle, onRename, onSetDeleted }: Props) {
  const styles = useStyles();
  const { colors, scheme } = useTheme();

  // `doneAt` records when the item was checked off; nothing here shows the time, only the fact.
  const done = item.doneAt !== null;

  // In the bin, and only on screen because "Show deleted" is ticked. It is a real row still — the
  // database keeps it for thirty days — so it stays readable rather than being greyed into
  // illegibility, and the checkbox stops working because there is nothing to check off.
  const deleted = item.deletedAt !== null;

  // The rename editor, in place of the row rather than in a bar at the top of the screen, so on a
  // long list it opens where the user just tapped. The draft is seeded from the title when the editor
  // opens and not after — like `AddBar`'s `initialValue`, a starting point rather than a controlled
  // value, so a rename arriving from another device while this one is typing does not clobber the
  // field. Row-local state, which a `FlatList` may discard if the row is scrolled far enough to be
  // unmounted; accepted, as an open `AddBar` draft is.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const canSave = draft.trim().length > 0;

  function openEditor() {
    setDraft(item.title);
    setEditing(true);
  }

  function save() {
    if (!canSave) return;
    // Unchanged is not a rename: nothing is queued, so nothing is sent.
    if (draft.trim() !== item.title) onRename?.(draft);
    setEditing(false);
  }

  if (editing) {
    return (
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Item name"
          placeholderTextColor={colors.textMuted}
          keyboardAppearance={scheme}
          selectionColor={colors.primary}
          accessibilityLabel="Item name"
          autoFocus
          returnKeyType="done"
          onSubmitEditing={save}
          autoCorrect={false}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save"
          accessibilityState={{ disabled: !canSave }}
          disabled={!canSave}
          onPress={save}
          style={({ pressed }) => [styles.action, pressed && canSave && styles.rowPressed]}>
          <Text style={[styles.actionText, !canSave && styles.actionTextDisabled]}>Save</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={() => setEditing(false)}
          style={({ pressed }) => [styles.action, pressed && styles.rowPressed]}>
          <Text style={styles.actionTextMuted}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.row, deleted && styles.rowDeleted]}>
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
        disabled={!editable || deleted}
        onPress={onToggle}
        style={({ pressed }) => [styles.tap, pressed && editable && styles.rowPressed]}>
        <View style={[styles.checkbox, done && styles.checkboxChecked]}>
          {done ? <Text style={styles.check}>✓</Text> : null}
        </View>
        <Text style={[styles.title, done && styles.titleDone]}>{item.title}</Text>
      </Pressable>

      {deleted ? <Text style={styles.tag}>Deleted</Text> : null}

      {/* Not for a binned row, for the reason its checkbox is disabled: a rename would come straight
          back `target_deleted`, and Restore is the one thing to offer it. */}
      {onRename && !deleted ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Rename ${item.title}`}
          onPress={openEditor}
          style={({ pressed }) => [styles.action, pressed && styles.rowPressed]}>
          <Text style={styles.actionText}>Rename</Text>
        </Pressable>
      ) : null}

      {onSetDeleted ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${deleted ? 'Restore' : 'Delete'} ${item.title}`}
          onPress={() => onSetDeleted(!deleted)}
          style={({ pressed }) => [styles.action, pressed && styles.rowPressed]}>
          <Text style={styles.actionText}>{deleted ? 'Restore' : 'Delete'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = themedStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingRight: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surfaceOutline,
  },
  rowDeleted: {
    backgroundColor: colors.skyHorizon,
  },
  // The padding lives on the tappable half so the whole title row stays a comfortable target.
  tap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  rowPressed: {
    opacity: 0.7,
  },
  // Sized like `AddBar`'s field, and set in from the row's edge by the same margin the title has.
  input: {
    flex: 1,
    height: 44,
    marginVertical: spacing.sm,
    marginLeft: spacing.lg,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.surfaceOutline,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: 16,
    // Set, not left to the default: iOS reuses native text inputs, and one that was the code
    // field keeps its letter spacing unless told otherwise. See `codeInput` in `SignInScreen`.
    letterSpacing: 0,
  },
  tag: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 12,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  action: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  actionText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.primary,
  },
  actionTextDisabled: {
    color: colors.primaryDisabled,
  },
  actionTextMuted: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.textMuted,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.checkboxOutline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  check: {
    color: colors.onPrimary,
    fontFamily: fonts.sansBold,
    fontSize: 14,
    lineHeight: 16,
  },
  title: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 17,
    color: colors.text,
  },
  titleDone: {
    color: colors.textDone,
    textDecorationLine: 'line-through',
  },
}));
