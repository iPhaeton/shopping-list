import { Pressable, Text, View } from 'react-native';

import { themedStyles } from '../state/ThemeContext';
import { fonts, radius, spacing } from '../theme';

/**
 * The switch between a screen's live rows and its bin. On, the screen shows the bin and nothing else,
 * newest deletion first.
 *
 * **Rendered while the bin has rows, or while it is checked.** A switch that reveals nothing is
 * noise, so an empty bin hides it. But once you are in the bin, restoring its last row must not take
 * away the only way back, so a checked switch stays, over `The bin is empty`.
 *
 * The label is always `Show deleted`, with no count — the user's call (task 24 step 1). A count
 * could only say what is loaded, not what exists, so it needed a `+` until the bin's last page.
 *
 * The state is the screen's own `useState` rather than a stored preference: no new storage key, no
 * version to bump, nothing to migrate, and it resets to off every time you arrive — which is the
 * right default, since the bin is somewhere you go deliberately. The cost is re-ticking it on each
 * screen, and that is accepted.
 *
 * The first page of deleted rows ships with the fetch that opens the list (and, for lists, with every
 * re-read), so ticking this is instant and works offline. The rest of the bin loads on scroll.
 */
export function ShowDeletedToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const styles = useStyles();

  return (
    <Pressable
      // A switch, not a checkbox: it flips a display filter on immediately, the same shape as an
      // iOS "on/off" setting, not a multi-select box to tick before submitting anything.
      accessibilityRole="switch"
      accessibilityState={{ checked }}
      accessibilityLabel="Show deleted"
      onPress={() => onChange(!checked)}
      hitSlop={4}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={[styles.track, checked && styles.trackChecked]}>
        <View style={[styles.knob, checked && styles.knobChecked]} />
      </View>
      <Text style={styles.label}>Show deleted</Text>
    </Pressable>
  );
}

const useStyles = themedStyles((colors) => ({
  // 24pt in from the edge: where both mockups put the track, level with List detail's checkboxes.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: 24,
    paddingVertical: spacing.sm,
    alignSelf: 'flex-start',
  },
  rowPressed: {
    opacity: 0.7,
  },
  track: {
    width: 36,
    height: 22,
    borderRadius: radius.pill,
    padding: 2,
    justifyContent: 'center',
    backgroundColor: colors.switchTrack,
  },
  trackChecked: {
    backgroundColor: colors.primary,
  },
  knob: {
    width: 18,
    height: 18,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
    backgroundColor: colors.switchKnob,
  },
  knobChecked: {
    alignSelf: 'flex-end',
    backgroundColor: colors.onPrimary,
  },
  label: {
    fontFamily: fonts.sans,
    fontSize: 17,
    // `text`, not `textMuted`: this sits on the sky, and `textMuted` on `skyTop` falls short of AA
    // (a pre-existing gap, flagged in task 20 step 1 — no reason to make a new use of it).
    color: colors.text,
  },
}));
