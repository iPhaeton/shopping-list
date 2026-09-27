import { DarkTheme, DefaultTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useMemo } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AccountScreen } from '../screens/AccountScreen';
import { ListDetailScreen } from '../screens/ListDetailScreen';
import { ListsScreen } from '../screens/ListsScreen';
import { SetNameScreen } from '../screens/SetNameScreen';
import { SharingScreen } from '../screens/SharingScreen';
import { SignInScreen } from '../screens/SignInScreen';
import { useSession, type AuthState } from '../state/SessionContext';
import { themedStyles, useTheme } from '../state/ThemeContext';
import { fonts } from '../theme';
import type { RootStackParamList } from './types';

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

  // Nothing is known yet about whether a stored session exists; showing either stack here would
  // flash the wrong one.
  if (state.status === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.skyTop },
          headerTintColor: colors.text,
          headerTitleStyle: { fontFamily: fonts.serif },
          headerBackTitleStyle: { fontFamily: fonts.sans },
          contentStyle: { backgroundColor: colors.skyTop },
        }}>
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
          options={{ title: 'ShoppingLoop' }}
        />
      );
    case 'nameRequired':
      return (
        <Stack.Screen name="SetName" component={SetNameScreen} options={{ title: 'Choose a name' }} />
      );
    case 'signedIn':
      return (
        <>
          {/*
            No native header: the title row and Account button are drawn inside `ListsScreen`
            itself, as part of the scrolling sky/horizon composition. `title` stays — it is still
            the iOS back-button label on `Account`, and the web page title.
          */}
          <Stack.Screen name="Lists" component={ListsScreen} options={{ title: 'My Lists', headerShown: false }} />
          {/*
            No native header here either: `ListDetailScreen` draws its back button, Rename/Share
            pills and title as part of its own sky. Back still works without the native button —
            the edge swipe on iOS and the hardware back on Android belong to the stack, not the
            header. `title` still comes from the screen, through `setOptions`.
          */}
          <Stack.Screen name="ListDetail" component={ListDetailScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Sharing" component={SharingScreen} options={{ title: 'Sharing' }} />
          <Stack.Screen name="Account" component={AccountScreen} options={{ title: 'Account' }} />
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
}));
