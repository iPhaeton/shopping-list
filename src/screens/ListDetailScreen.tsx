import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { ListRenderItemInfo } from 'react-native';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AddBar } from '../components/AddBar';
import { BarSentence } from '../components/BarSentence';
import { BlockedBanner } from '../components/BlockedBanner';
import { CoverageLine } from '../components/CoverageLine';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { Hillside } from '../components/Hillside';
import { ChevronIcon } from '../components/icons';
import { IconButton } from '../components/IconButton';
import { ItemRow } from '../components/ItemRow';
import { ModeButton } from '../components/ModeButton';
import { PillButton } from '../components/PillButton';
import { SearchField } from '../components/SearchField';
import { ShowDeletedToggle } from '../components/ShowDeletedToggle';
import { SkyFill } from '../components/Sky';
import { SortButtons } from '../components/SortButtons';
import { SyncBanner } from '../components/SyncBanner';
import { coverageLine, NO_MATCHES_HINT, noMatchesTitle, searchSummary } from '../lib/searchCopy';
import type { ListDetailScreenProps } from '../navigation/types';
import { arrangeItems, isDefaultSort, nextSort, type SortKey } from '../state/arrange';
import { bandAt } from '../state/bands';
import { useLists } from '../state/ListsContext';
import { binItems, inDeletionOrder, liveItems } from '../state/listsReducer';
import { canEditItems, canManageList } from '../state/roles';
import { useSorts } from '../state/SortContext';
import { themedStyles, useTheme } from '../state/ThemeContext';
import type { Item } from '../state/types';
import { useCompletion } from '../state/useCompletion';
import { fonts, radius, spacing } from '../theme';

/**
 * Between the safe-area inset and the header row: puts the row at y 60, where the mockup draws it,
 * on the iPhone 17e.
 */
const HEADER_GAP = 13;

/** How far the sky reaches above the header — past any pull-down bounce, so that shows sky and
 * never the band color behind the list. */
const OVERSCROLL_SKY = 1000;

/**
 * How tall the header's sky is on the mockup in search mode, top of the screen to the horizon strip
 * — a first guess only. The header is 224–318pt depending on the mode and the lines under the slot,
 * so the strip over the status bar draws its slice of a sky as tall as the header measures, and
 * lines up with the header's own sky underneath it, as Sharing's does.
 */
const SEARCH_SKY_H = 268;

/** List detail's sort buttons, left to right in priority order. */
const SORT_KEYS: readonly SortKey[] = ['todo', 'az', 'date'];

