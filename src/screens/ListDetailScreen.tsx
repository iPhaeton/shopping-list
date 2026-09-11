import { useLayoutEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AddBar } from '../components/AddBar';
import { BlockedBanner } from '../components/BlockedBanner';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { HeaderButton } from '../components/HeaderButton';
import { ItemRow } from '../components/ItemRow';
import { ShowDeletedToggle } from '../components/ShowDeletedToggle';
import { SyncBanner } from '../components/SyncBanner';
import type { ListDetailScreenProps } from '../navigation/types';
import { useLists } from '../state/ListsContext';
import { inCreationOrder, liveItems } from '../state/listsReducer';
import { canEditItems, canManageList } from '../state/roles';
import { colors, spacing } from '../theme';

export function ListDetailScreen({ navigation, route }: ListDetailScreenProps) {
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
  } = useLists();
  const list = lists.find((candidate) => candidate.id === listId);

  const [renaming, setRenaming] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  // Screen-local like `showDeleted`: it drives the footer spinner and nothing else. The provider
  // keeps its own guard against a second request for the same list.
  const [loadingMore, setLoadingMore] = useState(false);

  // A list reached from the bin. It is a real list still — restorable, and shared with the same
  // people — so it opens and reads normally; what it does not get is anything that would write to
  // it, because every one of those would come straight back as `target_deleted`.
  const binned = list !== undefined && list.deletedAt !== null;

  // Which controls exist, never whether the write is allowed — the database decides that. A reader
  // handed an Add bar that fails is a worse experience than one that was never there.
  const editable = list ? canEditItems(list.role) && !binned : false;
  const manageable = list ? canManageList(list.role) && !binned : false;

  // Before the not-found return below, because hooks cannot be called conditionally. Memoised so the
  // `FlatList` is not handed a new `data` array on every render.
  //
  // Sorted, both views: `items` is two streams end to end plus whatever was added since, and a row
  // that moved between them — restored from the bin — keeps its place in the array. With the bin
  // shown, the sort is what interleaves page 2 of the live rows with page 1 of the bin by date.
  const live = useMemo(() => (list ? liveItems(list) : []), [list]);
  const visible = useMemo(
    () => inCreationOrder(showDeleted && list ? list.items : live),
    [showDeleted, list, live]
  );
  const inBin = (list?.items.length ?? 0) - live.length;

  // Whether a scroll to the end has anything to fetch: the bin's cursor only counts while the bin
  // is on screen. With no cursor the `FlatList` gets no handler at all, so nothing fires.
  const more =
    list !== undefined && (list.nextLive !== null || (showDeleted && list.nextBin !== null));

  const loadNextPage = async () => {
    setLoadingMore(true);
    try {
      await loadMore(listId, showDeleted);
    } finally {
      setLoadingMore(false);
    }
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      title: list?.name ?? 'List',
      // `Share list` is for every member, not only owners: `list_members_of` is gated on the
      // caller's own membership and hands a reader the full roster, and "who else can see my
      // shopping list" is a fair question for them to ask. Only renaming is an owner's to do.
      headerRight: list
        ? () => (
            <View style={styles.headerButtons}>
              {manageable ? (
                <HeaderButton label="Rename list" onPress={() => setRenaming((open) => !open)} />
              ) : null}
              <HeaderButton
                label="Share list"
                onPress={() => navigation.navigate('Sharing', { listId })}
              />
            </View>
          )
        : undefined,
    });
  }, [navigation, list, list?.name, manageable, listId]);

  if (!list) {
    return (
      <View style={styles.container}>
        <EmptyState title="List not found" hint="Go back and pick a list from the list screen." />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {error ? <ErrorBanner message={error} /> : null}
      {blocked ? (
        <BlockedBanner
          blocked={blocked}
          lists={lists}
          onRestore={restoreBlocked}
          onDiscard={discardBlocked}
        />
      ) : null}
      {pending > 0 ? <SyncBanner pending={pending} /> : null}
      {binned ? (
        <View style={styles.binned}>
          {/*
            Spelled out because the two tombstones are independent and the surprise is otherwise
            silent: restore a list you binned six items inside, and you get the list back missing
            six items with nothing on screen to say where they went.
          */}
          <Text style={styles.binnedText}>
            This list is in the bin. Restoring it brings back everything except the items you
            deleted separately — those are one tick of Show deleted away.
          </Text>
          {canManageList(list.role) ? (
            <HeaderButton label={`Restore ${list.name}`} onPress={() => setListDeleted(listId, false)} />
          ) : null}
        </View>
      ) : null}
      {editable || binned ? null : (
        <Text style={styles.readOnly}>Read only — you can see this list but not change it.</Text>
      )}
      {renaming ? (
        <AddBar
          placeholder="List name"
          buttonLabel="Save"
          initialValue={list.name}
          onSubmit={(name) => {
            renameList(list.id, name);
            setRenaming(false);
          }}
        />
      ) : null}
      {editable ? (
        <AddBar
          placeholder="Add an item"
          buttonLabel="Add"
          onSubmit={(title) => addItem(list.id, title)}
        />
      ) : null}
      {inBin > 0 ? (
        <ShowDeletedToggle
          checked={showDeleted}
          count={inBin}
          more={list.nextBin !== null}
          onChange={setShowDeleted}
        />
      ) : null}
      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onEndReached={more && !loadingMore ? () => void loadNextPage() : undefined}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator
              accessibilityLabel="Loading more items"
              color={colors.accent}
              style={styles.footer}
            />
          ) : null
        }
        renderItem={({ item }) => (
          <ItemRow
            item={item}
            editable={editable}
            onToggle={() => toggleItem(list.id, item.id)}
            onRename={editable ? (title) => renameItem(list.id, item.id, title) : undefined}
            onSetDeleted={
              editable ? (deleted) => setItemDeleted(list.id, item.id, deleted) : undefined
            }
          />
        )}
        ListEmptyComponent={
          <EmptyState
            title="Nothing on this list"
            hint={editable ? 'Add your first item above.' : 'Nobody has added anything yet.'}
          />
        }
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  readOnly: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    fontSize: 15,
    color: colors.textMuted,
  },
  binned: {
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  binnedText: {
    fontSize: 15,
    color: colors.textMuted,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  footer: {
    paddingVertical: spacing.md,
  },
});
