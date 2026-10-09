import { useCallback, useMemo, useState } from 'react';
import type { ListRenderItemInfo } from 'react-native';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AddBar } from '../components/AddBar';
import { Band } from '../components/Band';
import { BarSentence } from '../components/BarSentence';
import { BlockedBanner } from '../components/BlockedBanner';
import { CoverageLine } from '../components/CoverageLine';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { Horizon } from '../components/Horizon';
import { IconButton } from '../components/IconButton';
import { BellIcon, PersonIcon } from '../components/icons';
import { ListRow } from '../components/ListRow';
import { ModeButton } from '../components/ModeButton';
import { SearchField } from '../components/SearchField';
import { ShowDeletedToggle } from '../components/ShowDeletedToggle';
import { Sky } from '../components/Sky';
import { SortButtons } from '../components/SortButtons';
import { SyncBanner } from '../components/SyncBanner';
import { listLimitSentence } from '../lib/limits';
import { coverageLine, NO_MATCHES_HINT, noMatchesTitle, searchSummary } from '../lib/searchCopy';
import type { ListsScreenProps } from '../navigation/types';
import { arrangeLists, isDefaultSort, nextSort, type SortKey } from '../state/arrange';
import { bandAt } from '../state/bands';
import { useLists } from '../state/ListsContext';
import { useNotifications } from '../state/NotificationsContext';
import { binLists, inDeletionOrder, liveLists } from '../state/listsReducer';
import { canManageList } from '../state/roles';
import { useSorts } from '../state/SortContext';
import { themedStyles, useTheme } from '../state/ThemeContext';
import type { List } from '../state/types';
import { useCompletion } from '../state/useCompletion';
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

