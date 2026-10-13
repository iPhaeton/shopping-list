import { useLingui } from '@lingui/react/macro';
import { Text, View } from 'react-native';

import { blockedList, restorePlan, type Blocked } from '../state/restorePlan';
import { themedStyles } from '../state/ThemeContext';
import type { List } from '../state/types';
import { fonts, radius, spacing } from '../theme';
import { PillButton } from './PillButton';

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
  const styles = useStyles();
  const { t } = useLingui();

  if (restorePlan(lists, blocked).length === 0) return null;

  return (
    <View accessibilityRole="alert" style={styles.banner}>
      <Text style={styles.text}>
        {blockedList(lists, blocked)
          ? t({
              comment: 'A change made earlier is waiting: the list it was made to has since been deleted (put in the bin).',
              message: 'That list is in the bin. Restore it and keep your change?',
            })
          : t({
              comment: 'A change made earlier is waiting: the item it was made to has since been deleted (put in the bin).',
              message: 'That item is in the bin. Restore it and keep your change?',
            })}
      </Text>
      <View style={styles.actions}>
        <PillButton
          variant="filled"
          label={t({
            comment: 'Button: takes the deleted list or item out of the bin and sends the waiting change.',
            message: 'Restore and keep my change',
          })}
          onPress={onRestore}
        />
        <PillButton
          label={t({ comment: 'VoiceOver only: the Discard button, which drops the waiting change.', message: 'Discard my change' })}
          visibleLabel={t({
            comment: 'Button (verb): drops the waiting change. Fits about 10 characters, beside "Restore and keep my change".',
            message: 'Discard',
          })}
          onPress={onDiscard}
        />
      </View>
    </View>
  );
}

// The same notice card as `ErrorBanner`, without the error color: nothing failed here. The actions
// wrap, because the filled restore pill alone is most of a narrow phone's width.
const useStyles = themedStyles((colors) => ({
  banner: {
    marginHorizontal: 20,
    marginTop: spacing.lg,
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.bannerSurface,
  },
  text: {
    fontFamily: fonts.sans,
    fontSize: 16,
    color: colors.text,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
}));