export function ListDetailScreen({ navigation, route }: ListDetailScreenProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { listId } = route.params;
  const {
    lists,
    error,
    pending,
    blocked,
    addItem,
    renameItem,
    toggleItem,
    renameList,
    setListDeleted,
    setItemDeleted,
    restoreBlocked,
    discardBlocked,
    loadMore,
    loadListItems,
    loadAllItems,
    loadList,
    status,
    readEpoch,
  } = useLists();
  const list = lists.find((candidate) => candidate.id === listId);
  // This list's own item sort: each list keeps its own, and a list nobody re-sorted is oldest first.
  const { itemSortFor, setItemSort } = useSorts();
  const sort = useMemo(() => itemSortFor(listId), [itemSortFor, listId]);

  const [renaming, setRenaming] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  // Screen-local like `showDeleted`: it drives the footer spinner and nothing else. The provider
  // keeps its own guard against a second request for the same list.
  const [loadingMore, setLoadingMore] = useState(false);
  // Whether a list missing from state has been looked up yet. Lists are paged, so this one may
  // simply sort past the pages loaded so far — somebody else binned it — and "List not found" is
  // only said once a read by id agrees. Back to `idle` whenever the list is there, so if a later
  // hydrate drops it again, it is looked up again the same way.
  const [lookup, setLookup] = useState<'idle' | 'pending' | 'done'>('idle');
  // The search, and which of search or Add holds the slot. Never stored: both reset on leaving the
  // list, and both survive a trip into the bin and back. Switching modes keeps the query — it
  // filters in both, so an item added that does not match drops out of view as it lands (the
  // user's call) — and the sort.
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'search' | 'create' | null>(null);
  // Whether the Add bar takes the focus when it mounts: only once Plus asked for it.
  const [focusAdd, setFocusAdd] = useState(false);
  // How tall the header's sky measures, for the strip over the status bar.
  const [skyHeight, setSkyHeight] = useState(SEARCH_SKY_H);

  // A list reached from the bin. It is a real list still — restorable, and shared with the same
  // people — so it opens and reads normally; what it does not get is anything that would write to
  // it, because every one of those would come straight back as `target_deleted`.
  const binned = list !== undefined && list.deletedAt !== null;

  // Which controls exist, never whether the write is allowed — the database decides that. A reader
  // handed an Add bar that fails is a worse experience than one that was never there.
  const editable = list ? canEditItems(list.role) && !binned : false;
  const manageable = list ? canManageList(list.role) && !binned : false;

  // Nothing below the header reads from the database until this is true — the list was fetched, but
  // its items were not. `loadListItems`, triggered below, is on its way.
  const loaded = list?.itemsLoaded ?? false;

  // A binned list is a tombstone, like the bin: no search, so no query applies to it. Its rows keep
  // the list's stored sort.
  const shownQuery = binned ? '' : query;

  // Memoised so the `FlatList` is not handed a new `data` array on every render.
  //
  // One stream at a time: the live rows, searched and sorted, or — with "Show deleted" on — the bin
  // and nothing else, newest deletion first, the order it is paged in and never searched. Sorted
  // either way: `items` is two streams end to end plus whatever was added since, and a row that
  // moved between them — restored from the bin — keeps its place in the array.
  const live = useMemo(() => (list ? liveItems(list) : []), [list]);
  const bin = useMemo(() => (list ? binItems(list) : []), [list]);
  const visible = useMemo(
    () => (showDeleted ? inDeletionOrder(bin) : arrangeItems(live, { sort, query: shownQuery })),
    [showDeleted, bin, live, sort, shownQuery]
  );
  // Counted only to decide whether the toggle shows: its label carries no number.
  const inBin = bin.length;

  // Nothing to search: no live row, and none still to load.
  const emptyAndComplete = loaded && live.length === 0 && list?.nextLive === null;

  // Search is the resting state, except where there is nothing to search and something to add.
  // Decided once, on the first render with the rows known, and never switched by itself after that.
  // A reader has no create mode, so whatever was decided, a reader sees search.
  if (mode === null && loaded) setMode(editable && emptyAndComplete ? 'create' : 'search');
  const shownMode = editable ? (mode ?? 'search') : 'search';

  // A search or a non-default sort is right only over every live row, so the rest is loaded in the
  // background while they apply — the results show at once, and the line says how far it got.
  // "Complete" is never remembered: a cursor that comes back after a re-read needs it again.
  const searching = shownQuery.trim() !== '';
  const arranged = searching || !isDefaultSort(sort);
  const needsCompleting =
    list !== undefined && loaded && !showDeleted && arranged && list.nextLive !== null;
  const completeItems = useCallback(
    (signal: AbortSignal) => loadAllItems(listId, signal),
    [loadAllItems, listId]
  );
  const completion = useCompletion(needsCompleting, completeItems, readEpoch);

  // Whether a scroll to the end has anything to fetch — in the stream on screen only, so live mode
  // never asks for a page of the bin, nor the bin for a live one. With no cursor the `FlatList` gets
  // no handler at all, so nothing fires; nor while the stream is being completed, since then the
  // completion and `Try again` own paging.
  const stream = showDeleted ? 'bin' : 'live';
  const more =
    list !== undefined &&
    !needsCompleting &&
    (stream === 'live' ? list.nextLive !== null : list.nextBin !== null);

  const loadNextPage = async () => {
    setLoadingMore(true);
    try {
      await loadMore(listId, stream);
    } finally {
      setLoadingMore(false);
    }
  };

  // Once the first fetch has settled, a list that is still missing is read by id and folded in.
  useEffect(() => {
    if (list) {
      setLookup('idle');
      return;
    }
    if (status !== 'ready' || lookup !== 'idle') return;

    setLookup('pending');
    void loadList(listId).finally(() => setLookup('done'));
  }, [list, status, lookup, listId, loadList]);

  // Items are no longer part of the lists fetch — they arrive only once a list is actually
  // entered, so this asks for them the moment the screen has a list to ask about.
  useEffect(() => {
    if (list && !list.itemsLoaded) void loadListItems(listId);
  }, [list, list?.itemsLoaded, listId, loadListItems]);

  // The screen draws its own header — `RootNavigator` hides the native one on every screen — so this
  // title is read only by the browser tab on web.
  useLayoutEffect(() => {
    navigation.setOptions({ title: list?.name ?? 'List' });
  }, [navigation, list?.name]);

  // Ids in, so every row gets the same three functions and `ItemRow`'s `memo` holds across renders.
  const toggle = useCallback((itemId: string) => toggleItem(listId, itemId), [toggleItem, listId]);
  const rename = useCallback(
    (itemId: string, title: string) => renameItem(listId, itemId, title),
    [renameItem, listId]
  );
  const setDeleted = useCallback(
    (itemId: string, deleted: boolean) => setItemDeleted(listId, itemId, deleted),
    [setItemDeleted, listId]
  );
  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<Item>) => (
      <ItemRow
        item={item}
        index={index}
        editable={editable}
        onToggle={toggle}
        onRename={editable ? rename : undefined}
        onSetDeleted={editable ? setDeleted : undefined}
      />
    ),
    [editable, toggle, rename, setDeleted]
  );

  // A refused write or a blocked one: pinned above the list, header included, rather than inside
  // the header, since the blocked banner holds up every write behind it until it is answered.
  const pinned = Boolean(error || blocked);

  const switchMode = () => {
    if (shownMode === 'search') setFocusAdd(true);
    setMode(shownMode === 'search' ? 'create' : 'search');
  };

  // Live mode only, once the rows are in, and only where there is a create mode to switch to — so
  // never for a reader or on a binned list. Hidden over an empty, complete list in create mode,
  // where there is nothing to search; the first item brings it back.
  const modeButton =
    list && loaded && editable && !showDeleted && !(shownMode === 'create' && emptyAndComplete) ? (
      <ModeButton
        mode={shownMode}
        newLabel="New item"
        dot={arranged}
        summary={searchSummary(shownQuery, sort)}
        onPress={switchMode}
      />
    ) : null;

  // Where the Add bar sits on the mockup (y 172), whichever the list calls for. Only once the items
  // are in: before that nothing may write, and a notice about what you cannot do can wait for the
  // list it is about.
  let slot = null;
  if (list && loaded) {
    if (showDeleted && !binned) {
      // Nothing is added to the bin, and it is never searched, so it says what it is in the slot —
      // keeping the sort buttons' 44pt as sky when entered from search, so `Show deleted` stays
      // under the finger that tapped it. A binned list's notice, below, is not a write control, so
      // it stays in either view.
      slot = (
        <>
          <BarSentence>Deleted items, newest first.</BarSentence>
          {shownMode === 'search' ? <View style={styles.sortSky} /> : null}
        </>
      );
    } else if (shownMode === 'search' && !binned) {
      slot = (
        <>
          <SearchField placeholder="Search items" value={query} onChangeText={setQuery} />
          <SortButtons
            sort={sort}
            keys={SORT_KEYS}
            onPress={(key) => setItemSort(listId, nextSort(sort, key))}
          />
        </>
      );
    } else if (editable) {
      slot = (
        <AddBar
          placeholder="Add an item"
          buttonLabel="Add"
          autoFocus={focusAdd}
          onSubmit={(title) => addItem(list.id, title)}
        />
      );
    } else if (binned) {
      slot = (
        <View style={styles.card}>
          {/*
            Spelled out because the two tombstones are independent and the surprise is otherwise
            silent: restore a list you binned six items inside, and you get the list back missing
            six items with nothing on screen to say where they went.
          */}
          <Text style={styles.noticeText}>
            This list is in the bin. Restoring it brings back everything except the items you
            deleted separately — those are one tick of Show deleted away.
          </Text>
          {canManageList(list.role) ? (
            <View style={styles.cardAction}>
              <PillButton
                variant="filled"
                label={`Restore ${list.name}`}
                onPress={() => setListDeleted(listId, false)}
              />
            </View>
          ) : null}
        </View>
      );
    }
  }

  // Built here as a value, never as an inline component type: a component defined in this render
  // would be a new type on every render, remounting the Add bar and throwing away its draft.
  //
  // Sticky, so the Add bar is always in reach, and opaque top to bottom — `SkyFill` behind the
  // padded block, `Hillside`'s own sky under the hill — because the rows scroll up behind it.
  // `styles.header` fills whatever those two leave uncovered: on Android, a pixel row where they
  // meet, which without it shows the band color behind the list as a light line.
  const header = (
    <View style={styles.header}>
      <View
        style={styles.overscrollSky}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <View
        style={{ paddingTop: (pinned ? 0 : insets.top) + HEADER_GAP }}
        onLayout={({ nativeEvent: { layout } }) => {
          if (layout.height !== skyHeight) setSkyHeight(layout.height);
        }}>
        <View
          style={styles.fill}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants">
          <SkyFill />
        </View>

        <View style={styles.headerRow}>
          <IconButton label="Back" outline={colors.outline} onPress={() => navigation.goBack()}>
            <ChevronIcon direction="left" color={colors.text} size={18} />
          </IconButton>
          {/*
            `Share list` is for every member, not only owners: `list_members_of` is gated on the
            caller's own membership and hands a reader the full roster, and "who else can see my
            shopping list" is a fair question for them to ask. Only renaming is an owner's to do.
          */}
          {list ? (
            <View style={styles.headerPills}>
              {modeButton}
              {manageable ? (
                <PillButton
                  label="Rename list"
                  visibleLabel="Rename"
                  onPress={() => setRenaming((open) => !open)}
                />
              ) : null}
              <PillButton
                label="Share list"
                visibleLabel="Share"
                onPress={() => navigation.navigate('Sharing', { listId })}
              />
            </View>
          ) : null}
        </View>

        {/* The rename bar takes the title's own place — it is the title being edited — and is the
            same height, so nothing below it moves while it is open. */}
        {list && renaming && manageable ? (
          <View style={styles.titleSlot}>
            <AddBar
              placeholder="List name"
              buttonLabel="Save"
              initialValue={list.name}
              onSubmit={(name) => {
                renameList(list.id, name);
                setRenaming(false);
              }}
            />
          </View>
        ) : list ? (
          <Text accessibilityRole="header" style={styles.title} numberOfLines={2}>
            {list.name}
          </Text>
        ) : null}

        <SyncBanner pending={pending} />

        {slot ? <View style={styles.slot}>{slot}</View> : null}

        {/* Under the slot, in either mode: how much of the list the results cover, then — for a
            reader, whose slot holds the search — that the list is theirs to read only. */}
        {completion.status ? (
          <CoverageLine
            text={coverageLine({
              rows: 'items',
              status: completion.status,
              searching,
              held: live.length,
            })}
            onRetry={completion.status === 'failed' ? completion.retry : undefined}
          />
        ) : null}
        {list && loaded && !editable && !binned ? (
          <CoverageLine text="Read only — you can see this list but not change it." />
        ) : null}
      </View>

      <Hillside ground={bandAt(colors, 0).color}>
        {/* Kept while checked, so restoring the bin's last item does not take away the way back. */}
        {loaded && (inBin > 0 || showDeleted) && list ? (
          <ShowDeletedToggle checked={showDeleted} onChange={setShowDeleted} />
        ) : null}
      </Hillside>
    </View>
  );

  // The screen's own background, not the sky: what shows below the last row — past a short list,
  // in an overscroll, or under an empty one — so it reads as that row's band carrying on. With no
  // rows it is the first band, the one the hill is the top edge of.
  const last = bandAt(colors, Math.max(visible.length, 1) - 1);

  // `ink`: on a band, `textMuted` falls short of AA for the hint.
  const empty = !list ? (
    lookup !== 'done' ? (
      <ActivityIndicator accessibilityLabel="Loading list" color={last.ink} style={styles.loading} />
    ) : (
      <EmptyState
        title="List not found"
        hint="Go back and pick a list from the list screen."
        ink={last.ink}
      />
    )
  ) : !loaded ? (
    <ActivityIndicator
      accessibilityLabel="Loading list items"
      color={last.ink}
      style={styles.loading}
    />
  ) : showDeleted ? (
    <EmptyState title="The bin is empty" hint="Deleted items wait here for 30 days." ink={last.ink} />
  ) : live.length === 0 ? (
    <EmptyState
      title="Nothing on this list"
      hint={editable ? 'Add your first item above.' : 'Nobody has added anything yet.'}
      ink={last.ink}
    />
  ) : (
    // Never "No matches" over partial data: while rows are still to load, it says how many were
    // searched, and the coverage line above says the rest.
    <EmptyState
      title={noMatchesTitle({
        query: shownQuery,
        rows: 'items',
        partial: list.nextLive !== null,
        held: live.length,
      })}
      hint={NO_MATCHES_HINT}
      ink={last.ink}
    />
  );

  return (
    <View style={[styles.screen, { backgroundColor: last.color }]}>

      {pinned ? (
        <View style={[styles.pinned, { paddingTop: insets.top }]}>
          {error ? <ErrorBanner message={error} /> : null}
          {blocked ? (
            <BlockedBanner
              blocked={blocked}
              lists={lists}
              onRestore={restoreBlocked}
              onDiscard={discardBlocked}
            />
          ) : null}
        </View>
      ) : null}

      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListHeaderComponent={header}
          // With a `ListHeaderComponent`, index 0 is the header itself.
          stickyHeaderIndices={[0]}
          ListEmptyComponent={empty}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator
                accessibilityLabel="Loading more items"
                color={last.ink}
                style={styles.footer}
              />
            ) : null
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
          keyboardShouldPersistTaps="handled"
          onEndReached={more && !loadingMore ? () => void loadNextPage() : undefined}
          onEndReachedThreshold={0.5}
        />
      </KeyboardAvoidingView>

      {/*
        Keeps the status bar on clean sky. Nothing scrolls under it now that the header is pinned,
        but iOS 26 draws a light blur there over this screen's list, pinned or not — never over
        Lists' — and the header cannot hide it from inside that list. react-native-screens'
        `scrollEdgeEffects` does not reach it, `hidden` or `hard`. Drawn above the list, this does.
      */}
      <View
        style={[styles.statusBarSky, { height: insets.top }]}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <View style={{ height: skyHeight }}>
          <SkyFill initialHeight={skyHeight} />
        </View>
      </View>
    </View>
  );
}

