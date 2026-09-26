import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { themedStyles, useTheme } from '../state/ThemeContext';
import { fonts, radius, spacing } from '../theme';
import { CloudIcon, CloudPuff } from './icons';

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
  const styles = useStyles();
  const { colors } = useTheme();
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
    <View accessibilityLiveRegion="polite" style={styles.wrap}>
      <View
        style={styles.puff}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <CloudPuff color={colors.bannerSurface} />
      </View>
      <View style={styles.banner}>
        <CloudIcon color={colors.text} size={18} />
        <Text style={styles.text}>{`${changes} will sync when you're back online`}</Text>
      </View>
    </View>
  );
}

const useStyles = themedStyles((colors) => ({
  wrap: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    alignSelf: 'flex-start',
  },
  puff: {
    position: 'absolute',
    top: -14,
    left: 20,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: 14,
    paddingRight: spacing.lg,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.bannerSurface,
  },
  text: {
    fontFamily: fonts.sans,
    fontSize: 16,
    // `text`, not `textMuted`: `textMuted` falls short of AA on this surface (flagged in task 20
    // step 1's log) and the mockup reads this sentence in the full-strength ink.
    color: colors.text,
  },
}));
