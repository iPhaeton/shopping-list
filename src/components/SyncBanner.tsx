import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme';

/**
 * A write that lands within one normal online round trip should never paint at all — only one
 * still unacknowledged after this long is worth interrupting the screen for. Without the delay,
 * `pending` ticking 0 → 1 → 0 across a fast, healthy request flashes this banner on every write.
 */
const SHOW_AFTER_MS = 400;

/**
 * "Not saved *yet*" — which is what almost every failure means now that writes are queued and
 * retried. Deliberately muted rather than red: a lift, a tunnel or a dead spot is not an error, and
 * a screen that cries wolf every time signal drops teaches people to ignore it.
 *
 * `ErrorBanner` is for the other kind: a write the database refused, which is gone.
 */
export function SyncBanner({ pending }: { pending: number }) {
  const [visible, setVisible] = useState(false);
  const waiting = pending > 0;

  useEffect(() => {
    if (!waiting) {
      setVisible(false);
      return;
    }

    const timer = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [waiting]);

  if (!visible) return null;

  const changes = pending === 1 ? '1 change' : `${pending} changes`;

  return (
    <View accessibilityLiveRegion="polite" style={styles.banner}>
      <Text style={styles.text}>{`${changes} will sync when you're back online`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    margin: spacing.lg,
    marginBottom: 0,
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  text: {
    fontSize: 15,
    color: colors.textMuted,
  },
});