const useStyles = themedStyles((colors) => ({
  screen: {
    flex: 1,
  },
  body: {
    flex: 1,
  },
  pinned: {
    paddingBottom: spacing.sm,
    backgroundColor: colors.skyTop,
  },
  // `SkyFill` ends on `skyHorizon` and `Hillside` starts on it, so a gap between them vanishes.
  header: {
    backgroundColor: colors.skyHorizon,
  },
  overscrollSky: {
    position: 'absolute',
    top: -OVERSCROLL_SKY,
    left: 0,
    right: 0,
    height: OVERSCROLL_SKY,
    backgroundColor: colors.skyTop,
  },
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  headerRow: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  headerPills: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  // A fixed line height, matching the rename bar that replaces it, so opening that bar moves
  // nothing below.
  title: {
    marginTop: 10,
    paddingHorizontal: 20,
    fontFamily: fonts.serif,
    fontSize: 40,
    lineHeight: 52,
    color: colors.text,
  },
  titleSlot: {
    marginTop: 10,
  },
  // With the title's 10 above it, this puts the Add bar at y 172, where the mockup draws it.
  slot: {
    marginTop: 14,
  },
  // The sort buttons' height and their gap above, kept as sky under the bin sentence.
  sortSky: {
    height: spacing.sm + 36,
  },
  // The binned-list notice: the same fill, as a card, since it has a button to hold.
  card: {
    marginHorizontal: 20,
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.bannerSurface,
  },
  cardAction: {
    alignItems: 'flex-start',
  },
  noticeText: {
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.text,
  },
  loading: {
    paddingTop: spacing.xl * 2,
  },
  footer: {
    paddingVertical: spacing.md,
  },
  statusBarSky: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
}));
