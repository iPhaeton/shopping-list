import { useLayoutEffect, useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';

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
import { liveItems } from '../state/listsReducer';
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
    toggleItem,
    renameList,
    setListDeleted,
    setItemDeleted,
    restoreBlocked,
    discardBlocked,
  } = useLists();
  const list = lists.find((candidate) => candidate.id === listId);

  const [renaming, setRenaming] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);

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
  const live = useMemo(() => (list ? liveItems(list) : []), [list]);
  const visible = showDeleted && list ? list.items : live;
  const inBin = (list?.items.length ?? 0) - live.length;

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
        <ShowDeletedToggle checked={showDeleted} count={inBin} onChange={setShowDeleted} />
      ) : null}
      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <ItemRow
            item={item}
            editable={editable}
            onToggle={() => toggleItem(list.id, item.id)}
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
});
