import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '../components/Avatar';
import { Backdrop } from '../components/Backdrop';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { HorizonFooter } from '../components/HorizonFooter';
import { PillButton } from '../components/PillButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { ScreenSky } from '../components/Sky';
import {
  BLOCKED_PAGE_SIZE,
  fetchBlockedUsers,
  unblockUser,
  type BlockedCursor,
  type BlockedUser,
} from '../lib/notificationsApi';
import type { BlockedPeopleScreenProps } from '../navigation/types';
import { useNotifications } from '../state/NotificationsContext';
import { useSession } from '../state/SessionContext';
import { themedStyles, useTheme } from '../state/ThemeContext';
import { fonts, spacing } from '../theme';

const OFFLINE_LOAD = "You need a connection to see who you've blocked.";
const OFFLINE_ACTION = 'You need a connection to unblock someone.';

/** A stable empty array while the first page loads, so the `FlatList`'s `data` never allocates one. */
const NONE: BlockedUser[] = [];

/**
 * The people this account blocked from Notifications (task 28, D5), newest block first, a page of
 * 100 at a time (D8). Online-only, as Notifications is: the rows are local `useState`.
 *
 * **Nothing reloads it.** Only this screen changes the list while it is open, so the first page
 * loads on mount and a scroll to the end appends the next.
 *
 * **Unblock is one tap, with no confirm** — nothing is lost by it. The row goes from the screen and
 * the cursor stays as it was: the next page continues from the cursor's values, not from its row,
 * so a dropped row never makes it skip one. The bell's count is re-read, because that person's
 * unread notifications count again and no nudge says so. Unblocks are independent, so each pill
 * waits only on its own.
 *
 * Laid out on Account's frame, as Notifications is.
 */
