import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ListsScreenProps } from '../navigation/types';
import { ListsProvider } from '../state/ListsContext';
import { ListsScreen } from './ListsScreen';

/**
 * The screens take `navigation`/`route` as props rather than calling `useNavigation()`,
 * so a stub is enough here — no NavigationContainer needed.
 *
 * Note: `render` and `fireEvent` are async in React Native Testing Library 14 and must
 * be awaited, otherwise the assertions run before anything has been mounted.
 */
async function renderScreen() {
  const navigation = { navigate: jest.fn(), setOptions: jest.fn() };

  await render(
    <ListsProvider>
      <ListsScreen {...({ navigation } as unknown as ListsScreenProps)} />
    </ListsProvider>
  );

  return { navigation };
}

async function createList(name: string) {
  await fireEvent.changeText(screen.getByLabelText('New list name'), name);
  await fireEvent.press(screen.getByLabelText('Create'));
}

it('shows an empty state before any list exists', async () => {
  await renderScreen();

  expect(screen.getByText('No lists yet')).toBeOnTheScreen();
});

it('creates a list and shows it with an item summary', async () => {
  await renderScreen();

  await createList('Groceries');

  expect(screen.queryByText('No lists yet')).not.toBeOnTheScreen();
  expect(screen.getByText('Groceries')).toBeOnTheScreen();
  expect(screen.getByText('No items yet')).toBeOnTheScreen();
});

it('clears the input after creating a list', async () => {
  await renderScreen();

  await createList('Groceries');

  expect(screen.getByLabelText('New list name')).toHaveDisplayValue('');
});

it('does not create a list from blank input', async () => {
  await renderScreen();

  await createList('   ');

  expect(screen.getByText('No lists yet')).toBeOnTheScreen();
});

it('keeps several lists', async () => {
  await renderScreen();

  await createList('Groceries');
  await createList('Hardware');

  expect(screen.getByText('Groceries')).toBeOnTheScreen();
  expect(screen.getByText('Hardware')).toBeOnTheScreen();
});

it('navigates to the list when a row is pressed', async () => {
  const { navigation } = await renderScreen();

  await createList('Groceries');
  await fireEvent.press(screen.getByLabelText('Groceries, No items yet'));

  expect(navigation.navigate).toHaveBeenCalledWith('ListDetail', {
    listId: expect.any(String),
  });
});
