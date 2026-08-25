import { fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';

import type { ListDetailScreenProps } from '../navigation/types';
import { ListsProvider, useLists } from '../state/ListsContext';
import { ListDetailScreen } from './ListDetailScreen';

const navigation = { navigate: jest.fn(), setOptions: jest.fn() };

function detailProps(listId: string) {
  return { navigation, route: { params: { listId } } } as unknown as ListDetailScreenProps;
}

/** Creates a real list through the provider, then renders the detail screen for it. */
function Harness({ listName }: { listName: string }) {
  const { lists, createList } = useLists();

  useEffect(() => {
    createList(listName);
  }, [createList, listName]);

  const list = lists[0];
  return list ? <ListDetailScreen {...detailProps(list.id)} /> : null;
}

/**
 * Note: `render` and `fireEvent` are async in React Native Testing Library 14 and must
 * be awaited, otherwise the assertions run before anything has been mounted.
 */
async function renderScreen(listName = 'Groceries') {
  await render(
    <ListsProvider>
      <Harness listName={listName} />
    </ListsProvider>
  );
}

async function addItem(title: string) {
  await fireEvent.changeText(screen.getByLabelText('Add an item'), title);
  await fireEvent.press(screen.getByLabelText('Add'));
}

beforeEach(() => {
  navigation.setOptions.mockClear();
});

it('shows an empty state for a list with no items', async () => {
  await renderScreen();

  expect(screen.getByText('Nothing on this list')).toBeOnTheScreen();
});

it('puts the list name in the header', async () => {
  await renderScreen('Hardware');

  expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Hardware' });
});

it('adds items and shows them unchecked, in order', async () => {
  await renderScreen();

  await addItem('Milk');
  await addItem('Bread');

  expect(screen.queryByText('Nothing on this list')).not.toBeOnTheScreen();
  expect(screen.getByLabelText('Milk')).not.toBeChecked();
  expect(screen.getAllByRole('checkbox').map((row) => row.props.accessibilityLabel)).toEqual([
    'Milk',
    'Bread',
  ]);
});

it('clears the input after adding an item', async () => {
  await renderScreen();

  await addItem('Milk');

  expect(screen.getByLabelText('Add an item')).toHaveDisplayValue('');
});

it('does not add a blank item', async () => {
  await renderScreen();

  await addItem('   ');

  expect(screen.getByText('Nothing on this list')).toBeOnTheScreen();
});

it('marks an item done and unmarks it again', async () => {
  await renderScreen();
  await addItem('Milk');

  await fireEvent.press(screen.getByLabelText('Milk'));
  expect(screen.getByLabelText('Milk')).toBeChecked();

  await fireEvent.press(screen.getByLabelText('Milk'));
  expect(screen.getByLabelText('Milk')).not.toBeChecked();
});

it('toggles only the item that was pressed', async () => {
  await renderScreen();
  await addItem('Milk');
  await addItem('Bread');

  await fireEvent.press(screen.getByLabelText('Bread'));

  expect(screen.getByLabelText('Milk')).not.toBeChecked();
  expect(screen.getByLabelText('Bread')).toBeChecked();
});

it('falls back to a not-found state for an unknown list', async () => {
  await render(
    <ListsProvider>
      <ListDetailScreen {...detailProps('does-not-exist')} />
    </ListsProvider>
  );

  expect(screen.getByText('List not found')).toBeOnTheScreen();
});