export function BlockedPeopleScreen({ navigation }: BlockedPeopleScreenProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { refreshUnread } = useNotifications();
  const { signOut } = useSession();

  const [rows, setRows] = useState<BlockedUser[] | null>(null);
  const [cursor, setCursor] = useState<BlockedCursor | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [unblocking, setUnblocking] = useState<ReadonlySet<string>>(() => new Set());
  const [loadingMore, setLoadingMore] = useState(false);

  // What the reads and unblocks check between awaits, set in the same breath as the state they
  // mirror.
  const rowsRef = useRef<BlockedUser[] | null>(null);
  const cursorRef = useRef<BlockedCursor | null>(null);
  const paging = useRef(false);
  const live = useRef(true);

  function show(next: BlockedUser[], nextCursor: BlockedCursor | null) {
    rowsRef.current = next;
    cursorRef.current = nextCursor;
    setRows(next);
    setCursor(nextCursor);
  }

  async function load() {
    const { blocked, cursor: next, error, retryable } = await fetchBlockedUsers({
      limit: BLOCKED_PAGE_SIZE,
    });
    if (!live.current) return;

    if (!blocked) {
      setLoadError(retryable ? OFFLINE_LOAD : error);
      return;
    }
    show(blocked, next);
  }

  async function loadMore() {
    const asked = cursorRef.current;
    if (paging.current || asked === null) return;

    paging.current = true;
    setLoadingMore(true);
    try {
      const { blocked, cursor: next } = await fetchBlockedUsers({
        before: asked,
        limit: BLOCKED_PAGE_SIZE,
      });
      // A failed page shows nothing; the next scroll to the end asks again.
      if (!live.current || !blocked) return;
      show([...(rowsRef.current ?? []), ...blocked], next);
    } finally {
      paging.current = false;
      if (live.current) setLoadingMore(false);
    }
  }

  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
    };
    // Mount only: nothing else changes this list while the screen is open.
  }, []);

  async function unblock(person: BlockedUser) {
    setActionError(null);
    setUnblocking((ids) => new Set(ids).add(person.userId));

    const result = await unblockUser(person.userId);
    if (!live.current) return;

    // This device's session was revoked elsewhere: hand off to sign-in, as Notifications does.
    if (result.sessionRevoked) {
      void signOut('revoked');
      return;
    }

    setUnblocking((ids) => {
      const next = new Set(ids);
      next.delete(person.userId);
      return next;
    });

    if (result.error) {
      setActionError(result.verdict === 'retryable' ? OFFLINE_ACTION : result.error);
      return;
    }

    const remaining = (rowsRef.current ?? []).filter((row) => row.userId !== person.userId);
    show(remaining, cursorRef.current);
    void refreshUnread();
    // With every loaded row gone and more to come, the empty state would claim nobody is blocked.
    if (remaining.length === 0) void loadMore();
  }

  function renderCard(person: BlockedUser) {
    const pending = unblocking.has(person.userId);
    return (
      <Card style={styles.card}>
        <View style={styles.row}>
          <Avatar id={person.userId} name={person.name} />
          {/* Wraps, never cut: `set_name` has no upper bound. */}
          <Text style={styles.name}>{person.name}</Text>
          <PillButton
            label={`Unblock ${person.name}`}
            visibleLabel={pending ? 'Unblocking…' : 'Unblock'}
            disabled={pending}
            onPress={() => void unblock(person)}
          />
        </View>
      </Card>
    );
  }

  const error = actionError ?? loadError;

  return (
    <Backdrop art={<ScreenSky />}>
      {error ? (
        <View style={{ paddingTop: insets.top }}>
          <ErrorBanner message={error} />
        </View>
      ) : null}

      <FlatList
        data={rows ?? NONE}
        keyExtractor={(person) => person.userId}
        renderItem={({ item, index }) => (
          <View style={[styles.item, index === 0 && styles.first]}>{renderCard(item)}</View>
        )}
        extraData={unblocking}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={styles.content}
        ListHeaderComponent={<ScreenHeader title="Blocked people" onBack={() => navigation.goBack()} />}
        ListEmptyComponent={
          rows === null ? (
            loadError ? null : (
              <View style={styles.loading}>
                <ActivityIndicator accessibilityLabel="Loading blocked people" color={colors.text} />
              </View>
            )
          ) : cursor === null ? (
            <EmptyState
              title="You haven't blocked anyone"
              hint="People you block from Notifications show up here."
              ink={colors.text}
            />
          ) : null
        }
        // After the last card: the next page's spinner while one is on its way, then the landscape,
        // as on Notifications.
        ListFooterComponent={
          <View style={styles.footer}>
            {loadingMore ? (
              <ActivityIndicator
                accessibilityLabel="Loading more blocked people"
                color={colors.text}
                style={styles.loadingMore}
              />
            ) : null}
            <View style={styles.spacer} />
            <HorizonFooter />
          </View>
        }
        ListFooterComponentStyle={styles.footer}
        onEndReached={cursor !== null && !loadingMore ? () => void loadMore() : undefined}
        onEndReachedThreshold={0.5}
      />
    </Backdrop>
  );
}

function Separator() {
  return <View style={{ height: 10 }} />;
}

// Measured off the Blocked people mockups (task 28 step 2): Notifications' frame and cards — x
// 20–370, 10pt apart, the first 12 under the title, padded 14/13 — holding the 36pt avatar, the name
// 13 after it, and the small Unblock pill, centred on the row.
const useStyles = themedStyles((colors) => ({
  content: {
    flexGrow: 1,
  },
  item: {
    paddingHorizontal: 20,
  },
  first: {
    marginTop: 12,
  },
  card: {
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  name: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 17,
    color: colors.text,
  },
  loading: {
    alignItems: 'center',
    paddingVertical: spacing.xl * 2,
  },
  // As on Notifications: 12 above and below, centred under the last card.
  loadingMore: {
    paddingVertical: spacing.md,
  },
  footer: {
    flexGrow: 1,
  },
  spacer: {
    flex: 1,
    minHeight: 64,
  },
}));
