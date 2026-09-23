import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import { searchUsers, type UserSuggestion } from '../lib/membersApi';
import { UserAutocomplete } from './UserAutocomplete';

jest.mock('../lib/membersApi', () => ({ searchUsers: jest.fn() }));

afterEach(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(searchUsers).mockResolvedValue({ users: [], error: null });
});

/**
 * Reproduces exactly what `SharingScreen` does around this component: mirror `value`/`selected` in
 * local state, clear `selected` on every edit, set both on a pick. Driving the real prop contract
 * this way, rather than a synthetic harness, is what proves the contract works end to end.
 */
function Harness() {
  const [value, setValue] = useState('');
  const [selected, setSelected] = useState<UserSuggestion | null>(null);

  return (
    <UserAutocomplete
      value={value}
      onChangeText={(text) => {
        setValue(text);
        setSelected(null);
      }}
      onSelect={(user) => {
        setSelected(user);
        setValue(user.name);
      }}
      selected={selected}
    />
  );
}

async function advanceDebounce() {
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
}

it('does not search under 3 trimmed characters', async () => {
  jest.useFakeTimers();
  await render(<Harness />);

  await fireEvent.changeText(screen.getByLabelText('Name'), 'al');
  await advanceDebounce();

  expect(searchUsers).not.toHaveBeenCalled();
});

it('collapses a burst of keystrokes into one debounced search', async () => {
  jest.useFakeTimers();
  await render(<Harness />);

  const input = screen.getByLabelText('Name');
  await fireEvent.changeText(input, 'a');
  await fireEvent.changeText(input, 'al');
  await fireEvent.changeText(input, 'ali');
  await advanceDebounce();

  expect(searchUsers).toHaveBeenCalledTimes(1);
  expect(searchUsers).toHaveBeenCalledWith('ali');
});

it('searches once the debounce settles at 3 or more characters', async () => {
  jest.useFakeTimers();
  await render(<Harness />);

  await fireEvent.changeText(screen.getByLabelText('Name'), 'ali');
  await advanceDebounce();

  expect(searchUsers).toHaveBeenCalledWith('ali');
});

it('renders whatever the server returns, up to 5, as labelled rows', async () => {
  jest.mocked(searchUsers).mockResolvedValue({
    users: [
      { userId: 'u1', name: 'Alice' },
      { userId: 'u2', name: 'Alicia' },
      { userId: 'u3', name: 'Alison' },
      { userId: 'u4', name: 'Allison' },
      { userId: 'u5', name: 'Ally' },
    ],
    error: null,
  });

  jest.useFakeTimers();
  await render(<Harness />);

  await fireEvent.changeText(screen.getByLabelText('Name'), 'ali');
  await advanceDebounce();

  expect(await screen.findByLabelText('Share with Alice')).toBeOnTheScreen();
  expect(screen.getByLabelText('Share with Alicia')).toBeOnTheScreen();
  expect(screen.getByLabelText('Share with Alison')).toBeOnTheScreen();
  expect(screen.getByLabelText('Share with Allison')).toBeOnTheScreen();
  expect(screen.getByLabelText('Share with Ally')).toBeOnTheScreen();
});

it('selecting calls onSelect and clears the suggestion list', async () => {
  jest.mocked(searchUsers).mockResolvedValue({
    users: [{ userId: 'u1', name: 'Carol' }],
    error: null,
  });

  jest.useFakeTimers();
  await render(<Harness />);

  await fireEvent.changeText(screen.getByLabelText('Name'), 'car');
  await advanceDebounce();

  await fireEvent.press(await screen.findByLabelText('Share with Carol'));

  expect(screen.getByLabelText('Name')).toHaveDisplayValue('Carol');
  expect(screen.queryByLabelText('Share with Carol')).not.toBeOnTheScreen();
});

it('editing after a selection clears it and searches again', async () => {
  jest.mocked(searchUsers).mockResolvedValue({
    users: [{ userId: 'u1', name: 'Carol' }],
    error: null,
  });

  jest.useFakeTimers();
  await render(<Harness />);

  await fireEvent.changeText(screen.getByLabelText('Name'), 'car');
  await advanceDebounce();
  await fireEvent.press(await screen.findByLabelText('Share with Carol'));

  jest.mocked(searchUsers).mockClear();
  jest.mocked(searchUsers).mockResolvedValue({
    users: [{ userId: 'u2', name: 'Caroline' }],
    error: null,
  });

  await fireEvent.changeText(screen.getByLabelText('Name'), 'Caro');
  await advanceDebounce();

  expect(searchUsers).toHaveBeenCalledWith('Caro');
  expect(await screen.findByLabelText('Share with Caroline')).toBeOnTheScreen();
});
