import { Pressable, Text, View } from 'react-native';

import { themedStyles } from '../state/ThemeContext';
import { fonts, radius, spacing } from '../theme';

/**
 * The bin, behind a switch.
 *
 * **Rendered only when there is something in it** — `count` of zero means both screens leave this
 * out entirely. A toggle that reveals nothing is noise, and the app has no other permanently visible
 * control that does nothing when pressed.
 *
 * The state is the screen's own `useState` rather than a stored preference: no new storage key, no
 * version to bump, nothing to migrate, and it resets to hidden every time you arrive — which is the
 * right default, since the bin is somewhere you go deliberately. The cost is re-ticking it on each
 * screen, and that is accepted.
 *
 * The first page of deleted rows ships in the same fetch as the live ones, so ticking this is
 * instant: no spinner and no round trip. That is a large part of why this reads better than a
 * separate "trash" screen would. A bin longer than a page loads the rest on scroll, like the live
 * rows, and says so with a `+` — the count is what is loaded, not what exists, until the end.
 */
export function ShowDeletedToggle({
  checked,
  count,
  more = false,
  onChange,
}: {
  checked: boolean;
  /** How many deleted rows are hiding behind it — loaded so far, when `more` is set. */
  count: number;
  /** Whether there are deleted rows beyond the ones loaded. */
  more?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const styles = useStyles();
  const label = more
    ? `Show ${count}+ deleted`
    : count === 1
      ? 'Show 1 deleted'
      : `Show ${count} deleted`;

  return (
    <Pressable
      // A switch, not a checkbox: it flips a display filter on immediately, the same shape as an
      // iOS "on/off" setting, not a multi-select box to tick before submitting anything.
      accessibilityRole="switch"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={() => onChange(!checked)}
      hitSlop={4}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={[styles.track, checked && styles.trackChecked]}>
        <View style={[styles.knob, checked && styles.knobChecked]} />
      </View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const useStyles = themedStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
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
