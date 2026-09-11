import { Pressable, StyleSheet, Text, View } from 'react-native';

import { blockedList, restorePlan, type Blocked } from '../state/restorePlan';
import type { List } from '../state/types';
import { colors, radius, spacing } from '../theme';

/**
 * A queued write that landed on something somebody else put in the bin.
 *
 * Not an error, and deliberately not red: nothing failed and nothing was thrown away. The write is
 * still at the head of the outbox and still on disk; this is the app asking what to do with it.
 *
 * **What can be restored is worked out from state, not told by the server** — `restorePlan` is the
 * one place that decides, and the provider reads the same function to know when to discard a write
 * nobody may unblock. Declining to render is *not* how that case is handled: the blocked write is
 * still the head of the outbox and the loop is stopped while it sits there, so an invisible prompt
 * would stall every write behind it. By the time this component sees a `blocked`, the provider has
 * already established that there is something to offer; the empty check below is a guard against a
 * render that slips between the two, not the mechanism.
 */
export function BlockedBanner({
  blocked,
  lists,
  onRestore,
  onDiscard,
}: {
  blocked: Blocked;
  lists: List[];
  onRestore: () => void;
  onDiscard: () => void;
}) {
  if (restorePlan(lists, blocked).length === 0) return null;

  return (
    <View accessibilityRole="alert" style={styles.banner}>
      <Text style={styles.text}>
        {blockedList(lists, blocked)
          ? 'That list is in the bin. Restore it and keep your change?'
          : 'That item is in the bin. Restore it and keep your change?'}
      </Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Restore and keep my change"
          onPress={onRestore}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
          <Text style={styles.primary}>Restore and keep my change</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Discard my change"
          onPress={onDiscard}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
          <Text style={styles.secondary}>Discard</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    margin: spacing.lg,
    marginBottom: 0,
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.surface,
  },
  text: {
    fontSize: 15,
    color: colors.text,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  button: {
    paddingVertical: spacing.xs,
  },
  pressed: {
    opacity: 0.7,
  },
  primary: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.accent,
  },
  secondary: {
    fontSize: 15,
    color: colors.textMuted,
  },
});
