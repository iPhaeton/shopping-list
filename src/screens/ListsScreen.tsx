import { useCallback, useMemo, useState } from 'react';
import type { ListRenderItemInfo } from 'react-native';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AddBar } from '../components/AddBar';
import { Band } from '../components/Band';
import { BarSentence } from '../components/BarSentence';
import { BlockedBanner } from '../components/BlockedBanner';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { Horizon } from '../components/Horizon';
import { ListRow } from '../components/ListRow';
import { PillButton } from '../components/PillButton';
import { ShowDeletedToggle } from '../components/ShowDeletedToggle';
import { Sky } from '../components/Sky';
import { SyncBanner } from '../components/SyncBanner';
import { listLimitSentence } from '../lib/limits';
import type { ListsScreenProps } from '../navigation/types';
import { bandAt } from '../state/bands';
import { useLists } from '../state/ListsContext';
import { binLists, inDeletionOrder, inJoinOrder, liveLists } from '../state/listsReducer';
import { canManageList } from '../state/roles';
import { themedStyles, useTheme } from '../state/ThemeContext';
import type { List } from '../state/types';
import { fonts, spacing } from '../theme';

/** A stable empty array while loading, so the `FlatList`'s `data` prop never allocates a new one. */
const NONE: List[] = [];

/**
 * How tall the sky layer is, comfortably covering the header (title, banner, add bar, horizon)
 * plus a generous buffer, so a top overscroll always reveals more sky rather than the ground color
 * underneath it. Not tied to the header's real measured height — a bounded, generous constant is
 * simpler and the overshoot only has to outlast a normal pull-to-refresh bounce.
 */
const SKY_HEIGHT = 520;

