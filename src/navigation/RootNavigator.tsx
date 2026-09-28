import { DarkTheme, DefaultTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useMemo } from 'react';
import { ActivityIndicator, Image, View } from 'react-native';

import { ScreenSky } from '../components/Sky';
import { AccountScreen } from '../screens/AccountScreen';
import { ListDetailScreen } from '../screens/ListDetailScreen';
import { ListsScreen } from '../screens/ListsScreen';
import { SetNameScreen } from '../screens/SetNameScreen';
import { SharingScreen } from '../screens/SharingScreen';
import { SignInScreen } from '../screens/SignInScreen';
import { useSession, type AuthState } from '../state/SessionContext';
import { themedStyles, useTheme } from '../state/ThemeContext';
import { hideSplash } from './splash';
import type { RootStackParamList } from './types';

/** The launch emblem, the same image the native splash shows (`app.json`), one per theme. */
const EMBLEM = {
  day: require('../../assets/splash/emblem-day.png'),
  night: require('../../assets/splash/emblem-night.png'),
};

/** Its width on the splash, `imageWidth` in `app.json` — measured off the launch mockups. */
const EMBLEM_SIZE = 152;

/** Lets the splash go even if the emblem never reports loading, rather than hold the app closed. */
const EMBLEM_WAIT_MS = 1500;

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { state } = useSession();
  const { name, colors } = useTheme();
  const styles = useStyles();

  // What the navigator paints where no screen does — behind a push, say. Left at React Navigation's
  // default, that is a white card sliding across the night sky.
  const navigationTheme = useMemo<Theme>(() => {
    const base = name === 'night' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.primary,
        background: colors.skyTop,
        card: colors.skyTop,
        text: colors.text,
        border: colors.divider,
      },
    };
  }, [name, colors]);

  const loading = state.status === 'loading';
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(hideSplash, EMBLEM_WAIT_MS);
    return () => clearTimeout(timer);
  }, [loading]);

  // Nothing is known yet about whether a stored session exists; showing either stack here would
  // flash the wrong one. What shows instead carries on from the native launch screen, which hides
  // over it once the emblem is drawn: the same emblem in the same place, now on the in-app theme's
  // sky, with a spinner below.
  if (state.status === 'loading') {
    return (
      <View style={styles.loading}>
        <View
          style={styles.sky}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants">
          <ScreenSky />
        </View>
        <Image
          source={EMBLEM[name]}
          style={styles.emblem}
          accessibilityIgnoresInvertColors
          onLoad={hideSplash}
          onError={hideSplash}
        />
        <ActivityIndicator color={colors.primary} style={styles.spinner} />
      </View>
    );
  }

  // Every screen draws its own header, so none of the native header's styling lives here.
  return (
    <NavigationContainer theme={navigationTheme} onReady={hideSplash}>
      <Stack.Navigator screenOptions={{ contentStyle: { backgroundColor: colors.skyTop } }}>
        {screensFor(state)}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

/**
 * A `switch` on the union rather than `session ? app : signIn`, so a further state — a biometric
 * `locked`, say — is one new case here instead of an edit to every branch point in the app.
 */
function screensFor(state: Exclude<AuthState, { status: 'loading' }>) {
  switch (state.status) {
    case 'signedOut':
      return (
        <Stack.Screen
          name="SignIn"
          component={SignInScreen}
          options={{ title: 'ShoppingLoop', headerShown: false }}
        />
      );
    case 'nameRequired':
      return (
        <Stack.Screen
          name="SetName"
          component={SetNameScreen}
          options={{ title: 'Choose a name', headerShown: false }}
        />
      );
    case 'signedIn':
      return (
        <>
          {/*
            No native header on any screen: each draws its own — Lists its title row and Account
            pill, the others a round Back and a serif title. `title` stays for the web page title.
            Back still works without the native button: the edge swipe on iOS and the hardware back
            on Android belong to the stack, not the header.
          */}
          <Stack.Screen name="Lists" component={ListsScreen} options={{ title: 'My Lists', headerShown: false }} />
          {/* `ListDetail`'s title comes from the screen, through `setOptions`. */}
          <Stack.Screen name="ListDetail" component={ListDetailScreen} options={{ headerShown: false }} />
          <Stack.Screen
            name="Sharing"
            component={SharingScreen}
            options={{ title: 'Sharing', headerShown: false }}
          />
          <Stack.Screen
            name="Account"
            component={AccountScreen}
            options={{ title: 'Account', headerShown: false }}
          />
        </>
      );
  }
}

const useStyles = themedStyles((colors) => ({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.skyTop,
  },
  sky: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  emblem: {
    width: EMBLEM_SIZE,
    height: EMBLEM_SIZE,
  },
  // Below the emblem without moving it off the screen's centre, where the splash drew it.
  spinner: {
    position: 'absolute',
    top: '50%',
    marginTop: EMBLEM_SIZE / 2 + 28,
  },
}));
