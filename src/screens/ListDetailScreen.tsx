import { useLayoutEffect, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';

import { AddBar } from '../components/AddBar';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { HeaderButton } from '../components/HeaderButton';
import { ItemRow } from '../components/ItemRow';
import { SyncBanner } from '../components/SyncBanner';
import type { ListDetailScreenProps } from '../navigation/types';
import { useLists } from '../state/ListsContext';
import { canEditItems, canManageList } from '../state/roles';
import { colors, spacing } from '../theme';

export function ListDetailScreen({ navigation, route }: ListDetailScreenProps) {
  const { listId } = route.params;
  const { lists, error, pending, addItem, toggleItem, renameList } = useLists();
  const list = lists.find((candidate) => candidate.id === listId);

  const [renaming, setRenaming] = useState(false);

  // Which controls exist, never whether the write is allowed — the database decides that. A reader
  // handed an Add bar that fails is a worse experience than one that was never there.
  const editable = list ? canEditItems(list.role) : false;
  const manageable = list ? canManageList(list.role) : false;

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
      {pending > 0 ? <SyncBanner pending={pending} /> : null}
      {editable ? null : (
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
      <FlatList
        data={list.items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <ItemRow
            item={item}
            editable={editable}
            onToggle={() => toggleItem(list.id, item.id)}
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
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
});