export function ListsScreen({ navigation }: ListsScreenProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const {
    lists,
    listCursors,
    listCounts,
    status,
    error,
    pending,
    blocked,
    createList,
    setListDeleted,
    restoreBlocked,
    discardBlocked,
    loadMoreLists,
  } = useLists();

  // Local, and deliberately not remembered: the bin is somewhere you go on purpose, so arriving
  // here should always show the live lists.
  const [showDeleted, setShowDeleted] = useState(false);
  // Screen-local like `showDeleted`: it drives the footer spinner and nothing else. The provider
  // keeps its own guard against a second request.
  const [loadingMore, setLoadingMore] = useState(false);

  const loading = status === 'loading';

  // Memoised because the filters and sorts return a fresh array every call, which would give the
  // `FlatList` a new `data` prop on every render.
  //
  // One stream at a time: the live lists by when you joined, or — with "Show deleted" on — the bin
  // and nothing else, newest deletion first, each in the order its stream is paged in. Sorted either
  // way, as List detail sorts its items: `lists` is two paged streams end to end plus lists fetched
  // one at a time, and a list that moves between streams keeps its place in the array.
  const live = useMemo(() => liveLists(lists), [lists]);
  const bin = useMemo(() => binLists(lists), [lists]);
  const ordered = useMemo(
    () => (showDeleted ? inDeletionOrder(bin) : inJoinOrder(live)),
    [showDeleted, bin, live]
  );
  const visible = loading ? NONE : ordered;
  // Counted only to decide whether the toggle shows: its label carries no number.
  const binned = bin.length;

  // At either list limit the Create bar gives way to the sentence saying so, rather than letting a
  // list appear and vanish a moment later when the database refuses it. The counts are approximate
  // — another member's share moves them unseen — so this is a warning, never the enforcement.
  const full = listLimitSentence(listCounts);

  // Whether a scroll to the end has anything to fetch — in the stream on screen only, so live mode
  // never asks for a page of the bin, nor the bin for a live one. With no cursor the `FlatList` gets
  // no handler at all, so nothing fires.
  const stream = showDeleted ? 'bin' : 'live';
  const more = listCursors[stream] !== null;

  const loadNextPage = async () => {
    setLoadingMore(true);
    try {
      await loadMoreLists(stream);
    } finally {
      setLoadingMore(false);
    }
  };

  const openList = useCallback(
    (listId: string) => navigation.navigate('ListDetail', { listId }),
    [navigation]
  );
  const openAccount = useCallback(() => navigation.navigate('Account'), [navigation]);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<List>) => (
      <ListRow
        list={item}
        index={index}
        onOpen={openList}
        onSetDeleted={canManageList(item.role) ? setListDeleted : undefined}
      />
    ),
    [openList, setListDeleted]
  );

  // Sticky, so the Create bar is always in reach — and so it carries its own sky: the rows scroll up
  // behind it, and the screen's `Sky` layer below would let them show through, above the hill's
  // curve most of all. The same drawing from the same top, so at rest nothing changes.
  const header = (
    <View>
      <View
        style={styles.headerSky}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <Sky height={SKY_HEIGHT} />
      </View>
      <View style={[styles.titleRow, { paddingTop: insets.top + spacing.lg }]}>
        <Text accessibilityRole="header" style={styles.title}>
          My Lists
        </Text>
        <PillButton label="Account" onPress={openAccount} />
      </View>
      {loading ? (
        <View style={styles.loadingBlock}>
          <ActivityIndicator accessibilityLabel="Loading your lists" color={colors.text} />
        </View>
      ) : (
        <>
          <SyncBanner pending={pending} />
          {/* Nothing is created from the bin, so it says what it is in the bar's place. */}
          {showDeleted ? (
            <BarSentence>Deleted lists, newest first.</BarSentence>
          ) : full ? (
            <BarSentence>{full}</BarSentence>
          ) : (
            <AddBar placeholder="New list name" buttonLabel="Create" onSubmit={(name) => createList(name)} />
          )}
        </>
      )}
      <Horizon ground={bandAt(colors, 0).color}>
        {/* Kept while checked, so restoring the bin's last list does not take away the way back. */}
        {!loading && (binned > 0 || showDeleted) ? (
          <ShowDeletedToggle checked={showDeleted} onChange={setShowDeleted} />
        ) : null}
      </Horizon>
    </View>
  );

  // The screen's own background, not the sky: what an overscroll past a short list — or past the
  // last row of a long one — reveals below the content, so it reads as a continuation of the last
  // band rather than a seam. `bandAt` bounces back and forth across the ramp past index 5.
  const ground = bandAt(colors, Math.max(visible.length, 1) - 1);
  const groundColor = ground.color;

  return (
    <View style={[styles.screen, { backgroundColor: groundColor }]}>
      {/*
        `pointerEvents="none"` matters here, not just on the `Sky` SVG inside it: an absolutely
        positioned View stacks above a static sibling like the `FlatList` below regardless of DOM
        order (a plain CSS rule on web), so without it this decorative layer silently swallows
        every tap on the header and the first several rows.
      */}
      <View
        style={[styles.sky, { height: SKY_HEIGHT }]}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <Sky height={SKY_HEIGHT} />
      </View>

      {error || blocked ? (
        <View style={{ paddingTop: insets.top }}>
          {error ? <ErrorBanner message={error} /> : null}
          {blocked ? (
            <BlockedBanner blocked={blocked} lists={lists} onRestore={restoreBlocked} onDiscard={discardBlocked} />
          ) : null}
        </View>
      ) : null}

      <FlatList
        data={visible}
        keyExtractor={(list) => list.id}
        keyboardShouldPersistTaps="handled"
        renderItem={renderItem}
        ListHeaderComponent={header}
        // With a `ListHeaderComponent`, index 0 is the header itself.
        stickyHeaderIndices={[0]}
        ListEmptyComponent={
          // `ListFooterComponent` does not render alongside `ListEmptyComponent` — confirmed by
          // inspection, not assumed — so the empty state has to guarantee its own minimum height
          // itself, the same way the non-empty footer below does for a short list. Rendered bare
          // while loading too: the horizon's hill is this band's top edge, and without it the hill
          // would float on sky.
          <Band index={0} style={styles.footer}>
            {loading ? null : showDeleted ? (
              <EmptyState
                title="The bin is empty"
                hint="Deleted lists wait here for 30 days."
                ink={bandAt(colors, 0).ink}
              />
            ) : (
              <EmptyState
                title="No lists yet"
                hint="Name your first list above — for example, Groceries."
                ink={bandAt(colors, 0).ink}
              />
            )}
          </Band>
        }
        // A short (non-empty) list doesn't reach past the bounded `Sky` layer behind the
        // `FlatList` on its own. A footer with a concrete `minHeight` matching `SKY_HEIGHT`
        // guarantees solid, ground-colored content past every point `Sky` reaches, however few
        // rows there are, so it never peeks through underneath. The next page's spinner sits at its
        // top, right under the last row, so the ground stays whether or not a page is on its way.
        ListFooterComponent={loading || visible.length === 0 ? null : (
          <View style={[styles.footer, { backgroundColor: groundColor }]}>
            {loadingMore ? (
              <ActivityIndicator
                accessibilityLabel="Loading more lists"
                color={ground.ink}
                style={styles.loadingMore}
              />
            ) : null}
          </View>
        )}
        onEndReached={more && !loadingMore ? () => void loadNextPage() : undefined}
        onEndReachedThreshold={0.5}
      />
    </View>
  );
}

const useStyles = themedStyles((colors) => ({
  screen: {
    flex: 1,
  },
  footer: {
    minHeight: SKY_HEIGHT,
  },
  loadingMore: {
    paddingVertical: spacing.md,
  },
  sky: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  headerSky: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 40,
    color: colors.text,
  },
  loadingBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl * 2,
  },
}));
