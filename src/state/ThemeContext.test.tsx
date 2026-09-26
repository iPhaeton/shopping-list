import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import {
  Appearance,
  AppState,
  Pressable,
  Text,
  TextInput,
  View,
  type AppStateStatus,
  type NativeEventSubscription,
} from 'react-native';

import { deviceTimeZone } from '../lib/deviceTimeZone';
import { day, night } from '../theme';
import { ThemeProvider, useTheme } from './ThemeContext';

jest.mock('../lib/deviceTimeZone', () => ({ deviceTimeZone: jest.fn() }));

/**
 * Warsaw at the June solstice: sunset at 21:01, sunrise at 04:14 (NOAA, as in `sun.test.ts`).
 * Every test runs on this faked clock — Auto is the default, so the real time of day would decide
 * what a test sees.
 */
const WARSAW_NOON = new Date('2026-06-21T12:00:00+02:00');
const MINUTE = 60_000;

let mounts = 0;
let appStateListeners: ((state: AppStateStatus) => void)[] = [];

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

/** A phone left open: the clock runs in steps, and each step lets the provider arm its next timer. */
async function letTimePass(ms: number) {
  for (let left = ms; left > 0; left -= 10 * MINUTE) {
    await act(async () => {
      jest.advanceTimersByTime(Math.min(left, 10 * MINUTE));
    });
  }
}

async function comeToTheFront() {
  await act(async () => appStateListeners.forEach((listener) => listener('active')));
}

beforeEach(async () => {
  jest.restoreAllMocks();
  jest.useFakeTimers({ now: WARSAW_NOON });
  jest.mocked(deviceTimeZone).mockReturnValue('Europe/Warsaw');
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListeners.push(listener);
    return {
      remove: () => (appStateListeners = appStateListeners.filter((other) => other !== listener)),
    } as NativeEventSubscription;
  });
  mounts = 0;
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
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

it('starts in Auto when nothing was ever chosen — day, at noon', async () => {
  await renderProvider();

  expect(await screen.findByLabelText('Probe')).toHaveStyle({ backgroundColor: day.skyTop });
  expect(screen.getByText('Preference: auto')).toBeOnTheScreen();
});

it('starts in Auto at night, too', async () => {
  jest.setSystemTime(new Date('2026-06-21T23:30:00+02:00'));

  await renderProvider();

  expect(await screen.findByLabelText('Probe')).toHaveStyle({ backgroundColor: night.skyTop });
});

it('keeps a stored Day however late it is', async () => {
  jest.setSystemTime(new Date('2026-06-21T23:30:00+02:00'));
  await AsyncStorage.setItem('theme-preference', JSON.stringify({ v: 1, preference: 'day' }));

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

it('falls back to Auto when storage cannot be read', async () => {
  jest.setSystemTime(new Date('2026-06-21T23:30:00+02:00'));
  jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk on fire'));

  await renderProvider();

  expect(await screen.findByLabelText('Probe')).toHaveStyle({ backgroundColor: night.skyTop });
  expect(screen.getByText('Preference: auto')).toBeOnTheScreen();
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

describe('under Auto, with the app open', () => {
  it('turns to night at sunset and back at sunrise, remounting nothing', async () => {
    const setColorScheme = jest.spyOn(Appearance, 'setColorScheme');
    jest.setSystemTime(new Date('2026-06-21T20:50:00+02:00'));
    await renderProvider();
    await fireEvent.changeText(await screen.findByLabelText('Draft'), 'half-typed');

    await letTimePass(10 * MINUTE); // 21:00
    expect(screen.getByLabelText('Probe')).toHaveStyle({ backgroundColor: day.skyTop });

    await letTimePass(5 * MINUTE); // 21:05
    expect(screen.getByLabelText('Probe')).toHaveStyle({ backgroundColor: night.skyTop });
    expect(setColorScheme).toHaveBeenLastCalledWith('dark');

    await letTimePass(7 * 60 * MINUTE + 15 * MINUTE); // 04:20 the next morning
    expect(screen.getByLabelText('Probe')).toHaveStyle({ backgroundColor: day.skyTop });
    expect(setColorScheme).toHaveBeenLastCalledWith('light');

    expect(screen.getByLabelText('Draft')).toHaveDisplayValue('half-typed');
    expect(mounts).toBe(1);
  });
});

describe('under Auto, coming back to the front', () => {
  // Timers do not run while the app is in the background; the clock does.
  it('looks at the clock again', async () => {
    await renderProvider();
    await screen.findByLabelText('Probe');

    jest.setSystemTime(new Date('2026-06-21T23:30:00+02:00'));
    expect(screen.getByLabelText('Probe')).toHaveStyle({ backgroundColor: day.skyTop });

    await comeToTheFront();

    expect(screen.getByLabelText('Probe')).toHaveStyle({ backgroundColor: night.skyTop });
  });

  it('looks at the time zone again, after a trip', async () => {
    await renderProvider();
    await screen.findByLabelText('Probe');

    // The same instant is 20:00 in Sydney, a winter evening.
    jest.mocked(deviceTimeZone).mockReturnValue('Australia/Sydney');
    await comeToTheFront();

    expect(screen.getByLabelText('Probe')).toHaveStyle({ backgroundColor: night.skyTop });
  });
});