/** Lists' sort buttons, left to right in priority order. */
const SORT_KEYS: readonly SortKey[] = ['az', 'date'];

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
    loadAllLists,
    readEpoch,
  } = useLists();
  const { listSort, setListSort } = useSorts();
  const { unread } = useNotifications();

  // Local, and deliberately not remembered: the bin is somewhere you go on purpose, so arriving
  // here should always show the live lists.
  const [showDeleted, setShowDeleted] = useState(false);
  // Screen-local like `showDeleted`: it drives the footer spinner and nothing else. The provider
  // keeps its own guard against a second request.
  const [loadingMore, setLoadingMore] = useState(false);
  // The search, and which of search or Create holds the slot. Never stored: both reset on leaving
  // the screen, and both survive a trip into the bin and back. Switching modes keeps the query —
  // it filters in both — and the sort, which is stored (`useSorts`).
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'search' | 'create' | null>(null);
  // Whether the Create bar takes the focus when it mounts: only once Plus asked for it.
  const [focusCreate, setFocusCreate] = useState(false);

  const loading = status === 'loading';

  // Memoised because the filters and sorts return a fresh array every call, which would give the
  // `FlatList` a new `data` prop on every render.
  //
  // One stream at a time: the live lists, searched and sorted, or — with "Show deleted" on — the bin
  // and nothing else, newest deletion first, the order it is paged in and never searched. Sorted
  // either way, as List detail sorts its items: `lists` is two paged streams end to end plus lists
  // fetched one at a time, and a list that moves between streams keeps its place in the array.
  const live = useMemo(() => liveLists(lists), [lists]);
  const bin = useMemo(() => binLists(lists), [lists]);
  const ordered = useMemo(
    () => (showDeleted ? inDeletionOrder(bin) : arrangeLists(live, { sort: listSort, query })),
    [showDeleted, bin, live, listSort, query]
  );
  const visible = loading ? NONE : ordered;
  // Counted only to decide whether the toggle shows: its label carries no number.
  const binned = bin.length;

  // Nothing to search: no live list, and none still to load. A new account's first screen.
  const emptyAndComplete = live.length === 0 && listCursors.live === null;

  // Search is the resting state, except where there is nothing to search. Decided once, on the
  // first render with the lists known, and never switched by itself after that — the first list
  // created here must not swap the Create bar out from under the person creating it.
  if (mode === null && !loading) setMode(emptyAndComplete ? 'create' : 'search');
  const shownMode = mode ?? 'search';

  // A search or a non-default sort is right only over every live list, so the rest is loaded in
  // the background while they apply — the results show at once, and the line says how far it got.
  // "Complete" is never remembered: a cursor that comes back after a re-read needs it again.
  const searching = query.trim() !== '';
  const arranged = searching || !isDefaultSort(listSort);
  const needsCompleting = !loading && !showDeleted && arranged && listCursors.live !== null;
  const completion = useCompletion(needsCompleting, loadAllLists, readEpoch);

  // At either list limit the Create bar gives way to the sentence saying so, rather than letting a
  // list appear and vanish a moment later when the database refuses it. The counts are approximate
  // — another member's removal, or an invitation accepted on another device, moves them unseen — so
  // this is a warning, never the enforcement.
  const full = listLimitSentence(listCounts);

  // Whether a scroll to the end has anything to fetch — in the stream on screen only, so live mode
  // never asks for a page of the bin, nor the bin for a live one. With no cursor the `FlatList` gets
  // no handler at all, so nothing fires; nor while the stream is being completed, since then the
  // completion and `Try again` own paging.
  const stream = showDeleted ? 'bin' : 'live';
  const more = listCursors[stream] !== null && !needsCompleting;

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
  const openNotifications = useCallback(() => navigation.navigate('Notifications'), [navigation]);
  // `null` until the count is first read: no dot and no value, rather than a guess.
  const anyUnread = unread !== null && unread > 0;

  const switchMode = () => {
    if (shownMode === 'search') setFocusCreate(true);
    setMode(shownMode === 'search' ? 'create' : 'search');
  };

  // Live mode only, once the lists are known. Hidden over an empty, complete stream in create mode,
  // where there is nothing to search; the first list brings it back.
  const modeButton =
    !loading && !showDeleted && !(shownMode === 'create' && emptyAndComplete) ? (
      <ModeButton
        mode={shownMode}
        newLabel="New list"
        dot={arranged}
        summary={searchSummary(query, listSort)}
        onPress={switchMode}
      />
    ) : null;

  // Whatever holds the Create bar's place. Nothing is created from the bin, so it says what it is
  // there — and keeps the sort buttons' 44pt as sky when entered from search, so `Show deleted`
  // stays under the finger that tapped it.
  let slot;
  if (showDeleted) {
    slot = (
      <>
        <BarSentence>Deleted lists, newest first.</BarSentence>
        {shownMode === 'search' ? <View style={styles.sortSky} /> : null}
      </>
    );
  } else if (shownMode === 'search') {
    slot = (
      <>
        <SearchField placeholder="Search lists" value={query} onChangeText={setQuery} />
        <SortButtons
          sort={listSort}
          keys={SORT_KEYS}
          onPress={(key) => setListSort(nextSort(listSort, key))}
        />
      </>
    );
  } else if (full) {
    slot = <BarSentence>{full}</BarSentence>;
  } else {
    slot = (
      <AddBar
        placeholder="New list name"
        buttonLabel="Create"
        autoFocus={focusCreate}
        onSubmit={(name) => createList(name)}
      />
    );
  }

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
        {/* Three round 36pt buttons (task 28, D7): the mode button, the bell, and the person. Glyphs
            only, so each says what it is through its label alone — `Account` kept from the pill. */}
        <View style={styles.titleActions}>
          {modeButton}
          <IconButton
            label="Notifications"
            value={anyUnread ? `${unread} unread` : undefined}
            outline={colors.outline}
            dot={anyUnread}
            onPress={openNotifications}>
            <BellIcon color={colors.text} />
          </IconButton>
          <IconButton label="Account" outline={colors.outline} onPress={openAccount}>
            <PersonIcon color={colors.text} />
          </IconButton>
        </View>
      </View>
      {loading ? (
        <View style={styles.loadingBlock}>
          <ActivityIndicator accessibilityLabel="Loading your lists" color={colors.text} />
        </View>
      ) : (
        <>
          <SyncBanner pending={pending} />
          {slot}
          {completion.status ? (
            <CoverageLine
              text={coverageLine({
                rows: 'lists',
                status: completion.status,
                searching,
                held: live.length,
                total: listCounts.total,
              })}
              onRetry={completion.status === 'failed' ? completion.retry : undefined}
            />
          ) : null}
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
            ) : live.length === 0 ? (
              <EmptyState
                title="No lists yet"
                hint="Name your first list above — for example, Groceries."
                ink={bandAt(colors, 0).ink}
              />
            ) : (
              // Never "No matches" over partial data: while lists are still to load, it says how
              // many were searched, and the coverage line above says the rest.
              <EmptyState
                title={noMatchesTitle({
                  query,
                  rows: 'lists',
                  partial: listCursors.live !== null,
                  held: live.length,
                })}
                hint={NO_MATCHES_HINT}
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
  titleActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  // The sort buttons' height and their gap above, kept as sky under the bin sentence.
  sortSky: {
    height: spacing.sm + 36,
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
