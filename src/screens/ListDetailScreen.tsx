import { useLayoutEffect } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { AddBar } from '../components/AddBar';
import { EmptyState } from '../components/EmptyState';
import { ItemRow } from '../components/ItemRow';
import type { ListDetailScreenProps } from '../navigation/types';
import { useLists } from '../state/ListsContext';
import { colors, spacing } from '../theme';

export function ListDetailScreen({ navigation, route }: ListDetailScreenProps) {
  const { listId } = route.params;
  const { lists, addItem, toggleItem } = useLists();
  const list = lists.find((candidate) => candidate.id === listId);

  useLayoutEffect(() => {
    navigation.setOptions({ title: list?.name ?? 'List' });
  }, [navigation, list?.name]);

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
      <AddBar
        placeholder="Add an item"
        buttonLabel="Add"
        onSubmit={(title) => addItem(list.id, title)}
      />
      <FlatList
        data={list.items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <ItemRow item={item} onToggle={() => toggleItem(list.id, item.id)} />
        )}
        ListEmptyComponent={
          <EmptyState title="Nothing on this list" hint="Add your first item above." />
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
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
});
