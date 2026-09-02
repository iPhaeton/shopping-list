import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';

import { AddBar } from '../components/AddBar';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { ListRow } from '../components/ListRow';
import { SyncBanner } from '../components/SyncBanner';
import type { ListsScreenProps } from '../navigation/types';
import { useLists } from '../state/ListsContext';
import { colors, spacing } from '../theme';

export function ListsScreen({ navigation }: ListsScreenProps) {
  const { lists, status, error, pending, createList } = useLists();

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
      {pending > 0 ? <SyncBanner pending={pending} /> : null}
      <AddBar
        placeholder="New list name"
        buttonLabel="Create"
        onSubmit={(name) => createList(name)}
      />
      <FlatList
        data={lists}
        keyExtractor={(list) => list.id}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <ListRow
            list={item}
            onPress={() => navigation.navigate('ListDetail', { listId: item.id })}
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
