import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';

import { AddBar } from '../components/AddBar';
import { BlockedBanner } from '../components/BlockedBanner';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { ListRow } from '../components/ListRow';
import { ShowDeletedToggle } from '../components/ShowDeletedToggle';
import { SyncBanner } from '../components/SyncBanner';
import type { ListsScreenProps } from '../navigation/types';
import { useLists } from '../state/ListsContext';
import { liveLists } from '../state/listsReducer';
import { canManageList } from '../state/roles';
import { colors, spacing } from '../theme';

export function ListsScreen({ navigation }: ListsScreenProps) {
  const { lists, status, error, pending, blocked, createList, setListDeleted, restoreBlocked, discardBlocked } =
    useLists();

  // Local, and deliberately not remembered: the bin is somewhere you go on purpose, so arriving
  // here should always show the live lists.
  const [showDeleted, setShowDeleted] = useState(false);

  // Memoised because `liveLists` returns a fresh array every call, which would give the `FlatList`
  // a new `data` prop on every render.
  const live = useMemo(() => liveLists(lists), [lists]);
  const visible = showDeleted ? lists : live;
  const binned = lists.length - live.length;

  // Without this the first paint claims "No lists yet" — before the fetch that would contradict it
  // has come back.
  if (status === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator accessibilityLabel="Loading your lists" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {error ? <ErrorBanner message={error} /> : null}
      {blocked ? (
        <BlockedBanner
          blocked={blocked}
          lists={lists}
          onRestore={restoreBlocked}
          onDiscard={discardBlocked}
        />
      ) : null}
      <SyncBanner pending={pending} />
      <AddBar
        placeholder="New list name"
        buttonLabel="Create"
        onSubmit={(name) => createList(name)}
      />
      {binned > 0 ? (
        <ShowDeletedToggle checked={showDeleted} count={binned} onChange={setShowDeleted} />
      ) : null}
      <FlatList
        data={visible}
        keyExtractor={(list) => list.id}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <ListRow
            list={item}
            onPress={() => navigation.navigate('ListDetail', { listId: item.id })}
            onSetDeleted={
              canManageList(item.role)
                ? (deleted) => setListDeleted(item.id, deleted)
                : undefined
            }
          />
        )}
        ListEmptyComponent={
          <EmptyState
            title="No lists yet"
            hint="Name your first list above — for example, Groceries."
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
});
