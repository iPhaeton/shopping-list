import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import { Appearance, Pressable, Text, TextInput, View } from 'react-native';

import { day, night } from '../theme';
import { ThemeProvider, useTheme } from './ThemeContext';

let mounts = 0;

/** Stands in for any screen: paints with the palette, holds a draft, and counts its own mounts. */
function Probe() {
  const { colors, preference, setPreference } = useTheme();
  const [draft, setDraft] = useState('');

  useEffect(() => {
    mounts += 1;
  }, []);

  return (
    <View accessibilityLabel="Probe" style={{ backgroundColor: colors.skyTop }}>
      <Text>{`Preference: ${preference}`}</Text>
      <TextInput accessibilityLabel="Draft" value={draft} onChangeText={setDraft} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose night"
        onPress={() => setPreference('night')}
      />
    </View>
  );
}

async function renderProvider() {
  await render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>
  );
}

beforeEach(async () => {
  jest.restoreAllMocks();
  mounts = 0;
  await AsyncStorage.clear();
});

it('paints nothing while the stored preference is still being read', async () => {
  let release!: (value: string | null) => void;
  jest
    .spyOn(AsyncStorage, 'getItem')
    .mockReturnValueOnce(new Promise((resolve) => (release = resolve)));

  await renderProvider();

  // The state in between, not only the one after: a day frame here is the bug for a night user.
  expect(screen.queryByLabelText('Probe')).toBeNull();

  await act(async () => release(JSON.stringify({ v: 1, preference: 'night' })));

  expect(await screen.findByLabelText('Probe')).toHaveStyle({ backgroundColor: night.skyTop });
});

it('starts in day when nothing was ever chosen', async () => {
  await renderProvider();

  expect(await screen.findByLabelText('Probe')).toHaveStyle({ backgroundColor: day.skyTop });
  expect(screen.getByText('Preference: day')).toBeOnTheScreen();
});

it('restores a stored night choice, and tells the native side', async () => {
  const setColorScheme = jest.spyOn(Appearance, 'setColorScheme');
  await AsyncStorage.setItem('theme-preference', JSON.stringify({ v: 1, preference: 'night' }));

  await renderProvider();

  expect(await screen.findByLabelText('Probe')).toHaveStyle({ backgroundColor: night.skyTop });
  expect(screen.getByText('Preference: night')).toBeOnTheScreen();
  expect(setColorScheme).toHaveBeenLastCalledWith('dark');
});

it('falls back to day when storage cannot be read', async () => {
  jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk on fire'));

  await renderProvider();

  expect(await screen.findByLabelText('Probe')).toHaveStyle({ backgroundColor: day.skyTop });
});

it('switches at once, remounts nothing, and persists the choice', async () => {
  await renderProvider();
  await screen.findByLabelText('Probe');

  await fireEvent.changeText(screen.getByLabelText('Draft'), 'half-typed');
  await fireEvent.press(screen.getByLabelText('Choose night'));

  expect(screen.getByLabelText('Probe')).toHaveStyle({ backgroundColor: night.skyTop });
  expect(screen.getByLabelText('Draft')).toHaveDisplayValue('half-typed');
  expect(mounts).toBe(1);

  await waitFor(async () =>
    expect(JSON.parse((await AsyncStorage.getItem('theme-preference')) ?? 'null')).toEqual({
      v: 1,
      preference: 'night',
    })
  );
});
