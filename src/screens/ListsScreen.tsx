import { FlatList, StyleSheet, View } from 'react-native';

import { AddBar } from '../components/AddBar';
import { EmptyState } from '../components/EmptyState';
import { ListRow } from '../components/ListRow';
import type { ListsScreenProps } from '../navigation/types';
import { useLists } from '../state/ListsContext';
import { colors, spacing } from '../theme';

export function ListsScreen({ navigation }: ListsScreenProps) {
  const { lists, createList } = useLists();

  return (
    <View style={styles.container}>
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
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
});
